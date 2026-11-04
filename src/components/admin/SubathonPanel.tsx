'use client';
import { useCallback, useEffect, useId, useState } from 'react';
import { formatBRL } from '@/lib/catalog/pricing';
import { fmtDateTime } from '@/lib/admin/types';
import { adminFetch } from '@/lib/passkey-client';
import {
  DEFAULT_SECONDS_PER_REAL,
  DEFAULT_SUBATHON_RATES,
  formatClock,
  formatDelta,
  secondsFor,
  type SubathonRates,
} from '@/lib/subathon-time';
import type { SubathonAdminView } from '@/server/subathon/admin';

/**
 * Admin › Subathon (2026-11-03): create the timer (starting time, R$ rule, values of bits and
 * subs), start / pause / resume / end it, add or remove time by hand, and watch every
 * contribution arrive (site payments, StreamElements tips, bits, subs and gift subs).
 */
type View = SubathonAdminView;
type Sub = NonNullable<View['subathon']>;
type Toast = { ok: boolean; text: string } | null;

const KIND_PT: Record<string, string> = {
  ORDER: 'Site',
  REFUND: 'Estorno',
  TIP: 'Doação',
  BITS: 'Bits',
  SUB: 'Sub',
  RESUB: 'Resub',
  PRIME: 'Prime',
  GIFT: 'Sub de presente',
  MANUAL: 'Manual',
};
const STATUS_PT: Record<Sub['status'], string> = {
  READY: 'Pronto para começar',
  RUNNING: 'Rodando',
  PAUSED: 'Pausado',
  ENDED: 'Encerrado',
};
const COUNT_PT: Record<keyof SubathonRates['count'], string> = {
  site: 'Pagamentos do site (filmes, contribuições, “Já pago”)',
  tips: 'Doações do StreamElements',
  bits: 'Bits',
  subs: 'Subs novos',
  resubs: 'Resubs',
  prime: 'Subs Prime',
  gifts: 'Subs de presente',
};

