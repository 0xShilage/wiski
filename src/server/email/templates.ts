import 'server-only';
import type { EmailTemplate } from '@/generated/prisma/enums';
import { formatBRL } from '@/lib/catalog/pricing';
import { formatDate } from '@/lib/format';

/**
 * Transactional e-mails (pt-BR). Plain text + minimal HTML: every value is escaped, no remote
 * images or trackers, the only link points at our own origin.
 */
export type EmailContent = { subject: string; text: string; html: string };

export type TemplateContext = {
  origin: string;
  publicCode: string;
  kind: 'MOVIE' | 'CONTRIBUTION';
  title: string;
  totalCents: number;
  /** order link with the access token (receipt only, when still available) */
  orderUrl: string | null;
  itemUrl: string;
  deadlineAt?: Date | undefined;
};

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!);

/** Header-safe subject: no CR/LF (header injection), bounded. */
const subjectSafe = (s: string) => s.replace(/[\r\n\u2028\u2029]+/g, ' ').slice(0, 140);

function html(paragraphs: (string | { href: string; label: string })[]): string {
  const body = paragraphs
    .map((p) =>
      typeof p === 'string'
        ? `<p>${escapeHtml(p)}</p>`
        : `<p><a href="${escapeHtml(p.href)}">${escapeHtml(p.label)}</a></p>`,
    )
    .join('\n');
  return `<!doctype html><html lang="pt-BR"><body>\n${body}\n<p>— Wiski</p></body></html>`;
}

const FOOTER = 'Você recebe este e-mail porque fez um pedido no Wiski. Não enviamos propaganda.';

export function render(template: EmailTemplate, c: TemplateContext): EmailContent {
  const what =
    c.kind === 'MOVIE'
      ? `o patrocínio do filme “${c.title}”`
      : `a sua contribuição para “${c.title}”`;
  switch (template) {
    case 'ORDER_RECEIPT': {
      const lines = [
        `Recebemos o seu Pix de ${formatBRL(c.totalCents)} para ${what}. Obrigado!`,
        `Pedido: ${c.publicCode}`,
        c.kind === 'MOVIE'
          ? 'O filme entra numa das próximas sessões da live; a data aparece na página do pedido.'
          : 'Quando a campanha atingir a meta, o título entra na programação da live.',
      ];
      const link = c.orderUrl ?? `${c.origin}/perfil`;
      return {
        subject: subjectSafe(`Pagamento confirmado — pedido ${c.publicCode}`),
        text: [...lines, `Acompanhe o pedido: ${link}`, '', FOOTER].join('\n'),
        html: html([...lines, { href: link, label: 'Acompanhar o pedido' }, FOOTER]),
      };
    }
    case 'CAMPAIGN_EXTENDED': {
      const until = c.deadlineAt ? formatDate(c.deadlineAt) : '';
      const lines = [
        `A campanha de “${c.title}”, para a qual você contribuiu, foi prorrogada${until ? ` até ${until}` : ''}.`,
        'A sua contribuição continua valendo. Obrigado pela paciência!',
      ];
      return {
        subject: subjectSafe(`Campanha prorrogada — ${c.title}`),
        text: [...lines, `Ver a campanha: ${c.itemUrl}`, '', FOOTER].join('\n'),
        html: html([...lines, { href: c.itemUrl, label: 'Ver a campanha' }, FOOTER]),
      };
    }
    case 'CAMPAIGN_FUNDED': {
      const lines = [
        `“${c.title}” atingiu a meta! A sua contribuição ajudou a colocar o título na programação.`,
        'O streamer vai anunciar a sessão em que ele será exibido.',
      ];
      return {
        subject: subjectSafe(`Meta atingida — ${c.title}`),
        text: [...lines, `Ver a página: ${c.itemUrl}`, '', FOOTER].join('\n'),
        html: html([...lines, { href: c.itemUrl, label: 'Ver a página' }, FOOTER]),
      };
    }
  }
}
