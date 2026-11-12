import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Badge, Role } from '@/generated/prisma/client';
import {
  BADGE_CODE_MAX,
  BADGE_CODE_MIN,
  BADGE_DESCRIPTION_MAX,
  BADGE_NAME_MAX,
  badgeSlug,
  badgeState,
  type BadgeView,
  normalizeCode,
} from '@/lib/badges';
import { pictureFrom, stillFrom } from '@/lib/media';
import { audit } from '../audit/audit';
import { db } from '../db';
import { PG, pgErrorCode } from '../db-errors';
import { HttpError, Problems } from '../http/problem';
import { plainText } from '../text/sanitize';

/**
 * Emblemas (2026-11-12, docs/phase-6/README.md §38): time-limited badges for events. The team
 * creates them in the dashboard (art: PNG, GIF or WebM, through the media pipeline); viewers claim
 * them on /emblemas while the window is open, with the claim word when there is one. The window
 * and the limit are enforced by the database (badge_claim_guard), not only here.
 */
type Ctx = { actor: { id: string; role: Role }; requestId: string | null };

const assetSelect = { select: { width: true, height: true, variants: true } } as const;

export const BadgeProblems = {
  notFound: () => new HttpError(404, 'BADGE_NOT_FOUND', 'Emblema não encontrado.'),
  closed: () =>
    new HttpError(409, 'BADGE_CLOSED', 'Esse emblema não está disponível para resgate agora.'),
  full: () =>
    new HttpError(409, 'BADGE_FULL', 'Os emblemas desse evento acabaram. Fica para a próxima!'),
  wrongCode: () =>
    new HttpError(422, 'BADGE_CODE', 'Palavra errada. Ela é dita na live durante o evento.'),
  hasClaims: () =>
    new HttpError(
      409,
      'BADGE_HAS_CLAIMS',
      'Esse emblema já foi resgatado por alguém: encerre em vez de apagar.',
    ),
};

function codeHash(raw: string): Buffer {
  return createHash('sha256')
    .update(`wf:badge:${normalizeCode(raw)}`)
    .digest();
}

// ── reading ──────────────────────────────────────────────────────────────────

type Row = Badge & {
  asset: { width: number; height: number; variants: unknown };
  _count: { claims: number };
  claims?: { claimedAt: Date }[];
};

function view(b: Row, now: Date): BadgeView {
  return {
    id: b.id,
    slug: b.slug,
    name: b.name,
    description: b.description,
    picture: pictureFrom(b.asset),
    still: stillFrom(b.asset),
    startsAt: b.startsAt.toISOString(),
    endsAt: b.endsAt.toISOString(),
    state: badgeState(b, now),
    needsCode: b.codeHash !== null,
    maxClaims: b.maxClaims,
    claims: b._count.claims,
    claimedAt: b.claims?.[0]?.claimedAt.toISOString() ?? null,
  };
}

const include = (viewerId: string | null) => ({
  asset: assetSelect,
  _count: { select: { claims: true } },
  ...(viewerId
    ? { claims: { where: { userId: viewerId }, select: { claimedAt: true }, take: 1 } }
    : {}),
});

/** /emblemas: open ones (ending soonest first), coming ones, then the past ones (newest first). */
export async function publicBadges(
  viewerId: string | null,
  now = new Date(),
): Promise<BadgeView[]> {
  const rows = await db().badge.findMany({ include: include(viewerId), take: 200 });
  const order = { open: 0, upcoming: 1, closed: 2 } as const;
  return rows
    .map((r) => view(r as Row, now))
    .sort((a, b) =>
      a.state !== b.state
        ? order[a.state] - order[b.state]
        : a.state === 'closed'
          ? b.endsAt.localeCompare(a.endsAt)
          : a.state === 'open'
            ? a.endsAt.localeCompare(b.endsAt)
            : a.startsAt.localeCompare(b.startsAt),
    );
}

/** The badges open right now (the home page's call-out). */
export async function openBadges(now = new Date()): Promise<BadgeView[]> {
  const rows = await db().badge.findMany({
    where: { startsAt: { lte: now }, endsAt: { gt: now } },
    include: include(null),
    orderBy: { endsAt: 'asc' },
    take: 3,
  });
  return rows.map((r) => view(r as Row, now));
}

