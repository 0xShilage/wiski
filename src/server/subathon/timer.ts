import 'server-only';
import type { Prisma, Role, Subathon, SubathonEntryKind } from '@/generated/prisma/client';
import {
  remainingAt,
  SUBATHON_MAX_SECONDS,
  subathonRatesSchema,
  type SubathonRates,
} from '@/lib/subathon';
import { audit } from '../audit/audit';
import { db } from '../db';
import { pgErrorCode, PG } from '../db-errors';
import { HttpError } from '../http/problem';
import { logger } from '../log';
import { publishSubathon } from './overlay';

/**
 * The subathon timer (2026-11-03, docs/phase-6/README.md §10). One subathon is open at a time
 * (database: openSlot). Its clock lives in one place — `endsAt` while RUNNING, `remainingSeconds`
 * otherwise — so the widget can count down on its own and nothing has to tick on the server.
 *
 * Every change of time goes through `applyEntry`: the ledger row (unique per subathon and
 * `externalId`) and the clock move in one transaction, as a compare-and-set on `version`; a
 * repeated source (a re-delivered StreamElements event, the credit sweep running twice) is a
 * no-op. Status changes are compare-and-sets on the version the streamer saw, and are audited.
 */
type Actor = { id: string; role: Role };
type Ctx = { actor: Actor; requestId: string | null };

export const SubathonProblems = {
  none: () => new HttpError(404, 'NO_SUBATHON', 'Nenhum subathon aberto.'),
  alreadyOpen: () =>
    new HttpError(
      409,
      'SUBATHON_OPEN',
      'Já existe um subathon aberto. Encerre-o antes de criar outro.',
    ),
  changed: () =>
    new HttpError(
      409,
      'SUBATHON_CHANGED',
      'O subathon mudou enquanto você editava. Atualize a página.',
    ),
  state: (detail: string) => new HttpError(409, 'SUBATHON_STATE', detail),
};

export function ratesOf(s: Pick<Subathon, 'rates'>): SubathonRates {
  return subathonRatesSchema.parse(s.rates);
}

export async function openSubathon(): Promise<Subathon | null> {
  return db().subathon.findUnique({ where: { openSlot: 1 } });
}

// ── streamer actions ─────────────────────────────────────────────────────────────────────────

export type SubathonSettings = {
  title: string;
  secondsPerReal: number;
  capSeconds: number | null;
  rates: SubathonRates;
};

export async function createSubathon(
  ctx: Ctx,
  input: SubathonSettings & { initialSeconds: number },
): Promise<Subathon> {
  const remaining = Math.min(input.initialSeconds, input.capSeconds ?? SUBATHON_MAX_SECONDS);
  let s: Subathon;
  try {
    s = await db().$transaction(async (t) => {
      const created = await t.subathon.create({
        data: {
          title: input.title,
          initialSeconds: input.initialSeconds,
          remainingSeconds: remaining,
          capSeconds: input.capSeconds,
          secondsPerReal: input.secondsPerReal,
          rates: input.rates,
        },
      });
      await audit(
        {
          action: 'subathon.create',
          actor: ctx.actor,
          requestId: ctx.requestId,
          targetType: 'Subathon',
          targetId: created.id,
          metadata: {
            initialSeconds: input.initialSeconds,
            secondsPerReal: input.secondsPerReal,
            capSeconds: input.capSeconds,
          },
        },
        t,
      );
      return created;
    });
  } catch (err) {
    if (isUnique(err)) throw SubathonProblems.alreadyOpen();
    throw err;
  }
  await publishSubathon(s, null);
  return s;
}

export async function updateSubathon(
  ctx: Ctx,
  id: string,
  input: { [K in keyof SubathonSettings]?: SubathonSettings[K] | undefined } & {
    expectedVersion: number;
  },
): Promise<Subathon> {
  const s = await db().subathon.findUnique({ where: { id } });
  if (!s || s.status === 'ENDED') throw SubathonProblems.none();
  if (s.version !== input.expectedVersion) throw SubathonProblems.changed();
  const data: Prisma.SubathonUpdateManyMutationInput = { version: { increment: 1 } };
  const fields: ('title' | 'secondsPerReal' | 'capSeconds' | 'rates')[] = [];
  if (input.title !== undefined && input.title !== s.title) {
    data.title = input.title;
    fields.push('title');
  }
  if (input.secondsPerReal !== undefined && input.secondsPerReal !== s.secondsPerReal) {
    data.secondsPerReal = input.secondsPerReal;
    fields.push('secondsPerReal');
  }
  if (input.capSeconds !== undefined && input.capSeconds !== s.capSeconds) {
    data.capSeconds = input.capSeconds;
    fields.push('capSeconds');
  }
  if (input.rates !== undefined && JSON.stringify(input.rates) !== JSON.stringify(s.rates)) {
    data.rates = input.rates;
    fields.push('rates');
  }
  if (!fields.length) return s;
  const updated = await db().$transaction(async (t) => {
    const res = await t.subathon.updateMany({
      where: { id, version: s.version, status: { not: 'ENDED' } },
      data,
    });
    if (res.count !== 1) throw SubathonProblems.changed();
    await audit(
      {
        action: 'subathon.update',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'Subathon',
        targetId: id,
        metadata: { fields },
      },
      t,
    );
    return t.subathon.findUniqueOrThrow({ where: { id } });
  });
  await publishSubathon(updated, null);
  return updated;
}

