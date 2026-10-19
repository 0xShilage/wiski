/** The five tabs (11 §3): Filmes · Séries · Franquias · Avaliações · Perfil. No search. */
export const NAV_ITEMS = [
  { href: '/', label: 'Filmes', match: (p: string) => p === '/' || p.startsWith('/filmes') },
  { href: '/series', label: 'Séries', match: (p: string) => p.startsWith('/series') },
  { href: '/franquias', label: 'Franquias', match: (p: string) => p.startsWith('/franquias') },
  { href: '/avaliacoes', label: 'Avaliações', match: (p: string) => p.startsWith('/avaliacoes') },
  {
    href: '/perfil',
    label: 'Perfil',
    match: (p: string) =>
      p.startsWith('/perfil') || p.startsWith('/bem-vindo') || p.startsWith('/u/'),
  },
] as const;
