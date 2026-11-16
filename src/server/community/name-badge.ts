import 'server-only';
import type { Prisma, Role } from '@/generated/prisma/client';
import { ACHIEVEMENTS } from '@/lib/achievements';
import { pictureFrom, stillFrom } from '@/lib/media';
import type { NameBadge, NameBadgeChoice, NameBadgeOptions } from '@/lib/name-badge';
import { ROLE_LABEL } from '@/lib/roles';
import { audit } from '../audit/audit';
import { badgesOf } from '../badges/badges';
import { db } from '../db';
import { PG, pgErrorCode } from '../db-errors';
import { HttpError } from '../http/problem';
import { logger } from '../log';
import { achievementsFor } from './achievements';

/**
 * "Emblema ao lado do nome" (2026-11-15, docs/phase-6/README.md §51): the one badge a viewer shows
 * next to their @username, Twitch style — an event badge they claimed, a conquista they earned, or
 * (for the team) their role. It follows the same switch as the conquistas and emblemas: a viewer
 * who hides them on /perfil shows no badge either. The database guarantees a single badge, a
 * claimed event badge and a staff role; whether a conquista is still earned (a refund can undo
 * one) is checked when it's chosen and again by the worker.
 */

/** The user fields a page needs to draw the badge (add to any `user: { select }`). */
export const nameBadgeUserSelect = {
  role: true,
  showAchievements: true,
  nameBadgeRole: true,
  nameBadgeAchievement: true,
  nameBadgeEmblem: {
    select: {
      slug: true,
      name: true,
      asset: { select: { width: true, height: true, variants: true, lqip: true } },
    },
  },
} satisfies Prisma.UserSelect;

export type NameBadgeUser = Prisma.UserGetPayload<{ select: typeof nameBadgeUserSelect }>;

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

/** The badge to draw next to this user's name, or null. */
export function nameBadgeOf(u: NameBadgeUser | null | undefined): NameBadge | null {
  if (!u || !u.showAchievements) return null;
  if (u.nameBadgeRole && u.role !== 'USER') {
    return { kind: 'role', role: u.role, name: ROLE_LABEL[u.role] };
  }
  if (u.nameBadgeAchievement) {
    const a = BY_ID.get(u.nameBadgeAchievement);
    return a ? { kind: 'achievement', id: a.id, name: a.label, group: a.group } : null;
  }
  if (u.nameBadgeEmblem) {
    const e = u.nameBadgeEmblem;
    return {
      kind: 'emblem',
      slug: e.slug,
      name: e.name,
      picture: pictureFrom(e.asset),
      still: stillFrom(e.asset),
    };
  }
  return null;
}

type Viewer = {
  id: string;
  role: Role;
  createdAt: Date;
  isVip: boolean;
  showAchievements: boolean;
  nameBadgeRole: boolean;
  nameBadgeAchievement: string | null;
  nameBadgeEmblemId: string | null;
};

function currentChoice(u: Viewer, emblemSlug: string | null): NameBadgeChoice {
  if (u.nameBadgeRole) return { kind: 'role' };
  if (u.nameBadgeAchievement) return { kind: 'achievement', id: u.nameBadgeAchievement };
  if (u.nameBadgeEmblemId && emblemSlug) return { kind: 'emblem', slug: emblemSlug };
  return { kind: 'none' };
}

/** /perfil: what this viewer may pick (their role, their event badges, their conquistas). */
export async function nameBadgeOptions(u: Viewer, now = new Date()): Promise<NameBadgeOptions> {
  const [emblems, achievements] = await Promise.all([badgesOf(u.id, now), achievementsFor(u, now)]);
  const options: NameBadgeOptions['options'] = [];
  if (u.role !== 'USER') {
    options.push({
      choice: { kind: 'role' },
      badge: { kind: 'role', role: u.role, name: ROLE_LABEL[u.role] },
    });
  }
  for (const e of emblems) {
    options.push({
      choice: { kind: 'emblem', slug: e.slug },
      badge: { kind: 'emblem', slug: e.slug, name: e.name, picture: e.picture, still: e.still },
    });
  }
  for (const a of achievements.filter((x) => x.earned)) {
    options.push({
      choice: { kind: 'achievement', id: a.id },
      badge: { kind: 'achievement', id: a.id, name: a.label, group: a.group },
    });
  }
  const shown = u.nameBadgeEmblemId ? emblems.find((e) => e.id === u.nameBadgeEmblemId) : null;
  return {
    current: currentChoice(u, shown?.slug ?? null),
    options,
    visible: u.showAchievements,
  };
}

const unavailable = () =>
  new HttpError(422, 'NAME_BADGE_UNAVAILABLE', 'Esse emblema não está disponível para você.');

/** Pick (or clear, with `none`) the badge next to the name. */
export async function setNameBadge(
  u: Viewer,
  choice: NameBadgeChoice,
  requestId: string | null,
  now = new Date(),
): Promise<void> {
  const data = { nameBadgeRole: false, nameBadgeAchievement: null, nameBadgeEmblemId: null } as {
    nameBadgeRole: boolean;
    nameBadgeAchievement: string | null;
    nameBadgeEmblemId: string | null;
  };
  if (choice.kind === 'role') {
    if (u.role === 'USER') throw unavailable();
    data.nameBadgeRole = true;
  } else if (choice.kind === 'achievement') {
    const earned = (await achievementsFor(u, now)).find((a) => a.id === choice.id && a.earned);
    if (!earned) throw unavailable();
    data.nameBadgeAchievement = earned.id;
  } else if (choice.kind === 'emblem') {
    const claim = await db().badgeClaim.findFirst({
      where: { userId: u.id, badge: { slug: choice.slug } },
      select: { badgeId: true },
    });
    if (!claim) throw unavailable();
    data.nameBadgeEmblemId = claim.badgeId;
  }
  try {
    await db().$transaction(async (t) => {
      await t.user.update({ where: { id: u.id }, data });
      await audit(
        {
          action: 'user.nameBadge',
          actor: { id: u.id, role: u.role },
          requestId,
          targetType: 'User',
          targetId: u.id,
          metadata: { kind: choice.kind },
        },
        t,
      );
    });
  } catch (err) {
    // the claim vanished between the check and the write (the account's data was erased)
    if (pgErrorCode(err) === PG.nameBadgeNotClaimed) throw unavailable();
    throw err;
  }
}

/**
 * Worker ("users.nameBadges", a few times a day): a conquista shown next to a name that is no
 * longer earned (a refund took a sponsorship away, a review was removed) is taken off.
 */
export async function revalidateNameBadges(now = new Date(), limit = 500): Promise<number> {
  const rows = await db().user.findMany({
    where: { nameBadgeAchievement: { not: null } },
    select: { id: true, createdAt: true, isVip: true, nameBadgeAchievement: true },
    take: limit,
  });
  let cleared = 0;
  for (const u of rows) {
    const earned = (await achievementsFor(u, now)).some(
      (a) => a.id === u.nameBadgeAchievement && a.earned,
    );
    if (earned) continue;
    await db().$transaction(async (t) => {
      const res = await t.user.updateMany({
        where: { id: u.id, nameBadgeAchievement: u.nameBadgeAchievement },
        data: { nameBadgeAchievement: null },
      });
      if (res.count !== 1) return;
      await audit(
        {
          action: 'user.nameBadge',
          actor: null,
          requestId: null,
          targetType: 'User',
          targetId: u.id,
          metadata: { kind: 'none', reason: 'not-earned' },
        },
        t,
      );
    });
    cleared += 1;
  }
  if (cleared) logger.info({ cleared }, 'name badges no longer earned were taken off');
  return cleared;
}