export type SubathonAction = 'start' | 'pause' | 'resume' | 'end';

const FROM: Record<SubathonAction, readonly Subathon['status'][]> = {
  start: ['READY'],
  pause: ['RUNNING'],
  resume: ['PAUSED'],
  end: ['READY', 'RUNNING', 'PAUSED'],
};

export async function changeStatus(
  ctx: Ctx | null,
  id: string,
  action: SubathonAction,
  expectedVersion: number | null,
  now = new Date(),
): Promise<Subathon> {
  const s = await db().subathon.findUnique({ where: { id } });
  if (!s) throw SubathonProblems.none();
  if (expectedVersion !== null && s.version !== expectedVersion) throw SubathonProblems.changed();
  if (!FROM[action].includes(s.status)) {
    throw SubathonProblems.state(
      s.status === 'ENDED'
        ? 'Este subathon já terminou.'
        : 'Esta ação não vale no estado atual. Atualize a página.',
    );
  }
  const left = remainingAt(s, now.getTime());
  // a running timer that already reached zero can only end
  const to: Subathon['status'] =
    action === 'end' || (s.status === 'RUNNING' && left === 0)
      ? 'ENDED'
      : action === 'pause'
        ? 'PAUSED'
        : 'RUNNING';
  const data: Prisma.SubathonUpdateManyMutationInput = {
    status: to,
    version: { increment: 1 },
    ...(to === 'RUNNING'
      ? {
          endsAt: new Date(now.getTime() + left * 1000),
          ...(s.startedAt ? {} : { startedAt: now }),
        }
      : { endsAt: null, remainingSeconds: left }),
    ...(to === 'ENDED' ? { endedAt: now, openSlot: null } : {}),
  };
  const updated = await db().$transaction(async (t) => {
    const res = await t.subathon.updateMany({
      where: { id, version: s.version, status: s.status },
      data,
    });
    if (res.count !== 1) throw SubathonProblems.changed();
    await audit(
      {
        action: 'subathon.status',
        actor: ctx?.actor ?? null,
        requestId: ctx?.requestId ?? null,
        targetType: 'Subathon',
        targetId: id,
        metadata: { from: s.status, to, remainingSeconds: left },
      },
      t,
    );
    return t.subathon.findUniqueOrThrow({ where: { id } });
  });
  await publishSubathon(updated, null);
  return updated;
}

/** Worker: a running timer that reached zero ends (end time = the moment it hit zero). */
export async function finishIfDue(now = new Date()): Promise<boolean> {
  const s = await db().subathon.findFirst({
    where: { status: 'RUNNING', endsAt: { lte: now } },
  });
  if (!s) return false;
  const res = await db().$transaction(async (t) => {
    const r = await t.subathon.updateMany({
      where: { id: s.id, version: s.version, status: 'RUNNING' },
      data: {
        status: 'ENDED',
        endsAt: null,
        remainingSeconds: 0,
        endedAt: s.endsAt!,
        openSlot: null,
        version: { increment: 1 },
      },
    });
    if (r.count !== 1) return false;
    await audit(
      {
        action: 'subathon.status',
        actor: null,
        requestId: null,
        targetType: 'Subathon',
        targetId: s.id,
        metadata: { from: 'RUNNING', to: 'ENDED', remainingSeconds: 0 },
      },
      t,
    );
    return true;
  });
  if (res)
    await publishSubathon(await db().subathon.findUniqueOrThrow({ where: { id: s.id } }), null);
  return res;
}

// ── the ledger ───────────────────────────────────────────────────────────────────────────────

