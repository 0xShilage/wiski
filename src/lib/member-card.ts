import type { RoleName } from '@/lib/roles';
/**
 * Cinema membership card on /perfil (2026-11-11): the tier, the member number and the decorative
 * barcode. Pure: the server counts, this decides (and the unit tests check it). The card is the
 * viewer's own private page, so the counts include their anonymous sponsorships too — unlike the
 * public badges and ranking, which count only orders shown with the name.
 */
export type MemberTierId =
  'viewer' | 'member' | 'silver' | 'gold' | 'diamond' | 'staff' | 'super' | 'streamer';
export type MemberTier = { id: MemberTierId; label: string };

/** Paid sponsorships + contributions needed for each tier (same steps as the sponsor badges). */
export const MEMBER_TIERS: readonly { id: MemberTierId; label: string; from: number }[] = [
  { id: 'viewer', label: 'Espectador', from: 0 },
  { id: 'member', label: 'Sócio', from: 1 },
  { id: 'silver', label: 'Sócio Prata', from: 5 },
  { id: 'gold', label: 'Sócio Ouro', from: 10 },
  { id: 'diamond', label: 'Sócio Diamante', from: 25 },
];

export type MemberStats = {
  /** paid (not refunded) movie sponsorships, named or not */
  sponsorships: number;
  /** paid (not refunded) series/franchise contributions, named or not */
  contributions: number;
  /** minutes of the films they sponsored that were already watched on stream */
  minutes: number;
  /** visible reviews */
  reviews: number;
};

export function memberTier(
  stats: Pick<MemberStats, 'sponsorships' | 'contributions'>,
  role: RoleName,
): MemberTier {
  if (role === 'STREAMER') return { id: 'streamer', label: 'Streamer' };
  if (role === 'SUPER_MODERATOR') return { id: 'super', label: 'Super Moderador' };
  if (role === 'MODERATOR') return { id: 'staff', label: 'Moderação' };
  const total = stats.sponsorships + stats.contributions;
  const tier = [...MEMBER_TIERS].reverse().find((t) => total >= t.from)!;
  return { id: tier.id, label: tier.label };
}

/** The next tier and how many more sponsorships/contributions it takes (null at the top, or staff). */
export function nextMemberTier(
  stats: Pick<MemberStats, 'sponsorships' | 'contributions'>,
  role: RoleName,
): { label: string; remaining: number } | null {
  if (role !== 'USER') return null;
  const total = stats.sponsorships + stats.contributions;
  const next = MEMBER_TIERS.find((t) => t.from > total);
  return next ? { label: next.label, remaining: next.from - total } : null;
}

/**
 * "0042 1937": eight digits from an FNV-1a hash of the account id. Stable for the account, and it
 * says nothing about the id (27 bits out of a 122-bit UUID can't be turned back into it).
 */
export function memberNumber(userId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const digits = String(h % 100_000_000).padStart(8, '0');
  return `${digits.slice(0, 4)} ${digits.slice(4)}`;
}

/** A decorative barcode for the number: bar positions and widths in viewBox units. */
export function barcodeBars(number: string): { x: number; w: number }[] {
  const digits = number.replace(/\D/g, '');
  const bars: { x: number; w: number }[] = [];
  let x = 0;
  const push = (w: number, gap: number) => {
    bars.push({ x, w });
    x += w + gap;
  };
  push(1, 1); // start guard
  push(1, 2);
  for (const d of digits) {
    const n = Number(d);
    push(1 + (n % 3), 1 + ((n >> 1) % 2));
    push(1 + ((n + 1) % 2), 1 + (n % 2));
  }
  push(1, 1); // end guard
  push(1, 0);
  return bars;
}

export const barcodeWidth = (bars: { x: number; w: number }[]) => {
  const last = bars.at(-1);
  return last ? last.x + last.w : 0;
};
