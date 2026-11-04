import 'server-only';
import type { SubathonEntryKind } from '@/generated/prisma/client';
import { tipCents, type SubathonRates } from '@/lib/subathon';

/**
 * StreamElements activities → subathon credits (2026-11-03). Pure: no I/O, unit-tested.
 *
 * Astro (`wss://astro.streamelements.com`, topic `channel.activities`) delivers each activity as
 * `{ type: 'message', topic, data: { _id | activityId, type, provider, data: {…} } }`. The inner
 * fields follow StreamElements' activity objects (amount, tier, gifted, sender, isCommunityGift,
 * bulkGifted, currency, displayName/username, isMock). The public docs don't list all of them for
 * Astro, so everything is read defensively and anything unexpected is ignored (and logged by
 * the connector by field name only).
 *
 * Gift subs: a community gift ("sub bomb") arrives as one purchase event with the count (type
 * `communityGiftPurchase`, or a `subscriber` event with `bulkGifted`) plus one `subscriber` event
 * per recipient (`gifted`, `isCommunityGift`). GiftLedger counts each gift exactly once, whichever
 * order they arrive in.
 */
export type SeActivity = {
  id: string;
  type: string;
  provider: string;
  data: Record<string, unknown>;
};

export type SeCredit = {
  kind: SubathonEntryKind;
  externalId: string;
  valueCents: number;
  label: string;
};

const str = (v: unknown, max = 60): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
const int = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
};

/** The activity inside an Astro frame, or null for anything else. */
export function activityOf(frame: unknown): SeActivity | null {
  const f = frame as { type?: unknown; topic?: unknown; data?: unknown } | null;
  if (!f || f.type !== 'message' || f.topic !== 'channel.activities') return null;
  const d = f.data as Record<string, unknown> | null;
  if (!d || typeof d !== 'object') return null;
  const inner = (d.data && typeof d.data === 'object' ? d.data : {}) as Record<string, unknown>;
  const id = str(d._id, 100) ?? str(d.activityId, 100) ?? str(inner._id, 100);
  const type = str(d.type, 40);
  if (!id || !type) return null;
  if (!/^[\w.:-]{1,100}$/.test(id)) return null;
  return { id, type, provider: str(d.provider, 40) ?? '', data: inner };
}

function tierCents(tier: string | null, r: SubathonRates): number {
  if (tier === '2000') return r.tier2Cents;
  if (tier === '3000') return r.tier3Cents;
  if (tier === 'prime') return r.primeCents;
  return r.tier1Cents;
}

export type GiftNote =
  | { role: 'purchase'; sender: string; count: number }
  | { role: 'recipient'; sender: string; community: boolean };

export type Parsed = { credit: SeCredit; gift?: GiftNote } | null;

/** What an activity is worth, before gift de-duplication. null = doesn't count. */
export function parseActivity(a: SeActivity, r: SubathonRates): Parsed {
  const d = a.data;
  if (d.isMock === true || d.isTest === true) return null; // dashboard test alerts
  const name = str(d.displayName, 30) ?? str(d.username, 30) ?? 'Anônimo';
  const externalId = `se:${a.id}`;

  if (a.type === 'tip') {
    if (!r.count.tips) return null;
    const amount = num(d.amount);
    const currency = (str(d.currency, 8) ?? 'BRL').toUpperCase();
    // BRL as is; USD/EUR by the subathon's rates; any other currency doesn't count (logged)
    const valueCents = amount ? tipCents(amount, currency, r) : null;
    if (!valueCents) return null;
    return {
      credit: { kind: 'TIP', externalId, valueCents, label: `Doação de ${name}` },
    };
  }
  if (a.type === 'cheer') {
    if (!r.count.bits) return null;
    const bits = int(d.amount);
    if (!bits) return null;
    return {
      credit: {
        kind: 'BITS',
        externalId,
        valueCents: Math.round((bits * r.bits100Cents) / 100),
        label: `${bits} bits de ${name}`,
      },
    };
  }
  const tier = str(d.tier, 10)?.toLowerCase() ?? null;
  const bomb =
    a.type === 'communityGiftPurchase' || (a.type === 'subscriber' && d.bulkGifted === true);
  if (bomb) {
    if (!r.count.gifts) return null;
    const count = int(d.amount) ?? 0;
    if (!count) return null;
    const sender = str(d.sender, 30) ?? name;
    return {
      credit: {
        kind: 'GIFT',
        externalId,
        valueCents: count * tierCents(tier, r),
        label: `${count} ${count === 1 ? 'sub' : 'subs'} de presente de ${sender}`,
      },
      gift: { role: 'purchase', sender, count },
    };
  }
  if (a.type !== 'subscriber') return null;
  if (d.gifted === true) {
    if (!r.count.gifts) return null;
    const sender = str(d.sender, 30) ?? 'Anônimo';
    return {
      credit: {
        kind: 'GIFT',
        externalId,
        valueCents: tierCents(tier, r),
        label: `Sub de presente de ${sender}`,
      },
      gift: {
        role: 'recipient',
        sender,
        community: d.isCommunityGift === true || d.communityGifted === true,
      },
    };
  }
  if (tier === 'prime') {
    if (!r.count.prime) return null;
    return {
      credit: {
        kind: 'PRIME',
        externalId,
        valueCents: r.primeCents,
        label: `Sub Prime de ${name}`,
      },
    };
  }
  const months = int(d.amount) ?? 1;
  if (months > 1) {
    if (!r.count.resubs) return null;
    return {
      credit: {
        kind: 'RESUB',
        externalId,
        valueCents: tierCents(tier, r),
        label: `Resub de ${name} (${months} meses)`,
      },
    };
  }
  if (!r.count.subs) return null;
  return {
    credit: { kind: 'SUB', externalId, valueCents: tierCents(tier, r), label: `Sub de ${name}` },
  };
}

/**
 * Counts each gifted sub once. Per gifter, for a few minutes:
 *  • a purchase of N after k recipients were already counted one by one adds N − k, and the next
 *    N − k recipients from that gifter are skipped;
 *  • a recipient with no purchase pending is counted (a single gift, or a bomb whose purchase
 *    event hasn't arrived yet).
 */
export class GiftLedger {
  private skip = new Map<string, { left: number; at: number }>();
  private counted = new Map<string, { n: number; at: number }>();
  constructor(private readonly windowMs = 3 * 60_000) {}

  private fresh<T extends { at: number }>(
    m: Map<string, T>,
    key: string,
    now: number,
  ): T | undefined {
    const v = m.get(key);
    if (v && now - v.at > this.windowMs) {
      m.delete(key);
      return undefined;
    }
    return v;
  }

  /** How many gifts of this event to credit (0 = skip it). */
  giftsToCredit(note: GiftNote, now = Date.now()): number {
    const key = note.sender.toLowerCase();
    if (note.role === 'purchase') {
      const already = Math.min(note.count, this.fresh(this.counted, key, now)?.n ?? 0);
      this.counted.delete(key);
      const left = note.count - already;
      if (left > 0) this.skip.set(key, { left, at: now });
      return left;
    }
    const pending = this.fresh(this.skip, key, now);
    if (pending && pending.left > 0) {
      pending.left -= 1;
      if (!pending.left) this.skip.delete(key);
      return 0;
    }
    const c = this.fresh(this.counted, key, now);
    this.counted.set(key, { n: (c?.n ?? 0) + 1, at: now });
    return 1;
  }
}
