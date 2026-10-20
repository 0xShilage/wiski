'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Breakdown } from '@/components/checkout/Breakdown';
import { useEventStream } from '@/components/checkout/useEventStream';
import { IconCheck } from '@/components/ui/icons';
import { apiFetch } from '@/lib/api-fetch';
import { KIND_PATH } from '@/lib/catalog/kinds';
import { formatBRL } from '@/lib/catalog/pricing';
import { PAID_STATES, statusOf } from '@/lib/orders/labels';
import type { BuyerOrderView } from '@/server/orders/read';
import { PixQr } from './PixQr';

type Props = {
  initial: BuyerOrderView;
  /** "Confira o nome do recebedor" (Q13) — null when not configured (development) */
  recipientName: string | null;
  signedIn: boolean;
  /** the buyer (owner or cookie holder), not staff looking at it */
  isBuyer: boolean;
  /** holds the order in the cookie (can link it to the signed-in account) */
  canClaim: boolean;
};

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * /pedido/[code] (13 §3 step 12): the Pix (QR + copia e cola), a countdown, the live status
 * (SSE, polling fallback) and the end states. The access token arrives in the URL fragment right
 * after checkout; it is kept in memory for "Copiar link do pedido" and removed from the address
 * bar at once.
 */
export function OrderView({ initial, recipientName, signedIn, isBuyer, canClaim }: Props) {
  const [o, setO] = useState(initial);
  const [link, setLink] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState<'pix' | 'link' | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(initial.claimed);
  const [announce, setAnnounce] = useState('');
  const status = useRef(initial.status);

  const pending = o.status === 'PENDING_PAYMENT';
  const expiresAt = o.pix?.expiresAt ?? o.expiresAt;
  const left = expiresAt ? Date.parse(expiresAt) - now : 0;
  const itemHref = `/${KIND_PATH[o.item.kind]}/${o.item.slug}`;

  useEffect(() => {
    const m = /(?:^#|&)t=([\w-]{43})(?:&|$)/.exec(window.location.hash);
    if (!m) return;
    const url = `${window.location.origin}/pedido/${initial.publicCode}#t=${m[1]}`;
    history.replaceState(null, '', window.location.pathname + window.location.search);
    const t = window.setTimeout(() => setLink(url), 0);
    return () => window.clearTimeout(t);
  }, [initial.publicCode]);

  useEffect(() => {
    if (!pending) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [pending]);

  const refresh = useCallback(async () => {
    const res = await apiFetch<{ order: BuyerOrderView }>(`/api/v1/orders/${o.publicCode}`);
    if (res.ok) {
      const next = res.data.order;
      if (next.status !== status.current) {
        status.current = next.status;
        setAnnounce(`Situação do pedido: ${statusOf(next.status).label}.`);
      }
      setO(next);
    }
  }, [o.publicCode]);

  useEventStream<{ status: string }>({
    url: pending ? `/api/v1/orders/${o.publicCode}/events` : null,
    event: 'status',
    pollUrl: `/api/v1/orders/${o.publicCode}`,
    fromPoll: (json) => {
      const order = (json as { order?: BuyerOrderView }).order;
      return order ? { status: order.status } : null;
    },
    onData: (e) => {
      if (e.status !== status.current) void refresh();
    },
  });

  // Past the Pix deadline: check once (the worker expires it at 35 min; a late payment still wins).
  const expiredLocally = pending && !!expiresAt && left <= 0;
  useEffect(() => {
    if (!expiredLocally) return;
    const t = window.setTimeout(() => void refresh(), 1500);
    return () => window.clearTimeout(t);
  }, [expiredLocally, refresh]);

  async function copy(what: 'pix' | 'link', text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 2500);
    } catch {
      setError('Não foi possível copiar. Selecione o texto e copie manualmente.');
    }
  }

  async function cancel() {
    setBusy(true);
    setError(null);
    const res = await apiFetch<{ order: BuyerOrderView }>(`/api/v1/orders/${o.publicCode}/cancel`, {
      method: 'POST',
    });
    setBusy(false);
    setConfirmCancel(false);
    if (res.ok) {
      status.current = res.data.order.status;
      setO(res.data.order);
    } else {
      setError(res.problem.detail);
      void refresh();
    }
  }

  async function claim() {
    setBusy(true);
    setError(null);
    const res = await apiFetch<{ claimed: boolean }>(`/api/v1/orders/${o.publicCode}/claim`, {
      method: 'POST',
    });
    setBusy(false);
    if (res.ok) setClaimed(true);
    else setError(res.problem.detail);
  }

  const st = statusOf(o.status);
  const paid = PAID_STATES.includes(o.status);

  return (
    <div className="wf-page wf-page--narrow wf-order">
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      <header className="wf-order__head">
        <p className="wf-kicker">
          {o.kind === 'MOVIE' ? 'Patrocínio de filme' : 'Contribuição para campanha'} ·{' '}
          <span className="wf-nums-inline">{o.publicCode}</span>
        </p>
        <h1 className="wf-h1">
          <Link href={itemHref}>{o.item.title}</Link>
        </h1>
        <p
          className={`wf-status wf-status--${st.tone === 'ok' ? 'ok' : st.tone === 'wait' ? 'wait' : 'warn'}`}
        >
          {paid ? <IconCheck /> : null}
          {st.label}
        </p>
      </header>

      {pending ? (
        <section className="wf-order__pay" aria-labelledby="pagar">
          <div className="wf-order__intro">
            <h2 id="pagar" className="wf-h2">
              Pague {formatBRL(o.totalCents)} com Pix
            </h2>
            <p className="wf-countdown" role="timer" aria-live="off">
              {left > 0 ? (
                <>
                  Expira em <b>{mmss(left)}</b>
                </>
              ) : (
                'Tempo esgotado — verificando o pagamento…'
              )}
            </p>
          </div>

          {o.pix ? (
            <div className="wf-pix">
              <div className="wf-pix__qr">
                <PixQr text={o.pix.qrCode} />
              </div>
              <div className="wf-pix__steps">
                <ol className="wf-steps">
                  <li>Abra o app do seu banco e escolha pagar com Pix.</li>
                  <li>Escaneie o QR code ou use o Pix copia e cola.</li>
                  <li>
                    Confira o valor de <b>{formatBRL(o.totalCents)}</b>
                    {recipientName ? (
                      <>
                        {' '}
                        e o nome do recebedor: <b>{recipientName}</b>
                      </>
                    ) : null}
                    .
                  </li>
                </ol>
                <label className="wf-field" htmlFor="pix-code">
                  Pix copia e cola
                  <textarea
                    id="pix-code"
                    className="wf-input wf-pix__code"
                    readOnly
                    value={o.pix.qrCode}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </label>
                <button
                  type="button"
                  className="wf-btn wf-btn--neon w-full"
                  onClick={() => void copy('pix', o.pix!.qrCode)}
                >
                  {copied === 'pix' ? (
                    <>
                      Código copiado <IconCheck />
                    </>
                  ) : (
                    'Copiar código Pix'
                  )}
                </button>
                <p className="sr-only" aria-live="polite">
                  {copied === 'pix' ? 'Código Pix copiado.' : ''}
                </p>
              </div>
            </div>
          ) : (
            <p className="wf-alert">
              Não foi possível carregar o Pix agora. Recarregue a página em instantes — se você já
              pagou, a confirmação aparece aqui sozinha.
            </p>
          )}
          <p className="wf-live">
            <span className="wf-live__dot" aria-hidden="true" /> Esta página se atualiza sozinha
            quando o pagamento for confirmado.
          </p>
        </section>
      ) : (
        <section className="wf-panel wf-order__done" aria-live="polite">
          {paid ? (
            <>
              <h2>
                {o.kind === 'MOVIE' ? 'Pagamento confirmado!' : 'Obrigado pela contribuição!'}
              </h2>
              <p>
                {o.kind === 'MOVIE'
                  ? `${o.item.title} agora está patrocinado e entra numa das próximas sessões da live.`
                  : `Sua contribuição de ${formatBRL(o.totalCents)} entrou na campanha de ${o.item.title}.`}
              </p>
              <p className="wf-muted text-sm">
                Comprovante enviado para {o.contactEmail}
                {o.paidAt ? ` · pago em ${dateTime.format(new Date(o.paidAt))}` : ''}.
              </p>
            </>
          ) : o.status === 'EXPIRED' || o.status === 'CANCELLED' ? (
            <>
              <h2>{o.status === 'EXPIRED' ? 'O Pix expirou' : 'Pedido cancelado'}</h2>
              <p>
                Nada foi cobrado.
                {o.kind === 'MOVIE' ? ' O filme voltou a ficar disponível para patrocínio.' : ''}
              </p>
              <Link
                href={`${itemHref}${o.kind === 'MOVIE' ? '#patrocinar' : '#contribuir'}`}
                className="wf-btn wf-btn--neon"
              >
                Tentar de novo
              </Link>
            </>
          ) : o.status === 'NEEDS_ATTENTION' ? (
            <>
              <h2>Pagamento em análise</h2>
              <p>
                Recebemos um pagamento que precisa de conferência (por exemplo, pago depois do prazo
                do Pix). A equipe vai confirmar o pedido ou devolver o valor.
              </p>
            </>
          ) : (
            <>
              <h2>{st.label}</h2>
              <p>
                {o.status === 'REFUNDED'
                  ? 'O valor foi devolvido para a conta que pagou o Pix.'
                  : 'Acompanhe aqui a situação do seu pedido.'}
              </p>
            </>
          )}
        </section>
      )}

      {error ? (
        <p role="alert" className="wf-alert">
          {error}
        </p>
      ) : null}

      <section className="wf-panel" aria-labelledby="resumo">
        <h2 id="resumo">Resumo</h2>
        <Breakdown lines={o.lines} />
        <dl className="wf-order__meta">
          <dt>Pedido</dt>
          <dd>{o.publicCode}</dd>
          <dt>Feito em</dt>
          <dd>{dateTime.format(new Date(o.createdAt))}</dd>
          <dt>Comprovante</dt>
          <dd>{o.contactEmail}</dd>
          {o.displayName ? (
            <>
              <dt>Nome público</dt>
              <dd>
                {o.displayName}
                {o.displayNameStatus === 'PENDING' ? ' (aguardando moderação)' : null}
                {o.displayNameStatus === 'REJECTED' ? ' (não aprovado)' : null}
              </dd>
            </>
          ) : null}
          {o.message ? (
            <>
              <dt>Mensagem</dt>
              <dd>
                {o.message}
                {o.messageStatus === 'PENDING' ? ' (aguardando moderação)' : null}
                {o.messageStatus === 'REJECTED' ? ' (não aprovada)' : null}
              </dd>
            </>
          ) : null}
        </dl>

        {link ? (
          <div className="wf-order__link">
            <p className="wf-hint">
              Guarde o link do pedido para voltar a esta página em outro aparelho. Ele também vai no
              e-mail do comprovante.
            </p>
            <button
              type="button"
              className="wf-btn wf-btn--ghost wf-btn--sm"
              onClick={() => void copy('link', link)}
            >
              {copied === 'link' ? 'Link copiado' : 'Copiar link do pedido'}
            </button>
          </div>
        ) : null}

        {isBuyer && !claimed ? (
          signedIn ? (
            canClaim ? (
              <button
                type="button"
                className="wf-btn wf-btn--ghost wf-btn--sm mt-4"
                onClick={() => void claim()}
                disabled={busy}
              >
                Vincular à minha conta
              </button>
            ) : null
          ) : (
            <p className="wf-hint mt-4">
              <a href={`/perfil?returnTo=${encodeURIComponent(`/pedido/${o.publicCode}`)}`}>
                Entre com Google
              </a>{' '}
              para guardar esta compra em “Minhas compras”.
            </p>
          )
        ) : null}
        {claimed && isBuyer ? (
          <p className="wf-hint mt-4">Esta compra está na sua conta, em Perfil › Minhas compras.</p>
        ) : null}

        {pending && isBuyer && o.canCancel ? (
          confirmCancel ? (
            <div className="wf-confirm" role="group" aria-label="Confirmar cancelamento">
              <p>
                Cancelar este pedido? O Pix deixa de valer
                {o.kind === 'MOVIE' ? ' e o filme volta a ficar disponível' : ''}.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className="wf-btn wf-btn--ghost wf-btn--sm"
                  onClick={() => void cancel()}
                  disabled={busy}
                >
                  Sim, cancelar
                </button>
                <button
                  type="button"
                  className="wf-btn wf-btn--sm wf-btn--plain"
                  onClick={() => setConfirmCancel(false)}
                >
                  Voltar
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="wf-linkbtn mt-4"
              onClick={() => setConfirmCancel(true)}
            >
              Cancelar pedido
            </button>
          )
        ) : null}
      </section>
    </div>
  );
}
