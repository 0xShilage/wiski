/**
 * Phase 6 reviewed SQL (prisma/migrations/*_phase6_constraints): the Links page and suggestions,
 * hit directly through the app role. The 20-series limit is in db-constraints-r1.test.ts.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { pgErrorCode, PG } from '@/server/db-errors';
import { makeUser } from '../support/db';

async function rejects(p: Promise<unknown>, sqlstate: string = PG.checkViolation) {
  let err: unknown = null;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err, 'expected the database to refuse').not.toBeNull();
  const code = pgErrorCode(err) ?? (err as { code?: string }).code;
  if (sqlstate === PG.uniqueViolation) expect(['23505', 'P2002']).toContain(code);
  else expect(code).toBe(sqlstate);
}

beforeEach(async () => {
  await db().socialLink.deleteMany({});
});

describe('SocialLink', () => {
  const link = (over: Record<string, unknown> = {}) =>
    db().socialLink.create({
      data: { label: 'Twitch', url: 'https://twitch.tv/wiski', position: 1, ...over },
    });

  it('https only, a real host, no user-info or spaces; label/note lengths; positions 1–30', async () => {
    await rejects(link({ url: 'http://twitch.tv/wiski' }));
    // eslint-disable-next-line no-script-url -- hostile input under test
    await rejects(link({ url: 'javascript:alert(1)//x.y' }));
    await rejects(link({ url: 'https://localhost/x' }));
    await rejects(link({ url: 'https://user@evil.example/x' }));
    await rejects(link({ url: 'https://twitch.tv/a b' }));
    await rejects(link({ url: `https://x.example/${'a'.repeat(300)}` }));
    await rejects(link({ label: '' }));
    await rejects(link({ label: 'x'.repeat(41) }));
    await rejects(link({ note: 'x'.repeat(81) }));
    await rejects(link({ position: 0 }));
    await rejects(link({ position: 31 }));
    await expect(link({ url: 'https://youtube.com/@wiski?si=1#top' })).resolves.toBeTruthy();
  });

  it('positions are unique, checked at COMMIT (a swap in one transaction works)', async () => {
    const a = await link({ position: 1 });
    const b = await link({ position: 2, label: 'YouTube', url: 'https://youtube.com/@wiski' });
    await rejects(
      db().socialLink.update({ where: { id: b.id }, data: { position: 1 } }),
      PG.uniqueViolation,
    );
    await db().$transaction(async (t) => {
      await t.socialLink.update({ where: { id: a.id }, data: { position: 2 } });
      await t.socialLink.update({ where: { id: b.id }, data: { position: 1 } });
    });
    expect((await db().socialLink.findUniqueOrThrow({ where: { id: b.id } })).position).toBe(1);
  });
});

describe('Suggestion', () => {
  it('lengths, a normalised key, year range; reviewer/time exactly when decided', async () => {
    const u = await makeUser();
    const mod = await makeUser({ role: 'MODERATOR' });
    const mk = (over: Record<string, unknown> = {}) =>
      db().suggestion.create({
        data: { userId: u.id, kind: 'MOVIE', title: 'Duna', titleKey: 'duna', ...over },
      });
    await rejects(mk({ title: '' }));
    await rejects(mk({ title: 'x'.repeat(121) }));
    await rejects(mk({ titleKey: 'Duna' }));
    await rejects(mk({ titleKey: ' duna' }));
    await rejects(mk({ titleKey: 'duna  2' }));
    await rejects(mk({ year: 1800 }));
    await rejects(mk({ note: 'x'.repeat(281) }));
    await rejects(mk({ status: 'ACCEPTED' })); // no reviewedAt
    await rejects(mk({ reviewedAt: new Date(), reviewedById: mod.id })); // NEW with a reviewer
    const s = await mk();
    await expect(
      db().suggestion.update({
        where: { id: s.id },
        data: { status: 'DISMISSED', reviewedAt: new Date(), reviewedById: mod.id },
      }),
    ).resolves.toBeTruthy();
  });

  it('one waiting suggestion per viewer and title; decided ones do not count', async () => {
    const u = await makeUser();
    const mod = await makeUser({ role: 'MODERATOR' });
    const mk = () =>
      db().suggestion.create({
        data: { userId: u.id, kind: 'MOVIE', title: 'Duna', titleKey: 'duna' },
      });
    const first = await mk();
    await rejects(mk(), PG.uniqueViolation);
    await db().suggestion.update({
      where: { id: first.id },
      data: { status: 'ACCEPTED', reviewedAt: new Date(), reviewedById: mod.id },
    });
    await expect(mk()).resolves.toBeTruthy();
    // another viewer may wait with the same title
    const other = await makeUser();
    await expect(
      db().suggestion.create({
        data: { userId: other.id, kind: 'MOVIE', title: 'DUNA', titleKey: 'duna' },
      }),
    ).resolves.toBeTruthy();
  });
});
