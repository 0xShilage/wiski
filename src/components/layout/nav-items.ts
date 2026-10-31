/**
 * The tabs (11 §3): Filmes · Séries · Franquias · Cronograma · Avaliações · Perfil. No search.
 * Cronograma (2026-10-31): what is booked on the next lives.
 */
export const NAV_ITEMS = [
  { href: '/', label: 'Filmes', match: (p: string) => p === '/' || p.startsWith('/filmes') },
  { href: '/series', label: 'Séries', match: (p: string) => p.startsWith('/series') },
  { href: '/franquias', label: 'Franquias', match: (p: string) => p.startsWith('/franquias') },
  { href: '/cronograma', label: 'Cronograma', match: (p: string) => p.startsWith('/cronograma') },
  { href: '/avaliacoes', label: 'Avaliações', match: (p: string) => p.startsWith('/avaliacoes') },
  {
    href: '/perfil',
    label: 'Perfil',
    match: (p: string) =>
      p.startsWith('/perfil') || p.startsWith('/bem-vindo') || p.startsWith('/u/'),
  },
] as const;
