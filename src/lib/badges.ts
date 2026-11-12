/**
 * Emblemas (2026-11-12): the rules shared by the dashboard, the public page and the server.
 */
import type { Picture } from '@/lib/media';

export const BADGE_NAME_MAX = 40;
export const BADGE_DESCRIPTION_MAX = 200;
export const BADGE_CODE_MIN = 3;
export const BADGE_CODE_MAX = 40;

export type BadgeState = 'upcoming' | 'open' | 'closed';

export type BadgeView = {
  id: string;
  slug: string;
  name: string;
  description: string;
  picture: Picture | null;
  /** the first frame of an animated badge ("reduce motion"); null for a still badge */
  still: Picture | null;
  startsAt: string;
  endsAt: string;
  state: BadgeState;
  needsCode: boolean;
  maxClaims: number | null;
  claims: number;
  /** when the viewer claimed it (null: not theirs) */
  claimedAt: string | null;
};

export function badgeState(b: { startsAt: Date; endsAt: Date }, now: Date): BadgeState {
  if (now < b.startsAt) return 'upcoming';
  if (now >= b.endsAt) return 'closed';
  return 'open';
}

/**
 * The claim word as the database stores it (before hashing): lower case, no accents, letters and
 * digits only — so "Maratona!", "maratona" and "MARATONA " are the same word.
 */
export function normalizeCode(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** "Maratona Senhor dos Anéis!" → "maratona-senhor-dos-aneis" (≤ 50 chars). */
export function badgeSlug(name: string): string {
  const s = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join('-')
    .slice(0, 50);
  return s.endsWith('-') ? s.slice(0, -1) || 'emblema' : s || 'emblema';
}
