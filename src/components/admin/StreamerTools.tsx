'use client';
import { useId, useState } from 'react';
import { formatBRL } from '@/lib/catalog/pricing';
import { adminFetch } from '@/lib/passkey-client';
import { fmtDateTime, fromLocalInput, METRIC_PT, toLocalInput, WIDGET_PT } from '@/lib/admin/types';

/** Streamer-only dashboard tools (Phase 4). Small panels; every write goes through adminFetch. */

type Toast = { ok: boolean; text: string } | null;
function useAct() {
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  async function act<T>(label: string, path: string, init: Parameters<typeof adminFetch>[1]) {
    setBusy(true);
    setToast(null);
    const r = await adminFetch<T>(path, init);
    setBusy(false);
    setToast(r.ok ? { ok: true, text: `${label}: feito.` } : { ok: false, text: r.problem.detail });
    return r;
  }
  const view = toast ? (
    <p role="status" className={toast.ok ? 'wf-toast wf-toast--ok' : 'wf-toast wf-toast--err'}>
      {toast.text}
    </p>
  ) : null;
  return { busy, act, view };
}

// ── Overlays ──────────────────────────────────────────────────────────────────

type KeyView = {
  id: string;
  label: string;
  keyPrefix: string;
  widgets: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};
const WIDGETS = ['agora', 'fila', 'meta', 'meta-total', 'patrocinio'] as const;

export function OverlayKeysPanel({ initial, origin }: { initial: KeyView[]; origin: string }) {
  const id = useId();
  const { busy, act, view } = useAct();
  const [keys, setKeys] = useState(initial);
  const [label, setLabel] = useState('OBS');
  const [widgets, setWidgets] = useState<string[]>([...WIDGETS]);
  const [fresh, setFresh] = useState<{ key: string; widgets: string[] } | null>(null);

  async function reload() {
    const r = await adminFetch<{ keys: KeyView[] }>('/api/v1/admin/overlay-keys');
    if (r.ok) setKeys(r.data.keys);
  }

  return (
    <>
      {view}
      <form
        className="wf-ops-card"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await act<{ key: string; overlay: KeyView }>(
            'Chave criada',
            '/api/v1/admin/overlay-keys',
            {
              method: 'POST',
              body: { label, widgets },
            },
          );
          if (r.ok) setFresh({ key: r.data.key, widgets: r.data.overlay.widgets });
          await reload();
        }}
      >
        <h2>Nova chave para o OBS</h2>
        <div className="wf-ops-form">
          <label className="wf-field" htmlFor={`${id}-l`}>
            <span>Nome (ex.: “PC da live”)</span>
            <input
              id={`${id}-l`}
              className="wf-input"
              value={label}
              maxLength={40}
              onChange={(e) => setLabel(e.target.value)}
              required
            />
          </label>
          <fieldset className="full">
            <legend className="text-sm">Widgets que esta chave pode abrir</legend>
            <div className="wf-ops-filters">
              {WIDGETS.map((w) => (
                <label key={w} className="wf-switch">
                  <input
                    type="checkbox"
                    checked={widgets.includes(w)}
                    onChange={(e) =>
                      setWidgets(
                        e.target.checked ? [...widgets, w] : widgets.filter((x) => x !== w),
                      )
                    }
                  />
                  {WIDGET_PT[w]}
                </label>
              ))}
            </div>
          </fieldset>
          <button type="submit" className="wf-btn wf-btn--neon" disabled={busy || !widgets.length}>
            Criar chave
          </button>
        </div>
      </form>

      {fresh ? (
        <section className="wf-ops-card is-live" aria-labelledby={`${id}-new`}>
          <h2 id={`${id}-new`}>Copie agora — a chave não aparece de novo</h2>
          <p className="wf-muted text-sm">
            No OBS, adicione uma “Fonte de navegador” para cada endereço (fundo transparente). A
            chave fica depois do #, então não vai para nenhum log.
          </p>
          {fresh.widgets.map((w) => (
            <div key={w} className="grid gap-1">
              <span className="text-sm font-semibold">
                {WIDGET_PT[w as keyof typeof WIDGET_PT]}
              </span>
              <code className="wf-code">{`${origin}/overlay/${w}#k=${fresh.key}`}</code>
            </div>
          ))}
          <button type="button" className="wf-btn wf-btn--ghost" onClick={() => setFresh(null)}>
            Já copiei
          </button>
        </section>
      ) : null}

      <ul className="wf-ops-list">
        {keys.map((k) => (
          <li key={k.id} className="wf-ops-row">
            <div className="wf-ops-row__main">
              <span className="wf-ops-row__title">
                {k.label} <code>{k.keyPrefix}…</code>
              </span>
              <span className="wf-muted text-xs">
                {k.widgets.map((w) => WIDGET_PT[w as keyof typeof WIDGET_PT] ?? w).join(', ')} ·
                criada {fmtDateTime(k.createdAt)}
                {k.lastUsedAt ? ` · usada ${fmtDateTime(k.lastUsedAt)}` : ' · nunca usada'}
              </span>
            </div>
            {k.revokedAt ? (
              <span className="wf-pill wf-pill--bad">Revogada</span>
            ) : (
              <button
                type="button"
                className="wf-btn wf-btn--sm wf-btn--danger"
                disabled={busy}
                onClick={async () => {
                  if (
                    !window.confirm(
                      `Revogar “${k.label}”? Os overlays com ela param na próxima reconexão.`,
                    )
                  )
                    return;
                  await act('Chave revogada', `/api/v1/admin/overlay-keys/${k.id}`, {
                    method: 'DELETE',
                  });
                  await reload();
                }}
              >
                Revogar
              </button>
            )}
          </li>
        ))}
      </ul>
      {keys.length ? null : <p className="wf-muted">Nenhuma chave ainda.</p>}
    </>
  );
}

