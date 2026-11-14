import 'server-only';
import type { LiveDayOffReason, Role } from '@/generated/prisma/client';
import type { DayOff } from '@/lib/live/days-off';
import { audit } from '../audit/audit';
import { db } from '../db';
import { pgErrorCode, PG } from '../db-errors';
import { HttpError, Problems } from '../http/problem';
import { todaySaoPaulo } from '../releases/releases';
import { cleanNote } from './schedule';

/**
 * "Dias sem live" (2026-11-13): the dashboard marks one day, or a stretch of up to 31 days, as
 * "Folga", "Viagem" or "Sem live" with a short public note; the Cronograma shows it among the
 * lives so viewers know there's no live and why. Days are São Paulo calendar days (DATE); two
 * stretches never overlap (exclusion constraint). Lives already planned on those days are left
 * alone: the Agenda points them out, and Iara decides.
 */
type Ctx = { actor: { id: string; role: Role }; requestId: string | null };

export const DAY_OFF_MAX_DAYS = 31;
/** Stretches shown ahead on the Cronograma. */
export const DAY_OFF_PUBLIC_HORIZON_DAYS = 60;

export const DayOffProblems = {
  overlap: () =>
    new HttpError(409, 'DAY_OFF_OVERLAP', 'Já existe um dia sem live marcado nessas datas.'),
};

export type { DayOff };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDay = (s: string) => new Date(`${s}T00:00:00.000Z`);

function view(r: {
  id: string;
  startsOn: Date;
  endsOn: Date;
  reason: LiveDayOffReason;
  note: string | null;
}): DayOff {
  return {
    id: r.id,
    startsOn: iso(r.startsOn),
    endsOn: iso(r.endsOn),
    reason: r.reason,
    note: r.note,
  };
}

/** Today on, soonest first (the Agenda and the Cronograma). */
export async function daysOff(now = new Date(), horizonDays?: number): Promise<DayOff[]> {
  const today = todaySaoPaulo(now);
  const rows = await db().liveDayOff.findMany({
    where: {
      endsOn: { gte: today },
      ...(horizonDays
        ? { startsOn: { lte: new Date(today.getTime() + horizonDays * 86_400_000) } }
        : {}),
    },
    orderBy: { startsOn: 'asc' },
    take: 40,
  });
  return rows.map(view);
}

export async function createDayOff(
  ctx: Ctx,
  input: {
    startsOn: string;
    endsOn?: string | undefined;
    reason: LiveDayOffReason;
    note?: string | null | undefined;
  },
  now = new Date(),
): Promise<DayOff> {
  const startsOn = asDay(input.startsOn);
  const endsOn = asDay(input.endsOn ?? input.startsOn);
  if (endsOn < startsOn) {
    throw Problems.validation([
      { path: 'endsOn', message: 'O último dia vem depois do primeiro.' },
    ]);
  }
  if ((endsOn.getTime() - startsOn.getTime()) / 86_400_000 + 1 > DAY_OFF_MAX_DAYS) {
    throw Problems.validation([
      { path: 'endsOn', message: `Marque no máximo ${DAY_OFF_MAX_DAYS} dias de uma vez.` },
    ]);
  }
  if (endsOn < todaySaoPaulo(now)) {
    throw Problems.validation([{ path: 'startsOn', message: 'Essas datas já passaram.' }]);
  }
  const note = cleanNote(input.note) ?? null;
  try {
    return await db().$transaction(async (t) => {
      const row = await t.liveDayOff.create({
        data: { startsOn, endsOn, reason: input.reason, note, createdById: ctx.actor.id },
      });
      await audit(
        {
          action: 'dayoff.create',
          actor: ctx.actor,
          requestId: ctx.requestId,
          targetType: 'LiveDayOff',
          targetId: row.id,
          metadata: {
            reason: row.reason,
            days: (endsOn.getTime() - startsOn.getTime()) / 86_400_000 + 1,
            note: note !== null,
          },
        },
        t,
      );
      return view(row);
    });
  } catch (err) {
    if (pgErrorCode(err) === PG.exclusionViolation) throw DayOffProblems.overlap();
    throw err;
  }
}

export async function deleteDayOff(ctx: Ctx, id: string): Promise<void> {
  await db().$transaction(async (t) => {
    const row = await t.liveDayOff.findUnique({ where: { id } });
    if (!row) throw Problems.notFound();
    await t.liveDayOff.delete({ where: { id } });
    await audit(
      {
        action: 'dayoff.delete',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'LiveDayOff',
        targetId: id,
        metadata: { reason: row.reason },
      },
      t,
    );
  });
}
