'use client';
import Link from 'next/link';
import { useState } from 'react';
import { formatBRL } from '@/lib/catalog/pricing';
import { KIND_PATH } from '@/lib/catalog/kinds';
import { adminFetch } from '@/lib/passkey-client';
import { fmtDateTime, ORDER_STATUS_PT, type AdminOrderView } from '@/lib/admin/types';

type Page = {
  orders: AdminOrderView[];
  next: string | null;
  counts: { attention: number; texts: number; queue: number };
};
type Filter = 'attention' | 'texts' | 'paid' | 'all';

const FILTERS: { id: Filter; label: string; qs: string }[] = [
  { id: 'attention', label: 'Precisam de atenção', qs: 'status=NEEDS_ATTENTION' },
  { id: 'texts', label: 'Textos para aprovar', qs: 'texts=1' },
  { id: 'paid', label: 'Pagos (na fila)', qs: 'status=PAID' },
  { id: 'all', label: 'Todos', qs: '' },
];

const REASON_PT = {
  DUPLICATE_PAYMENT: 'Pagamento em dobro',
  PROCESSING_ERROR: 'Erro de processamento',
  LEGAL_REQUIREMENT: 'Exigência legal',
} as const;

function pill(status: string) {
  const cls =
    status === 'NEEDS_ATTENTION'
      ? 'wf-pill wf-pill--bad'
      : status === 'PAID' || status === 'SCHEDULED' || status === 'COMPLETED'
        ? 'wf-pill wf-pill--ok'
        : 'wf-pill';
  return <span className={cls}>{ORDER_STATUS_PT[status] ?? status}</span>;
}

/**
 * Pedidos (Phase 4): who paid for what, the texts waiting for approval (sponsor message, guest
 * name), and — for the streamer — accepting an order that needs attention or the exception refund.
 */
