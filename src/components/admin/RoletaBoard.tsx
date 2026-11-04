'use client';
import { useState } from 'react';
import { fmtDateTime } from '@/lib/admin/types';
import { adminFetch } from '@/lib/passkey-client';
import type { RoletaPrize, RoletaPrizeStatus } from '@/lib/roleta';

export type AdminRoletaPrize = {
  id: string;
  prize: RoletaPrize;
  label: string;
  status: RoletaPrizeStatus;
  createdAt: string;
  deliveredAt: string | null;
  winner: string | null;
  twitchLogin: string | null;
  deliveredBy: string | null;
  coupon: { code: string; endsAt: string | null; used: boolean; active: boolean } | null;
};
type Page = {
  prizes: AdminRoletaPrize[];
  next: string | null;
  pending: number;
  today: { spins: number; prizes: number };
  open: boolean;
};
type Toast = { ok: boolean; text: string } | null;

const HOW: Partial<Record<RoletaPrize, string>> = {
  FILME: 'Crie um pedido “Já pago” do filme que a pessoa escolher, depois marque como entregue.',
  DOIS_FILMES: 'Crie dois pedidos “Já pago” (um por filme), depois marque como entregue.',
  VIP_TWITCH: 'Dê VIP no canal (/vip usuário no chat da Twitch), depois marque como entregue.',
};

/**
 * Admin › Roleta (2026-11-04): what viewers won on the wheel — never the "Nada" spins. Movies and
 * VIP are given by hand and marked delivered here; coupons are delivered by the system. The
 * streamer can switch the wheel off and cancel a prize (a coupon's voucher is switched off too).
 */
export function RoletaBoard({ initial, streamer }: { initial: Page; streamer: boolean }) {
  const [page, setPage] = useState(initial);
  const [status, setStatus] = useState<RoletaPrizeStatus>('PENDING');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  async function reload(s = status, before?: string) {
    const q = new URLSearchParams({ status: s, ...(before ? { before } : {}) });
    const r = await adminFetch<Page>(`/api/v1/admin/roleta?${q}`);
    if (r.ok) {
      setPage(before ? { ...r.data, prizes: [...page.prizes, ...r.data.prizes] } : r.data);
    }
  }
  async function act(label: string, path: string, init: Parameters<typeof adminFetch>[1]) {
    setBusy(true);
    setToast(null);
    const r = await adminFetch<unknown>(path, init);
    setBusy(false);
    setToast(r.ok ? { ok: true, text: `${label}: feito.` } : { ok: false, text: r.problem.detail });
    await reload();
  }
  const move = (p: AdminRoletaPrize, to: RoletaPrizeStatus, label: string) =>
    act(label, `/api/v1/admin/roleta/${p.id}`, {
      method: 'PATCH',
      body: { status: to, expectedStatus: p.status },
    });

  return (
    <>
      {toast ? (
        <p role="status" className={toast.ok ? 'wf-toast wf-toast--ok' : 'wf-toast wf-toast--err'}>
          {toast.text}
        </p>
      ) : null}
      <div className="wf-roleta-admin__top">
        <p className="wf-muted">
          Hoje (desde as 17h): <strong>{page.today.spins}</strong>{' '}
          {page.today.spins === 1 ? 'giro' : 'giros'} · <strong>{page.today.prizes}</strong>{' '}
          {page.today.prizes === 1 ? 'prêmio' : 'prêmios'}
        </p>
        {streamer ? (
          <label className="wf-switch">
            <input
              type="checkbox"
              checked={page.open}
              disabled={busy}
              onChange={(e) =>
                void act(
                  e.target.checked ? 'Roleta aberta' : 'Roleta fechada',
                  '/api/v1/admin/roleta/open',
                  { method: 'PUT', body: { open: e.target.checked } },
                )
              }
            />
            Roleta aberta para o público
          </label>
        ) : (
          <p className="wf-muted">Roleta {page.open ? 'aberta' : 'fechada'}.</p>
        )}
      </div>
      <div className="wf-seg" role="group" aria-label="Situação">
        {(
          [
            ['PENDING', `Para entregar${page.pending ? ` (${page.pending})` : ''}`],
            ['DELIVERED', 'Entregues'],
            ['CANCELLED', 'Cancelados'],
          ] as const
        ).map(([v, l]) => (
          <button
            key={v}
            type="button"
            className={status === v ? 'is-on' : ''}
            aria-pressed={status === v}
            onClick={() => {
              setStatus(v);
              void reload(v);
            }}
          >
            {l}
          </button>
        ))}
      </div>
      <ul className="wf-ops-list">
        {page.prizes.map((p) => (
          <li key={p.id} className="wf-ops-card">
            <div className="wf-ops-row__main">
              <span className="wf-ops-row__title">
                {p.label} <span className="wf-pill">@{p.winner ?? 'removido'}</span>
                {p.twitchLogin ? (
                  <span className="wf-pill wf-pill--ok">Twitch: {p.twitchLogin}</span>
                ) : HOW[p.prize] && p.status === 'PENDING' ? (
                  <span className="wf-pill wf-pill--warn">sem usuário da Twitch ainda</span>
                ) : null}
              </span>
              <span className="wf-muted text-xs">
                Ganhou em {fmtDateTime(p.createdAt)}
                {p.deliveredAt && !p.coupon
                  ? ` · entregue por @${p.deliveredBy ?? 'removido'} em ${fmtDateTime(p.deliveredAt)}`
                  : ''}
              </span>
            </div>
            {p.coupon ? (
              <p className="wf-muted text-xs">
                Cupom <code>{p.coupon.code}</code> ·{' '}
                {p.coupon.used ? 'já usado' : p.coupon.active ? 'ainda não usado' : 'desativado'}
                {p.coupon.endsAt ? ` · vale até ${fmtDateTime(p.coupon.endsAt)}` : ''}
              </p>
            ) : p.status === 'PENDING' && HOW[p.prize] ? (
              <p className="wf-muted text-xs">{HOW[p.prize]}</p>
            ) : null}
            <div className="wf-ops-actions">
              {p.status === 'PENDING' ? (
                <button
                  type="button"
                  className="wf-btn wf-btn--sm wf-btn--neon"
                  disabled={busy}
                  onClick={() => void move(p, 'DELIVERED', 'Prêmio entregue')}
                >
                  Marcar como entregue
                </button>
              ) : null}
              {p.status === 'DELIVERED' && !p.coupon ? (
                <button
                  type="button"
                  className="wf-linkbtn text-xs"
                  disabled={busy}
                  onClick={() => void move(p, 'PENDING', 'De volta para entregar')}
                >
                  Desfazer entrega
                </button>
              ) : null}
              {streamer && p.status !== 'CANCELLED' ? (
                <button
                  type="button"
                  className="wf-btn wf-btn--sm wf-btn--ghost"
                  disabled={busy}
                  onClick={() => void move(p, 'CANCELLED', 'Prêmio cancelado')}
                >
                  Cancelar prêmio
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {page.prizes.length ? null : <p className="wf-muted">Nenhum prêmio aqui.</p>}
      {page.next ? (
        <button
          type="button"
          className="wf-btn wf-btn--ghost"
          disabled={busy}
          onClick={() => void reload(status, page.next!)}
        >
          Ver mais
        </button>
      ) : null}
    </>
  );
}
