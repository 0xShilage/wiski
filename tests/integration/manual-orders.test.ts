/**
 * 2026-11-02: the manual movie price (streamer only; checkout, public reads and the "Meta total"
 * use it) and "Já pago" — a payment received outside the site registered by the streamer: the
 * title enters the queue (movie SPONSORED + PAID order, contribution counted / campaign FUNDED)
 * with source MANUAL, no Payment row, no Mercado Pago call; idempotent; undoable.
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import {
  GET as candidatesRoute,
  POST as manualRoute,
} from '@/app/api/v1/admin/orders/manual/route';
import { POST as undoRoute } from '@/app/api/v1/admin/orders/[id]/undo/route';
import { PATCH as saveRoute } from '@/app/api/v1/admin/catalog/items/[id]/route';
import { POST as quoteRoute } from '@/app/api/v1/sponsorships/quote/route';
import { listPublic } from '@/server/catalog/read';
import { totalGoal } from '@/server/goals/total';
import { clearCatalog } from '../support/catalog';
import {
  contribute,
  contributionBody,
  type Legal,
  liveMovie,
  movieBody,
  openCampaignFor,
  sponsor,
} from '../support/checkout';
import { call, req } from '../support/http';
import { as, hit, type Who } from '../support/live';
import { ensureLegal, type FakeMp, installFakeMp } from '../support/mercadopago';

let legal: Legal;
let mp: FakeMp;
beforeAll(async () => {
  legal = await ensureLegal();
});
beforeEach(async () => {
  mp = installFakeMp();
  await clearCatalog();
});

const register = (who: Who, body: Record<string, unknown>) =>
  hit(manualRoute, 'POST', '/api/v1/admin/orders/manual', {
    who,
    body: { idempotencyKey: randomUUID(), ...body },
  });

const save = async (who: Who, id: string, fields: Record<string, unknown>) => {
  const item = await db().catalogItem.findUniqueOrThrow({ where: { id } });
  return hit(saveRoute, 'PATCH', `/api/v1/admin/catalog/items/${id}`, {
    who,
    params: { id },
    body: { expectedVersion: item.version, fields },
  });
};

describe('manual movie price', () => {
  it('streamer sets it; checkout, public price and the total goal use it; empty = by runtime', async () => {
    const movie = await liveMovie(100); // R$ 20 by runtime
    const st = await as('STREAMER');
    const r = await save(st, movie.id, { manualPriceCents: 6000 });
    expect(r.res.status).toBe(200);

    const quote = await call(
      quoteRoute,
      req('POST', '/api/v1/sponsorships/quote', { body: { movieId: movie.id } }),
    );
    expect(((await quote.json()) as { totalCents: number }).totalCents).toBe(6000);
    const pub = (await listPublic('MOVIE')).find((m) => m.id === movie.id)!;
    expect(pub).toMatchObject({ priceCents: 6000, manualPrice: true });

    // the checkout charges the manual price (the old one is a PRICE_CHANGED)
    expect((await sponsor(movieBody(movie.id, legal))).res.status).toBe(409);
    const ok = await sponsor(movieBody(movie.id, legal, { expectedTotalCents: 6000 }));
    expect(ok.res.status).toBe(201);
    expect([...mp.payments.values()].at(-1)?.transaction_amount).toBe(60);

    await save(st, movie.id, { manualPriceCents: null });
    expect((await listPublic('MOVIE')).find((m) => m.id === movie.id)).toMatchObject({
      priceCents: 2000,
      manualPrice: false,
    });
    const log = await db().auditLog.findFirstOrThrow({
      where: { action: 'catalog.save', targetId: movie.id },
      orderBy: { id: 'asc' },
    });
    expect(log.metadata).toMatchObject({ fields: ['manualPriceCents'] });
  });

  it('moderators set it too (since 2026-11-08); not for series; R$ 5–2.000', async () => {
    const movie = await liveMovie(100);
    const mod = await as('MODERATOR');
    expect((await save(mod, movie.id, { manualPriceCents: 6000 })).res.status).toBe(200);
    expect((await save(mod, movie.id, { manualPriceCents: null, synopsis: 'ok' })).res.status).toBe(
      200,
    );
    const st = await as('STREAMER');
    expect((await save(st, movie.id, { manualPriceCents: 499 })).res.status).toBe(422);
    expect((await save(st, movie.id, { manualPriceCents: 200_001 })).res.status).toBe(422);
    const { item: series } = await openCampaignFor();
    expect((await save(st, series.id, { manualPriceCents: 6000 })).res.status).toBe(422);
  });

  it('the total goal counts the manual price', async () => {
    const a = await liveMovie(100);
    await liveMovie(100);
    await save(await as('STREAMER'), a.id, { manualPriceCents: 6000 });
    await db().catalogItem.update({ where: { id: a.id }, data: { status: 'SPONSORED' } });
    const t = await totalGoal();
    expect(t.kinds.find((k) => k.kind === 'MOVIE')).toMatchObject({ titles: 2, percent: 75 });
  });
});

describe('"Já pago"', () => {
  it('movie: SPONSORED with a PAID manual order, no Payment, no MP call; candidates update', async () => {
    const movie = await liveMovie(100);
    const st = await as('STREAMER');
    const before = await hit(candidatesRoute, 'GET', '/api/v1/admin/orders/manual', { who: st });
    expect(before.json.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemId: movie.id, kind: 'MOVIE', defaultCents: 2000 }),
      ]),
    );
    const r = await register(st, {
      itemId: movie.id,
      sponsorName: 'Tia Lu',
      message: 'Pago no Pix da live',
    });
    expect(r.res.status).toBe(200);
    expect(r.json.order).toMatchObject({
      status: 'PAID',
      manual: true,
      totalCents: 2000,
      publicName: 'Tia Lu',
      shownMessage: 'Pago no Pix da live',
      payment: null,
      email: null,
      buyer: 'Pago fora do site',
    });
    const o = await db().order.findFirstOrThrow({
      where: { itemId: movie.id },
      include: { payment: true },
    });
    expect(o).toMatchObject({ source: 'MANUAL', ipKey: null, payment: null, kind: 'MOVIE' });
    expect((await db().catalogItem.findUniqueOrThrow({ where: { id: movie.id } })).status).toBe(
      'SPONSORED',
    );
    expect(mp.payments.size).toBe(0);
    const log = await db().auditLog.findFirstOrThrow({
      where: { action: 'order.manual', targetId: o.id },
    });
    expect(log.metadata).toEqual({ kind: 'MOVIE', totalCents: 2000, named: true, message: true });
    expect(JSON.stringify(log.metadata)).not.toContain('Tia Lu');

    const after = await hit(candidatesRoute, 'GET', '/api/v1/admin/orders/manual', { who: st });
    expect((after.json.candidates as { itemId: string }[]).map((c) => c.itemId)).not.toContain(
      movie.id,
    );
    // a second registration of the same movie is refused
    const again = await register(st, { itemId: movie.id });
    expect([again.res.status, again.json.code]).toEqual([409, 'CANNOT_REGISTER']);
    // and nobody can check out the sponsored movie
    expect((await sponsor(movieBody(movie.id, legal))).res.status).toBe(409);
  });

  it('a double submit with the same key registers once', async () => {
    const movie = await liveMovie(100);
    const other = await liveMovie(100);
    const st = await as('STREAMER');
    const key = randomUUID();
    expect((await register(st, { itemId: movie.id, idempotencyKey: key })).res.status).toBe(200);
    const dup = await register(st, { itemId: other.id, idempotencyKey: key });
    expect([dup.res.status, dup.json.code]).toEqual([409, 'ALREADY_REGISTERED']);
    expect((await db().catalogItem.findUniqueOrThrow({ where: { id: other.id } })).status).toBe(
      'ACTIVE',
    );
  });

  it('campaign: any amount up to what is left; completing it FUNDS the title', async () => {
    const { item, campaign } = await openCampaignFor(10_000);
    const st = await as('STREAMER');
    const part = await register(st, { itemId: item.id, amountCents: 1_234 }); // not whole reais
    expect(part.res.status).toBe(200);
    let c = await db().campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(c).toMatchObject({ raisedCents: 1_234, remainingCents: 8_766, supporterCount: 1 });
    const over = await register(st, { itemId: item.id, amountCents: 9_000 });
    expect(over.json.code).toBe('CANNOT_REGISTER');
    const rest = await register(st, { itemId: item.id }); // default = what is left
    expect((rest.json.order as { totalCents: number }).totalCents).toBe(8_766);
    c = await db().campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(c).toMatchObject({ status: 'FUNDED', raisedCents: 10_000, remainingCents: 0 });
    expect((await db().catalogItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(
      'FUNDED',
    );
  });

  it('a pending Pix holds its share: the manual contribution fits only the rest', async () => {
    const { item, campaign } = await openCampaignFor(10_000);
    expect((await contribute(campaign.id, contributionBody(4_000, legal))).res.status).toBe(201);
    const st = await as('STREAMER');
    const cands = await hit(candidatesRoute, 'GET', '', { who: st });
    expect(cands.json.candidates).toEqual([
      expect.objectContaining({ itemId: item.id, defaultCents: 6_000, maxCents: 6_000 }),
    ]);
    expect((await register(st, { itemId: item.id })).res.status).toBe(200);
    // remaining 0 but 40 still reserved → not FUNDED yet
    const c = await db().campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(c).toMatchObject({ status: 'OPEN', remainingCents: 0, reservedCents: 4_000 });
  });

  it('undo: movie back in the catalogue; a funded campaign opens again; only MANUAL orders', async () => {
    const movie = await liveMovie(100);
    const st = await as('STREAMER');
    const m = (await register(st, { itemId: movie.id })).json.order as {
      id: string;
      version: number;
    };
    const u = await hit(undoRoute, 'POST', '', {
      who: st,
      params: { id: m.id },
      body: { expectedVersion: m.version },
    });
    expect((u.json.order as { status: string }).status).toBe('CANCELLED');
    expect((await db().catalogItem.findUniqueOrThrow({ where: { id: movie.id } })).status).toBe(
      'ACTIVE',
    );
    // the movie can be registered (or sold) again
    expect((await register(st, { itemId: movie.id })).res.status).toBe(200);

    const { item, campaign } = await openCampaignFor(10_000);
    const o = (await register(st, { itemId: item.id })).json.order as {
      id: string;
      version: number;
    };
    await hit(undoRoute, 'POST', '', {
      who: st,
      params: { id: o.id },
      body: { expectedVersion: o.version },
    });
    expect(await db().campaign.findUniqueOrThrow({ where: { id: campaign.id } })).toMatchObject({
      status: 'OPEN',
      raisedCents: 0,
      remainingCents: 10_000,
      fundedAt: null,
    });
    expect((await db().catalogItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(
      'ACTIVE',
    );
    expect(
      await db().auditLog.count({ where: { action: 'order.manual-undo', targetId: o.id } }),
    ).toBe(1);

    // a site order is never "undone"
    const other = await liveMovie(100);
    const site = await sponsor(movieBody(other.id, legal));
    const so = await db().order.findFirstOrThrow({
      where: { publicCode: site.json.publicCode as string },
    });
    const no = await hit(undoRoute, 'POST', '', {
      who: st,
      params: { id: so.id },
      body: { expectedVersion: so.version },
    });
    expect([no.res.status, no.json.code]).toEqual([409, 'CANNOT_ACCEPT']);
  });

  it('moderators and the streamer, with a recent Google step-up', async () => {
    const movie = await liveMovie(100);
    const staleMod = await as('MODERATOR', { authTime: new Date(Date.now() - 60 * 60_000) });
    const m = await register(staleMod, { itemId: movie.id });
    expect([m.res.status, m.json.code]).toEqual([401, 'STEP_UP_REQUIRED']);
    const stale = await as('STREAMER', { authTime: new Date(Date.now() - 60 * 60_000) });
    const r = await register(stale, { itemId: movie.id });
    expect([r.res.status, r.json.code]).toEqual([401, 'STEP_UP_REQUIRED']);
  });
});
