/**
 * Subathon timer (2026-11-03): the R$ → seconds rule, the clock text, the StreamElements activity
 * parser and the gift-sub de-duplication. Pure functions, no database.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SUBATHON_RATES,
  formatClock,
  formatDelta,
  remainingAt,
  secondsFor,
  subathonRatesSchema,
  tipCents,
} from '@/lib/subathon';
import {
  activityOf,
  GiftLedger,
  parseActivity,
  type SeActivity,
} from '@/server/subathon/se-activity';
import { seChannelOf } from '@/server/subathon/streamelements';

const R = DEFAULT_SUBATHON_RATES;
const act = (type: string, data: Record<string, unknown>, id = 'a1'): SeActivity => ({
  id,
  type,
  provider: 'twitch',
  data,
});

describe('R$ → seconds', () => {
  it('the base rule: R$ 1 = 60 s, rounded to the second', () => {
    expect(secondsFor(100, 60)).toBe(60);
    expect(secondsFor(2550, 60)).toBe(1530); // R$ 25,50 → 25 min 30 s
    expect(secondsFor(1, 60)).toBe(1); // 1 centavo → 0,6 s → 1 s
    expect(secondsFor(100, 120)).toBe(120);
    expect(secondsFor(0, 60)).toBe(0);
    expect(secondsFor(-500, 60)).toBe(0);
  });

  it('tips in BRL as paid; USD and EUR by the subathon rates; other currencies do not count', () => {
    expect(tipCents(10, 'BRL', R)).toBe(1000);
    expect(tipCents(10, 'brl', R)).toBe(1000);
    expect(tipCents(2, 'USD', R)).toBe(2 * R.usdCents);
    expect(tipCents(1.5, 'EUR', R)).toBe(Math.round(1.5 * R.eurCents));
    expect(tipCents(10, 'JPY', R)).toBeNull();
    expect(tipCents(0, 'BRL', R)).toBeNull();
  });

  it('the default rates are valid and the schema refuses unknown keys', () => {
    expect(subathonRatesSchema.parse(R)).toEqual(R);
    expect(() => subathonRatesSchema.parse({ ...R, extra: 1 })).toThrow();
    expect(() => subathonRatesSchema.parse({ ...R, tier1Cents: -1 })).toThrow();
  });
});

describe('clock text', () => {
  it('HH:MM:SS, days past 24 h, never negative', () => {
    expect(formatClock(0)).toBe('00:00:00');
    expect(formatClock(3661)).toBe('01:01:01');
    expect(formatClock(90_000)).toBe('1d 01:00:00');
    expect(formatClock(-5)).toBe('00:00:00');
  });

  it('deltas with a sign', () => {
    expect(formatDelta(300)).toBe('+5:00');
    expect(formatDelta(3750)).toBe('+1:02:30');
    expect(formatDelta(-180)).toBe('−3:00');
  });

  it('time left: from endsAt while running, the stored value otherwise, 0 once ended', () => {
    const now = Date.parse('2026-11-03T20:00:00Z');
    const endsAt = new Date(now + 90_500);
    expect(remainingAt({ status: 'RUNNING', remainingSeconds: 5, endsAt }, now)).toBe(91);
    expect(
      remainingAt({ status: 'RUNNING', remainingSeconds: 5, endsAt: new Date(now - 1) }, now),
    ).toBe(0);
    expect(remainingAt({ status: 'PAUSED', remainingSeconds: 42, endsAt: null }, now)).toBe(42);
    expect(remainingAt({ status: 'ENDED', remainingSeconds: 42, endsAt: null }, now)).toBe(0);
  });
});

describe('StreamElements activities', () => {
  it('reads the activity out of an Astro frame and refuses anything else', () => {
    const frame = {
      id: '01J',
      ts: '2026-11-03T20:00:00Z',
      type: 'message',
      topic: 'channel.activities',
      data: {
        _id: '67b5f39d07ecd4c594e60f73',
        type: 'tip',
        provider: 'twitch',
        data: { amount: 5 },
      },
    };
    expect(activityOf(frame)).toEqual({
      id: '67b5f39d07ecd4c594e60f73',
      type: 'tip',
      provider: 'twitch',
      data: { amount: 5 },
    });
    expect(activityOf({ ...frame, topic: 'channel.tips' })).toBeNull();
    expect(activityOf({ ...frame, type: 'response' })).toBeNull();
    expect(activityOf({ ...frame, data: { ...frame.data, _id: 'bad id with spaces' } })).toBeNull();
    expect(activityOf(null)).toBeNull();
  });

  it('a tip counts its value; a dollar tip by the rate; a yen tip and a test alert do not', () => {
    expect(parseActivity(act('tip', { amount: 12.5, currency: 'BRL', username: 'lu' }), R)).toEqual(
      {
        credit: { kind: 'TIP', externalId: 'se:a1', valueCents: 1250, label: 'Doação de lu' },
      },
    );
    expect(
      parseActivity(act('tip', { amount: 2, currency: 'USD', displayName: 'Bob' }), R)?.credit,
    ).toMatchObject({ valueCents: 2 * R.usdCents, label: 'Doação de Bob' });
    expect(parseActivity(act('tip', { amount: 500, currency: 'JPY' }), R)).toBeNull();
    expect(parseActivity(act('tip', { amount: 5, currency: 'BRL', isMock: true }), R)).toBeNull();
  });

  it('bits: by the value of 100 bits', () => {
    expect(parseActivity(act('cheer', { amount: 250, username: 'x' }), R)?.credit).toMatchObject({
      kind: 'BITS',
      valueCents: Math.round((250 * R.bits100Cents) / 100),
      label: '250 bits de x',
    });
  });

  it('subs by tier, Prime, resubs (more than one month)', () => {
    const p = (d: Record<string, unknown>) => parseActivity(act('subscriber', d), R)?.credit;
    expect(p({ tier: '1000', amount: 1, username: 'a' })).toMatchObject({
      kind: 'SUB',
      valueCents: R.tier1Cents,
    });
    expect(p({ tier: '2000', amount: 1 })).toMatchObject({ kind: 'SUB', valueCents: R.tier2Cents });
    expect(p({ tier: '3000', amount: 1 })).toMatchObject({ kind: 'SUB', valueCents: R.tier3Cents });
    expect(p({ tier: 'prime', amount: 1 })).toMatchObject({
      kind: 'PRIME',
      valueCents: R.primeCents,
    });
    expect(p({ tier: '1000', amount: 7, username: 'b' })).toMatchObject({
      kind: 'RESUB',
      label: 'Resub de b (7 meses)',
    });
  });

  it('gift subs: a single gift, a community-gift purchase (either shape) and its recipients', () => {
    const single = parseActivity(
      act('subscriber', { gifted: true, sender: 'Tia', tier: '1000' }),
      R,
    );
    expect(single).toMatchObject({
      credit: { kind: 'GIFT', valueCents: R.tier1Cents },
      gift: { role: 'recipient', sender: 'Tia', community: false },
    });
    const bomb = parseActivity(
      act('communityGiftPurchase', { amount: 5, username: 'Tia', tier: '1000' }),
      R,
    );
    expect(bomb).toMatchObject({
      credit: { kind: 'GIFT', valueCents: 5 * R.tier1Cents, label: '5 subs de presente de Tia' },
      gift: { role: 'purchase', sender: 'Tia', count: 5 },
    });
    const bulk = parseActivity(
      act('subscriber', { bulkGifted: true, amount: 3, sender: 'Tia' }),
      R,
    );
    expect(bulk?.gift).toEqual({ role: 'purchase', sender: 'Tia', count: 3 });
    const member = parseActivity(
      act('subscriber', { gifted: true, isCommunityGift: true, sender: 'Tia', username: 'r1' }),
      R,
    );
    expect(member?.gift).toEqual({ role: 'recipient', sender: 'Tia', community: true });
  });

  it('switched-off sources and non-paying events do not count', () => {
    const off = { ...R, count: { ...R.count, bits: false, gifts: false } };
    expect(parseActivity(act('cheer', { amount: 100 }), off)).toBeNull();
    expect(parseActivity(act('communityGiftPurchase', { amount: 2 }), off)).toBeNull();
    expect(parseActivity(act('follow', { username: 'x' }), R)).toBeNull();
    expect(parseActivity(act('raid', { amount: 50 }), R)).toBeNull();
  });

  it('labels are cut and fall back to Anônimo', () => {
    const long = 'x'.repeat(80);
    expect(parseActivity(act('tip', { amount: 1, displayName: long }), R)?.credit.label).toBe(
      `Doação de ${'x'.repeat(30)}`,
    );
    expect(parseActivity(act('tip', { amount: 1 }), R)?.credit.label).toBe('Doação de Anônimo');
  });
});

describe('gift subs are counted once, whatever the order', () => {
  const purchase = (count: number) => ({ role: 'purchase' as const, sender: 'Tia', count });
  const member = { role: 'recipient' as const, sender: 'TIA', community: true };

  it('purchase first: the purchase counts N, its N recipients are skipped, a later gift counts', () => {
    const g = new GiftLedger();
    expect(g.giftsToCredit(purchase(3), 0)).toBe(3);
    expect([1, 2, 3].map((t) => g.giftsToCredit(member, t))).toEqual([0, 0, 0]);
    expect(g.giftsToCredit(member, 4)).toBe(1); // a new single gift afterwards
  });

  it('recipients first: each counts, the purchase adds only the rest', () => {
    const g = new GiftLedger();
    expect(g.giftsToCredit(member, 0)).toBe(1);
    expect(g.giftsToCredit(member, 1)).toBe(1);
    expect(g.giftsToCredit(purchase(5), 2)).toBe(3);
    expect([3, 4, 5].map((t) => g.giftsToCredit(member, t))).toEqual([0, 0, 0]);
  });

  it('the window expires: an old purchase no longer swallows new gifts', () => {
    const g = new GiftLedger(60_000);
    expect(g.giftsToCredit(purchase(2), 0)).toBe(2);
    expect(g.giftsToCredit(member, 61_000)).toBe(1);
  });

  it('a purchase never credits less than zero', () => {
    const g = new GiftLedger();
    for (let t = 0; t < 4; t++) g.giftsToCredit(member, t);
    expect(g.giftsToCredit(purchase(2), 5)).toBe(0);
  });
});

describe('StreamElements JWT', () => {
  const jwt = (payload: unknown) =>
    `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;

  it('the channel id (room) comes from the token payload; anything odd → none', () => {
    expect(seChannelOf(jwt({ channel: '5b2f0a1c9e8d7f6a5b4c3d2e' }))).toBe(
      '5b2f0a1c9e8d7f6a5b4c3d2e',
    );
    expect(seChannelOf(jwt({ user: 'x' }))).toBeNull();
    expect(seChannelOf(jwt({ channel: 'bad channel!' }))).toBeNull();
    expect(seChannelOf('not-a-jwt')).toBeNull();
  });
});
