import { z } from 'zod';

/**
 * Preset avatars (06 §7): 4 mascot poses × 5 colours, each on a fixed background chosen for
 * contrast (≥ 3:1 for graphics) with a plum ring. No user uploads.
 */
export const AVATAR_POSES = [1, 2, 3, 4] as const;
export const AVATAR_COLOURS = ['ink', 'plum', 'violet', 'lavender', 'lilac'] as const;
export type AvatarColour = (typeof AVATAR_COLOURS)[number];

/** pose × colour, listed literally so the Zod enum and the DB CHECK-free column agree exactly. */
export const AVATAR_KEYS = [
  'mascote-1-ink',
  'mascote-1-plum',
  'mascote-1-violet',
  'mascote-1-lavender',
  'mascote-1-lilac',
  'mascote-2-ink',
  'mascote-2-plum',
  'mascote-2-violet',
  'mascote-2-lavender',
  'mascote-2-lilac',
  'mascote-3-ink',
  'mascote-3-plum',
  'mascote-3-violet',
  'mascote-3-lavender',
  'mascote-3-lilac',
  'mascote-4-ink',
  'mascote-4-plum',
  'mascote-4-violet',
  'mascote-4-lavender',
  'mascote-4-lilac',
] as const;

export type AvatarKey = (typeof AVATAR_KEYS)[number];
export const DEFAULT_AVATAR: AvatarKey = 'mascote-4-lavender';
export const avatarKeySchema = z.enum(AVATAR_KEYS);

/** Background per mascot colour (contrast: ink 13.71, plum 7.09, violet 3.55, lavender 7.40, lilac 7.09). */
export const AVATAR_BACKGROUND: Record<AvatarColour, string> = {
  ink: 'bg-lilac',
  plum: 'bg-lilac',
  violet: 'bg-lilac',
  lavender: 'bg-ink',
  lilac: 'bg-plum',
};

export const AVATAR_COLOUR_LABEL: Record<AvatarColour, string> = {
  ink: 'noite',
  plum: 'ameixa',
  violet: 'violeta',
  lavender: 'lavanda',
  lilac: 'lilás',
};

export function avatarColour(key: AvatarKey): AvatarColour {
  return key.split('-')[2] as AvatarColour;
}

/** Safe resolver for values read from the DB: unknown keys fall back to the default. */
export function resolveAvatarKey(value: string | null | undefined): AvatarKey {
  const parsed = avatarKeySchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_AVATAR;
}
