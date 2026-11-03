'use client';
import Link from 'next/link';
import { Img } from '@/components/Img';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, type Problem } from '@/lib/api-fetch';
import { KIND_PATH } from '@/lib/catalog/kinds';
import { formatBRL } from '@/lib/catalog/pricing';
import { ORDER_STATUS_LABEL, type OrderView as View } from '@/lib/checkout/types';

const TOKEN = /^#t=([\w-]{43})$/;

/** Seconds left until `until` (null when there is no deadline); `onZero` fires once at 0. */
function useCountdown(until: string | null, onZero: () => void): number | null {
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);
  const zero = useRef(onZero);
  useEffect(() => {
    zero.current = onZero;
  }, [onZero]);
  useEffect(() => {
    if (!until) return;
    fired.current = false;
    const end = Date.parse(until);
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= end && !fired.current) {
        fired.current = true;
        zero.current();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.floor((Date.parse(until) - now) / 1000)) : null;
}

const sessionFmt = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: '2-digit',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

/** "Trocar data" (04 §7): owner only, up to 24 h before, at most twice. */
function Reschedule({ code, left, onDone }: { code: string; left: number; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<
    { id: string; startsAt: string; publicNote: string | null }[] | null
  >(null);
  const [pick, setPick] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (left <= 0) return <p className="wf-co__muted mt-2 text-sm">Você já trocou a data 2 vezes.</p>;
  return (
    <div className="mt-3 grid gap-2">
      {!open ? (
        <button
          type="button"
          className="wf-btn wf-btn--ghost wf-btn--sm justify-self-start"
          onClick={async () => {
            setOpen(true);
            const r = await apiFetch<{
              sessions: { id: string; startsAt: string; publicNote: string | null }[];
            }>(`/api/v1/orders/${code}/reschedule`);
            setOptions(r.ok ? r.data.sessions : []);
          }}
        >
          Trocar a data ({left} {left === 1 ? 'troca restante' : 'trocas restantes'})
        </button>
      ) : options === null ? (
        <p className="wf-co__muted text-sm">Carregando sessões…</p>
      ) : options.length ? (
        <form
          className="wf-co__row flex-wrap"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await apiFetch(`/api/v1/orders/${code}/reschedule`, {
              method: 'POST',
              body: { sessionId: pick },
            });
            setMsg(
              r.ok ? { ok: true, text: 'Data trocada!' } : { ok: false, text: r.problem.detail },
            );
            if (r.ok) onDone();
          }}
        >
          <label className="sr-only" htmlFor="wf-resched">
            Nova sessão
          </label>
          <select
            id="wf-resched"
            className="wf-input"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            required
          >
            <option value="">Escolha uma sessão…</option>
            {options.map((s) => (
              <option key={s.id} value={s.id}>
                {sessionFmt.format(new Date(s.startsAt))}
                {s.publicNote ? ` — ${s.publicNote}` : ''}
              </option>
            ))}
          </select>
          <button type="submit" className="wf-btn wf-btn--neon wf-btn--sm" disabled={!pick}>
            Confirmar
          </button>
        </form>
      ) : (
        <p className="wf-co__muted text-sm">
          Nenhuma outra sessão com espaço nos próximos 60 dias.
        </p>
      )}
      {msg ? (
        <p className={msg.ok ? 'wf-hint wf-hint--ok' : 'wf-hint wf-hint--err'} role="status">
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * The order page (03 §4 "/patrocinar/pedido/[code]", generalised to /pedido/[code] in 11 §8):
 * exchanges the order-link token from the URL fragment (never sent to a server, never logged),
 * shows the Pix QR + copia-e-cola with a countdown while unpaid, follows the status over SSE
 * (polling every 4 s as fallback), and offers cancel / "vincular à minha conta".
 */
export function OrderView({ code, signedIn }: { code: string; signedIn: boolean }) {
  const [view, setView] = useState<View | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState<'pix' | 'link' | null>(null);
  const [busy, setBusy] = useState(false);
  const status = useRef<string | null>(null);

  const load = useCallback(async () => {
    const r = await apiFetch<View>(`/api/v1/orders/${code}`);
    if (r.ok) {
      setView(r.data);
      setProblem(null);
      status.current = r.data.order.status;
    } else setProblem(r.problem);
  }, [code]);

  // 1. order-link token (fragment) → cookie, then load
  useEffect(() => {
    const m = TOKEN.exec(window.location.hash);
    void (async () => {
      if (m) {
        setLink(`${window.location.origin}/pedido/${code}#t=${m[1]}`);
        await apiFetch(`/api/v1/orders/${code}/access`, { method: 'POST', body: { token: m[1] } });
      }
      await load();
    })();
  }, [code, load]);

  // 2. live status (SSE, polling fallback while unpaid)
  const pending = view?.order.status === 'PENDING_PAYMENT';
  useEffect(() => {
    if (!pending) return;
    let poll: ReturnType<typeof setInterval> | undefined;
    const es = new EventSource(`/api/v1/orders/${code}/events`);
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data as string) as { status?: string };
        if (ev.status && ev.status !== status.current) void load();
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED && !poll)
        poll = setInterval(() => void load(), 4000);
    };
    return () => {
      es.close();
      if (poll) clearInterval(poll);
    };
  }, [pending, code, load]);

  const left = useCountdown(pending ? (view?.order.expiresAt ?? null) : null, () => void load());

  async function copy(text: string, what: 'pix' | 'link') {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2500);
    } catch {
      /* the text stays selectable */
    }
  }

  async function cancel() {
    if (!view || busy) return;
    setBusy(true);
    const r = await apiFetch(`/api/v1/orders/${code}/cancel`, {
      method: 'POST',
      ...(view.orderCsrf ? { headers: { 'x-csrf-token': view.orderCsrf } } : {}),
    });
    await load();
    setBusy(false);
    if (!r.ok) setProblem(r.problem); // after load(), which clears old messages
  }

  async function claim() {
    setBusy(true);
    const r = await apiFetch(`/api/v1/orders/${code}/claim`, { method: 'POST' });
    await load();
    setBusy(false);
    if (!r.ok) setProblem(r.problem); // after load(), which clears old messages
  }

  if (!view) {
    return (
      <div className="wf-panel wf-order">
        {problem ? (
          <>
            <h1 className="wf-h2">Pedido não encontrado</h1>
            <p className="wf-co__muted">
              Abra o link do pedido no mesmo navegador em que você pagou, ou entre na sua conta.
            </p>
            <Link href="/" className="wf-btn wf-btn--ghost">
              Voltar aos filmes
            </Link>
          </>
        ) : (
          <p className="wf-co__muted">Carregando pedido…</p>
        )}
      </div>
    );
  }

  const o = view.order;
  const itemHref = `/${KIND_PATH[o.item.kind]}/${o.item.slug}`;
  const what = o.kind === 'MOVIE' ? 'Patrocínio' : 'Contribuição';

  return (
    <div className="wf-order-grid">
      <section className="wf-panel wf-order" aria-labelledby="pedido-titulo">
        <p className="wf-kicker">
          {what} · {o.code}
        </p>
        <h1 id="pedido-titulo" className="wf-h2 mt-2">
          <Link href={itemHref}>{o.item.title}</Link>
        </h1>
        <p
          className={`wf-status mt-3 ${o.status === 'PAID' || o.status === 'COMPLETED' ? 'wf-status--ok' : o.status === 'PENDING_PAYMENT' ? '' : 'wf-status--warn'}`}
          role="status"
        >
          {ORDER_STATUS_LABEL[o.status]}
        </p>

        {o.status === 'PENDING_PAYMENT' && o.pix ? (
          <div className="wf-pix">
            {/* validated PNG from our API (05 §5 "QR swap"); never from the URL */}
            <Img
              src={`data:image/png;base64,${o.pix.qrCodeBase64}`}
              alt="QR Code do Pix"
              width={240}
              height={240}
              unoptimized
              className="wf-pix__qr"
            />
            <div className="wf-pix__side">
              <p>
                Pague <b>{formatBRL(o.totalCents)}</b> com Pix
                {left !== null ? (
                  <>
                    {' '}
                    em até <b aria-live="off">{mmss(left)}</b>
                  </>
                ) : null}
                .
              </p>
              <ol className="wf-pix__steps">
                <li>Abra o app do seu banco e escolha Pix → Ler QR Code (ou Pix Copia e Cola).</li>
                <li>Confira o valor e o nome do recebedor antes de confirmar.</li>
                <li>Esta página atualiza sozinha quando o pagamento for aprovado.</li>
              </ol>
              <label className="wf-field">
                <span>Pix Copia e Cola</span>
                <textarea
                  className="wf-input wf-pix__code"
                  readOnly
                  rows={3}
                  value={o.pix.qrCode}
                  onFocus={(e) => e.currentTarget.select()}
                />
              </label>
              <button
                type="button"
                className="wf-btn wf-btn--neon"
                onClick={() => void copy(o.pix!.qrCode, 'pix')}
              >
                {copied === 'pix' ? 'Copiado ✓' : 'Copiar código Pix'}
              </button>
            </div>
          </div>
        ) : null}

        {o.status === 'PENDING_PAYMENT' && !o.pix ? (
          <p className="wf-co__muted mt-4">O Pix deste pedido expirou ou está sendo atualizado…</p>
        ) : null}
        {o.status === 'PAID' ? (
          <p className="mt-4">
            {o.kind === 'MOVIE'
              ? 'Pagamento aprovado! O filme entra numa das próximas sessões da live.'
              : 'Pagamento aprovado! Sua contribuição já conta na barra da campanha.'}
          </p>
        ) : null}
        {o.status === 'EXPIRED' || o.status === 'CANCELLED' ? (
          <p className="mt-4">
            Nada foi cobrado.{' '}
            <Link href={itemHref} className="underline">
              Tentar de novo
            </Link>
          </p>
        ) : null}
        {o.session && (o.status === 'SCHEDULED' || o.status === 'WATCHING') ? (
          <p className="mt-4">
            {o.status === 'WATCHING'
              ? 'Passando agora na live!'
              : `Agendado para a live de ${sessionFmt.format(new Date(o.session.startsAt))}.`}
          </p>
        ) : null}
        {view.canReschedule ? (
          <Reschedule code={o.code} left={o.rescheduleLeft} onDone={() => void load()} />
        ) : null}
        {o.status === 'NEEDS_ATTENTION' ? (
          <p className="mt-4">
            Recebemos um retorno do pagamento que precisa ser conferido. O streamer vai analisar
            este pedido.
          </p>
        ) : null}

        {problem ? (
          <p className="wf-co__error mt-4" role="alert">
            {problem.detail}
          </p>
        ) : null}

        <div className="wf-order__actions">
          {view.canCancel ? (
            <button
              type="button"
              className="wf-btn wf-btn--ghost wf-btn--sm"
              disabled={busy}
              onClick={() => void cancel()}
            >
              Cancelar pedido
            </button>
          ) : null}
          {view.canClaim ? (
            <button
              type="button"
              className="wf-btn wf-btn--ghost wf-btn--sm"
              disabled={busy}
              onClick={() => void claim()}
            >
              Vincular à minha conta
            </button>
          ) : null}
          {!signedIn && o.guest ? (
            <a
              className="wf-btn wf-btn--ghost wf-btn--sm"
              href={`/perfil?returnTo=${encodeURIComponent(`/pedido/${o.code}`)}`}
            >
              Entrar para vincular
            </a>
          ) : null}
        </div>
      </section>

      <aside className="wf-panel" aria-labelledby="resumo">
        <h2 id="resumo">Resumo</h2>
        <dl className="wf-bd">
          {o.breakdown
            .filter((l) => l.cents !== null || l.key === 'runtime')
            .map((l) => (
              <div
                key={l.key}
                className={`wf-bd__row ${l.key === 'total' ? 'is-total' : ''} ${l.cents === null ? 'is-info' : ''}`}
              >
                <dt>{l.label}</dt>
                <dd>
                  {l.cents === null
                    ? ''
                    : l.cents < 0
                      ? `− ${formatBRL(-l.cents)}`
                      : formatBRL(l.cents)}
                </dd>
              </div>
            ))}
        </dl>
        <p className="wf-co__muted mt-4 text-sm">
          E-mail: {o.contactEmail}
          {o.anonymous
            ? ' · anônimo'
            : o.displayName
              ? ` · nome: ${o.displayName}${o.displayNameStatus === 'PENDING' ? ' (aguardando moderação)' : ''}`
              : ''}
        </p>
        {o.message ? (
          <p className="wf-co__muted mt-2 text-sm">
            Mensagem: “{o.message}”
            {o.messageStatus === 'PENDING'
              ? ' (aguardando moderação)'
              : o.messageStatus === 'REJECTED'
                ? ' (ocultada pela moderação)'
                : ''}
          </p>
        ) : null}
        {link ? (
          <div className="wf-order__link">
            <p className="text-sm">
              <b>Guarde o link deste pedido</b> — é com ele que você acompanha o pedido em outro
              navegador. Não compartilhe.
            </p>
            <button
              type="button"
              className="wf-btn wf-btn--ghost wf-btn--sm"
              onClick={() => void copy(link, 'link')}
            >
              {copied === 'link' ? 'Link copiado ✓' : 'Copiar link do pedido'}
            </button>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
