/**
 * 2026-11-01: "Próximas temporadas" (Admin › Estreias → Cronograma), the Assistidos list and the
 * posters on the Cronograma.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { pgErrorCode, PG } from '@/server/db-errors';
import { cronograma } from '@/server/live/public';
import { watchedTitles } from '@/server/catalog/read';
import { publicReleases, todaySaoPaulo } from '@/server/releases/releases';
import { GET as listRoute, POST as createRoute } from '@/app/api/v1/admin/releases/route';
import { DELETE as deleteRoute, PATCH as patchRoute } from '@/app/api/v1/admin/releases/[id]/route';
import { clearCatalog, makeAsset, makeItem } from '../support/catalog';
import { makeUser } from '../support/db';
import { as, hit, makeSession, paidMovie, resetSlots } from '../support/live';

const day = (offset: number, now = new Date()) =>
  new Date(todaySaoPaulo(now).getTime() + offset * 86_400_000).toISOString().slice(0, 10);

beforeEach(async () => {
  await db().seasonRelease.deleteMany({});
  await clearCatalog();
  resetSlots();
});

describe('season releases', () => {
  it('moderators add, edit and delete; linked series lend name, poster and link; audited', async () => {
    const mod = await as('MODERATOR');
    const poster = await makeAsset('POSTER');
    const series = await makeItem({ kind: 'SERIES', status: 'ACTIVE', slot: 1, title: 'Bosque' });
    await db().catalogItem.update({ where: { id: series.id }, data: { posterId: poster.id } });

    const linked = await hit(createRoute, 'POST', '', {
      who: mod,
      body: { itemId: series.id, seasonLabel: ' Temporada 4 ', releaseDate: day(10) },
    });
    expect(linked.res.status).toBe(201);
    expect(linked.json).toMatchObject({ title: 'Bosque', seasonLabel: 'Temporada 4' });
    const plain = await hit(createRoute, 'POST', '', {
      who: mod,
      body: { title: 'Outra Série', seasonLabel: 'Parte 2', releaseDate: day(3), note: 'Netflix' },
    });
    expect(plain.res.status).toBe(201);

    const pub = await publicReleases();
    expect(pub.map((r) => r.title)).toEqual(['Outra Série', 'Bosque']); // soonest first
    expect(pub[1]).toMatchObject({ href: `/series/${series.slug}`, released: false });
    expect(pub[1]!.poster?.webp).toMatch(/\/media\//);
    expect(pub[0]).toMatchObject({ href: null, poster: null, note: 'Netflix' });

    const id = plain.json.id as string;
    expect(
      (
        await hit(patchRoute, 'PATCH', '', {
          who: mod,
          params: { id },
          body: { releaseDate: day(-2), note: null },
        })
      ).res.status,
    ).toBe(200);
    const after = await publicReleases();
    expect(after[0]).toMatchObject({ title: 'Outra Série', released: true, note: null });

    const list = await hit(listRoute, 'GET', '', { who: mod });
    expect((list.json.series as { id: string }[]).map((s) => s.id)).toContain(series.id);
    expect((await hit(deleteRoute, 'DELETE', '', { who: mod, params: { id } })).res.status).toBe(
      204,
    );
    const actions = await db().auditLog.findMany({
      where: { action: { startsWith: 'release.' }, actorId: mod.user.id },
      select: { action: true, metadata: true },
    });
    expect(actions.map((a) => a.action).sort()).toEqual([
      'release.create',
      'release.create',
      'release.delete',
      'release.update',
    ]);
    expect(JSON.stringify(actions)).not.toContain('Netflix');
  });

  it('refuses a movie as the series, missing name/season/date, and long text; viewers get 404', async () => {
    const mod = await as('MODERATOR');
    const movie = await makeItem({ kind: 'MOVIE', status: 'ACTIVE', slot: 1 });
    const post = (body: Record<string, unknown>) =>
      hit(createRoute, 'POST', '', { who: mod, body });
    expect(
      (await post({ itemId: movie.id, seasonLabel: 'T2', releaseDate: day(1) })).res.status,
    ).toBe(422);
    expect((await post({ seasonLabel: 'T2', releaseDate: day(1) })).res.status).toBe(422);
    expect((await post({ title: 'X', seasonLabel: '  ', releaseDate: day(1) })).res.status).toBe(
      422,
    );
    expect(
      (await post({ title: 'X', seasonLabel: 'T2', releaseDate: '31/12/2026' })).res.status,
    ).toBe(422);
    expect(
      (await post({ title: 'x'.repeat(121), seasonLabel: 'T2', releaseDate: day(1) })).res.status,
    ).toBe(422);
    const viewer = await as('USER');
    expect((await hit(listRoute, 'GET', '', { who: viewer })).res.status).toBe(404);
  });

  it('the Cronograma shows a week back and onwards; drafts lend neither poster nor link', async () => {
    const mod = await makeUser({ role: 'MODERATOR' });
    const draft = await makeItem({ kind: 'SERIES', status: 'DRAFT', title: 'Rascunho' });
    const mk = (title: string, offset: number, itemId: string | null = null) =>
      db().seasonRelease.create({
        data: {
          title,
          seasonLabel: 'T1',
          releaseDate: new Date(`${day(offset)}T00:00:00.000Z`),
          editedById: mod.id,
          itemId,
        },
      });
    await mk('Velha', -8);
    await mk('Semana passada', -7);
    await mk('Hoje', 0);
    await mk('Do rascunho', 5, draft.id);
    const pub = await publicReleases();
    expect(pub.map((r) => r.title)).toEqual(['Semana passada', 'Hoje', 'Do rascunho']);
    expect(pub.find((r) => r.title === 'Hoje')?.released).toBe(true);
    expect(pub.find((r) => r.title === 'Do rascunho')).toMatchObject({ href: null, poster: null });
  });

  it('database: lengths, date range and series-only link (trigger)', async () => {
    const mod = await makeUser({ role: 'MODERATOR' });
    const movie = await makeItem({ kind: 'MOVIE', status: 'DRAFT' });
    const mk = (over: Record<string, unknown>) =>
      db().seasonRelease.create({
        data: {
          title: 'X',
          seasonLabel: 'T1',
          releaseDate: new Date('2027-01-01T00:00:00Z'),
          editedById: mod.id,
          ...over,
        },
      });
    for (const bad of [
      { title: '' },
      { seasonLabel: 'x'.repeat(41) },
      { note: '' },
      { releaseDate: new Date('1999-12-31T00:00:00Z') },
      { itemId: movie.id },
    ]) {
      let code: string | null = null;
      try {
        await mk(bad);
      } catch (e) {
        code = pgErrorCode(e);
      }
      expect(code, JSON.stringify(bad)).toBe(PG.checkViolation);
    }
  });
});

describe('Assistidos and Cronograma posters', () => {
  it('watched titles newest first (archived included, never-watched excluded), by kind', async () => {
    const old = await makeItem({ kind: 'MOVIE', status: 'WATCHED', slot: 1, title: 'Antigo' });
    await db().catalogItem.update({
      where: { id: old.id },
      data: { watchedAt: new Date(Date.now() - 86_400_000) },
    });
    await makeItem({ kind: 'SERIES', status: 'WATCHED', slot: 1, title: 'Série vista' });
    const archived = await makeItem({ kind: 'MOVIE', status: 'ARCHIVED', title: 'Arquivado' });
    await db().catalogItem.update({
      where: { id: archived.id },
      data: { watchedAt: new Date(Date.now() - 2 * 86_400_000) },
    });
    await makeItem({ kind: 'MOVIE', status: 'ARCHIVED', title: 'Nunca visto' });
    expect((await watchedTitles()).map((t) => t.title)).toEqual([
      'Série vista',
      'Antigo',
      'Arquivado',
    ]);
    expect((await watchedTitles('MOVIE')).map((t) => t.title)).toEqual(['Antigo', 'Arquivado']);
    expect((await watchedTitles('FRANCHISE')).length).toBe(0);
  });

  it('every title on the Cronograma carries its poster', async () => {
    const poster = await makeAsset('POSTER');
    const { item, order } = await paidMovie({ title: 'Com Pôster' });
    await db().catalogItem.update({ where: { id: item.id }, data: { posterId: poster.id } });
    const live = await makeSession({ inHours: 30 });
    await db().order.update({
      where: { id: order.id },
      data: { status: 'SCHEDULED', sessionId: live.id, scheduledAt: new Date() },
    });
    const days = await cronograma();
    const title = days.flatMap((d) => d.sessions.flatMap((s) => s.titles))[0]!;
    expect(title).toMatchObject({ title: 'Com Pôster' });
    expect(title.poster?.webp).toMatch(/\/media\//);
    await clearCatalog();
    await db().streamSession.delete({ where: { id: live.id } });
  });
});
