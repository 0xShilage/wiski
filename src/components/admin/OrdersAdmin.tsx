'use client';

import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { Breakdown } from '@/components/checkout/Breakdown';
import { formatBRL } from '@/lib/catalog/pricing';
import { ORDER_KIND_LABEL, statusOf } from '@/lib/orders/labels';
import { adminFetch } from '@/lib/passkey-client';
import type { AdminFilter, AdminOrderDetail, AdminOrderRow } from '@/server/orders/admin';
import { AdminSidebar } from './AdminSidebar';

type Counts = { atencao: number; moderacao: number };
type List = { orders: AdminOrderRow[]; nextCursor: string | null };

const FILTERS: { id: AdminFilter; label: string }[] = [
  { id: 'atencao', label: 'Atenção' },
  { id: 'moderacao', label: 'Moderação' },
  { id: 'pendentes', label: 'Aguardando Pix' },
  { id: 'pagos', label: 'Pagos' },
  { id: 'encerrados', label: 'Encerrados' },
  { id: 'todos', label: 'Todos' },
];

const ATTENTION_TEXT: Record<string, string> = {
  LATE_APPROVAL:
    'O Pix foi pago depois de expirar. Aceite se o filme/campanha ainda tem espaço; senão, reembolse.',
  AMOUNT_MISMATCH:
    'O valor, a moeda ou o meio de pagamento no Mercado Pago não confere com o pedido. Reembolse.',
  ACCOUNT_MISMATCH:
    'O pagamento não é da conta/aplicação Mercado Pago do Wiski (ou é de teste em produção). Confira no painel do Mercado Pago.',
  CHARGEBACK:
    'O pagador contestou o pagamento (chargeback). Acompanhe a disputa no painel do Mercado Pago.',
  REFUNDED_OUTSIDE:
    'O pagamento foi devolvido pelo painel do Mercado Pago, fora deste painel. Confira o motivo lá.',
};

const REASONS = [
  { id: 'PROCESSING_ERROR', label: 'Erro de processamento' },
  { id: 'DUPLICATE_PAYMENT', label: 'Pagamento em duplicidade' },
  { id: 'LEGAL_REQUIREMENT', label: 'Exigência legal' },
] as const;

const when = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

