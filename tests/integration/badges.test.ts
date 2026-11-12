/**
 * Emblemas (2026-11-12, prisma/migrations/*_badges_constraints): the team creates a time-limited
 * badge, viewers claim it while the window is open (with the claim word when there is one, up to
 * the limit), the database guards the window and the limit, everything audited, in the LGPD export.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { POST as createRoute } from '@/app/api/v1/admin/badges/route';
import { DELETE as deleteRoute, PATCH as patchRoute } from '@/app/api/v1/admin/badges/[id]/route';
import { POST as endRoute } from '@/app/api/v1/admin/badges/[id]/end/route';
import { POST as claimRoute } from '@/app/api/v1/badges/[slug]/claim/route';
import { badgeSlug, normalizeCode } from '@/lib/badges';
import { badgesOf, openBadges, publicBadges } from '@/server/badges/badges';
import { db } from '@/server/db';
import { eraseMyAccount, exportMyData } from '@/server/users/lgpd';
import { clearCatalog, makeAsset } from '../support/catalog';
import { makeUser } from '../support/db';
import { signedIn } from '../support/http';
import { as, hit } from '../support/live';

beforeEach(async () => {
  await clearCatalog();
});

type Who = Awaited<ReturnType<typeof as>>;
const H = 3_600_000;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

async function create(who: Who, over: Record<string, unknown> = {}) {
  const art = await makeAsset('BADGE');
  return hit(createRoute, 'POST', '/api/v1/admin/badges', {
    who,
    body: {
      name: 'Maratona Senhor dos Anéis',
      description: 'Para quem aguentou as 12 horas.',
      assetId: art.id,
      startsAt: at(-H),
      endsAt: at(5 * H),
      maxClaims: null,
      ...over,
    },
  });
}

const claim = (who: Who, slug: string, body: unknown = {}, ip?: string) =>
  hit(claimRoute, 'POST', `/api/v1/badges/${slug}/claim`, {
    who,
    body,
    params: { slug },
    ...(ip ? { ip } : {}),
  });

let ipSeq = 0;
const freshIp = () => `10.77.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;

describe('emblemas', () => {
  it('a moderator creates one; a viewer claims it once and it is in their collection', async () => {
    const mod = await as('MODERATOR');
    const r = await create(mod);
    expect(r.res.status).toBe(201);
    expect(r.json.slug).toBe('maratona-senhor-dos-aneis');

    const viewer = await as('USER');
    const c = await claim(viewer, 'maratona-senhor-dos-aneis');
    expect(c.res.status).toBe(200);
    const badge = c.json.badge as { claimedAt: string | null; claims: number; state: string };
    expect(badge.state).toBe('open');
    expect(badge.claims).toBe(1);
    expect(badge.claimedAt).not.toBeNull();
    // twice is fine, still one
    expect((await claim(viewer, 'maratona-senhor-dos-aneis')).res.status).toBe(200);
    expect(await db().badgeClaim.count()).toBe(1);

    expect((await badgesOf(viewer.user.id)).map((b) => b.name)).toEqual([
      'Maratona Senhor dos Anéis',
    ]);
    expect((await openBadges()).map((b) => b.slug)).toEqual(['maratona-senhor-dos-aneis']);
    const pub = await publicBadges(null);
    expect(pub[0]!.claimedAt).toBeNull();
    expect(pub[0]!.picture?.fallback).toMatch(/^\/media\//);

    const log = await db().auditLog.findFirstOrThrow({
      where: { actorId: mod.user.id, action: 'badge.create' },
    });
    expect(log.metadata).toEqual({ hasCode: false, maxClaims: null, minutes: 360 });

    // a second badge with the same name gets its own address
    expect((await create(mod)).json.slug).toBe('maratona-senhor-dos-aneis-2');
  });

  it('the claim word: accents, case and punctuation do not matter; a wrong word is refused', async () => {
    const mod = await as('MODERATOR');
    await create(mod, { name: 'Sessão Ghibli', code: 'Totoro Ônibus!' });
    const v = await as('USER');
    expect((await claim(v, 'sessao-ghibli')).res.status).toBe(422);
    const wrong = await claim(v, 'sessao-ghibli', { code: 'catbus' });
    expect(wrong.res.status).toBe(422);
    expect(wrong.json.code).toBe('BADGE_CODE');
    expect((await claim(v, 'sessao-ghibli', { code: '  totoro onibus ' })).res.status).toBe(200);
    // the word is never stored in the clear
    const row = await db().badge.findUniqueOrThrow({ where: { slug: 'sessao-ghibli' } });
    expect(Buffer.from(row.codeHash!).toString('utf8')).not.toContain('totoro');
    expect(row.codeHash!.length).toBe(32);
  });

  it('only while the window is open — before, after and once ended early', async () => {
    const mod = await as('MODERATOR');
    await create(mod, { name: 'Depois', startsAt: at(2 * H), endsAt: at(4 * H) });
    const v = await as('USER');
    const early = await claim(v, 'depois');
    expect(early.res.status).toBe(409);
    expect(early.json.code).toBe('BADGE_CLOSED');
    // upcoming art stays hidden from the public list
    expect((await publicBadges(null)).find((b) => b.slug === 'depois')?.state).toBe('upcoming');

    const r = await create(mod, { name: 'Agora' });
    const ended = await hit(endRoute, 'POST', `/api/v1/admin/badges/${r.json.id}/end`, {
      who: mod,
      params: { id: String(r.json.id) },
    });
    expect(ended.res.status).toBe(200);
    expect((await claim(v, 'agora')).json.code).toBe('BADGE_CLOSED');
    expect(
      await db().auditLog.count({ where: { action: 'badge.end', targetId: String(r.json.id) } }),
    ).toBe(1);

    // the database refuses a claim outside the window even past the service
    const badge = await db().badge.findUniqueOrThrow({ where: { slug: 'depois' } });
    await expect(
      db().badgeClaim.create({ data: { badgeId: badge.id, userId: v.user.id } }),
    ).rejects.toThrow();
  });

  it('a limit holds under a rush of claims', async () => {
    const mod = await as('MODERATOR');
    await create(mod, { name: 'Primeiros', maxClaims: 3 });
    const viewers = await Promise.all(Array.from({ length: 8 }, () => as('USER')));
    const results = await Promise.all(viewers.map((v) => claim(v, 'primeiros', {}, freshIp())));
    const codes = results.map((r) => r.res.status).sort();
    expect(codes.filter((c) => c === 200)).toHaveLength(3);
    expect(results.filter((r) => r.json.code === 'BADGE_FULL')).toHaveLength(5);
    expect(await db().badgeClaim.count()).toBe(3);
  });

  it('suspended accounts, accounts without a username and guests cannot claim', async () => {
    const mod = await as('MODERATOR');
    await create(mod, { name: 'Aberto' });
    const suspended = await makeUser({ status: 'SUSPENDED' });
    const s = await hit(claimRoute, 'POST', '/api/v1/badges/aberto/claim', {
      who: { user: suspended, auth: await signedIn(suspended, new Date()) },
      body: {},
      params: { slug: 'aberto' },
    });
    expect([401, 403]).toContain(s.res.status);
    const fresh = await makeUser({ username: null });
    const f = await hit(claimRoute, 'POST', '/api/v1/badges/aberto/claim', {
      who: { user: fresh, auth: await signedIn(fresh, new Date()) },
      body: {},
      params: { slug: 'aberto' },
    });
    expect(f.res.status).toBe(409);
    expect(f.json.code).toBe('ONBOARDING_REQUIRED');
    const g = await hit(claimRoute, 'POST', '/api/v1/badges/aberto/claim', {
      body: {},
      params: { slug: 'aberto' },
    });
    expect(g.res.status).toBe(401);
    expect(await db().badgeClaim.count()).toBe(0);
    // unknown and malformed slugs
    const v = await as('USER');
    expect((await claim(v, 'nao-existe')).res.status).toBe(404);
    expect((await claim(v, 'NAO--existe')).res.status).toBe(404);
  });

  it('edits keep or replace the word; a claimed badge cannot be deleted, an unclaimed one can', async () => {
    const mod = await as('MODERATOR');
    const r = await create(mod, { name: 'Editável', code: 'pipoca' });
    const id = String(r.json.id);
    const b = await db().badge.findUniqueOrThrow({ where: { id } });
    const patch = (body: Record<string, unknown>) =>
      hit(patchRoute, 'PATCH', `/api/v1/admin/badges/${id}`, {
        who: mod,
        params: { id },
        body: {
          name: 'Editado',
          description: '',
          assetId: b.assetId,
          startsAt: b.startsAt.toISOString(),
          endsAt: b.endsAt.toISOString(),
          maxClaims: 10,
          ...body,
        },
      });
    expect((await patch({})).res.status).toBe(200);
    let row = await db().badge.findUniqueOrThrow({ where: { id } });
    expect(row.name).toBe('Editado');
    expect(row.slug).toBe('editavel'); // the address never changes
    expect(row.codeHash).not.toBeNull();
    expect((await patch({ code: null })).res.status).toBe(200);
    row = await db().badge.findUniqueOrThrow({ where: { id } });
    expect(row.codeHash).toBeNull();

    const v = await as('USER');
    expect((await claim(v, 'editavel')).res.status).toBe(200);
    const del = await hit(deleteRoute, 'DELETE', `/api/v1/admin/badges/${id}`, {
      who: mod,
      params: { id },
    });
    expect(del.res.status).toBe(409);

    const other = await create(mod, { name: 'Ninguém' });
    const del2 = await hit(deleteRoute, 'DELETE', `/api/v1/admin/badges/${other.json.id}`, {
      who: mod,
      params: { id: String(other.json.id) },
    });
    expect(del2.res.status).toBe(204);
    expect(await db().badge.count({ where: { id: String(other.json.id) } })).toBe(0);
  });

  it('validation: names, windows, words, art', async () => {
    const mod = await as('MODERATOR');
    const bad = async (over: Record<string, unknown>) => (await create(mod, over)).res.status;
    expect(await bad({ name: '   ' })).toBe(422);
    expect(await bad({ name: 'x'.repeat(41) })).toBe(422);
    expect(await bad({ endsAt: at(-2 * H) })).toBe(422);
    expect(await bad({ startsAt: at(2 * H), endsAt: at(H) })).toBe(422);
    expect(await bad({ code: '!!' })).toBe(422);
    expect(await bad({ maxClaims: 0 })).toBe(422);
    const poster = await makeAsset('POSTER');
    expect(await bad({ assetId: poster.id })).toBe(422);
    expect(await bad({ extra: true })).toBe(422);
    expect(await db().badge.count()).toBe(0);

    const viewer = await as('USER');
    expect((await create(viewer)).res.status).toBe(404);
  });

  it('the database only takes the shapes the code builds', async () => {
    const art = await makeAsset('BADGE');
    const ok = {
      slug: 'ok',
      name: 'Ok',
      description: '',
      assetId: art.id,
      startsAt: new Date(Date.now() - H),
      endsAt: new Date(Date.now() + H),
    };
    for (const over of [
      { slug: 'Com Espaço' },
      { slug: '-x' },
      { name: '' },
      { name: 'a\u0007b' },
      { description: 'x'.repeat(201) },
      { endsAt: new Date(Date.now() - 2 * H) },
      { maxClaims: 0 },
      { codeHash: new Uint8Array(5) },
    ])
      await expect(db().badge.create({ data: { ...ok, ...over } })).rejects.toThrow();
    const b = await db().badge.create({ data: ok });
    const u = await makeUser();
    await db().badgeClaim.create({ data: { badgeId: b.id, userId: u.id } });
    // claims are never edited, and the art can't be deleted from under the badge
    await expect(
      db().badgeClaim.update({
        where: { badgeId_userId: { badgeId: b.id, userId: u.id } },
        data: { claimedAt: new Date(0) },
      }),
    ).rejects.toThrow();
    await expect(db().mediaAsset.delete({ where: { id: art.id } })).rejects.toThrow();
  });

  it('LGPD: the export lists the badges; erasing the account removes the claims', async () => {
    const mod = await as('MODERATOR');
    await create(mod, { name: 'Exportado' });
    const v = await as('USER');
    await claim(v, 'exportado');
    const data = await exportMyData(v.user, null);
    expect(data.badges).toEqual([{ badge: 'Exportado', claimedAt: expect.any(Date) }]);
    await eraseMyAccount(v.user, v.user.username!, null);
    expect(await db().badgeClaim.count({ where: { userId: v.user.id } })).toBe(0);
  });
});

describe('badge helpers', () => {
  it('normalizeCode and badgeSlug', () => {
    expect(normalizeCode('  Maratona! ')).toBe('maratona');
    expect(normalizeCode('ÔNIBUS-gato 2')).toBe('onibusgato2');
    expect(badgeSlug('Maratona Senhor dos Anéis!')).toBe('maratona-senhor-dos-aneis');
    expect(badgeSlug('!!!')).toBe('emblema');
    expect(badgeSlug('a'.repeat(49) + ' bc').length).toBeLessThanOrEqual(50);
    expect(badgeSlug('a'.repeat(49) + ' bc')).not.toMatch(/-$/);
  });
});