const reais = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');
const toCents = (s: string): number | null => {
  const t = s.trim().replace(/\./g, '').replace(',', '.');
  if (!/^\d{1,5}(?:\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
};
const int = (s: string): number | null => (/^\d{1,6}$/.test(s.trim()) ? Number(s.trim()) : null);

type Form = {
  title: string;
  hours: string;
  minutes: string;
  secondsPerReal: string;
  capHours: string;
  bits100: string;
  tier1: string;
  tier2: string;
  tier3: string;
  prime: string;
  usd: string;
  eur: string;
  count: SubathonRates['count'];
};

function formFrom(s: Sub | null): Form {
  const r = s?.rates ?? DEFAULT_SUBATHON_RATES;
  const init = s?.initialSeconds ?? 4 * 3600;
  return {
    title: s?.title ?? 'Subathon',
    hours: String(Math.floor(init / 3600)),
    minutes: String(Math.floor((init % 3600) / 60)),
    secondsPerReal: String(s?.secondsPerReal ?? DEFAULT_SECONDS_PER_REAL),
    capHours: s?.capSeconds ? String(Math.round(s.capSeconds / 3600)) : '',
    bits100: reais(r.bits100Cents),
    tier1: reais(r.tier1Cents),
    tier2: reais(r.tier2Cents),
    tier3: reais(r.tier3Cents),
    prime: reais(r.primeCents),
    usd: reais(r.usdCents),
    eur: reais(r.eurCents),
    count: { ...r.count },
  };
}

export function SubathonPanel({ initial, origin }: { initial: View; origin: string }) {
  const id = useId();
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [form, setForm] = useState<Form>(() =>
    formFrom(initial.subathon?.status === 'ENDED' ? null : initial.subathon),
  );
  const [editing, setEditing] = useState(false);
  const [adjust, setAdjust] = useState('5');
  /** the chat commands' key, only right after it was created (it is never shown again) */
  const [newKey, setNewKey] = useState<string | null>(null);
  /** this browser's clock (0 until the first tick) and the server's offset from it, in ms */
  const [clock, setClock] = useState({ now: 0, offset: 0 });
  const synced = (serverNow: string) =>
    setClock((c) => ({ ...c, offset: Date.parse(serverNow) - Date.now() }));

  const s = view.subathon;
  const open = s && s.status !== 'ENDED' ? s : null;

  const reload = useCallback(async () => {
    const r = await adminFetch<View>('/api/v1/admin/subathon');
    if (r.ok) {
      setClock((c) => ({ ...c, offset: Date.parse(r.data.serverNow) - Date.now() }));
      setView(r.data);
    }
  }, []);
  useEffect(() => {
    const t = setInterval(() => void reload(), 5_000);
    const c = setInterval(() => setClock((x) => ({ ...x, now: Date.now() })), 500);
    return () => {
      clearInterval(t);
      clearInterval(c);
    };
  }, [reload]);

  async function act(label: string, path: string, init: Parameters<typeof adminFetch>[1]) {
    setBusy(true);
    setToast(null);
    const r = await adminFetch<View>(path, init);
    setBusy(false);
    if (r.ok) {
      synced(r.data.serverNow);
      setView(r.data);
      setToast({ ok: true, text: label });
    } else {
      setToast({ ok: false, text: r.problem.detail });
      if (r.problem.code === 'SUBATHON_CHANGED') await reload();
    }
    return r.ok;
  }

  // until the first tick, the time left the server computed for this page
  const left =
    s?.status === 'RUNNING' && s.endsAt && clock.now
      ? Math.max(0, Math.ceil((Date.parse(s.endsAt) - (clock.now + clock.offset)) / 1000))
      : (s?.remainingSeconds ?? 0);

  function settingsBody():
    { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
    const spr = int(form.secondsPerReal);
    if (!spr || spr < 1 || spr > 3600)
      return { ok: false, error: 'Segundos por R$ 1: de 1 a 3600.' };
    const cap = form.capHours.trim() ? int(form.capHours) : null;
    if (form.capHours.trim() && (!cap || cap < 1 || cap > 2160))
      return { ok: false, error: 'Teto: de 1 a 2160 horas, ou vazio.' };
    const cents = [form.bits100, form.tier1, form.tier2, form.tier3, form.prime].map(toCents);
    if (cents.some((c) => c === null || c > 1_000_000))
      return { ok: false, error: 'Valores em R$, ex.: 5 ou 7,90 (até R$ 10.000).' };
    const [bits100Cents, tier1Cents, tier2Cents, tier3Cents, primeCents] = cents as number[];
    const fx = [form.usd, form.eur].map(toCents);
    if (fx.some((c) => c === null || c > 10_000))
      return { ok: false, error: 'Câmbio: quanto vale US$ 1 e € 1 em R$ (ex.: 5,50), até R$ 100.' };
    const [usdCents, eurCents] = fx as number[];
    if (!form.title.trim()) return { ok: false, error: 'Dê um nome ao subathon.' };
    return {
      ok: true,
      body: {
        title: form.title.trim(),
        secondsPerReal: spr,
        capSeconds: cap ? cap * 3600 : null,
        rates: {
          bits100Cents: bits100Cents!,
          tier1Cents: tier1Cents!,
          tier2Cents: tier2Cents!,
          tier3Cents: tier3Cents!,
          primeCents: primeCents!,
          usdCents: usdCents!,
          eurCents: eurCents!,
          count: form.count,
        },
      },
    };
  }

  async function create() {
    const b = settingsBody();
    if (!b.ok) return setToast({ ok: false, text: b.error });
    const h = int(form.hours) ?? 0;
    const m = int(form.minutes) ?? 0;
    const initialSeconds = h * 3600 + m * 60;
    if (initialSeconds > 90 * 86_400)
      return setToast({ ok: false, text: 'Tempo inicial: até 90 dias.' });
    await act('Subathon criado. Inicie o timer quando a live começar.', '/api/v1/admin/subathon', {
      method: 'POST',
      body: { ...b.body, initialSeconds },
    });
  }

  async function save() {
    if (!open) return;
    const b = settingsBody();
    if (!b.ok) return setToast({ ok: false, text: b.error });
    if (
      await act(
        'Configurações salvas (valem para o que chegar a partir de agora).',
        `/api/v1/admin/subathon/${open.id}`,
        {
          method: 'PATCH',
          body: { expectedVersion: open.version, ...b.body },
        },
      )
    )
      setEditing(false);
  }

  async function status(action: 'start' | 'pause' | 'resume' | 'end') {
    if (!open) return;
    if (
      action === 'end' &&
      !window.confirm('Encerrar o subathon agora? O timer para e não recebe mais tempo.')
    )
      return;
    const label = {
      start: 'Timer iniciado.',
      pause: 'Timer pausado.',
      resume: 'Timer retomado.',
      end: 'Subathon encerrado.',
    }[action];
    await act(label, `/api/v1/admin/subathon/${open.id}/action`, {
      method: 'POST',
      body: { action, expectedVersion: open.version },
    });
  }

  async function addTime(sign: 1 | -1, minutes?: number) {
    if (!open) return;
    const m = minutes ?? int(adjust);
    if (!m || m > 129_600) return setToast({ ok: false, text: 'Informe os minutos (ex.: 5).' });
    await act(
      sign > 0 ? `${m} min adicionados.` : `${m} min removidos.`,
      `/api/v1/admin/subathon/${open.id}/adjust`,
      { method: 'POST', body: { seconds: sign * m * 60, idempotencyKey: crypto.randomUUID() } },
    );
  }

  async function commandKey(method: 'POST' | 'DELETE') {
    if (
      method === 'POST' &&
      view.commandKey &&
      !window.confirm('Trocar a chave? Os comandos atuais no StreamElements param de funcionar.')
    )
      return;
    if (method === 'DELETE' && !window.confirm('Desligar os comandos do chat?')) return;
    setBusy(true);
    setToast(null);
    const r = await adminFetch<{ key?: string }>('/api/v1/admin/subathon/command-key', { method });
    setBusy(false);
    if (!r.ok) return setToast({ ok: false, text: r.problem.detail });
    setNewKey(method === 'POST' ? (r.data.key ?? null) : null);
    setToast({
      ok: true,
      text:
        method === 'POST'
          ? 'Chave criada. Copie os comandos abaixo para o StreamElements agora: ela não aparece de novo.'
          : 'Comandos do chat desligados.',
    });
    await reload();
  }
  const commandUrl = (a: string, key: string) =>
    `$(customapi ${origin}/api/v1/subathon/command?a=${a}&k=${key})`;
  const COMMANDS = [
    { name: '!pausar', a: 'pausar', level: 'Moderador' },
    { name: '!retomar', a: 'retomar', level: 'Moderador' },
    { name: '!tempo', a: 'tempo', level: 'Todos' },
  ] as const;

  const se = view.streamElements;
  const seText = !se
    ? 'Sem notícia do worker (ele está rodando?)'
    : se.state === 'connected'
      ? `Conectado desde ${fmtDateTime(se.since)}${se.lastEventAt ? ` · último evento ${fmtDateTime(se.lastEventAt)}` : ''}`
      : se.state === 'disabled'
        ? 'Desligado: coloque o STREAMELEMENTS_JWT no app.env do servidor (veja o guia).'
        : se.state === 'connecting'
          ? (se.error ?? 'Conectando…')
          : (se.error ?? 'Erro de conexão.');

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const spr = int(form.secondsPerReal) ?? DEFAULT_SECONDS_PER_REAL;
  const preview = (label: string, v: string) => {
    const c = toCents(v);
    return c === null ? null : `${label}: ${formatBRL(c)} → ${formatDelta(secondsFor(c, spr))}`;
  };

  const settings = (
    <div className="wf-ops-form">
      <label className="wf-field" htmlFor={`${id}-t`}>
        <span>Nome (aparece no OBS)</span>
        <input
          id={`${id}-t`}
          className="wf-input"
          maxLength={60}
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
        />
      </label>
      {open ? null : (
        <fieldset className="wf-field m-0 border-0 p-0">
          <legend className="mb-1">Tempo inicial</legend>
          <div className="flex gap-2">
            <label className="sr-only" htmlFor={`${id}-h`}>
              Horas
            </label>
            <input
              id={`${id}-h`}
              className="wf-input"
              inputMode="numeric"
              value={form.hours}
              onChange={(e) => set('hours', e.target.value)}
            />
            <span className="self-center">h</span>
            <label className="sr-only" htmlFor={`${id}-m`}>
              Minutos
            </label>
            <input
              id={`${id}-m`}
              className="wf-input"
              inputMode="numeric"
              value={form.minutes}
              onChange={(e) => set('minutes', e.target.value)}
            />
            <span className="self-center">min</span>
          </div>
        </fieldset>
      )}
      <label className="wf-field" htmlFor={`${id}-spr`}>
        <span>Segundos por R$ 1 (60 = R$ 1 vale 1 minuto)</span>
        <input
          id={`${id}-spr`}
          className="wf-input"
          inputMode="numeric"
          value={form.secondsPerReal}
          onChange={(e) => set('secondsPerReal', e.target.value)}
        />
      </label>
      <label className="wf-field" htmlFor={`${id}-cap`}>
        <span>Teto do timer em horas (vazio = sem teto)</span>
        <input
          id={`${id}-cap`}
          className="wf-input"
          inputMode="numeric"
          value={form.capHours}
          onChange={(e) => set('capHours', e.target.value)}
        />
      </label>
      <fieldset className="full m-0 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">
          Quanto vale cada evento da live (em R$)
        </legend>
        <div className="wf-ops-form">
          {(
            [
              ['bits100', '100 bits'],
              ['tier1', 'Sub Tier 1'],
              ['tier2', 'Sub Tier 2'],
              ['tier3', 'Sub Tier 3'],
              ['prime', 'Sub Prime'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="wf-field" htmlFor={`${id}-${k}`}>
              <span>{label} (R$)</span>
              <input
                id={`${id}-${k}`}
                className="wf-input"
                inputMode="decimal"
                value={form[k]}
                onChange={(e) => set(k, e.target.value)}
              />
              <small className="wf-muted">{preview(label, form[k])}</small>
            </label>
          ))}
        </div>
        <div className="wf-ops-form">
          {(
            [
              ['usd', 'US$ 1 vale (R$)'],
              ['eur', '€ 1 vale (R$)'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="wf-field" htmlFor={`${id}-${k}`}>
              <span>{label}</span>
              <input
                id={`${id}-${k}`}
                className="wf-input"
                inputMode="decimal"
                value={form[k]}
                onChange={(e) => set(k, e.target.value)}
              />
            </label>
          ))}
        </div>
        <p className="wf-muted m-0 text-sm">
          Doações do StreamElements e pagamentos do site contam pelo valor pago (doações em dólar ou
          euro pelo câmbio acima). Subs de presente valem o sub do tier (um “bomb” de 10 = 10 subs).
        </p>
      </fieldset>
      <fieldset className="full m-0 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">O que conta no timer</legend>
        <div className="wf-ops-filters">
          {(Object.keys(COUNT_PT) as (keyof SubathonRates['count'])[]).map((k) => (
            <label key={k} className="wf-switch">
              <input
                type="checkbox"
                checked={form.count[k]}
                onChange={(e) => set('count', { ...form.count, [k]: e.target.checked })}
              />
              {COUNT_PT[k]}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );

  return (
    <>
      {toast ? (
        <p role="status" className={toast.ok ? 'wf-toast wf-toast--ok' : 'wf-toast wf-toast--err'}>
          {toast.text}
        </p>
      ) : null}

      {open ? (
        <section className="wf-ops-card is-live" aria-labelledby={`${id}-now`}>
          <h2 id={`${id}-now`}>
            {open.title} · <span className="wf-pill">{STATUS_PT[open.status]}</span>
          </h2>
          <p className="wf-subathon-admin__clock" aria-live="off">
            {formatClock(left)}
          </p>
          <p className="wf-muted m-0 text-sm">
            Começou com {formatClock(open.initialSeconds)} · contribuições somaram{' '}
            {formatDelta(open.addedSeconds)}
            {open.capSeconds ? ` · teto de ${formatClock(open.capSeconds)}` : ''}
          </p>
          <div className="wf-ops-actions mt-3">
            {open.status === 'READY' ? (
              <button
                type="button"
                className="wf-btn wf-btn--neon"
                disabled={busy}
                onClick={() => void status('start')}
              >
                Iniciar timer
              </button>
            ) : null}
            {open.status === 'RUNNING' ? (
              <button
                type="button"
                className="wf-btn wf-btn--neon"
                disabled={busy}
                onClick={() => void status('pause')}
              >
                Pausar
              </button>
            ) : null}
            {open.status === 'PAUSED' ? (
              <button
                type="button"
                className="wf-btn wf-btn--neon"
                disabled={busy}
                onClick={() => void status('resume')}
              >
                Retomar
              </button>
            ) : null}
            <button
              type="button"
              className="wf-btn wf-btn--danger"
              disabled={busy}
              onClick={() => void status('end')}
            >
              Encerrar
            </button>
          </div>
          <div className="wf-ops-actions mt-3" role="group" aria-label="Ajustar o tempo">
            {[5, 10, 30].map((m) => (
              <button
                key={m}
                type="button"
                className="wf-btn wf-btn--ghost wf-btn--sm"
                disabled={busy}
                onClick={() => void addTime(1, m)}
              >
                +{m} min
              </button>
            ))}
            <label className="sr-only" htmlFor={`${id}-adj`}>
              Minutos para ajustar
            </label>
            <input
              id={`${id}-adj`}
              className="wf-input max-w-24"
              inputMode="numeric"
              value={adjust}
              onChange={(e) => setAdjust(e.target.value)}
            />
            <button
              type="button"
              className="wf-btn wf-btn--ghost wf-btn--sm"
              disabled={busy}
              onClick={() => void addTime(1)}
            >
              Adicionar
            </button>
            <button
              type="button"
              className="wf-btn wf-btn--ghost wf-btn--sm"
              disabled={busy}
              onClick={() => void addTime(-1)}
            >
              Remover
            </button>
          </div>
        </section>
      ) : null}

      <section className="wf-ops-card" aria-labelledby={`${id}-se`}>
        <h2 id={`${id}-se`}>StreamElements</h2>
        <p className="m-0">
          <span
            className={se?.state === 'connected' ? 'wf-pill wf-pill--ok' : 'wf-pill wf-pill--bad'}
          >
            {se?.state === 'connected'
              ? 'Conectado'
              : se?.state === 'disabled'
                ? 'Desligado'
                : 'Sem conexão'}
          </span>{' '}
          <span className="wf-muted text-sm">{seText}</span>
        </p>
      </section>

      <section className="wf-ops-card" aria-labelledby={`${id}-cmd`}>
        <h2 id={`${id}-cmd`}>Comandos no chat</h2>
        <p className="wf-muted m-0 text-sm">
          Comandos do chatbot do StreamElements: <strong>!pausar</strong> e{' '}
          <strong>!retomar</strong> (só moderadores) e <strong>!tempo</strong> (todos). No
          StreamElements: Chatbot → Commands → Custom commands → criar cada um com a resposta abaixo
          e o nível de usuário indicado.
        </p>
        {newKey ? (
          <ul className="wf-ops-list mt-3">
            {COMMANDS.map((c) => (
              <li key={c.name} className="wf-ops-row">
                <div className="wf-ops-row__main">
                  <span className="wf-ops-row__title">
                    <strong>{c.name}</strong> · nível: {c.level}
                  </span>
                  <label className="sr-only" htmlFor={`${id}-cmd-${c.a}`}>
                    Resposta do comando {c.name}
                  </label>
                  <input
                    id={`${id}-cmd-${c.a}`}
                    className="wf-input"
                    readOnly
                    value={commandUrl(c.a, newKey)}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </div>
                <span className="wf-ops-actions">
                  <button
                    type="button"
                    className="wf-btn wf-btn--ghost wf-btn--sm"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(commandUrl(c.a, newKey))
                        .then(() => setToast({ ok: true, text: `Resposta de ${c.name} copiada.` }))
                    }
                  >
                    Copiar
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="m-0 mt-3 text-sm">
          {view.commandKey ? (
            <>
              <span className="wf-pill wf-pill--ok">Ligado</span>{' '}
              <span className="wf-muted">
                chave wfc_{view.commandKey.prefix}… criada em{' '}
                {fmtDateTime(view.commandKey.createdAt)}
              </span>
            </>
          ) : (
            <span className="wf-pill">Desligado</span>
          )}
        </p>
        <div className="wf-ops-actions mt-3">
          <button
            type="button"
            className="wf-btn wf-btn--ghost wf-btn--sm"
            disabled={busy}
            onClick={() => void commandKey('POST')}
          >
            {view.commandKey ? 'Trocar chave' : 'Criar comandos'}
          </button>
          {view.commandKey ? (
            <button
              type="button"
              className="wf-btn wf-btn--ghost wf-btn--sm"
              disabled={busy}
              onClick={() => void commandKey('DELETE')}
            >
              Desligar
            </button>
          ) : null}
        </div>
      </section>

      <section className="wf-ops-card" aria-labelledby={`${id}-cfg`}>
        <h2 id={`${id}-cfg`}>{open ? 'Configurações' : 'Novo subathon'}</h2>
        {open && !editing ? (
          <>
            <p className="wf-muted m-0 text-sm">
              R$ 1 = {formatDelta(open.secondsPerReal)} · 100 bits ={' '}
              {formatBRL(open.rates.bits100Cents)} · Tier 1 = {formatBRL(open.rates.tier1Cents)} ·
              Tier 2 = {formatBRL(open.rates.tier2Cents)} · Tier 3 ={' '}
              {formatBRL(open.rates.tier3Cents)} · Prime = {formatBRL(open.rates.primeCents)} · US$
              1 = {formatBRL(open.rates.usdCents)} · € 1 = {formatBRL(open.rates.eurCents)}
            </p>
            <button
              type="button"
              className="wf-btn wf-btn--ghost wf-btn--sm mt-2"
              onClick={() => {
                setForm(formFrom(open));
                setEditing(true);
              }}
            >
              Editar valores
            </button>
          </>
        ) : (
          <>
            {s?.status === 'ENDED' ? (
              <p className="wf-muted m-0 text-sm">
                O último subathon (“{s.title}”) terminou em{' '}
                {s.endedAt ? fmtDateTime(s.endedAt) : '—'}.
              </p>
            ) : null}
            {settings}
            <div className="wf-ops-actions mt-3">
              {open ? (
                <>
                  <button
                    type="button"
                    className="wf-btn wf-btn--neon"
                    disabled={busy}
                    onClick={() => void save()}
                  >
                    Salvar
                  </button>
                  <button
                    type="button"
                    className="wf-btn wf-btn--ghost"
                    disabled={busy}
                    onClick={() => setEditing(false)}
                  >
                    Cancelar
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="wf-btn wf-btn--neon"
                  disabled={busy}
                  onClick={() => void create()}
                >
                  Criar subathon
                </button>
              )}
            </div>
          </>
        )}
      </section>

      {s ? (
        <section className="wf-ops-card" aria-labelledby={`${id}-log`}>
          <h2 id={`${id}-log`}>O que entrou no timer</h2>
          {view.entries.length ? (
            <ul className="wf-ops-list">
              {view.entries.map((e) => (
                <li key={e.id} className="wf-ops-row">
                  <div className="wf-ops-row__main">
                    <span className="wf-ops-row__title">
                      <strong>{formatDelta(e.appliedSeconds)}</strong> {e.label ?? KIND_PT[e.kind]}
                    </span>
                    <span className="wf-muted text-xs">
                      {KIND_PT[e.kind] ?? e.kind}
                      {e.valueCents !== null ? ` · ${formatBRL(e.valueCents)}` : ''} ·{' '}
                      {fmtDateTime(e.at)}
                      {e.appliedSeconds !== e.seconds
                        ? ` · pedido ${formatDelta(e.seconds)} (limitado pelo teto ou pelo zero)`
                        : ''}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="wf-muted m-0">
              Nada ainda. Pagamentos do site e eventos da live aparecem aqui.
            </p>
          )}
        </section>
      ) : null}
    </>
  );
}
