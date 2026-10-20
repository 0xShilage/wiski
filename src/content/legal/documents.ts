/**
 * Legal texts (Q13). They live in the repository, versioned: every checkout records which version
 * (and the SHA-256 of exactly this structure, see legal.ts) the buyer accepted.
 *
 * These are PROVISIONAL texts written to describe what the site does — not legal advice. The
 * lawyer's final texts replace them (new `version`, `provisional: false`); production refuses to
 * start while any current text is provisional (src/server/legal/legal.ts).
 *
 * To publish a change: edit the text AND bump `version` (a test fails if the hash of a version
 * changes, so an accepted text can never be edited in place).
 */
export type LegalType = 'TERMS' | 'PRIVACY' | 'REFUND';

export type LegalBlock = { p: string } | { list: string[] } | { h2: string; id?: string };

export type LegalText = {
  type: LegalType;
  version: string;
  title: string;
  path: '/termos' | '/privacidade' | '/reembolso';
  provisional: boolean;
  blocks: LegalBlock[];
};

export const LEGAL_TEXTS: Record<LegalType, LegalText> = {
  TERMS: {
    type: 'TERMS',
    version: '2026-10-19-provisorio',
    title: 'Termos de uso',
    path: '/termos',
    provisional: true,
    blocks: [
      {
        p: 'Estes termos explicam como funcionam os patrocínios de filmes e as contribuições para séries e franquias do Wiski.',
      },
      { h2: 'Patrocínio de filmes' },
      {
        list: [
          'Cada filme da lista é patrocinado por uma única pessoa, que paga o valor inteiro mostrado na página antes do pagamento.',
          'O pagamento é feito por Pix, processado pelo Mercado Pago. Enquanto o Pix não é pago, o filme fica reservado por até 35 minutos; depois disso, a reserva é desfeita.',
          'Depois de pago, o filme entra numa das próximas sessões da live. A data é definida pelo streamer.',
        ],
      },
      { h2: 'Contribuições para séries e franquias' },
      {
        list: [
          'Séries e franquias são financiadas coletivamente: qualquer pessoa pode contribuir com valores inteiros a partir de R$ 5,00 até completar a meta.',
          'Cada campanha tem um prazo. Se a meta não for atingida no prazo, as contribuições ficam pausadas e o streamer pode prorrogar o prazo quantas vezes for necessário. Cada prorrogação aparece na página da campanha e quem contribuiu e informou um e-mail é avisado.',
          'O dinheiro de uma campanha pode, portanto, ficar aguardando por tempo indeterminado até a meta ser atingida e o título ser exibido.',
        ],
      },
      { h2: 'Nomes e mensagens' },
      {
        p: 'Você pode aparecer como patrocinador pelo seu nome de usuário, por um nome de exibição (que passa por moderação) ou como “Anônimo”. Mensagens também passam por moderação antes de aparecer.',
      },
      { h2: 'Reembolsos' },
      { p: 'Patrocínios e contribuições não são reembolsáveis. Veja a política de reembolso.' },
    ],
  },
  PRIVACY: {
    type: 'PRIVACY',
    version: '2026-10-19-provisorio',
    title: 'Política de privacidade',
    path: '/privacidade',
    provisional: true,
    blocks: [
      { p: 'Resumimos o que o site faz hoje com os seus dados:' },
      {
        list: [
          'Login com Google: guardamos o identificador da sua conta Google, seu e-mail (nunca exibido), o nome de usuário e o avatar que você escolher.',
          'Pagamentos: para gerar o Pix enviamos ao Mercado Pago o valor, uma referência do pedido e o seu e-mail de contato. Não recebemos nem guardamos dados bancários.',
          'Pedidos: guardamos o e-mail de contato, o valor, o título escolhido e a situação do pagamento, para mostrar o pedido a você e cumprir obrigações legais.',
          'E-mails: enviamos o comprovante com o link do pedido depois que o pagamento é aprovado, e avisos sobre campanhas para as quais você contribuiu. Não enviamos propaganda.',
          'Cookies: apenas os necessários para o login, para acessar os seus pedidos e para a segurança da sua sessão. Não usamos cookies de publicidade nem de análise.',
          'Proteção contra robôs: o checkout usa o Cloudflare Turnstile, que avalia sinais do navegador para separar pessoas de robôs.',
          'Segurança: registros técnicos guardam o seu endereço IP apenas de forma cifrada (HMAC) e por até 30 dias.',
          'Trailers: o player do YouTube (youtube-nocookie.com) só é carregado quando você clica em “Assistir trailer”; antes disso, nada é enviado ao Google.',
          'Você pode encerrar suas sessões a qualquer momento em “Perfil › Sessões ativas”.',
        ],
      },
      { h2: 'Canal de privacidade (LGPD)', id: 'canal-lgpd' },
      {
        p: 'O canal oficial para pedidos sobre seus dados pessoais (acesso, correção, exclusão) será publicado aqui junto com a política definitiva.',
      },
    ],
  },
  REFUND: {
    type: 'REFUND',
    version: '2026-10-19-provisorio',
    title: 'Política de reembolso',
    path: '/reembolso',
    provisional: true,
    blocks: [
      { p: 'Patrocínios de filmes e contribuições para campanhas não são reembolsáveis.' },
      {
        list: [
          'Se uma sessão da live for cancelada, o filme patrocinado é remarcado para outra sessão — não há reembolso.',
          'Se uma campanha não atingir a meta no prazo, as contribuições continuam valendo e o prazo pode ser prorrogado.',
          'Pagamentos em duplicidade ou erros de processamento são analisados e devolvidos pelo streamer.',
        ],
      },
    ],
  },
};
