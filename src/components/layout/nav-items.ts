/**
 * The tabs (11 §3): Filmes · Séries · Franquias · Cronograma · Assistidos · Avaliações ·
 * Sugestões · Roleta · Links · Perfil. Roleta (2026-11-04): the daily wheel of fortune. No search. Cronograma (2026-10-31): what is booked on the next
 * lives. Sugestões and Links (Phase 6). Assistidos (2026-11-01): everything already watched.
 *
 * Desktop shows every tab. Phones show the `bar` tabs plus "Mais", which opens the `more` ones.
 */
export const NAV_ITEMS = [
  {
    href: '/',
    label: 'Filmes',
    mobile: 'bar',
    match: (p: string) => p === '/' || p.startsWith('/filmes'),
  },
  {
    href: '/series',
    label: 'Séries',
    mobile: 'bar',
    match: (p: string) => p.startsWith('/series'),
  },
  {
    href: '/franquias',
    label: 'Franquias',
    mobile: 'bar',
    match: (p: string) => p.startsWith('/franquias'),
  },
  {
    href: '/cronograma',
    label: 'Cronograma',
    mobile: 'bar',
    match: (p: string) => p.startsWith('/cronograma'),
  },
  {
    href: '/assistidos',
    label: 'Assistidos',
    mobile: 'more',
    match: (p: string) => p.startsWith('/assistidos'),
  },
  {
    href: '/avaliacoes',
    label: 'Avaliações',
    mobile: 'more',
    match: (p: string) => p.startsWith('/avaliacoes'),
  },
  {
    href: '/sugestoes',
    label: 'Sugestões',
    mobile: 'more',
    match: (p: string) => p.startsWith('/sugestoes'),
  },
  {
    href: '/roleta',
    label: 'Roleta',
    mobile: 'more',
    match: (p: string) => p.startsWith('/roleta'),
  },
  { href: '/links', label: 'Links', mobile: 'more', match: (p: string) => p.startsWith('/links') },
  {
    href: '/perfil',
    label: 'Perfil',
    mobile: 'bar',
    match: (p: string) =>
      p.startsWith('/perfil') || p.startsWith('/bem-vindo') || p.startsWith('/u/'),
  },
] as const;

export type NavItem = (typeof NAV_ITEMS)[number];