export function OrdersBoard({ initial, role }: { initial: Page; role: 'MODERATOR' | 'STREAMER' }) {
  const [filter, setFilter] = useState<Filter>(initial.counts.attention ? 'attention' : 'all');
  const [page, setPage] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  async function load(f: Filter, before?: string) {
    const qs = FILTERS.find((x) => x.id === f)!.qs;
    const params = [qs, before ? `before=${encodeURIComponent(before)}` : '']
      .filter(Boolean)
      .join('&');
    const r = await adminFetch<Page>(`/api/v1/admin/orders${params ? `?${params}` : ''}`);
    if (r.ok) setPage(before ? { ...r.data, orders: [...page.orders, ...r.data.orders] } : r.data);
  }

  async function act(label: string, path: string, body: unknown, headers?: Record<string, string>) {
    setBusy(true);
    setToast(null);
    const r = await adminFetch(path, { method: 'POST', body, ...(headers ? { headers } : {}) });
    setBusy(false);
    setToast(r.ok ? { ok: true, text: `${label}: feito.` } : { ok: false, text: r.problem.detail });
    await load(filter);
  }

  function refund(o: AdminOrderView) {
    const reason = window.prompt(
      'Motivo do reembolso: 1 = pagamento em dobro, 2 = erro de processamento, 3 = exigência legal',
      '1',
    );
    const map = {
      '1': 'DUPLICATE_PAYMENT',
      '2': 'PROCESSING_ERROR',
      '3': 'LEGAL_REQUIREMENT',
    } as const;
    const r = reason ? map[reason.trim() as keyof typeof map] : undefined;
    if (!r) return;
    if (
      !window.confirm(
        `Reembolsar ${formatBRL(o.totalCents)} do pedido ${o.code} (${REASON_PT[r]})? Não dá para desfazer.`,
      )
    )
      return;
    void act(
      'Reembolso pedido',
      `/api/v1/admin/orders/${o.id}/refund`,
      { expectedVersion: o.version, reason: r },
      {
        'idempotency-key': crypto.randomUUID(),
      },
    );
  }

  return (
    <>
      {toast ? (
        <p role="status" className={toast.ok ? 'wf-toast wf-toast--ok' : 'wf-toast wf-toast--err'}>
          {toast.text}
        </p>
      ) : null}
      <div className="wf-seg" role="group" aria-label="Filtrar pedidos">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={filter === f.id ? 'is-on' : ''}
            aria-pressed={filter === f.id}
            onClick={() => {
              setFilter(f.id);
              void load(f.id);
            }}
          >
            {f.label}
            {f.id === 'attention' && page.counts.attention ? ` (${page.counts.attention})` : ''}
            {f.id === 'texts' && page.counts.texts ? ` (${page.counts.texts})` : ''}
          </button>
        ))}
      </div>

      {page.orders.length ? (
        <ul className="wf-ops-list">
          {page.orders.map((o) => (
            <li key={o.id} className="wf-ops-card">
              <div className="wf-ops-row__main">
                <span className="wf-ops-row__title">
                  <Link href={`/${KIND_PATH[o.item.kind]}/${o.item.slug}`} target="_blank">
                    {o.item.title}
                  </Link>{' '}
                  · {formatBRL(o.totalCents)}
                </span>
                <span className="wf-muted text-xs">
                  {o.code} · {o.kind === 'MOVIE' ? 'Patrocínio' : 'Contribuição'} · {o.buyer}
                  {o.email ? ` · ${o.email}` : ''} · {fmtDateTime(o.createdAt)}
                  {o.session ? ` · sessão ${fmtDateTime(o.session.startsAt)}` : ''}
                  {o.tier ? ` · ${o.tier === 'topo' ? 'Topo da fila' : 'Prioridade'}` : ''}
                </span>
              </div>
              <div className="wf-ops-actions">
                {pill(o.status)}
                {o.payment ? (
                  <span className="wf-pill">Pix: {o.payment.status.toLowerCase()}</span>
                ) : null}
                {o.payment?.detail?.startsWith('verification_failed') ? (
                  <span className="wf-pill wf-pill--bad">Pagamento não conferiu</span>
                ) : null}
              </div>

              {o.guestDisplayName ? (
                <div className="wf-ops-row">
                  <span>
                    Nome público pedido: <strong>{o.guestDisplayName}</strong> (
                    {o.displayNameStatus === 'PENDING'
                      ? 'aguardando'
                      : o.displayNameStatus === 'APPROVED'
                        ? 'aprovado'
                        : 'recusado'}
                    )
                  </span>
                  {o.displayNameStatus === 'PENDING' ? (
                    <span className="wf-ops-actions">
                      <button
                        type="button"
                        className="wf-btn wf-btn--sm wf-btn--neon"
                        disabled={busy}
                        onClick={() =>
                          void act('Nome aprovado', `/api/v1/admin/orders/${o.id}/texts`, {
                            expectedVersion: o.version,
                            displayName: 'APPROVED',
                          })
                        }
                      >
                        Aprovar nome
                      </button>
                      <button
                        type="button"
                        className="wf-btn wf-btn--sm wf-btn--ghost"
                        disabled={busy}
                        onClick={() =>
                          void act('Nome recusado', `/api/v1/admin/orders/${o.id}/texts`, {
                            expectedVersion: o.version,
                            displayName: 'REJECTED',
                          })
                        }
                      >
                        Recusar
                      </button>
                    </span>
                  ) : null}
                </div>
              ) : null}
              {o.sponsorMessage ? (
                <div className="wf-ops-row">
                  <span>
                    Mensagem: “{o.sponsorMessage}” (
                    {o.messageStatus === 'PENDING'
                      ? 'aguardando'
                      : o.messageStatus === 'APPROVED'
                        ? 'aprovada'
                        : 'recusada'}
                    )
                  </span>
                  {o.messageStatus === 'PENDING' ? (
                    <span className="wf-ops-actions">
                      <button
                        type="button"
                        className="wf-btn wf-btn--sm wf-btn--neon"
                        disabled={busy}
                        onClick={() =>
                          void act('Mensagem aprovada', `/api/v1/admin/orders/${o.id}/texts`, {
                            expectedVersion: o.version,
                            message: 'APPROVED',
                          })
                        }
                      >
                        Aprovar mensagem
                      </button>
                      <button
                        type="button"
                        className="wf-btn wf-btn--sm wf-btn--ghost"
                        disabled={busy}
                        onClick={() =>
                          void act('Mensagem recusada', `/api/v1/admin/orders/${o.id}/texts`, {
                            expectedVersion: o.version,
                            message: 'REJECTED',
                          })
                        }
                      >
                        Recusar
                      </button>
                    </span>
                  ) : null}
                </div>
              ) : null}

              {role === 'STREAMER' ? (
                <div className="wf-ops-actions">
                  {o.status === 'NEEDS_ATTENTION' &&
                  o.payment?.status === 'APPROVED' &&
                  !o.payment.detail?.startsWith('verification_failed') ? (
                    <button
                      type="button"
                      className="wf-btn wf-btn--sm wf-btn--neon"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            'Aceitar este pagamento como venda normal? Só funciona se o filme/campanha ainda tiver espaço.',
                          )
                        ) {
                          void act('Pedido aceito', `/api/v1/admin/orders/${o.id}/accept`, {
                            expectedVersion: o.version,
                          });
                        }
                      }}
                    >
                      Aceitar como venda
                    </button>
                  ) : null}
                  {['PAID', 'SCHEDULED', 'NEEDS_ATTENTION'].includes(o.status) &&
                  o.payment?.status === 'APPROVED' ? (
                    <button
                      type="button"
                      className="wf-btn wf-btn--sm wf-btn--danger"
                      disabled={busy}
                      onClick={() => refund(o)}
                    >
                      Reembolsar (exceção)
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="wf-muted">Nenhum pedido aqui.</p>
      )}
      {page.next ? (
        <button
          type="button"
          className="wf-btn wf-btn--ghost"
          onClick={() => void load(filter, page.next!)}
        >
          Carregar mais
        </button>
      ) : null}
    </>
  );
}
