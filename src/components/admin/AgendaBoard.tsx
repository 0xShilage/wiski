'use client';
import { useId, useState } from 'react';
import { adminFetch } from '@/lib/passkey-client';
import {
  fmtDateTime,
  fromLocalInput,
  toLocalInput,
  type AgendaEntry,
  type AgendaSession,
} from '@/lib/admin/types';
import { formatRuntime } from '@/lib/catalog/pricing';

type Data = { sessions: AgendaSession[]; queue: AgendaEntry[] };

const STATUS_PT = {
  PLANNED: 'Planejada',
  LIVE: 'Ao vivo',
  DONE: 'Encerrada',
  CANCELLED: 'Cancelada',
};
const TIER_PT = { topo: 'Topo da fila', prioridade: 'Prioridade' } as const;

/** Tomorrow at 20:00 (Brasília) as a datetime-local value — the usual live time. */
function tomorrowAt20() {
  return toLocalInput(new Date(Date.now() + 86_400_000).toISOString()).slice(0, 11) + '20:00';
}

/**
 * Agenda da live (Phase 4): the queue of paid movies and funded campaigns on the left, the
 * sessions on the right. Every button sends the version the moderator saw; if someone else moved
 * first the server says so and the board reloads.
 */
export function AgendaBoard({ initial, role }: { initial: Data; role: 'MODERATOR' | 'STREAMER' }) {
  const id = useId();
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [form, setForm] = useState(() => ({ startsAt: tomorrowAt20(), capacity: '240', note: '' }));

  const upcoming = data.sessions.filter((s) => s.status === 'PLANNED' || s.status === 'LIVE');

  async function reload() {
    const r = await adminFetch<Data>('/api/v1/admin/live');
    if (r.ok) setData(r.data);
  }

  async function run(label: string, path: string, method: 'POST' | 'PATCH', body: unknown) {
    setBusy(true);
    setToast(null);
    const r = await adminFetch(path, { method, body });
    setBusy(false);
    setToast(r.ok ? { ok: true, text: `${label}: feito.` } : { ok: false, text: r.problem.detail });
    await reload();
  }

  const target = (e: AgendaEntry) => ({ kind: e.kind, id: e.id, expectedVersion: e.version });

  function entryRow(e: AgendaEntry, s: AgendaSession | null) {
    const isNow = s?.nowItemId === e.item.id;
    const done = e.status === 'COMPLETED' || e.status === 'WATCHED';
    return (
      <li key={`${e.kind}:${e.id}`} className={isNow ? 'wf-ops-row is-now' : 'wf-ops-row'}>
        <div className="wf-ops-row__main">
          <span className="wf-ops-row__title">{e.item.title}</span>
          <span className="wf-muted text-xs">
            {e.kind === 'CAMPAIGN' ? 'Campanha (meta atingida)' : formatRuntime(e.runtimeMinutes)}
            {e.sponsor ? ` · ${e.sponsor}` : e.kind === 'ORDER' ? ' · Anônimo' : ''}
            {e.publicCode ? ` · ${e.publicCode}` : ''}
          </span>
          {e.message ? <span className="text-xs">“{e.message}”</span> : null}
        </div>
        <div className="wf-ops-actions">
          {e.tier ? <span className="wf-pill wf-pill--warn">{TIER_PT[e.tier]}</span> : null}
          {done ? <span className="wf-pill wf-pill--ok">Assistido</span> : null}
          {isNow ? <span className="wf-pill wf-pill--ok">No ar</span> : null}
          {!s ? (
            <>
              <label className="sr-only" htmlFor={`${id}-${e.id}`}>
                Sessão para {e.item.title}
              </label>
              <select
                id={`${id}-${e.id}`}
                value={pick[e.id] ?? ''}
                onChange={(ev) => setPick({ ...pick, [e.id]: ev.target.value })}
              >
                <option value="">Escolher sessão…</option>
                {upcoming.map((x) => (
                  <option key={x.id} value={x.id}>
                    {fmtDateTime(x.startsAt)} · livre {x.capacityMinutes - x.bookedMinutes} min
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="wf-btn wf-btn--sm wf-btn--neon"
                disabled={busy || !pick[e.id]}
                onClick={() =>
                  void run('Agendado', '/api/v1/admin/schedule', 'POST', {
                    action: 'add',
                    target: target(e),
                    sessionId: pick[e.id],
                  })
                }
              >
                Agendar
              </button>
            </>
          ) : done ? null : (
            <>
              {s.status === 'LIVE' && !isNow ? (
                <button
                  type="button"
                  className="wf-btn wf-btn--sm wf-btn--ghost"
                  disabled={busy}
                  onClick={() =>
                    void run('Agora assistindo', '/api/v1/admin/schedule', 'POST', {
                      action: 'now',
                      target: target(e),
                    })
                  }
                >
                  Agora assistindo
                </button>
              ) : null}
              {s.status === 'LIVE' ? (
                <button
                  type="button"
                  className="wf-btn wf-btn--sm wf-btn--neon"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Marcar “${e.item.title}” como assistido? As avaliações abrem.`,
                      )
                    ) {
                      void run('Concluído', '/api/v1/admin/schedule', 'POST', {
                        action: 'complete',
                        target: target(e),
                      });
                    }
                  }}
                >
                  Concluído
                </button>
              ) : null}
              {e.status === 'SCHEDULED' && !isNow ? (
                <button
                  type="button"
                  className="wf-linkbtn text-xs"
                  disabled={busy}
                  onClick={() =>
                    void run('Voltou para a fila', '/api/v1/admin/schedule', 'POST', {
                      action: 'remove',
                      target: target(e),
                    })
                  }
                >
                  Tirar da sessão
                </button>
              ) : null}
            </>
          )}
        </div>
      </li>
    );
  }

  return (
    <>
      {toast ? (
        <p role="status" className={toast.ok ? 'wf-toast wf-toast--ok' : 'wf-toast wf-toast--err'}>
          {toast.text}
        </p>
      ) : null}

      <form
        className="wf-ops-card"
        onSubmit={(ev) => {
          ev.preventDefault();
          void run('Sessão criada', '/api/v1/admin/sessions', 'POST', {
            startsAt: fromLocalInput(form.startsAt),
            capacityMinutes: Number(form.capacity),
            publicNote: form.note || null,
          });
        }}
      >
        <h2>Nova sessão</h2>
        <div className="wf-ops-form">
          <label className="wf-field" htmlFor={`${id}-start`}>
            <span>Começa em (horário de Brasília)</span>
            <input
              id={`${id}-start`}
              type="datetime-local"
              className="wf-input"
              value={form.startsAt}
              onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
              required
            />
          </label>
          <label className="wf-field" htmlFor={`${id}-cap`}>
            <span>Capacidade (minutos)</span>
            <input
              id={`${id}-cap`}
              type="number"
              min={15}
              max={1440}
              className="wf-input"
              value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: e.target.value })}
              required
            />
          </label>
          <label className="wf-field" htmlFor={`${id}-note`}>
            <span>Aviso público (opcional)</span>
            <input
              id={`${id}-note`}
              className="wf-input"
              maxLength={140}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </label>
          <button type="submit" className="wf-btn wf-btn--neon" disabled={busy}>
            Criar sessão
          </button>
        </div>
      </form>

      <div className="wf-ops-grid">
        <section className="wf-ops-card" aria-labelledby={`${id}-q`}>
          <h2 id={`${id}-q`}>Fila ({data.queue.length})</h2>
          <p className="wf-muted text-xs">
            Filmes pagos e campanhas com meta atingida, na ordem: Topo da fila, Prioridade e depois
            por data de pagamento.
          </p>
          {data.queue.length ? (
            <ul className="wf-ops-list">{data.queue.map((e) => entryRow(e, null))}</ul>
          ) : (
            <p className="wf-muted">Nada na fila.</p>
          )}
        </section>

        <div className="grid gap-4">
          {data.sessions.length ? null : <p className="wf-muted">Nenhuma sessão ainda.</p>}
          {data.sessions.map((s) => (
            <section
              key={s.id}
              className={s.status === 'LIVE' ? 'wf-ops-card is-live' : 'wf-ops-card'}
              aria-label={`Sessão de ${fmtDateTime(s.startsAt)}`}
            >
              <div className="wf-ops-row__main">
                <h3>
                  {fmtDateTime(s.startsAt)} · {STATUS_PT[s.status]}
                </h3>
                <span className="wf-muted text-xs">
                  {s.bookedMinutes} de {s.capacityMinutes} min agendados
                  {s.publicNote ? ` · “${s.publicNote}”` : ''}
                  {s.nowItem ? ` · no ar: ${s.nowItem.title}` : ''}
                </span>
              </div>
              <progress
                className="wf-progress wf-progress--sm"
                max={s.capacityMinutes}
                value={Math.min(s.bookedMinutes, s.capacityMinutes)}
                aria-label={`${s.bookedMinutes} de ${s.capacityMinutes} minutos`}
              />
              {s.entries.length ? (
                <ul className="wf-ops-list">{s.entries.map((e) => entryRow(e, s))}</ul>
              ) : (
                <p className="wf-muted text-sm">Nada agendado.</p>
              )}
              <div className="wf-ops-actions">
                {s.status === 'PLANNED' ? (
                  <button
                    type="button"
                    className="wf-btn wf-btn--sm wf-btn--neon"
                    disabled={busy}
                    onClick={() =>
                      void run('Sessão ao vivo', `/api/v1/admin/sessions/${s.id}/start`, 'POST', {
                        expectedVersion: s.version,
                      })
                    }
                  >
                    Começar live
                  </button>
                ) : null}
                {s.status === 'LIVE' ? (
                  <button
                    type="button"
                    className="wf-btn wf-btn--sm wf-btn--ghost"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          'Encerrar a live? O que não foi assistido volta para a fila.',
                        )
                      ) {
                        void run('Sessão encerrada', `/api/v1/admin/sessions/${s.id}/end`, 'POST', {
                          expectedVersion: s.version,
                        });
                      }
                    }}
                  >
                    Encerrar live
                  </button>
                ) : null}
                {s.status === 'PLANNED' || s.status === 'LIVE' ? (
                  <button
                    type="button"
                    className="wf-linkbtn text-xs"
                    disabled={busy}
                    onClick={() => {
                      const v = window.prompt(
                        'Nova capacidade em minutos',
                        String(s.capacityMinutes),
                      );
                      if (v) {
                        void run('Capacidade alterada', `/api/v1/admin/sessions/${s.id}`, 'PATCH', {
                          expectedVersion: s.version,
                          capacityMinutes: Number(v),
                        });
                      }
                    }}
                  >
                    Mudar capacidade
                  </button>
                ) : null}
                {role === 'STREAMER' && s.status === 'PLANNED' ? (
                  <button
                    type="button"
                    className="wf-linkbtn text-xs"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm('Cancelar esta sessão? Tudo volta para a fila.')) {
                        void run(
                          'Sessão cancelada',
                          `/api/v1/admin/sessions/${s.id}/cancel`,
                          'POST',
                          { expectedVersion: s.version },
                        );
                      }
                    }}
                  >
                    Cancelar sessão
                  </button>
                ) : null}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