/** A viewer's collection, newest first. */
export async function badgesOf(userId: string, now = new Date()): Promise<BadgeView[]> {
  const claims = await db().badgeClaim.findMany({
    where: { userId },
    orderBy: { claimedAt: 'desc' },
    include: { badge: { include: include(userId) } },
    take: 200,
  });
  return claims.map((c) => view(c.badge as Row, now));
}

export type AdminBadgeView = BadgeView & { assetId: string };

/** The dashboard's list: everything, newest first (with the art's id, for editing). */
export async function adminBadges(now = new Date()): Promise<AdminBadgeView[]> {
  const rows = await db().badge.findMany({
    include: include(null),
    orderBy: { startsAt: 'desc' },
    take: 200,
  });
  return rows.map((r) => ({ ...view(r as Row, now), assetId: r.assetId }));
}

// ── claiming ─────────────────────────────────────────────────────────────────

export const claimInput = z.object({ code: z.string().max(200).optional() }).strict();

export async function claimBadge(
  user: { id: string; status: string; username: string | null },
  slug: string,
  code: string | undefined,
  now = new Date(),
): Promise<BadgeView> {
  if (!user.username)
    throw new HttpError(
      409,
      'ONBOARDING_REQUIRED',
      'Escolha seu nome de usuário antes de resgatar.',
    );
  if (user.status !== 'ACTIVE')
    throw new HttpError(403, 'ACCOUNT_SUSPENDED', 'Sua conta está suspensa.');
  const badge = await db().badge.findUnique({ where: { slug } });
  if (!badge) throw BadgeProblems.notFound();
  if (badgeState(badge, now) !== 'open') throw BadgeProblems.closed();
  if (badge.codeHash) {
    const given = codeHash(code ?? '');
    const stored = Buffer.from(badge.codeHash);
    if (!code || stored.length !== given.length || !timingSafeEqual(stored, given))
      throw BadgeProblems.wrongCode();
  }
  try {
    await db().badgeClaim.create({ data: { badgeId: badge.id, userId: user.id } });
  } catch (err) {
    const pg = pgErrorCode(err);
    if (pg === PG.badgeClosed) throw BadgeProblems.closed();
    if (pg === PG.badgeFull) throw BadgeProblems.full();
    if (pg !== PG.uniqueViolation) throw err;
    // already theirs: claiming twice is fine
  }
  const row = await db().badge.findUniqueOrThrow({
    where: { id: badge.id },
    include: include(user.id),
  });
  return view(row as Row, now);
}

// ── the dashboard ────────────────────────────────────────────────────────────

const iso = z.iso.datetime({ offset: true });
export const badgeInput = z
  .object({
    name: z.string().max(200),
    description: z.string().max(1_000),
    assetId: z.uuid(),
    startsAt: iso,
    endsAt: iso,
    /** the claim word; null: none; omitted on an edit: unchanged */
    code: z.string().max(200).nullable().optional(),
    maxClaims: z.int().min(1).max(1_000_000).nullable(),
  })
  .strict();
type BadgeInput = z.infer<typeof badgeInput>;

async function checked(input: BadgeInput, now: Date, isNew: boolean) {
  const errors: { path: string; message: string }[] = [];
  const name = plainText(input.name).trim();
  const description = plainText(input.description).trim();
  if (!name) errors.push({ path: 'name', message: 'Dê um nome ao emblema.' });
  else if ([...name].length > BADGE_NAME_MAX)
    errors.push({ path: 'name', message: `Use no máximo ${BADGE_NAME_MAX} caracteres.` });
  if ([...description].length > BADGE_DESCRIPTION_MAX)
    errors.push({
      path: 'description',
      message: `Use no máximo ${BADGE_DESCRIPTION_MAX} caracteres.`,
    });
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (endsAt <= startsAt)
    errors.push({ path: 'endsAt', message: 'O fim precisa ser depois do começo.' });
  else if (isNew && endsAt <= now)
    errors.push({ path: 'endsAt', message: 'Esse período já acabou.' });
  let code: Buffer | null | undefined = undefined;
  if (input.code === null) code = null;
  else if (input.code !== undefined) {
    const n = normalizeCode(input.code);
    if (n.length < BADGE_CODE_MIN || n.length > BADGE_CODE_MAX)
      errors.push({
        path: 'code',
        message: `A palavra precisa ter de ${BADGE_CODE_MIN} a ${BADGE_CODE_MAX} letras ou números.`,
      });
    else code = codeHash(n);
  }
  const asset = await db().mediaAsset.findUnique({
    where: { id: input.assetId },
    select: { role: true },
  });
  if (!asset || asset.role !== 'BADGE')
    errors.push({ path: 'assetId', message: 'Envie a arte do emblema (PNG, GIF ou WebM).' });
  if (errors.length) throw Problems.validation(errors);
  return { name, description, startsAt, endsAt, code, maxClaims: input.maxClaims };
}

