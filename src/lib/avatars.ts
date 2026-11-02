import { z } from 'zod';

/**
 * Preset profile pictures: hand-made round icons (ASSETS/PROFILE_ICONS, built by `npm run avatars`
 * into public/avatars): 30 on 2026-10-31, 40 on 2026-11-01, 45 since 2026-11-02. A key is the
 * file's number and never changes meaning, so an account keeps its picture; the picker shows them
 * in AVATAR_COLOR_ORDER instead.
 * They replace the 20 mascot × colour presets of 06 §7; old keys were moved to these in migration
 * 20261104120100. No user uploads.
 */
export const AVATAR_KEYS = [
  'perfil-01',
  'perfil-02',
  'perfil-03',
  'perfil-04',
  'perfil-05',
  'perfil-06',
  'perfil-07',
  'perfil-08',
  'perfil-09',
  'perfil-10',
  'perfil-11',
  'perfil-12',
  'perfil-13',
  'perfil-14',
  'perfil-15',
  'perfil-16',
  'perfil-17',
  'perfil-18',
  'perfil-19',
  'perfil-20',
  'perfil-21',
  'perfil-22',
  'perfil-23',
  'perfil-24',
  'perfil-25',
  'perfil-26',
  'perfil-27',
  'perfil-28',
  'perfil-29',
  'perfil-30',
  'perfil-31',
  'perfil-32',
  'perfil-33',
  'perfil-34',
  'perfil-35',
  'perfil-36',
  'perfil-37',
  'perfil-38',
  'perfil-39',
  'perfil-40',
  'perfil-41',
  'perfil-42',
  'perfil-43',
  'perfil-44',
  'perfil-45',
] as const;

export type AvatarKey = (typeof AVATAR_KEYS)[number];

/**
 * The picker's order (2026-11-02): grouped by each picture's background colour — white, light
 * grey, beige, yellow, green, blue, purple, pink, red, brown, black — lighter first within a
 * group. Every key exactly once (tests/unit/rules.test.ts); a new picture must be placed here.
 */
export const AVATAR_COLOR_ORDER: readonly AvatarKey[] = [
  // branco
  'perfil-09',
  'perfil-06',
  'perfil-12',
  'perfil-45',
  'perfil-21',
  'perfil-04',
  'perfil-05',
  'perfil-31',
  'perfil-02',
  'perfil-07',
  'perfil-03',
  'perfil-08',
  'perfil-01',

  // cinza claro
  'perfil-11',
  'perfil-10',

  // bege
  'perfil-18',
  'perfil-20',
  'perfil-19',

  // amarelo
  'perfil-17',
  'perfil-13',
  'perfil-14',
  'perfil-15',
  'perfil-16',
  'perfil-41',

  // verde
  'perfil-40',

  // azul
  'perfil-44',
  'perfil-28',
  'perfil-29',
  'perfil-33',
  'perfil-32',
  'perfil-30',

  // roxo
  'perfil-36',

  // rosa
  'perfil-25',

  // vermelho
  'perfil-24',
  'perfil-26',
  'perfil-27',
  'perfil-43',

  // marrom
  'perfil-22',
  'perfil-23',

  // preto
  'perfil-42',
  'perfil-34',
  'perfil-37',
  'perfil-38',
  'perfil-35',
  'perfil-39',
];

export const DEFAULT_AVATAR: AvatarKey = 'perfil-01';
export const avatarKeySchema = z.enum(AVATAR_KEYS);

/** Built sizes: 128 serves avatars up to 64 CSS px at 2×, 256 the larger ones. */
export const AVATAR_PIXELS = [128, 256] as const;

export function avatarSrc(key: AvatarKey, cssPx: number): string {
  return `/avatars/${key}-${cssPx <= 64 ? 128 : 256}.webp`;
}

/** "Avatar 7" — the picker's accessible name. */
export function avatarLabel(key: AvatarKey): string {
  return `Avatar ${Number(key.slice(-2))}`;
}

/** Safe resolver for values read from the DB: unknown keys fall back to the default. */
export function resolveAvatarKey(value: string | null | undefined): AvatarKey {
  const parsed = avatarKeySchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_AVATAR;
}
