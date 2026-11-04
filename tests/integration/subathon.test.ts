/**
 * Subathon timer (2026-11-03) against the real database: one open subathon, the clock and its
 * transitions, the idempotent ledger (cap and zero floor), site orders credited and refunds
 * debited, StreamElements activities (gift subs counted once), the reviewed constraints, audit.
 */
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SUBATHON_RATES, type SubathonRates } from '@/lib/subathon';
import { db } from '@/server/db';
import { createOverlayKey } from '@/server/overlay/keys';
import { WIDGETS } from '@/server/overlay/events';
import { syncSiteCredits } from '@/server/subathon/credits';
import { GiftLedger, type SeActivity } from '@/server/subathon/se-activity';
import { handleActivity } from '@/server/subathon/streamelements';
import {
  adjustTime,
  applyEntry,
  changeStatus,
  createSubathon,
  finishIfDue,
  updateSubathon,
} from '@/server/subathon/timer';
import { clearCatalog } from '../support/catalog';
import { makeUser } from '../support/db';
import { paidMovie, resetSlots } from '../support/live';

const R: SubathonRates = DEFAULT_SUBATHON_RATES;
const T0 = new Date('2026-11-03T20:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);
let ctx: { actor: { id: string; role: 'STREAMER' }; requestId: null };

async function make(
  over: { initialSeconds?: number; capSeconds?: number | null; rates?: SubathonRates } = {},
) {
  return createSubathon(ctx, {
    title: 'Subathon de teste',
    initialSeconds: over.initialSeconds ?? 3600,
    secondsPerReal: 60,
    capSeconds: over.capSeconds ?? null,
    rates: over.rates ?? R,
  });
}
const fresh = (id: string) => db().subathon.findUniqueOrThrow({ where: { id } });
const entry = (seconds: number, externalId = `t:${randomUUID()}`) => ({
  kind: 'MANUAL' as const,
  externalId,
  valueCents: null,
  seconds,
  label: 'teste',
});
const activity = (
  type: string,
  data: Record<string, unknown>,
  id = randomUUID().replace(/-/g, ''),
): SeActivity => ({
  id,
  type,
  provider: 'twitch',
  data,
});

beforeEach(async () => {
  await db().subathon.deleteMany({});
  await clearCatalog();
  resetSlots();
  const st = await makeUser({ role: 'STREAMER' });
  ctx = { actor: { id: st.id, role: 'STREAMER' }, requestId: null };
});

describe('one open subathon and its clock', () => {
  it('created READY with the starting time; a second open one is refused', async () => {
    const s = await make({ initialSeconds: 7200 });
    expect(s).toMatchObject({ status: 'READY', remainingSeconds: 7200, endsAt: null, openSlot: 1 });
    await expect(make()).rejects.toMatchObject({ code: 'SUBATHON_OPEN' });
    expect(
      await db().auditLog.count({ where: { action: 'subathon.create', targetId: s.id } }),
    ).toBe(1);
  });

  it('start → pause → resume → end; the time left is kept across a pause', async () => {
    const s = await make({ initialSeconds: 600 });
    const run = await changeStatus(ctx, s.id, 'start', s.version, T0);
    expect(run.status).toBe('RUNNING');
    expect(run.endsAt!.getTime()).toBe(at(600).getTime());
    const paused = await changeStatus(ctx, s.id, 'pause', run.version, at(100));
    expect(paused).toMatchObject({ status: 'PAUSED', remainingSeconds: 500, endsAt: null });
    const again = await changeStatus(ctx, s.id, 'resume', paused.version, at(1000));
    expect(again.endsAt!.getTime()).toBe(at(1500).getTime());
    const ended = await changeStatus(ctx, s.id, 'end', again.version, at(1100));
    expect(ended).toMatchObject({ status: 'ENDED', openSlot: null, remainingSeconds: 400 });
    // a new one can open now
    await expect(make()).resolves.toMatchObject({ status: 'READY' });
    expect(
      await db().auditLog.count({ where: { action: 'subathon.status', targetId: s.id } }),
    ).toBe(4);
  });

  it('a stale version and an action that does not fit the state are 409', async () => {
    const s = await make();
    await expect(changeStatus(ctx, s.id, 'start', s.version + 1, T0)).rejects.toMatchObject({
      code: 'SUBATHON_CHANGED',
    });
    await expect(changeStatus(ctx, s.id, 'pause', s.version, T0)).rejects.toMatchObject({
      code: 'SUBATHON_STATE',
    });
  });

  it('a running timer that reaches zero ends at that moment and takes no more time', async () => {
    const s = await make({ initialSeconds: 60 });
    await changeStatus(ctx, s.id, 'start', s.version, T0);
    expect(await finishIfDue(at(30))).toBe(false);
    expect(await finishIfDue(at(61))).toBe(true);
    const done = await fresh(s.id);
    expect(done).toMatchObject({ status: 'ENDED', remainingSeconds: 0 });
    expect(done.endedAt!.getTime()).toBe(at(60).getTime());
    expect(await applyEntry(entry(300), at(62))).toEqual({ result: 'closed' });
  });

  it('settings change only what comes next, and are audited by field name', async () => {
    const s = await make();
    const u = await updateSubathon(ctx, s.id, {
      expectedVersion: s.version,
      secondsPerReal: 120,
      title: 'Subathon 2',
    });
    expect(u).toMatchObject({ secondsPerReal: 120, title: 'Subathon 2' });
    const log = await db().auditLog.findFirstOrThrow({ where: { action: 'subathon.update' } });
    expect(log.metadata).toEqual({ fields: ['title', 'secondsPerReal'] });
  });
});

describe('the ledger', () => {
  it('time adds to the stored value while READY and moves endsAt while RUNNING', async () => {
    const s = await make({ initialSeconds: 100 });
    await applyEntry(entry(50), T0);
    expect((await fresh(s.id)).remainingSeconds).toBe(150);
    const run = await changeStatus(ctx, s.id, 'start', (await fresh(s.id)).version, T0);
    await applyEntry(entry(60), at(10));
    expect((await fresh(s.id)).endsAt!.getTime()).toBe(run.endsAt!.getTime() + 60_000);
    expect((await fresh(s.id)).addedSeconds).toBe(110);
  });

  it('the same source twice is applied once', async () => {
    const s = await make({ initialSeconds: 100 });
    expect((await applyEntry(entry(30, 'se:dup'), T0)).result).toBe('applied');
    expect(await applyEntry(entry(30, 'se:dup'), T0)).toEqual({ result: 'duplicate' });
    expect((await fresh(s.id)).remainingSeconds).toBe(130);
  });

  it('the cap limits what is added; removing time stops at zero', async () => {
    const s = await make({ initialSeconds: 3000, capSeconds: 3600 });
    const out = await applyEntry(entry(1000), T0);
    expect(out).toMatchObject({ result: 'applied', appliedSeconds: 600 });
    expect((await fresh(s.id)).remainingSeconds).toBe(3600);
    await adjustTime(ctx, s.id, { seconds: -5000, idempotencyKey: randomUUID() }, T0);
    expect((await fresh(s.id)).remainingSeconds).toBe(0);
    const rows = await db().subathonEntry.findMany({
      where: { subathonId: s.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map((r) => [r.seconds, r.appliedSeconds])).toEqual([
      [1000, 600],
      [-5000, -3600],
    ]);
    expect(await db().auditLog.count({ where: { action: 'subathon.adjust' } })).toBe(1);
  });

  it('with no open subathon nothing is recorded', async () => {
    expect(await applyEntry(entry(60), T0)).toEqual({ result: 'closed' });
    expect(await db().subathonEntry.count()).toBe(0);
  });
});

describe('site payments', () => {
  it('a paid order adds its value (R$ 1 = 60 s); a refund takes back exactly that; idempotent', async () => {
    const s = await make({ initialSeconds: 0 });
    const { order } = await paidMovie(); // R$ 20,00
    expect(await syncSiteCredits()).toEqual({ credited: 1, debited: 0 });
    expect(await syncSiteCredits()).toEqual({ credited: 0, debited: 0 });
    expect((await fresh(s.id)).remainingSeconds).toBe(20 * 60);
    const credit = await db().subathonEntry.findFirstOrThrow({ where: { orderId: order.id } });
    expect(credit).toMatchObject({ kind: 'ORDER', valueCents: 2000, seconds: 1200 });
    // the streamer refunds it (test shortcut: the order leaves the paid states)
    await db().order.update({ where: { id: order.id }, data: { status: 'REFUNDED' } });
    expect(await syncSiteCredits()).toEqual({ credited: 0, debited: 1 });
    expect(await syncSiteCredits()).toEqual({ credited: 0, debited: 0 });
    expect((await fresh(s.id)).remainingSeconds).toBe(0);
  });

  it('orders paid before the subathon was created, or with site payments switched off, do not count', async () => {
    await paidMovie({ paidAt: new Date(Date.now() - 3_600_000) });
    const s = await make({
      initialSeconds: 0,
      rates: { ...R, count: { ...R.count, site: false } },
    });
    await paidMovie();
    expect(await syncSiteCredits()).toEqual({ credited: 0, debited: 0 });
    expect((await fresh(s.id)).remainingSeconds).toBe(0);
  });
});

describe('StreamElements activities', () => {
  it('a tip, bits and a sub add their value; a re-delivered activity is ignored', async () => {
    const s = await make({ initialSeconds: 0 });
    const ledger = new GiftLedger();
    const tip = activity('tip', { amount: 10, currency: 'BRL', username: 'lu' });
    expect(await handleActivity(tip, ledger, T0)).toBe('applied');
    expect(await handleActivity(tip, ledger, T0)).toBe('duplicate');
    expect(await handleActivity(activity('cheer', { amount: 200 }), ledger, T0)).toBe('applied');
    expect(
      await handleActivity(activity('subscriber', { tier: '1000', amount: 1 }), ledger, T0),
    ).toBe('applied');
    expect(await handleActivity(activity('follow', { username: 'x' }), ledger, T0)).toBe('ignored');
    // R$ 10 + 200 bits (2 × R$ 5) + Tier 1 (R$ 10) = R$ 30 → 30 min
    expect((await fresh(s.id)).remainingSeconds).toBe(30 * 60);
  });

  it('a 5-sub community gift adds 5 subs once, whether the purchase or the recipients come first', async () => {
    const s = await make({ initialSeconds: 0 });
    const ledger = new GiftLedger();
    const member = () =>
      activity('subscriber', { gifted: true, isCommunityGift: true, sender: 'Tia', tier: '1000' });
    // two recipients arrive before the purchase event, three after
    await handleActivity(member(), ledger, T0);
    await handleActivity(member(), ledger, T0);
    await handleActivity(
      activity('communityGiftPurchase', { amount: 5, username: 'Tia', tier: '1000' }),
      ledger,
      T0,
    );
    for (let i = 0; i < 3; i++) await handleActivity(member(), ledger, T0);
    expect((await fresh(s.id)).remainingSeconds).toBe(5 * 10 * 60); // 5 × R$ 10
    const gifts = await db().subathonEntry.findMany({ where: { subathonId: s.id, kind: 'GIFT' } });
    expect(gifts.reduce((n, g) => n + (g.valueCents ?? 0), 0)).toBe(5 * R.tier1Cents);
  });

  it('nothing is recorded when no subathon is open', async () => {
    expect(await handleActivity(activity('tip', { amount: 5 }), new GiftLedger(), T0)).toBe(
      'closed',
    );
  });
});

describe('OBS', () => {
  it('an overlay key can include the subathon widget (all six widgets at once)', async () => {
    const k = await createOverlayKey(ctx, { label: 'OBS subathon', widgets: [...WIDGETS] });
    const row = await db().overlayKey.findFirstOrThrow({ where: { label: 'OBS subathon' } });
    expect(row.widgets).toEqual([...WIDGETS]);
    expect(row.widgets).toContain('subathon');
    expect(k).toBeTruthy();
  });
});

describe('reviewed constraints', () => {
  it('the clock is in one place, ranges hold, a refund never adds time', async () => {
    const s = await make();
    await expect(
      db().subathon.update({ where: { id: s.id }, data: { endsAt: T0 } }), // READY with endsAt
    ).rejects.toThrow();
    await expect(
      db().subathon.update({ where: { id: s.id }, data: { secondsPerReal: 0 } }),
    ).rejects.toThrow();
    await expect(
      db().subathonEntry.create({
        data: {
          subathonId: s.id,
          kind: 'REFUND',
          externalId: 'x',
          seconds: 60,
          appliedSeconds: 60,
        },
      }),
    ).rejects.toThrow();
    await expect(
      db().subathonEntry.create({
        data: { subathonId: s.id, kind: 'TIP', externalId: 'y', seconds: 60, appliedSeconds: 90 },
      }),
    ).rejects.toThrow();
  });
});
