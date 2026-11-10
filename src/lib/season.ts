import type { Picture } from './media';

/**
 * Seasonal themes (2026-11-10), client-safe: the ids, their names in the admin panel and what the
 * small piece next to the logo is called (screen readers skip it; it is decoration).
 */
export const SEASONS = ['natal', 'halloween', 'aniversario'] as const;
export type Season = (typeof SEASONS)[number];

export const SEASON_LABEL: Record<Season, string> = {
  natal: 'Natal',
  halloween: 'Halloween',
  aniversario: 'Aniversário da Iara',
};

export const SEASON_HINT: Record<Season, string> = {
  natal: 'Flocos de neve no fundo, brilho vermelho e verde, gorro do Papai Noel ao lado do logo.',
  halloween: 'Morcegos e luas no fundo, brilho laranja, abóbora ao lado do logo.',
  aniversario: 'Confete no fundo, brilho rosa e dourado, balões ao lado do logo.',
};

/** The home pop-up as the home page gets it (2026-11-10). */
export type HomePopup = {
  /** changes each time the pop-up is switched on: visitors who closed it see the next one */
  id: string;
  title: string;
  body: string;
  image: Picture | null;
  cta: { label: string; href: string } | null;
};
