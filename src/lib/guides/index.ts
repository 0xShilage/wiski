/**
 * Spoiler-free guides (2026-11-11): which title pages link to one. Matched by kind and title
 * (the catalog slug is chosen by the team), so the link appears as soon as the title is added.
 */
export type Guide = { href: string; title: string; blurb: string };

const fold = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

export function guideFor(item: {
  kind: string;
  title: string;
  originalTitle?: string | null;
}): Guide | null {
  if (
    item.kind === 'SERIES' &&
    (fold(item.title) === 'dark' || fold(item.originalTitle) === 'dark')
  )
    return {
      href: '/guias/dark',
      title: 'Guia de Winden',
      blurb:
        'Um mapa da cidade, as épocas e as quatro famílias da 1ª temporada, sem spoilers: você diz até qual episódio viu.',
    };
  return null;
}
