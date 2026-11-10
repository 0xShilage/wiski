/**
 * The tabs (11 §3): Filmes · Séries · Franquias · Fila · Cronograma · Assistidos · Avaliações ·
 * Sugestões · Roleta · Links · Perfil. Fila (2026-11-09): what is paid and waiting. Roleta (2026-11-04): the daily wheel of fortune. No search. Cronograma (2026-10-31): what is booked on the next
 * lives. Sugestões and Links (Phase 6). Assistidos (2026-11-01): everything already watched.
 *
 * Phones show the `mobile: 'bar'` tabs plus "Mais", which opens the `more` ones. Desktop
 * (2026-11-09, thirteen tabs no longer fit next to the logo) shows the `desktop: 'bar'` tabs plus
 * its own "Mais" menu with the rest.
 */
export const NAV_ITEMS = [
  {
    href: '/',
    desktop: 'bar',
    label: 'Filmes',
    mobile: 'bar',
    match: (p: string) => p === '/' || p.startsWith('/filmes'),
  },
  {
    href: '/series',
    desktop: 'bar',
    label: 'Séries',
    mobile: 'bar',
    match: (p: string) => p.startsWith('/series'),
  },
  {
    href: '/franquias',
    desktop: 'bar',
    label: 'Franquias',
    mobile: 'bar',
    match: (p: string) => p.startsWith('/franquias'),
  },
  {
    href: '/animes',
    desktop: 'bar',
    label: 'Animes',
    mobile: 'more',
    match: (p: string) => p.startsWith('/animes'),
  },
  {
    href: '/jogos',
    desktop: 'more',
    label: 'Jogos',
    mobile: 'more',
    match: (p: string) => p.startsWith('/jogos'),
  },
  {
    href: '/fila',
    desktop: 'bar',
    label: 'Fila',
    mobile: 'more',
    match: (p: string) => p.startsWith('/fila'),
  },
  {
    href: '/cronograma',
    desktop: 'bar',
    label: 'Cronograma',
    mobile: 'bar',
    match: (p: string) => p.startsWith('/cronograma'),
  },
  {
    href: '/assistidos',
    desktop: 'more',
    label: 'Assistidos',
    mobile: 'more',
    match: (p: string) => p.startsWith('/assistidos'),
  },
  {
    href: '/avaliacoes',
    desktop: 'more',
    label: 'Avaliações',
    mobile: 'more',
    match: (p: string) => p.startsWith('/avaliacoes'),
  },
  {
    href: '/sugestoes',
    desktop: 'more',
    label: 'Sugestões',
    mobile: 'more',
    match: (p: string) => p.startsWith('/sugestoes'),
  },
  {
    href: '/roleta',
    desktop: 'more',
    label: 'Roleta',
    mobile: 'more',
    match: (p: string) => p.startsWith('/roleta'),
  },
  {
    href: '/apoiadores',
    desktop: 'more',
    label: 'Apoiadores',
    mobile: 'more',
    match: (p: string) => p.startsWith('/apoiadores'),
  },
  {
    href: '/links',
    desktop: 'more',
    label: 'Links',
    mobile: 'more',
    match: (p: string) => p.startsWith('/links'),
  },
  {
    href: '/perfil',
    desktop: 'bar',
    label: 'Perfil',
    mobile: 'bar',
    match: (p: string) =>
      p.startsWith('/perfil') || p.startsWith('/bem-vindo') || p.startsWith('/u/'),
  },
] as const;

export type NavItem = (typeof NAV_ITEMS)[number];
