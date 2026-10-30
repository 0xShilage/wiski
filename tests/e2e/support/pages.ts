/** Every page (Phase 1 + R1 + Phase 3), as visited by the CSP / a11y / layout specs. */
export type PageCase = {
  name: string;
  path: string | ((username: string) => string);
  /** user: signed-in viewer; newcomer: no username yet; admin: MODERATOR with a verified passkey */
  auth?: 'user' | 'newcomer' | 'moderator' | 'admin';
  status?: number;
  /** pages without the public header/footer (the dashboard) */
  shell?: false;
};

export const PAGES: PageCase[] = [
  { name: 'filmes', path: '/' },
  { name: 'series', path: '/series' },
  { name: 'franquias', path: '/franquias' },
  { name: 'filme-detalhe', path: '/filmes/a-noite-do-esquilo' },
  { name: 'serie-detalhe', path: '/series/cronicas-do-bosque' },
  { name: 'franquia-detalhe', path: '/franquias/saga-rabinho-4-filmes' },
  { name: 'avaliacoes', path: '/avaliacoes' },
  { name: 'filme-assistido', path: '/filmes/a-primeira-live' },
  { name: 'filme-assistido-logado', path: '/filmes/a-primeira-live', auth: 'user' },
  { name: 'perfil-publico-avaliacoes', path: '/u/bia_cine' },
  { name: 'perfil-entrar', path: '/perfil' },
  { name: 'perfil-erro', path: '/perfil?erro=expirado' },
  { name: 'termos', path: '/termos' },
  { name: 'privacidade', path: '/privacidade' },
  { name: 'reembolso', path: '/reembolso' },
  { name: 'media-kit', path: '/media-kit' },
  { name: 'contato', path: '/contato' },
  { name: 'perfil-publico', path: (u) => `/u/${u}` },
  { name: 'nao-encontrada', path: '/pagina-que-nao-existe', status: 404 },
  { name: 'perfil', path: '/perfil', auth: 'user' },
  { name: 'sessoes', path: '/perfil/sessoes', auth: 'user' },
  { name: 'bem-vindo', path: '/bem-vindo', auth: 'newcomer' },
  { name: 'seguranca', path: '/perfil/seguranca', auth: 'moderator' },
  { name: 'painel-passkey', path: '/admin/catalogo', auth: 'moderator', shell: false },
  { name: 'painel', path: '/admin/catalogo', auth: 'admin', shell: false },
  { name: 'moderacao', path: '/admin/moderacao', auth: 'admin', shell: false },
];