// ── Goals ─────────────────────────────────────────────────────────────────────

type GoalView = {
  id: string;
  title: string;
  metric: keyof typeof METRIC_PT;
  target: number;
  current: number;
  percent: number;
  startsAt: string;
  endsAt: string | null;
  active: boolean;
  showOnOverlay: boolean;
  showOnMediaKit: boolean;
};

function goalNumber(metric: GoalView['metric'], n: number) {
  if (metric === 'SPONSORSHIP_REVENUE_CENTS') return formatBRL(n);
  if (metric === 'WATCHED_MINUTES') return `${n} min`;
  return String(n);
}

export function GoalsPanel({ initial }: { initial: GoalView[] }) {
  const id = useId();
  const { busy, act, view } = useAct();
  const [goals, setGoals] = useState(initial);
  const [form, setForm] = useState({
    title: '',
    metric: 'SPONSORSHIP_COUNT' as GoalView['metric'],
    target: '',
    startsAt: toLocalInput(new Date().toISOString()),
    endsAt: '',
  });

  async function reload() {
    const r = await adminFetch<{ goals: GoalView[] }>('/api/v1/admin/goals');
    if (r.ok) setGoals(r.data.goals);
  }
  const targetValue = () =>
    form.metric === 'SPONSORSHIP_REVENUE_CENTS'
      ? Math.round(Number(form.target) * 100)
      : Number(form.target);

  return (
    <>
      {view}
      <form
        className="wf-ops-card"
        onSubmit={async (e) => {
          e.preventDefault();
          await act('Meta criada', '/api/v1/admin/goals', {
            method: 'POST',
            body: {
              title: form.title,
              metric: form.metric,
              target: targetValue(),
              startsAt: fromLocalInput(form.startsAt),
              endsAt: form.endsAt ? fromLocalInput(form.endsAt) : null,
            },
          });
          await reload();
        }}
      >
        <h2>Nova meta</h2>
        <div className="wf-ops-form">
          <label className="wf-field" htmlFor={`${id}-t`}>
            <span>Nome</span>
            <input
              id={`${id}-t`}
              className="wf-input"
              maxLength={60}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
            />
          </label>
          <label className="wf-field" htmlFor={`${id}-m`}>
            <span>O que conta</span>
            <select
              id={`${id}-m`}
              className="wf-ops-select"
              value={form.metric}
              onChange={(e) => setForm({ ...form, metric: e.target.value as GoalView['metric'] })}
            >
              {Object.entries(METRIC_PT).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="wf-field" htmlFor={`${id}-v`}>
            <span>
              {form.metric === 'SPONSORSHIP_REVENUE_CENTS'
                ? 'Alvo (R$)'
                : form.metric === 'WATCHED_MINUTES'
                  ? 'Alvo (minutos)'
                  : 'Alvo (quantidade)'}
            </span>
            <input
              id={`${id}-v`}
              type="number"
              min={1}
              className="wf-input"
              value={form.target}
              onChange={(e) => setForm({ ...form, target: e.target.value })}
              required
            />
          </label>
          <label className="wf-field" htmlFor={`${id}-s`}>
            <span>Começa</span>
            <input
              id={`${id}-s`}
              type="datetime-local"
              className="wf-input"
              value={form.startsAt}
              onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
              required
            />
          </label>
          <label className="wf-field" htmlFor={`${id}-e`}>
            <span>Termina (opcional)</span>
            <input
              id={`${id}-e`}
              type="datetime-local"
              className="wf-input"
              value={form.endsAt}
              onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
            />
          </label>
          <button type="submit" className="wf-btn wf-btn--neon" disabled={busy}>
            Criar meta
          </button>
        </div>
      </form>

      <ul className="wf-ops-list">
        {goals.map((g) => (
          <li key={g.id} className="wf-ops-card">
            <div className="wf-ops-row__main">
              <span className="wf-ops-row__title">{g.title}</span>
              <span className="wf-muted text-xs">
                {METRIC_PT[g.metric]} · {goalNumber(g.metric, g.current)} de{' '}
                {goalNumber(g.metric, g.target)} · {g.percent}% · desde {fmtDateTime(g.startsAt)}
                {g.endsAt ? ` até ${fmtDateTime(g.endsAt)}` : ''}
              </span>
            </div>
            <progress
              className="wf-progress wf-progress--sm"
              max={100}
              value={g.percent}
              aria-label={`${g.percent}%`}
            />
            <div className="wf-ops-actions">
              {(
                [
                  ['active', 'Ativa'],
                  ['showOnOverlay', 'No overlay'],
                  ['showOnMediaKit', 'No media kit'],
                ] as const
              ).map(([k, l]) => (
                <label key={k} className="wf-switch">
                  <input
                    type="checkbox"
                    checked={g[k]}
                    disabled={busy}
                    onChange={async (e) => {
                      await act('Meta atualizada', `/api/v1/admin/goals/${g.id}`, {
                        method: 'PATCH',
                        body: { [k]: e.target.checked },
                      });
                      await reload();
                    }}
                  />
                  {l}
                </label>
              ))}
              <button
                type="button"
                className="wf-linkbtn text-xs"
                disabled={busy}
                onClick={async () => {
                  if (!window.confirm(`Excluir a meta “${g.title}”?`)) return;
                  await act('Meta excluída', `/api/v1/admin/goals/${g.id}`, { method: 'DELETE' });
                  await reload();
                }}
              >
                Excluir
              </button>
            </div>
          </li>
        ))}
      </ul>
      {goals.length ? null : <p className="wf-muted">Nenhuma meta ainda.</p>}
    </>
  );
}

// ── Media kit numbers ─────────────────────────────────────────────────────────

type StatView = {
  platform: string;
  metric: string;
  value: number;
  source: string;
  updatedAt: string;
};
const PLATFORMS = ['TWITCH', 'YOUTUBE', 'KICK', 'TIKTOK', 'INSTAGRAM', 'X'] as const;
const PLATFORM_PT = {
  TWITCH: 'Twitch',
  YOUTUBE: 'YouTube',
  KICK: 'Kick',
  TIKTOK: 'TikTok',
  INSTAGRAM: 'Instagram',
  X: 'X',
} as const;

export function StatsPanel({
  initial,
  metrics,
}: {
  initial: StatView[];
  metrics: Record<string, string>;
}) {
  const id = useId();
  const { busy, act, view } = useAct();
  const [stats, setStats] = useState(initial);
  const [form, setForm] = useState({
    platform: 'TWITCH',
    metric: Object.keys(metrics)[0]!,
    value: '',
  });

  async function save(platform: string, metric: string, value: number | null) {
    const r = await act<{ stats: StatView[] }>(
      value === null ? 'Número removido' : 'Número salvo',
      '/api/v1/admin/stats',
      {
        method: 'PUT',
        body: { platform, metric, value },
      },
    );
    if (r.ok) setStats(r.data.stats);
  }

  return (
    <>
      {view}
      <form
        className="wf-ops-card"
        onSubmit={(e) => {
          e.preventDefault();
          void save(form.platform, form.metric, Number(form.value));
        }}
      >
        <h2>Atualizar um número</h2>
        <div className="wf-ops-form">
          <label className="wf-field" htmlFor={`${id}-p`}>
            <span>Plataforma</span>
            <select
              id={`${id}-p`}
              className="wf-ops-select"
              value={form.platform}
              onChange={(e) => setForm({ ...form, platform: e.target.value })}
            >
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_PT[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="wf-field" htmlFor={`${id}-m`}>
            <span>Número</span>
            <select
              id={`${id}-m`}
              className="wf-ops-select"
              value={form.metric}
              onChange={(e) => setForm({ ...form, metric: e.target.value })}
            >
              {Object.entries(metrics).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="wf-field" htmlFor={`${id}-v`}>
            <span>Valor</span>
            <input
              id={`${id}-v`}
              type="number"
              min={0}
              className="wf-input"
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
              required
            />
          </label>
          <button type="submit" className="wf-btn wf-btn--neon" disabled={busy}>
            Salvar
          </button>
        </div>
      </form>
      <ul className="wf-ops-list">
        {stats.map((s) => (
          <li key={`${s.platform}:${s.metric}`} className="wf-ops-row">
            <div className="wf-ops-row__main">
              <span className="wf-ops-row__title">
                {PLATFORM_PT[s.platform as keyof typeof PLATFORM_PT]} ·{' '}
                {metrics[s.metric] ?? s.metric}: {s.value.toLocaleString('pt-BR')}
              </span>
              <span className="wf-muted text-xs">
                {s.source === 'MANUAL' ? 'digitado' : 'automático'} · {fmtDateTime(s.updatedAt)}
              </span>
            </div>
            <button
              type="button"
              className="wf-linkbtn text-xs"
              disabled={busy}
              onClick={() => void save(s.platform, s.metric, null)}
            >
              Remover
            </button>
          </li>
        ))}
      </ul>
      {stats.length ? null : (
        <p className="wf-muted">Nenhum número ainda: o media kit mostra só as metas.</p>
      )}
    </>
  );
}

// ── Contact inbox ─────────────────────────────────────────────────────────────

type Msg = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  subject: string;
  body: string;
  status: string;
  createdAt: string;
  purgeAfter: string;
};

export function InboxPanel({
  initial,
}: {
  initial: { messages: Msg[]; next: string | null; unread: number };
}) {
  const { busy, act, view } = useAct();
  const [page, setPage] = useState(initial);
  const [status, setStatus] = useState<'' | 'ARCHIVED' | 'SPAM'>('');

  async function reload(s = status) {
    const r = await adminFetch<typeof initial>(`/api/v1/admin/contact${s ? `?status=${s}` : ''}`);
    if (r.ok) setPage(r.data);
  }
  async function mark(m: Msg, to: string) {
    await act('Mensagem atualizada', `/api/v1/admin/contact/${m.id}`, {
      method: 'PATCH',
      body: { status: to },
    });
    await reload();
  }

  return (
    <>
      {view}
      <div className="wf-seg" role="group" aria-label="Pasta">
        {(
          [
            ['', `Caixa de entrada${page.unread ? ` (${page.unread} novas)` : ''}`],
            ['ARCHIVED', 'Arquivadas'],
            ['SPAM', 'Spam'],
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
        {page.messages.map((m) => (
          <li key={m.id} className="wf-ops-card">
            <div className="wf-ops-row__main">
              <span className="wf-ops-row__title">
                {m.subject}{' '}
                {m.status === 'NEW' ? <span className="wf-pill wf-pill--warn">Nova</span> : null}
              </span>
              <span className="wf-muted text-xs">
                {m.name}
                {m.company ? ` · ${m.company}` : ''} · {m.email} · {fmtDateTime(m.createdAt)} ·
                apaga sozinha em {fmtDateTime(m.purgeAfter)}
              </span>
            </div>
            <p className="wf-review__body">{m.body}</p>
            <div className="wf-ops-actions">
              {m.status === 'NEW' ? (
                <button
                  type="button"
                  className="wf-btn wf-btn--sm wf-btn--ghost"
                  disabled={busy}
                  onClick={() => void mark(m, 'READ')}
                >
                  Marcar como lida
                </button>
              ) : null}
              {m.status !== 'ARCHIVED' ? (
                <button
                  type="button"
                  className="wf-btn wf-btn--sm wf-btn--ghost"
                  disabled={busy}
                  onClick={() => void mark(m, 'ARCHIVED')}
                >
                  Arquivar
                </button>
              ) : null}
              {m.status !== 'SPAM' ? (
                <button
                  type="button"
                  className="wf-btn wf-btn--sm wf-btn--ghost"
                  disabled={busy}
                  onClick={() => void mark(m, 'SPAM')}
                >
                  Spam
                </button>
              ) : null}
              <button
                type="button"
                className="wf-linkbtn text-xs"
                disabled={busy}
                onClick={async () => {
                  if (!window.confirm('Excluir esta mensagem de vez?')) return;
                  await act('Mensagem excluída', `/api/v1/admin/contact/${m.id}`, {
                    method: 'DELETE',
                  });
                  await reload();
                }}
              >
                Excluir
              </button>
            </div>
          </li>
        ))}
      </ul>
      {page.messages.length ? null : <p className="wf-muted">Nenhuma mensagem aqui.</p>}
    </>
  );
}

// ── Vouchers ──────────────────────────────────────────────────────────────────

type VoucherView = {
  id: string;
  code: string;
  kind: 'PERCENT' | 'FIXED';
  percentBps: number | null;
  amountCents: number | null;
  endsAt: string | null;
  maxRedemptions: number | null;
  maxPerUser: number;
  redemptionCount: number;
  active: boolean;
  createdAt: string;
};

export function VouchersPanel({ initial }: { initial: VoucherView[] }) {
  const id = useId();
  const { busy, act, view } = useAct();
  const [list, setList] = useState(initial);
  const [form, setForm] = useState({
    code: '',
    kind: 'PERCENT' as 'PERCENT' | 'FIXED',
    value: '',
    max: '',
    perUser: '1',
    endsAt: '',
  });

  async function reload() {
    const r = await adminFetch<{ vouchers: VoucherView[] }>('/api/v1/admin/vouchers');
    if (r.ok) setList(r.data.vouchers);
  }

  return (
    <>
      {view}
      <form
        className="wf-ops-card"
        onSubmit={async (e) => {
          e.preventDefault();
          await act('Cupom criado', '/api/v1/admin/vouchers', {
            method: 'POST',
            body: {
              code: form.code,
              kind: form.kind,
              ...(form.kind === 'PERCENT'
                ? { percentBps: Math.round(Number(form.value) * 100) }
                : { amountCents: Math.round(Number(form.value) * 100) }),
              maxRedemptions: form.max ? Number(form.max) : null,
              maxPerUser: Number(form.perUser),
              endsAt: form.endsAt ? fromLocalInput(form.endsAt) : null,
            },
          });
          await reload();
        }}
      >
        <h2>Novo cupom (só para filmes)</h2>
        <div className="wf-ops-form">
          <label className="wf-field" htmlFor={`${id}-c`}>
            <span>Código (8–32: letras, números, -)</span>
            <input
              id={`${id}-c`}
              className="wf-input"
              value={form.code}
              minLength={8}
              maxLength={32}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              required
            />
          </label>
          <label className="wf-field" htmlFor={`${id}-k`}>
            <span>Tipo</span>
            <select
              id={`${id}-k`}
              className="wf-ops-select"
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as 'PERCENT' | 'FIXED' })}
            >
              <option value="PERCENT">Porcentagem</option>
              <option value="FIXED">Valor fixo (R$)</option>
            </select>
          </label>
          <label className="wf-field" htmlFor={`${id}-v`}>
            <span>{form.kind === 'PERCENT' ? 'Desconto (%)' : 'Desconto (R$)'}</span>
            <input
              id={`${id}-v`}
              type="number"
              min={0.01}
              step={0.01}
              className="wf-input"
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
              required
            />
          </label>
          <label className="wf-field" htmlFor={`${id}-m`}>
            <span>Usos no total (vazio = sem limite)</span>
            <input
              id={`${id}-m`}
              type="number"
              min={1}
              className="wf-input"
              value={form.max}
              onChange={(e) => setForm({ ...form, max: e.target.value })}
            />
          </label>
          <label className="wf-field" htmlFor={`${id}-u`}>
            <span>Usos por pessoa</span>
            <input
              id={`${id}-u`}
              type="number"
              min={1}
              max={100}
              className="wf-input"
              value={form.perUser}
              onChange={(e) => setForm({ ...form, perUser: e.target.value })}
              required
            />
          </label>
          <label className="wf-field" htmlFor={`${id}-e`}>
            <span>Vale até (opcional)</span>
            <input
              id={`${id}-e`}
              type="datetime-local"
              className="wf-input"
              value={form.endsAt}
              onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
            />
          </label>
          <button type="submit" className="wf-btn wf-btn--neon" disabled={busy}>
            Criar cupom
          </button>
        </div>
      </form>
      <ul className="wf-ops-list">
        {list.map((v) => (
          <li key={v.id} className="wf-ops-row">
            <div className="wf-ops-row__main">
              <span className="wf-ops-row__title">
                <code>{v.code}</code> ·{' '}
                {v.kind === 'PERCENT'
                  ? `${(v.percentBps ?? 0) / 100}%`
                  : formatBRL(v.amountCents ?? 0)}
              </span>
              <span className="wf-muted text-xs">
                {v.redemptionCount} uso{v.redemptionCount === 1 ? '' : 's'}
                {v.maxRedemptions ? ` de ${v.maxRedemptions}` : ''} · {v.maxPerUser} por pessoa
                {v.endsAt ? ` · até ${fmtDateTime(v.endsAt)}` : ''}
              </span>
            </div>
            <label className="wf-switch">
              <input
                type="checkbox"
                checked={v.active}
                disabled={busy}
                onChange={async (e) => {
                  await act(
                    e.target.checked ? 'Cupom ativado' : 'Cupom desativado',
                    `/api/v1/admin/vouchers/${v.id}`,
                    {
                      method: 'PATCH',
                      body: { active: e.target.checked },
                    },
                  );
                  await reload();
                }}
              />
              Ativo
            </label>
          </li>
        ))}
      </ul>
      {list.length ? null : <p className="wf-muted">Nenhum cupom ainda.</p>}
    </>
  );
}

// ── Audit log ─────────────────────────────────────────────────────────────────

type AuditRow = {
  id: string;
  at: string;
  actor: string;
  actorRole: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: unknown;
};

export function AuditPanel({ initial }: { initial: { entries: AuditRow[]; next: string | null } }) {
  const id = useId();
  const [page, setPage] = useState(initial);
  const [action, setAction] = useState('');

  async function load(before?: string) {
    const params = new URLSearchParams();
    if (action) params.set('action', action);
    if (before) params.set('before', before);
    const r = await adminFetch<typeof initial>(
      `/api/v1/admin/audit${params.size ? `?${params}` : ''}`,
    );
    if (r.ok)
      setPage(before ? { ...r.data, entries: [...page.entries, ...r.data.entries] } : r.data);
  }

  return (
    <>
      <form
        className="wf-ops-filters"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <label className="sr-only" htmlFor={`${id}-a`}>
          Ação começa com
        </label>
        <input
          id={`${id}-a`}
          className="wf-input"
          placeholder="ação (ex.: refund, user., schedule)"
          value={action}
          onChange={(e) => setAction(e.target.value.toLowerCase())}
          maxLength={40}
        />
        <button type="submit" className="wf-btn wf-btn--sm wf-btn--neon">
          Filtrar
        </button>
        <a
          className="wf-btn wf-btn--sm wf-btn--ghost"
          href={`/api/v1/admin/audit/export${action ? `?action=${encodeURIComponent(action)}` : ''}`}
        >
          Baixar CSV
        </a>
      </form>
      {/* scrolls sideways on narrow screens: focusable so keyboard users can scroll it too */}
      <div className="wf-table-wrap" tabIndex={0} role="region" aria-label="Histórico de auditoria">
        <table className="wf-table">
          <caption className="sr-only">Histórico de auditoria</caption>
          <thead>
            <tr>
              <th scope="col">Quando</th>
              <th scope="col">Quem</th>
              <th scope="col">Ação</th>
              <th scope="col">Alvo</th>
              <th scope="col">Detalhes</th>
            </tr>
          </thead>
          <tbody>
            {page.entries.map((e) => (
              <tr key={e.id}>
                <td>{fmtDateTime(e.at)}</td>
                <td>{e.actor}</td>
                <td>
                  <code>{e.action}</code>
                </td>
                <td>
                  {e.targetType}
                  {e.targetId ? <code> {e.targetId.slice(0, 8)}</code> : null}
                </td>
                <td>
                  <code>{JSON.stringify(e.metadata)}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {page.next ? (
        <button
          type="button"
          className="wf-btn wf-btn--ghost"
          onClick={() => void load(page.next!)}
        >
          Carregar mais
        </button>
      ) : null}
    </>
  );
}

// ── Settings ──────────────────────────────────────────────────────────────────

export function SettingsPanel({ initial }: { initial: { ordersOpen: boolean } }) {
  const { busy, act, view } = useAct();
  const [s, setS] = useState(initial);
  return (
    <>
      {view}
      <section className="wf-ops-card">
        <h2>Pagamentos</h2>
        <label className="wf-switch">
          <input
            type="checkbox"
            checked={s.ordersOpen}
            disabled={busy}
            onChange={async (e) => {
              const r = await act<{ settings: { ordersOpen: boolean } }>(
                e.target.checked ? 'Patrocínios abertos' : 'Patrocínios pausados',
                '/api/v1/admin/settings',
                { method: 'PUT', body: { ordersOpen: e.target.checked } },
              );
              if (r.ok) setS(r.data.settings);
            }}
          />
          Patrocínios e contribuições abertos
        </label>
        <p className="wf-muted text-sm">
          Desligado, o site mostra “Os patrocínios estão pausados no momento” e não cria novos Pix.
          Pedidos já pagos não mudam.
        </p>
      </section>
    </>
  );
}