const minutes = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60_000);

export async function createBadge(ctx: Ctx, input: BadgeInput, now = new Date()) {
  const c = await checked(input, now, true);
  const base = badgeSlug(c.name);
  for (let n = 1; n <= 50; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    try {
      return await db().$transaction(async (t) => {
        const b = await t.badge.create({
          data: {
            slug,
            name: c.name,
            description: c.description,
            assetId: input.assetId,
            startsAt: c.startsAt,
            endsAt: c.endsAt,
            codeHash: c.code ? new Uint8Array(c.code) : null,
            maxClaims: c.maxClaims,
            createdById: ctx.actor.id,
          },
        });
        await audit(
          {
            action: 'badge.create',
            actor: ctx.actor,
            requestId: ctx.requestId,
            targetType: 'Badge',
            targetId: b.id,
            metadata: {
              hasCode: !!c.code,
              maxClaims: c.maxClaims,
              minutes: minutes(c.startsAt, c.endsAt),
            },
          },
          t,
        );
        return b;
      });
    } catch (err) {
      if (pgErrorCode(err) !== PG.uniqueViolation) throw err;
    }
  }
  throw new HttpError(409, 'BADGE_SLUG', 'Já existem emblemas demais com esse nome.');
}

export async function updateBadge(ctx: Ctx, id: string, input: BadgeInput, now = new Date()) {
  const existing = await db().badge.findUnique({ where: { id } });
  if (!existing) throw BadgeProblems.notFound();
  const c = await checked(input, now, false);
  return db().$transaction(async (t) => {
    const b = await t.badge.update({
      where: { id },
      data: {
        name: c.name,
        description: c.description,
        assetId: input.assetId,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        ...(c.code === undefined ? {} : { codeHash: c.code ? new Uint8Array(c.code) : null }),
        maxClaims: c.maxClaims,
      },
    });
    await audit(
      {
        action: 'badge.update',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'Badge',
        targetId: id,
        metadata: {
          hasCode: b.codeHash !== null,
          maxClaims: c.maxClaims,
          minutes: minutes(c.startsAt, c.endsAt),
        },
      },
      t,
    );
    return b;
  });
}

/** Closes the window now (an event that ended early). */
export async function endBadge(ctx: Ctx, id: string, now = new Date()) {
  const b = await db().badge.findUnique({ where: { id } });
  if (!b) throw BadgeProblems.notFound();
  if (b.endsAt <= now) return b;
  const startsAt = b.startsAt > now ? new Date(now.getTime() - 1) : b.startsAt;
  return db().$transaction(async (t) => {
    const out = await t.badge.update({ where: { id }, data: { startsAt, endsAt: now } });
    await audit(
      {
        action: 'badge.end',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'Badge',
        targetId: id,
        metadata: { claims: await t.badgeClaim.count({ where: { badgeId: id } }) },
      },
      t,
    );
    return out;
  });
}

/** Deletes a badge nobody has (one with claims is part of people's collections: end it). */
export async function deleteBadge(ctx: Ctx, id: string) {
  const b = await db().badge.findUnique({
    where: { id },
    include: { _count: { select: { claims: true } } },
  });
  if (!b) throw BadgeProblems.notFound();
  if (b._count.claims) throw BadgeProblems.hasClaims();
  try {
    await db().$transaction(async (t) => {
      await t.badge.delete({ where: { id } });
      await audit(
        {
          action: 'badge.delete',
          actor: ctx.actor,
          requestId: ctx.requestId,
          targetType: 'Badge',
          targetId: id,
          metadata: { claims: 0 },
        },
        t,
      );
    });
  } catch (err) {
    if (pgErrorCode(err) === PG.foreignKeyViolation) throw BadgeProblems.hasClaims();
    throw err;
  }
}
