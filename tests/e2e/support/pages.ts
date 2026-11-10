/** Every page (Phase 1 + R1 + Phases 3–4 + 6), as visited by the CSP / a11y / layout specs. */
export type PageCase = {
  name: string;
  path: string | ((username: string) => string);
  /**
   * user: signed-in viewer; newcomer: no username yet; admin: MODERATOR with a verified passkey;
   * streamer: STREAMER with a verified passkey
   */
  auth?: 'user' | 'newcomer' | 'moderator' | 'admin' | 'streamer';
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
  { name: 'cronograma', path: '/cronograma' },
  // 2026-11-09: Fila, Animes, Jogos
  { name: 'fila', path: '/fila' },
  { name: 'animes', path: '/animes' },
  { name: 'jogos', path: '/jogos' },
  { name: 'filme-assistido', path: '/filmes/a-primeira-live' },
  { name: 'filme-assistido-logado', path: '/filmes/a-primeira-live', auth: 'user' },
  { name: 'perfil-publico-avaliacoes', path: '/u/bia_cine' },
  { name: 'perfil-entrar', path: '/perfil' },
  { name: 'perfil-erro', path: '/perfil?erro=expirado' },
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
  // Phase 4: operations
  { name: 'agenda', path: '/admin/agenda', auth: 'admin', shell: false },
  { name: 'pedidos', path: '/admin/pedidos', auth: 'admin', shell: false },
  { name: 'pessoas', path: '/admin/pessoas', auth: 'admin', shell: false },
  { name: 'agenda-streamer', path: '/admin/agenda', auth: 'streamer', shell: false },
  { name: 'overlays', path: '/admin/overlays', auth: 'streamer', shell: false },
  { name: 'metas', path: '/admin/metas', auth: 'streamer', shell: false },
  { name: 'media-kit-admin', path: '/admin/media-kit', auth: 'streamer', shell: false },
  { name: 'caixa-contato', path: '/admin/contato', auth: 'streamer', shell: false },
  { name: 'cupons', path: '/admin/cupons', auth: 'streamer', shell: false },
  { name: 'auditoria', path: '/admin/auditoria', auth: 'streamer', shell: false },
  { name: 'configuracoes', path: '/admin/configuracoes', auth: 'streamer', shell: false },
  // moderators open the channel sections too (2026-11-08)
  { name: 'overlays-moderacao', path: '/admin/overlays', auth: 'admin', shell: false },
  { name: 'overlay-sem-chave', path: '/overlay/fila', shell: false },
  // Phase 6: links page, suggestions
  { name: 'links', path: '/links' },
  { name: 'sugestoes-entrar', path: '/sugestoes' },
  { name: 'sugestoes', path: '/sugestoes', auth: 'user' },
  { name: 'sugestoes-admin', path: '/admin/sugestoes', auth: 'admin', shell: false },
  { name: 'links-admin', path: '/admin/links', auth: 'streamer', shell: false },
  { name: 'jogos-admin', path: '/admin/jogos', auth: 'admin', shell: false },
  // 2026-11-01: Assistidos, season releases
  { name: 'assistidos', path: '/assistidos' },
  { name: 'assistidos-series', path: '/assistidos?tipo=series' },
  { name: 'estreias-admin', path: '/admin/estreias', auth: 'admin', shell: false },
  // 2026-11-03: subathon timer
  { name: 'subathon-admin', path: '/admin/subathon', auth: 'streamer', shell: false },
  { name: 'subathon-moderacao', path: '/admin/subathon', auth: 'admin', shell: false },
  // 2026-11-04: Roleta
  { name: 'roleta-entrar', path: '/roleta' },
  { name: 'roleta', path: '/roleta', auth: 'user' },
  { name: 'roleta-admin', path: '/admin/roleta', auth: 'admin', shell: false },
  // 2026-11-04: ranking, filtered catalog, analytics
  { name: 'ranking', path: '/ranking' },
  { name: 'ranking-geral', path: '/ranking?periodo=geral' },
  { name: 'filmes-filtrados', path: '/?ordem=preco-asc&duracao=90-120' },
  { name: 'series-filtradas', path: '/series?ordem=meta' },
  { name: 'analise', path: '/admin/analise', auth: 'streamer', shell: false },
  { name: 'analise-12-meses', path: '/admin/analise?periodo=365', auth: 'streamer', shell: false },
  { name: 'analise-moderacao', path: '/admin/analise', auth: 'admin', shell: false },
];