/** /admin/pedidos: filters + list on the left, the selected order on the right. */
export function OrdersAdmin({
  user,
  initialFilter,
  initialCounts,
  initialList,
  initialDetail,
  catalogNav,
}: {
  user: { username: string; role: 'MODERATOR' | 'STREAMER' | 'USER' };
  initialFilter: AdminFilter;
  initialCounts: Counts;
  initialList: List;
  initialDetail: AdminOrderDetail | null;
  catalogNav: ReactNode;
}) {
  const ids = useId();
  const [filter, setFilter] = useState(initialFilter);
  const [counts, setCounts] = useState(initialCounts);
  const [list, setList] = useState(initialList);
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState(initialDetail);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [refundReason, setRefundReason] =
    useState<(typeof REASONS)[number]['id']>('PROCESSING_ERROR');
  const [confirm, setConfirm] = useState<'accept' | 'refund' | null>(null);
  const refundKey = useRef<string | null>(null);

  const syncUrl = (f: AdminFilter, code: string | null) => {
    const u = new URL(window.location.href);
    u.searchParams.set('filtro', f);
    if (code) u.searchParams.set('pedido', code);
    else u.searchParams.delete('pedido');
    history.replaceState(null, '', u.pathname + u.search);
  };

  const load = useCallback(async (f: AdminFilter, query: string, cursor: string | null = null) => {
    const sp = new URLSearchParams({ filtro: f });
    if (query.trim()) sp.set('q', query.trim());
    if (cursor) sp.set('cursor', cursor);
    const res = await adminFetch<List & { counts: Counts }>(`/api/v1/admin/orders?${sp}`);
    if (!res.ok) {
      setError(res.problem.detail);
      return;
    }
    setCounts(res.data.counts);
    setList((prev) =>
      cursor
        ? { orders: [...prev.orders, ...res.data.orders], nextCursor: res.data.nextCursor }
        : { orders: res.data.orders, nextCursor: res.data.nextCursor },
    );
  }, []);

  async function open(code: string) {
    setError(null);
    setToast(null);
    setConfirm(null);
    refundKey.current = null;
    const res = await adminFetch<{ order: AdminOrderDetail }>(`/api/v1/admin/orders/${code}`);
    if (res.ok) {
      setDetail(res.data.order);
      syncUrl(filter, code);
    } else setError(res.problem.detail);
  }

  async function act(
    label: string,
    path: string,
    body: unknown,
    headers?: Record<string, string>,
    done?: string,
  ) {
    if (!detail) return;
    setBusy(label);
    setError(null);
    setToast(null);
    const res = await adminFetch<{ order: AdminOrderDetail }>(
      `/api/v1/admin/orders/${detail.publicCode}/${path}`,
      { method: 'POST', body, ...(headers ? { headers } : {}) },
    );
    setBusy(null);
    if (res.ok) {
      setDetail(res.data.order);
      setConfirm(null);
      if (done) setToast(done);
      void load(filter, q);
      return true;
    }
    setError(res.problem.detail);
    return false;
  }

  const d = detail;
  const st = d ? statusOf(d.status) : null;

  return (
    <div className="wf-admin">
      <AdminSidebar
        current="pedidos"
        catalogNav={catalogNav}
        attention={counts.atencao + counts.moderacao}
        user={user}
      />

      <section className="wf-admin__board" aria-labelledby="pedidos-title">
        <div className="wf-admin__head">
          <h1 className="wf-h1" id="pedidos-title">
            Pedidos
          </h1>
        </div>
        <div className="wf-tabs" role="group" aria-label="Filtrar pedidos">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className="wf-tab"
              aria-pressed={filter === f.id}
              onClick={() => {
                setFilter(f.id);
                syncUrl(f.id, d?.publicCode ?? null);
                void load(f.id, q);
              }}
            >
              {f.label}
              {f.id === 'atencao' && counts.atencao ? <small>{counts.atencao}</small> : null}
              {f.id === 'moderacao' && counts.moderacao ? <small>{counts.moderacao}</small> : null}
            </button>
          ))}
        </div>
        <form
          className="wf-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            void load(filter, q);
          }}
        >
          <label htmlFor={`${ids}-q`} className="sr-only">
            Buscar por código ou título
          </label>
          <input
            id={`${ids}-q`}
            className="wf-input"
            placeholder="Código (WF-…) ou título"
            maxLength={80}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="submit" className="wf-btn wf-btn--ghost wf-btn--sm">
            Buscar
          </button>
        </form>

        {list.orders.length === 0 ? (
          <p className="wf-muted mt-6">Nenhum pedido aqui.</p>
        ) : (
          <ul className="wf-olist">
            {list.orders.map((o) => {
              const s = statusOf(o.status);
              return (
                <li key={o.publicCode}>
                  <button
                    type="button"
                    className="wf-olist__row"
                    aria-current={d?.publicCode === o.publicCode ? 'true' : undefined}
                    onClick={() => void open(o.publicCode)}
                  >
                    <span className="min-w-0">
                      <span className="wf-olist__title">{o.title}</span>
                      <span className="wf-muted text-xs">
                        {o.publicCode} · {ORDER_KIND_LABEL[o.kind]} · {o.buyer} ·{' '}
                        {when.format(new Date(o.createdAt))}
                      </span>
                    </span>
                    <span className="wf-olist__end">
                      <b>{formatBRL(o.totalCents)}</b>
                      <span className={`wf-tag wf-tag--${s.tone}`}>{s.label}</span>
                      {o.toModerate ? <span className="wf-tag wf-tag--wait">Moderar</span> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {list.nextCursor ? (
          <button
            type="button"
            className="wf-btn wf-btn--ghost wf-btn--sm mt-4"
            onClick={() => void load(filter, q, list.nextCursor)}
          >
            Carregar mais
          </button>
        ) : null}
      </section>

      <section className="wf-admin__editor" aria-label="Pedido selecionado">
        {error ? (
          <p role="alert" className="wf-alert mb-4">
            {error}
          </p>
        ) : null}
        {toast ? (
          <p role="status" className="wf-toast wf-toast--ok">
            {toast}
          </p>
        ) : null}
        {!d || !st ? (
          <p className="wf-muted">Escolha um pedido na lista.</p>
        ) : (
          <div className="wf-odetail">
            <div className="wf-editor__head">
              <div className="min-w-0">
                <p className="wf-kicker">
                  {ORDER_KIND_LABEL[d.kind]} · {d.publicCode}
                </p>
                <h2>{d.title}</h2>
              </div>
              <span className={`wf-tag wf-tag--${st.tone}`}>{st.label}</span>
            </div>

            {d.status === 'NEEDS_ATTENTION' && d.attentionReason ? (
              <div className="wf-notice">
                <b>Precisa de decisão.</b> {ATTENTION_TEXT[d.attentionReason]}
              </div>
            ) : null}

            <Breakdown lines={d.lines} caption="Valor do pedido" />

            <dl className="wf-order__meta">
              <dt>Comprador</dt>
              <dd>{d.buyer}</dd>
              <dt>E-mail</dt>
              <dd>{d.contactEmail}</dd>
              <dt>Feito em</dt>
              <dd>{when.format(new Date(d.createdAt))}</dd>
              {d.paidAt ? (
                <>
                  <dt>Pago em</dt>
                  <dd>{when.format(new Date(d.paidAt))}</dd>
                </>
              ) : null}
              {d.payment ? (
                <>
                  <dt>Pix</dt>
                  <dd>
                    {d.payment.status} · Mercado Pago: {d.payment.providerStatus ?? '—'}
                    {d.payment.statusDetail ? ` (${d.payment.statusDetail})` : ''}
                  </dd>
                </>
              ) : null}
              {d.queueJumpTierId ? (
                <>
                  <dt>Furo de fila</dt>
                  <dd>{d.queueJumpTierId}</dd>
                </>
              ) : null}
            </dl>

            {d.displayName || d.message ? (
              <div className="wf-odetail__box">
                <h3>Textos públicos</h3>
                {(
                  [
                    ['displayName', 'Nome', d.displayName, d.displayNameStatus],
                    ['message', 'Mensagem', d.message, d.messageStatus],
                  ] as const
                ).map(([field, label, text, status]) =>
                  text ? (
                    <div key={field} className="wf-modrow">
                      <p>
                        <span className="wf-muted text-xs">{label}</span>
                        <br />
                        {text}
                      </p>
                      {status === 'PENDING' ? (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="wf-btn wf-btn--ghost wf-btn--sm"
                            disabled={busy !== null}
                            onClick={() =>
                              void act(
                                `mod-${field}`,
                                'moderate',
                                { field, decision: 'APPROVED' },
                                undefined,
                                `${label} aprovado.`,
                              )
                            }
                          >
                            Aprovar
                          </button>
                          <button
                            type="button"
                            className="wf-btn wf-btn--plain wf-btn--sm"
                            disabled={busy !== null}
                            onClick={() =>
                              void act(
                                `mod-${field}`,
                                'moderate',
                                { field, decision: 'REJECTED' },
                                undefined,
                                `${label} recusado.`,
                              )
                            }
                          >
                            Recusar
                          </button>
                        </div>
                      ) : (
                        <span className="wf-tag wf-tag--off">
                          {status === 'APPROVED' ? 'Aprovado' : 'Recusado'}
                        </span>
                      )}
                    </div>
                  ) : null,
                )}
                {!d.showSponsorName ? (
                  <p className="wf-hint">O comprador pediu para aparecer como “Anônimo”.</p>
                ) : null}
              </div>
            ) : null}

            {d.can.accept ? (
              <div className="wf-odetail__box">
                <h3>Aceitar o pagamento atrasado</h3>
                {d.can.acceptHasRoom ? (
                  <>
                    <p className="wf-hint">
                      {d.kind === 'MOVIE'
                        ? 'O filme ainda está disponível: ele passa a Patrocinado.'
                        : 'A campanha ainda tem espaço: o valor entra na barra.'}
                      {d.queueJumpTierId
                        ? ' O furo de fila foi liberado quando o Pix expirou; o filme entra na fila comum.'
                        : ''}{' '}
                      O comprador recebe o comprovante.
                    </p>
                    {confirm === 'accept' ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="wf-btn wf-btn--neon wf-btn--sm"
                          disabled={busy !== null}
                          onClick={() =>
                            void act(
                              'accept',
                              'resolve',
                              { outcome: 'accept' },
                              undefined,
                              'Pagamento aceito.',
                            )
                          }
                        >
                          Confirmar
                        </button>
                        <button
                          type="button"
                          className="wf-btn wf-btn--plain wf-btn--sm"
                          onClick={() => setConfirm(null)}
                        >
                          Voltar
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="wf-btn wf-btn--ghost wf-btn--sm"
                        onClick={() => setConfirm('accept')}
                      >
                        Aceitar pagamento
                      </button>
                    )}
                  </>
                ) : (
                  <p className="wf-hint">
                    {d.kind === 'MOVIE'
                      ? 'O filme já não está disponível. Use o reembolso abaixo.'
                      : 'A campanha não tem mais espaço para este valor. Use o reembolso abaixo.'}
                  </p>
                )}
              </div>
            ) : null}

            {d.can.refund ? (
              <div className="wf-odetail__box">
                <h3>Reembolso (exceção)</h3>
                <p className="wf-hint">
                  Pagamentos não são reembolsáveis; use só para erro de pagamento ou exigência
                  legal. Devolve {formatBRL(d.payment?.amountCents ?? d.totalCents)} pelo Mercado
                  Pago{d.paidAt ? ' e desfaz o patrocínio/a contribuição' : ''}. Pede o login do
                  Google de novo.
                </p>
                <label className="wf-field" htmlFor={`${ids}-reason`}>
                  Motivo
                  <select
                    id={`${ids}-reason`}
                    className="wf-input"
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value as typeof refundReason)}
                  >
                    {REASONS.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
                {confirm === 'refund' ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="wf-btn wf-btn--neon wf-btn--sm"
                      disabled={busy !== null}
                      aria-busy={busy === 'refund' || undefined}
                      onClick={() => {
                        // one key per decision: a double-click or a retry refunds once
                        refundKey.current ??= crypto.randomUUID();
                        void act(
                          'refund',
                          'refund',
                          { reason: refundReason },
                          { 'idempotency-key': refundKey.current },
                          'Reembolso solicitado ao Mercado Pago.',
                        );
                      }}
                    >
                      {busy === 'refund' ? 'Reembolsando…' : 'Confirmar reembolso'}
                    </button>
                    <button
                      type="button"
                      className="wf-btn wf-btn--plain wf-btn--sm"
                      onClick={() => setConfirm(null)}
                    >
                      Voltar
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="wf-btn wf-btn--ghost wf-btn--sm"
                    onClick={() => setConfirm('refund')}
                  >
                    Reembolsar
                  </button>
                )}
              </div>
            ) : null}

            {d.refunds.length ? (
              <div className="wf-odetail__box">
                <h3>Reembolsos</h3>
                <ul className="m-0 list-none p-0 text-sm">
                  {d.refunds.map((r, i) => (
                    <li key={i}>
                      {when.format(new Date(r.createdAt))} · {formatBRL(r.amountCents)} · {r.reason}{' '}
                      · <b>{r.status}</b>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
