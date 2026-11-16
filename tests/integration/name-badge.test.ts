/**
 * "Emblema ao lado do nome" (2026-11-15): a viewer picks one of their event badges, conquistas or
 * (team only) their role; it shows next to their @username in reviews, the ranking and the public
 * profile, only while they show conquistas and emblemas. The database keeps it to one badge, a
 * claimed event badge and a staff role; the worker takes off a conquista no longer earned.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PUT as nameBadgeRoute } from '@/app/api/v1/me/name-badge/route';
import { db } from '@/server/db';
import { PG, pgErrorCode } from '@/server/db-errors';
import { nameBadgeOptions, revalidateNameBadges } from '@/server/community/name-badge';
import { ranking } from '@/server/community/rankings';
import { findProfile } from '@/server/reviews/read';
import { eraseMyAccount, exportMyData } from '@/server/users/lgpd';
import { clearCatalog, makeAsset } from '../support/catalog';
import { makeUser } from '../support/db';
import { call, req, signedIn } from '../support/http';
import { listReviews, watchedItem } from '../support/reviews';

beforeEach(async () => {
  await clearCatalog();
});

let seq = 0;
async function openBadge(name = 'Maratona do Anel') {
  seq++;
  const art = await makeAsset('BADGE');
  return db().badge.create({
    data: {
      slug: `maratona-${Date.now().toString(36)}-${seq}`,
      name,
      description: 'Esteve na maratona.',
      assetId: art.id,
      startsAt: new Date(Date.now() - 3_600_000),
      endsAt: new Date(Date.now() + 3_600_000),
    },
  });
}

async function viewer(over: Parameters<typeof makeUser>[0] = {}) {
  const user = await makeUser(over);
  return { user, auth: await signedIn(user) };
}
type V = Awaited<ReturnType<typeof viewer>>;

async function pick(v: V, choice: unknown) {
  const res = await call(
    nameBadgeRoute,
    req('PUT', '/api/v1/me/name-badge', {
      cookies: v.auth.cookies,
      headers: v.auth.headers,
      body: { choice },
    }),
  );
  return { status: res.status, json: (await res.json()) as { code?: string } };
}

async function review(userId: string) {
  const item = await watchedItem();
  await db().review.create({
    data: { itemId: item.id, userId, rating: 5, body: 'Que filme bonito, recomendo muito.' },
  });
  return item;
}

describe('picking the badge next to the name', () => {
  it('an event badge they claimed shows next to their name in reviews and on the profile', async () => {
    const v = await viewer();
    const badge = await openBadge();
    await db().badgeClaim.create({ data: { badgeId: badge.id, userId: v.user.id } });
    expect((await pick(v, { kind: 'emblem', slug: badge.slug })).status).toBe(200);

    const item = await review(v.user.id);
    const { json } = await listReviews(null, item.id);
    const author = (json.reviews as { author: { username: string; badge: unknown } }[])[0]!.author;
    expect(author.badge).toMatchObject({ kind: 'emblem', slug: badge.slug, name: badge.name });
    expect((author.badge as { picture: { webp: string } }).picture.webp).toMatch(/^\/media\//);
    expect((await findProfile(v.user.username!))?.badge).toMatchObject({ kind: 'emblem' });

    const log = await db().auditLog.findFirst({
      where: { action: 'user.nameBadge', targetId: v.user.id },
    });
    expect(log?.metadata).toEqual({ kind: 'emblem' });
  });

  it('only badges they have: not someone else’s event badge, not an unearned conquista, not a role', async () => {
    const v = await viewer();
    const badge = await openBadge();
    expect((await pick(v, { kind: 'emblem', slug: badge.slug })).json.code).toBe(
      'NAME_BADGE_UNAVAILABLE',
    );
    expect((await pick(v, { kind: 'achievement', id: 'review-1' })).status).toBe(422);
    expect((await pick(v, { kind: 'role' })).status).toBe(422);
    expect((await pick(v, { kind: 'achievement', id: '../x' })).status).toBe(422); // schema
    expect((await pick(v, { kind: 'emblem', slug: badge.slug, extra: 1 })).status).toBe(422);
    const row = await db().user.findUniqueOrThrow({ where: { id: v.user.id } });
    expect(row).toMatchObject({
      nameBadgeEmblemId: null,
      nameBadgeAchievement: null,
      nameBadgeRole: false,
    });
  });

  it('a conquista they earned, and the team role; one at a time; none clears it', async () => {
    const mod = await viewer({ role: 'MODERATOR' });
    await review(mod.user.id); // "Primeira crítica"
    const options = await nameBadgeOptions(
      await db().user.findUniqueOrThrow({ where: { id: mod.user.id } }),
    );
    expect(options.options.map((o) => o.choice)).toEqual([
      { kind: 'role' },
      { kind: 'achievement', id: 'review-1' },
    ]);
    expect(options.current).toEqual({ kind: 'none' });

    expect((await pick(mod, { kind: 'achievement', id: 'review-1' })).status).toBe(200);
    let p = await findProfile(mod.user.username!);
    expect(p?.badge).toEqual({
      kind: 'achievement',
      id: 'review-1',
      name: 'Primeira crítica',
      group: 'review',
    });
    expect((await pick(mod, { kind: 'role' })).status).toBe(200);
    p = await findProfile(mod.user.username!);
    expect(p?.badge).toEqual({ kind: 'role', role: 'MODERATOR', name: 'Moderação' });
    const row = await db().user.findUniqueOrThrow({ where: { id: mod.user.id } });
    expect(row.nameBadgeAchievement).toBeNull(); // replaced, not added
    expect((await pick(mod, { kind: 'none' })).status).toBe(200);
    expect((await findProfile(mod.user.username!))?.badge).toBeNull();
  });

  it('shows in the ranking, and hides everywhere when conquistas are hidden', async () => {
    const v = await viewer();
    await review(v.user.id);
    await pick(v, { kind: 'achievement', id: 'review-1' });
    const board = await ranking('criticos', 'geral');
    expect(board.find((r) => r.username === v.user.username)?.badge).toMatchObject({
      kind: 'achievement',
    });
    await db().user.update({ where: { id: v.user.id }, data: { showAchievements: false } });
    expect((await findProfile(v.user.username!))?.badge).toBeNull();
    const item = await review(v.user.id);
    const { json } = await listReviews(null, item.id);
    expect((json.reviews as { author: { badge: unknown } }[])[0]!.author.badge).toBeNull();
  });
});

describe('keeping it true', () => {
  it('the worker takes off a conquista no longer earned (the review was removed)', async () => {
    const v = await viewer();
    await review(v.user.id);
    await pick(v, { kind: 'achievement', id: 'review-1' });
    const shown = async () =>
      (await db().user.findUniqueOrThrow({ where: { id: v.user.id } })).nameBadgeAchievement;
    await revalidateNameBadges(); // other tests' leftovers are cleared too; this one stays
    expect(await shown()).toBe('review-1');
    await db().review.updateMany({ where: { userId: v.user.id }, data: { status: 'REMOVED' } });
    expect(await revalidateNameBadges()).toBeGreaterThanOrEqual(1);
    expect(await shown()).toBeNull();
    const log = await db().auditLog.findFirst({
      where: { action: 'user.nameBadge', targetId: v.user.id, actorId: null },
    });
    expect(log?.metadata).toEqual({ kind: 'none', reason: 'not-earned' });
  });

  it('the database: one badge, a claimed event badge, staff only for the role', async () => {
    const code = async (p: Promise<unknown>) => {
      try {
        await p;
        return null;
      } catch (err) {
        return pgErrorCode(err);
      }
    };
    const v = await viewer();
    const badge = await openBadge();
    expect(
      await code(
        db().user.update({ where: { id: v.user.id }, data: { nameBadgeEmblemId: badge.id } }),
      ),
    ).toBe(PG.nameBadgeNotClaimed);
    expect(
      await code(db().user.update({ where: { id: v.user.id }, data: { nameBadgeRole: true } })),
    ).toBe(PG.checkViolation);
    expect(
      await code(
        db().user.update({ where: { id: v.user.id }, data: { nameBadgeAchievement: 'A B' } }),
      ),
    ).toBe(PG.checkViolation);
    await db().badgeClaim.create({ data: { badgeId: badge.id, userId: v.user.id } });
    expect(
      await code(
        db().user.update({
          where: { id: v.user.id },
          data: { nameBadgeEmblemId: badge.id, nameBadgeAchievement: 'review-1' },
        }),
      ),
    ).toBe(PG.checkViolation);

    // a moderator who loses the role loses the role badge in the same write
    const mod = await makeUser({ role: 'MODERATOR' });
    await db().user.update({ where: { id: mod.id }, data: { nameBadgeRole: true } });
    await db().user.update({ where: { id: mod.id }, data: { role: 'USER' } });
    expect((await db().user.findUniqueOrThrow({ where: { id: mod.id } })).nameBadgeRole).toBe(
      false,
    );
  });

  it('LGPD: exported, and erasing the account takes it off', async () => {
    const v = await viewer();
    const badge = await openBadge();
    await db().badgeClaim.create({ data: { badgeId: badge.id, userId: v.user.id } });
    await pick(v, { kind: 'emblem', slug: badge.slug });
    const full = await db().user.findUniqueOrThrow({ where: { id: v.user.id } });
    const data = await exportMyData(full, null);
    expect(data.account.nameBadge).toEqual({ kind: 'emblem', id: badge.id });
    await eraseMyAccount(full, full.username!, null);
    const row = await db().user.findUniqueOrThrow({ where: { id: v.user.id } });
    expect(row).toMatchObject({
      nameBadgeEmblemId: null,
      nameBadgeAchievement: null,
      nameBadgeRole: false,
    });
  });
});