export type EntryInput = {
  kind: SubathonEntryKind;
  externalId: string;
  valueCents: number | null;
  /** asked-for change: positive adds time, negative removes it */
  seconds: number;
  label: string | null;
  orderId?: string | null;
};

export type ApplyOutcome =
  | { result: 'applied'; appliedSeconds: number; subathon: Subathon }
  | { result: 'duplicate' }
  | { result: 'closed' };

class Conflict extends Error {}

/** A unique violation (Prisma's P2002, or the raw SQLSTATE through the pg adapter). */
function isUnique(err: unknown): boolean {
  return (
    (err as { code?: unknown } | null)?.code === 'P2002' || pgErrorCode(err) === PG.uniqueViolation
  );
}

/** How much of `seconds` the timer can take: the cap above, zero below, 90 days at most. */
export function clampSeconds(
  seconds: number,
  remaining: number,
  capSeconds: number | null,
): number {
  if (seconds >= 0) {
    const room = Math.max(
      0,
      Math.min(capSeconds ?? SUBATHON_MAX_SECONDS, SUBATHON_MAX_SECONDS) - remaining,
    );
    return Math.min(seconds, room);
  }
  return Math.max(seconds, -remaining);
}

/**
 * Add (or remove) time on the open subathon, once per `externalId`. Returns 'closed' when no
 * subathon is open or its running timer already reached zero (nothing revives a finished timer).
 */
export async function applyEntry(
  entry: EntryInput,
  now = new Date(),
  opts: { subathonId?: string } = {},
): Promise<ApplyOutcome> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const s = opts.subathonId
      ? await db().subathon.findUnique({ where: { id: opts.subathonId } })
      : await openSubathon();
    if (!s || s.status === 'ENDED') return { result: 'closed' };
    const left = remainingAt(s, now.getTime());
    if (s.status === 'RUNNING' && left === 0) {
      await finishIfDue(now);
      return { result: 'closed' };
    }
    const applied = clampSeconds(entry.seconds, left, s.capSeconds);
    try {
      const { updated, entryId } = await db().$transaction(async (t) => {
        const created = await t.subathonEntry.create({
          data: {
            subathonId: s.id,
            kind: entry.kind,
            externalId: entry.externalId,
            valueCents: entry.valueCents,
            seconds: entry.seconds,
            appliedSeconds: applied,
            label: entry.label,
            orderId: entry.orderId ?? null,
          },
        });
        const res = await t.subathon.updateMany({
          where: { id: s.id, version: s.version, status: s.status },
          data: {
            version: { increment: 1 },
            addedSeconds: { increment: applied },
            ...(s.status === 'RUNNING'
              ? { endsAt: new Date(s.endsAt!.getTime() + applied * 1000) }
              : { remainingSeconds: left + applied }),
          },
        });
        if (res.count !== 1) throw new Conflict();
        return {
          updated: await t.subathon.findUniqueOrThrow({ where: { id: s.id } }),
          entryId: created.id,
        };
      });
      await publishSubathon(updated, {
        id: entryId,
        seconds: applied,
        label: entry.label,
      });
      return { result: 'applied', appliedSeconds: applied, subathon: updated };
    } catch (err) {
      if (err instanceof Conflict) continue; // the clock moved meanwhile: read it again
      if (isUnique(err)) return { result: 'duplicate' };
      throw err;
    }
  }
  logger.warn({ externalId: entry.externalId }, 'subathon entry gave up after conflicts');
  throw SubathonProblems.changed();
}

/** Streamer: add or remove time by hand (idempotent per key), audited. */
export async function adjustTime(
  ctx: Ctx,
  id: string,
  input: { seconds: number; idempotencyKey: string },
  now = new Date(),
): Promise<Subathon> {
  const out = await applyEntry(
    {
      kind: 'MANUAL',
      externalId: `manual:${input.idempotencyKey}`,
      valueCents: null,
      seconds: input.seconds,
      label: input.seconds >= 0 ? 'Tempo adicionado pela streamer' : 'Tempo removido pela streamer',
    },
    now,
    { subathonId: id },
  );
  if (out.result === 'closed') throw SubathonProblems.state('Este subathon já terminou.');
  const s = await db().subathon.findUniqueOrThrow({ where: { id } });
  if (out.result === 'applied') {
    await audit({
      action: 'subathon.adjust',
      actor: ctx.actor,
      requestId: ctx.requestId,
      targetType: 'Subathon',
      targetId: id,
      metadata: { seconds: input.seconds, appliedSeconds: out.appliedSeconds },
    });
  }
  return s;
}
