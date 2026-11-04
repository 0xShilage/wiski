'use client';
import Link from 'next/link';
import { useId, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { adminFetch } from '@/lib/passkey-client';
import { fmtDateTime, type AdminUserView } from '@/lib/admin/types';

type Page = { users: AdminUserView[]; next: string | null };
type Reset = { cleared: number; ips: number; pendingOrders: number; pendingOnIps: number };
type Filter = 'all' | 'staff' | 'vip' | 'suspended';
const ROLE_PT = { USER: 'Pessoa', MODERATOR: 'Moderação', STREAMER: 'Streamer' } as const;

/**
 * Pessoas (Phase 4): find someone by username; suspend (moderators up to 7 days, the streamer
 * longer); the streamer also changes roles, VIP and — since 2026-11-04 — clears the checkout
 * counters of someone who hit the hourly order limit ("Liberar pedidos"). Every action is audited.
 */
export function PeopleBoard({ initial, role }: { initial: Page; role: 'MODERATOR' | 'STREAMER' }) {
  const id = useId();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const options = role === 'STREAMER' ? ['1', '3', '7', '30', '90', 'sempre'] : ['1', '3', '7'];

  async function load(f = filter, query = q, after?: string) {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (f !== 'all') params.set('filter', f);
    if (after) params.set('after', after);
    const r = await adminFetch<Page>(`/api/v1/admin/users${params.size ? `?${params}` : ''}`);
    if (r.ok) setPage(after ? { ...r.data, users: [...page.users, ...r.data.users] } : r.data);
  }

  async function act(label: string, path: string, body?: unknown) {
    setBusy(true);
    setToast(null);
    const r = await adminFetch(path, { method: 'POST', ...(body !== undefined ? { body } : {}) });
    setBusy(false);
    setToast(r.ok ? { ok: true, text: `${label}: feito.` } : { ok: false, text: r.problem.detail });
    await load();
  }

  /** Clear the checkout counters of one account; the unpaid-order caps are only reported. */
  async function unthrottle(u: AdminUserView) {
    setBusy(true);
    setToast(null);
    const r = await adminFetch<{ reset: Reset }>(`/api/v1/admin/users/${u.id}/unthrottle`, {
      method: 'POST',
    });
    setBusy(false);
    if (!r.ok) {
      setToast({ ok: false, text: r.problem.detail });
      return;
    }
    const d = r.data.reset;
    const stuck = [
      d.pendingOrders ? `${d.pendingOrders} pedido(s) desta pessoa aguardando pagamento` : '',
      d.pendingOnIps > d.pendingOrders
        ? `${d.pendingOnIps} aguardando pagamento na mesma conexão`
        : '',
    ].filter(Boolean);
    setToast({
      ok: true,
      text: d.cleared
        ? `Limites liberados: ${d.cleared} contador(es) zerado(s). Já pode pedir de novo.${
            stuck.length ? ` Ainda no caminho: ${stuck.join('; ')} — pague ou cancele.` : ''
          }`
        : `Esta conta não estava no limite — nada a zerar.${
            stuck.length ? ` Mas há ${stuck.join('; ')} — pague ou cancele.` : ''
          }`,
    });
  }

  return (
    <>
      {toast ? (
        <p role="status" className={toast.ok ? 'wf-toast wf-toast--ok' : 'wf-toast wf-toast--err'}>
          {toast.text}
        </p>
      ) : null}
      <form
        className="wf-ops-filters"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <label className="sr-only" htmlFor={`${id}-q`}>
          Nome de usuário
        </label>
        <input
          id={`${id}-q`}
          className="wf-input"
          placeholder="nome de usuário"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={40}
        />
        <label className="sr-only" htmlFor={`${id}-f`}>
          Filtro
        </label>
        <select
          id={`${id}-f`}
          className="wf-ops-select"
          value={filter}
          onChange={(e) => {
            const f = e.target.value as Filter;
            setFilter(f);
            void load(f);
          }}
        >
          <option value="all">Todas as contas</option>
          <option value="staff">Moderação e streamer</option>
          <option value="vip">VIP</option>
          <option value="suspended">Suspensas</option>
        </select>
        <button type="submit" className="wf-btn wf-btn--sm wf-btn--neon">
          Buscar
        </button>
      </form>

      <ul className="wf-ops-list">
        {page.users.map((u) => (
          <li key={u.id} className="wf-ops-row">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar avatarKey={u.avatarKey} size={40} />
              <div className="wf-ops-row__main">
                <span className="wf-ops-row__title">
                  {u.username ? (
                    <Link href={`/u/${u.username}`} target="_blank">
                      @{u.username}
                    </Link>
                  ) : (
                    '(sem nome ainda)'
                  )}
                </span>
                <span className="wf-muted text-xs">
                  {ROLE_PT[u.role]} · desde {fmtDateTime(u.createdAt)} · {u.reviewCount} avaliações
                  · {u.orderCount} pedidos
                  {u.email ? ` · ${u.email}` : ''}
                </span>
              </div>
            </div>
            <div className="wf-ops-actions">
              {role === 'STREAMER' ? (
                <button
                  type="button"
                  className="wf-btn wf-btn--sm wf-btn--ghost"
                  disabled={busy}
                  title="Zera os contadores de pedidos por hora e o bloqueio por cupom errado"
                  onClick={() => void unthrottle(u)}
                >
                  Liberar pedidos
                </button>
              ) : null}
              {u.isVip ? <span className="wf-pill wf-pill--ok">VIP</span> : null}
              {u.status === 'SUSPENDED' ? (
                <span className="wf-pill wf-pill--bad">
                  Suspensa{' '}
                  {u.suspendedUntil
                    ? `até ${fmtDateTime(u.suspendedUntil)}`
                    : 'por tempo indeterminado'}
                </span>
              ) : null}
              {u.role === 'STREAMER' ? null : u.status === 'SUSPENDED' ? (
                <button
                  type="button"
                  className="wf-btn wf-btn--sm wf-btn--ghost"
                  disabled={busy}
                  onClick={() =>
                    void act('Suspensão retirada', `/api/v1/admin/users/${u.id}/unsuspend`)
                  }
                >
                  Reativar
                </button>
              ) : u.role === 'USER' ? (
                <>
                  <label className="sr-only" htmlFor={`${id}-d-${u.id}`}>
                    Dias de suspensão
                  </label>
                  <select
                    id={`${id}-d-${u.id}`}
                    value={days[u.id] ?? '1'}
                    onChange={(e) => setDays({ ...days, [u.id]: e.target.value })}
                  >
                    {options.map((o) => (
                      <option key={o} value={o}>
                        {o === 'sempre' ? 'Sem prazo' : `${o} dia${o === '1' ? '' : 's'}`}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="wf-btn wf-btn--sm wf-btn--danger"
                    disabled={busy}
                    onClick={() => {
                      const d = days[u.id] ?? '1';
                      if (
                        window.confirm(
                          `Suspender @${u.username ?? 'conta'}? A pessoa continua lendo, mas não avalia, curte, denuncia nem patrocina.`,
                        )
                      ) {
                        void act('Conta suspensa', `/api/v1/admin/users/${u.id}/suspend`, {
                          days: d === 'sempre' ? null : Number(d),
                        });
                      }
                    }}
                  >
                    Suspender
                  </button>
                </>
              ) : null}
              {role === 'STREAMER' && u.role !== 'STREAMER' && u.status === 'ACTIVE' ? (
                <>
                  <button
                    type="button"
                    className="wf-btn wf-btn--sm wf-btn--ghost"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        u.isVip ? 'VIP retirado' : 'VIP concedido',
                        `/api/v1/admin/users/${u.id}/vip`,
                        { vip: !u.isVip },
                      )
                    }
                  >
                    {u.isVip ? 'Tirar VIP' : 'Dar VIP'}
                  </button>
                  <button
                    type="button"
                    className="wf-btn wf-btn--sm wf-btn--ghost"
                    disabled={busy}
                    onClick={() => {
                      const to = u.role === 'USER' ? 'MODERATOR' : 'USER';
                      if (
                        window.confirm(
                          to === 'MODERATOR'
                            ? `Tornar @${u.username} moderador(a)? Vai precisar cadastrar uma passkey.`
                            : `Tirar @${u.username} da moderação?`,
                        )
                      ) {
                        void act('Papel alterado', `/api/v1/admin/users/${u.id}/role`, {
                          role: to,
                        });
                      }
                    }}
                  >
                    {u.role === 'USER' ? 'Tornar moderação' : 'Tirar da moderação'}
                  </button>
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {page.users.length ? null : <p className="wf-muted">Ninguém encontrado.</p>}
      {page.next ? (
        <button
          type="button"
          className="wf-btn wf-btn--ghost"
          onClick={() => void load(filter, q, page.next!)}
        >
          Carregar mais
        </button>
      ) : null}
    </>
  );
}
