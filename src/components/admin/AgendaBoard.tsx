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
import { episodesLabel, minutesPerEpisode } from '@/lib/live/segments';

type Data = { sessions: AgendaSession[]; queue: AgendaEntry[] };

const STATUS_PT = {
  PLANNED: 'Planejada',
  LIVE: 'Ao vivo',
  DONE: 'Encerrada',
  CANCELLED: 'Cancelada',
};
const TIER_PT = { topo: 'Topo da fila', prioridade: 'Prioridade' } as const;
const SCHEDULE = '/api/v1/admin/schedule';

/** Tomorrow at 20:00 (Brasília) as a datetime-local value — the usual live time. */
function tomorrowAt20() {
  return toLocalInput(new Date(Date.now() + 86_400_000).toISOString()).slice(0, 11) + '20:00';
}

const dayFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'America/Sao_Paulo',
});
const dayShort = (iso: string) => dayFmt.format(new Date(iso));

type PartForm = {
  sessionId: string;
  season: string;
  from: string;
  to: string;
  film: string;
  minutes: string;
  minutesTouched: boolean;
  atStart: boolean;
  note: string;
};
type EventForm = { title: string; minutes: string; atStart: boolean; note: string };

/** First guess for the next part: the episode after the last one booked, or the next film. */
function nextPart(e: AgendaEntry, sessionId: string): PartForm {
  const plan = e.plan;
  const parts = e.parts ?? [];
  const isSeries = e.item?.kind === 'SERIES';
  let season = 1;
  let from = 1;
  let film = plan?.films[0]?.position ?? 1;
  if (isSeries) {
    const last = [...parts].reverse().find((p) => p.season && p.episodeTo);
    if (last?.season && last.episodeTo) {
      season = last.season;
      from = last.episodeTo + 1;
    }
  } else if (plan) {
    const used = new Set(parts.map((p) => p.film));
    film = plan.films.find((f) => !used.has(f.position))?.position ?? film;
  }
  const to = isSeries ? from + 2 : from;
  return {
    sessionId,
    season: String(season),
    from: String(from),
    to: String(to),
    film: String(film),
    minutes: String(guessMinutes(e, { from, to, film })),
    minutesTouched: false,
    atStart: false,
    note: '',
  };
}

function guessMinutes(e: AgendaEntry, p: { from: number; to: number; film: number }): number {
  const plan = e.plan;
  if (!plan) return 60;
  if (e.item?.kind === 'SERIES') {
    const n = Math.max(1, p.to - p.from + 1);
    return Math.min(1440, n * minutesPerEpisode(plan));
  }
  return plan.films.find((f) => f.position === p.film)?.runtimeMinutes || 120;
}

/**
 * Agenda da live (Phase 4): the queue of paid movies and funded campaigns on the left, the
 * sessions on the right. Every button sends the version the moderator saw; if someone else moved
 * first the server says so and the board reloads.
 * 2026-11-04: a funded series is booked a few episodes at a time ("Agendar episódios"), a
 * franchise one film at a time, and stays in the queue until its last part is marked "fim da
 * série"; any session can also carry a custom event ("Jogando com os Viewers").
 */
export function AgendaBoard({ initial, role }: { initial: Data; role: 'MODERATOR' | 'STREAMER' }) {
  const id = useId();
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [form, setForm] = useState(() => ({ startsAt: tomorrowAt20(), capacity: '240', note: '' }));
  const [part, setPart] = useState<{ entry: AgendaEntry; form: PartForm } | null>(null);
  const [event, setEvent] = useState<{ sessionId: string; form: EventForm } | null>(null);

  const upcoming = data.sessions.filter((s) => s.status === 'PLANNED' || s.status === 'LIVE');

  async function reload() {
    const r = await adminFetch<Data>('/api/v1/admin/live');
    if (r.ok) setData(r.data);
  }

  async function run(
    label: string,
    path: string,
    method: 'POST' | 'PATCH',
    body: unknown,
  ): Promise<boolean> {
    setBusy(true);
    setToast(null);
    const r = await adminFetch(path, { method, body });
    setBusy(false);
    setToast(r.ok ? { ok: true, text: `${label}: feito.` } : { ok: false, text: r.problem.detail });
    await reload();
    return r.ok;
  }

  const target = (e: AgendaEntry) => ({ kind: e.kind, id: e.id, expectedVersion: e.version });
  const titleOf = (e: AgendaEntry) => e.item?.title ?? e.segment?.label ?? '';

  function sessionPicker(e: AgendaEntry) {
    return (
      <>
        <label className="sr-only" htmlFor={`${id}-${e.id}`}>
          Sessão para {titleOf(e)}
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
      </>
    );
  }

  /** The queue row of a funded campaign: what was watched, what is booked, "Agendar …". */
  function campaignQueueRow(e: AgendaEntry) {
    const parts = e.parts ?? [];
    const done = parts.filter((p) => p.status === 'DONE');
    const booked = parts.filter((p) => p.status !== 'DONE');
    const series = e.item?.kind === 'SERIES';
    const noun = series ? 'episódios' : 'filme';
    const noFilms = !series && !e.plan?.films.length;
    return (
      <li key={`${e.kind}:${e.id}`} className="wf-ops-row">
        <div className="wf-ops-row__main">
          <span className="wf-ops-row__title">{titleOf(e)}</span>
          <span className="wf-muted text-xs">
            {series ? 'Série' : 'Franquia'} · meta atingida · fica na fila até o fim
          </span>
          {done.length ? (
            <span className="text-xs">Já foi: {done.map((p) => p.label).join(', ')}</span>
          ) : null}
          {booked.length ? (
            <span className="text-xs">
              Agendado: {booked.map((p) => `${p.label} (${dayShort(p.startsAt)})`).join(', ')}
            </span>
          ) : null}
        </div>
        <div className="wf-ops-actions">
          {sessionPicker(e)}
          <button
            type="button"
            className="wf-btn wf-btn--sm wf-btn--neon"
            disabled={busy || !pick[e.id] || noFilms}
            title={noFilms ? 'Cadastre os filmes da franquia no catálogo' : undefined}
            onClick={() => setPart({ entry: e, form: nextPart(e, pick[e.id]!) })}
          >
            Agendar {noun}
          </button>
        </div>
        {part?.entry.id === e.id ? partForm(part.entry, part.form) : null}
      </li>
    );
  }

  function partForm(e: AgendaEntry, f: PartForm) {
    const series = e.item?.kind === 'SERIES';
    const films = e.plan?.films ?? [];
    const set = (patch: Partial<PartForm>) => {
      const next = { ...f, ...patch };
      if (!next.minutesTouched && !('minutes' in patch)) {
        next.minutes = String(
          guessMinutes(e, {
            from: Number(next.from) || 1,
            to: Number(next.to) || Number(next.from) || 1,
            film: Number(next.film) || 1,
          }),
        );
      }
      setPart({ entry: e, form: next });
    };
    const session = upcoming.find((s) => s.id === f.sessionId);
    const preview = series
      ? episodesLabel(
          Number(f.season) || 1,
          Number(f.from) || 1,
          Number(f.to) || Number(f.from) || 1,
        )
      : (films.find((x) => x.position === Number(f.film))?.title ?? '');
    return (
      <form
        className="wf-ops-form wf-ops-subform full"
        aria-label={`Agendar parte de ${titleOf(e)}`}
        onSubmit={(ev) => {
          ev.preventDefault();
          void run(series ? 'Episódios agendados' : 'Filme agendado', SCHEDULE, 'POST', {
            action: 'part',
            campaignId: e.id,
            sessionId: f.sessionId,
            ...(series
              ? {
                  season: Number(f.season),
                  episodeFrom: Number(f.from),
                  episodeTo: Number(f.to) || Number(f.from),
                }
              : { film: Number(f.film) }),
            minutes: Number(f.minutes),
            note: f.note.trim() || null,
            atStart: f.atStart,
          }).then((ok) => {
            if (ok) setPart(null);
          });
        }}
      >
        <p className="full text-sm">
          Na live de {session ? fmtDateTime(session.startsAt) : '…'}: <strong>{preview}</strong>
        </p>
        {series ? (
          <>
            <label className="wf-field" htmlFor={`${id}-season-${e.id}`}>
              <span>Temporada</span>
              <input
                id={`${id}-season-${e.id}`}
                type="number"
                min={1}
                max={e.plan?.seasonCount ?? 99}
                className="wf-input"
                value={f.season}
                onChange={(ev) => set({ season: ev.target.value })}
                required
              />
            </label>
            <label className="wf-field" htmlFor={`${id}-from-${e.id}`}>
              <span>Do episódio</span>
              <input
                id={`${id}-from-${e.id}`}
                type="number"
                min={1}
                max={999}
                className="wf-input"
                value={f.from}
                onChange={(ev) => set({ from: ev.target.value })}
                required
              />
            </label>
            <label className="wf-field" htmlFor={`${id}-to-${e.id}`}>
              <span>Até o episódio</span>
              <input
                id={`${id}-to-${e.id}`}
                type="number"
                min={Number(f.from) || 1}
                max={999}
                className="wf-input"
                value={f.to}
                onChange={(ev) => set({ to: ev.target.value })}
                required
              />
            </label>
          </>
        ) : (
          <label className="wf-field" htmlFor={`${id}-film-${e.id}`}>
            <span>Filme</span>
            <select
              id={`${id}-film-${e.id}`}
              className="wf-input"
              value={f.film}
              onChange={(ev) => set({ film: ev.target.value })}
            >
              {films.map((x) => (
                <option key={x.position} value={x.position}>
                  {x.position}. {x.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="wf-field" htmlFor={`${id}-min-${e.id}`}>
          <span>Duração (minutos)</span>
          <input
            id={`${id}-min-${e.id}`}
            type="number"
            min={1}
            max={1440}
            className="wf-input"
            value={f.minutes}
            onChange={(ev) => set({ minutes: ev.target.value, minutesTouched: true })}
            required
          />
        </label>
        <label className="wf-field" htmlFor={`${id}-pnote-${e.id}`}>
          <span>Aviso público (opcional)</span>
          <input
            id={`${id}-pnote-${e.id}`}
            className="wf-input"
            maxLength={140}
            value={f.note}
            onChange={(ev) => set({ note: ev.target.value })}
          />
        </label>
        <label className="wf-switch">
          <input
            type="checkbox"
            checked={f.atStart}
            onChange={(ev) => set({ atStart: ev.target.checked })}
          />
          No começo da live
        </label>
        <span className="wf-ops-actions full">
          <button type="submit" className="wf-btn wf-btn--sm wf-btn--neon" disabled={busy}>
            Agendar
          </button>
          <button type="button" className="wf-linkbtn text-xs" onClick={() => setPart(null)}>
            Cancelar
          </button>
        </span>
      </form>
    );
  }

  function eventForm(s: AgendaSession, f: EventForm) {
    const set = (patch: Partial<EventForm>) =>
      setEvent({ sessionId: s.id, form: { ...f, ...patch } });
    return (
      <form
        className="wf-ops-form wf-ops-subform"
        aria-label={`Novo evento na live de ${fmtDateTime(s.startsAt)}`}
        onSubmit={(ev) => {
          ev.preventDefault();
          void run('Evento adicionado', SCHEDULE, 'POST', {
            action: 'event',
            sessionId: s.id,
            title: f.title,
            minutes: Number(f.minutes),
            note: f.note.trim() || null,
            atStart: f.atStart,
          }).then((ok) => {
            if (ok) setEvent(null);
          });
        }}
      >
        <label className="wf-field" htmlFor={`${id}-et-${s.id}`}>
          <span>Nome do evento</span>
          <input
            id={`${id}-et-${s.id}`}
            className="wf-input"
            minLength={2}
            maxLength={60}
            placeholder="Jogando com os Viewers"
            value={f.title}
            onChange={(ev) => set({ title: ev.target.value })}
            required
          />
        </label>
        <label className="wf-field" htmlFor={`${id}-em-${s.id}`}>
          <span>Duração (minutos)</span>
          <input
            id={`${id}-em-${s.id}`}
            type="number"
            min={1}
            max={1440}
            className="wf-input"
            value={f.minutes}
            onChange={(ev) => set({ minutes: ev.target.value })}
            required
          />
        </label>
        <label className="wf-field" htmlFor={`${id}-en-${s.id}`}>
          <span>Aviso público (opcional)</span>
          <input
            id={`${id}-en-${s.id}`}
            className="wf-input"
            maxLength={140}
            value={f.note}
            onChange={(ev) => set({ note: ev.target.value })}
          />
        </label>
        <label className="wf-switch">
          <input
            type="checkbox"
            checked={f.atStart}
            onChange={(ev) => set({ atStart: ev.target.checked })}
          />
          No começo da live
        </label>
        <span className="wf-ops-actions full">
          <button type="submit" className="wf-btn wf-btn--sm wf-btn--neon" disabled={busy}>
            Adicionar evento
          </button>
          <button type="button" className="wf-linkbtn text-xs" onClick={() => setEvent(null)}>
            Cancelar
          </button>
        </span>
      </form>
    );
  }

  /** A segment on a session: a part of a series/franchise, or a custom event. */
  function segmentRow(e: AgendaEntry, s: AgendaSession) {
    const g = e.segment!;
    const playing = e.status === 'PLAYING';
    const done = e.status === 'DONE';
    const isPart = g.kind === 'PART';
    const series = e.item?.kind === 'SERIES';
    return (
      <li key={`${e.kind}:${e.id}`} className={playing ? 'wf-ops-row is-now' : 'wf-ops-row'}>
        <div className="wf-ops-row__main">
          <span className="wf-ops-row__title">
            {isPart ? `${e.item?.title ?? ''} · ${g.label}` : g.label}
          </span>
          <span className="wf-muted text-xs">
            {isPart ? (series ? 'Episódios' : 'Filme da franquia') : 'Evento'} ·{' '}
            {formatRuntime(e.runtimeMinutes)}
            {g.note ? ` · “${g.note}”` : ''}
          </span>
        </div>
        <div className="wf-ops-actions">
          {g.atStart ? <span className="wf-pill">No começo</span> : null}
          {done ? (
            <span className="wf-pill wf-pill--ok">{isPart ? 'Assistido' : 'Feito'}</span>
          ) : null}
          {playing ? <span className="wf-pill wf-pill--ok">No ar</span> : null}
          {done ? null : (
            <>
              {s.status === 'LIVE' && !playing ? (
                <button
                  type="button"
                  className="wf-btn wf-btn--sm wf-btn--ghost"
                  disabled={busy}
                  onClick={() =>
                    void run('Agora na live', SCHEDULE, 'POST', {
                      action: 'now',
                      target: target(e),
                    })
                  }
                >
                  {isPart ? 'Agora assistindo' : 'Começar agora'}
                </button>
              ) : null}
              {s.status === 'LIVE' ? (
                <button
                  type="button"
                  className="wf-btn wf-btn--sm wf-btn--neon"
                  disabled={busy}
                  onClick={() =>
                    void run('Concluído', SCHEDULE, 'POST', {
                      action: 'complete',
                      target: target(e),
                    })
                  }
                >
                  Concluído
                </button>
              ) : null}
              {s.status === 'LIVE' && isPart ? (
                <button
                  type="button"
                  className="wf-btn wf-btn--sm wf-btn--ghost"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Era a última parte de “${e.item?.title ?? ''}”? ${
                          series ? 'A série' : 'A franquia'
                        } fica como assistida, sai da fila e as avaliações abrem.`,
                      )
                    ) {
                      void run(
                        series ? 'Série concluída' : 'Franquia concluída',
                        SCHEDULE,
                        'POST',
                        {
                          action: 'complete',
                          target: target(e),
                          finish: true,
                        },
                      );
                    }
                  }}
                >
                  {series ? 'Concluído · fim da série' : 'Concluído · fim da franquia'}
                </button>
              ) : null}
              {e.status === 'SCHEDULED' ? (
                <button
                  type="button"
                  className="wf-linkbtn text-xs"
                  disabled={busy}
                  onClick={() =>
                    void run('Tirado da sessão', SCHEDULE, 'POST', {
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

  function entryRow(e: AgendaEntry, s: AgendaSession | null) {
    if (e.segment && s) return segmentRow(e, s);
    if (!s && e.kind === 'CAMPAIGN') return campaignQueueRow(e);
    const isNow = !!s && !!e.item && s.nowItemId === e.item.id && !s.playing?.segment;
    const done = e.status === 'COMPLETED' || e.status === 'WATCHED';
    return (
      <li key={`${e.kind}:${e.id}`} className={isNow ? 'wf-ops-row is-now' : 'wf-ops-row'}>
        <div className="wf-ops-row__main">
          <span className="wf-ops-row__title">{titleOf(e)}</span>
          <span className="wf-muted text-xs">
            {e.kind === 'CAMPAIGN' ? 'Campanha inteira' : formatRuntime(e.runtimeMinutes)}
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
              {sessionPicker(e)}
              <button
                type="button"
                className="wf-btn wf-btn--sm wf-btn--neon"
                disabled={busy || !pick[e.id]}
                onClick={() =>
                  void run('Agendado', SCHEDULE, 'POST', {
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
                    void run('Agora assistindo', SCHEDULE, 'POST', {
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
                      window.confirm(`Marcar “${titleOf(e)}” como assistido? As avaliações abrem.`)
                    ) {
                      void run('Concluído', SCHEDULE, 'POST', {
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
                    void run('Voltou para a fila', SCHEDULE, 'POST', {
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
            por data de pagamento. Séries entram aos poucos (alguns episódios por live) e franquias
            um filme por vez: elas ficam aqui até você marcar o fim.
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
                  {s.playing?.segment
                    ? ` · no ar: ${s.playing.item ? `${s.playing.item.title} · ` : ''}${s.playing.segment.label}`
                    : s.nowItem
                      ? ` · no ar: ${s.nowItem.title}`
                      : ''}
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
              {event?.sessionId === s.id ? eventForm(s, event.form) : null}
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
                {(s.status === 'PLANNED' || s.status === 'LIVE') && event?.sessionId !== s.id ? (
                  <button
                    type="button"
                    className="wf-btn wf-btn--sm wf-btn--ghost"
                    disabled={busy}
                    onClick={() =>
                      setEvent({
                        sessionId: s.id,
                        form: { title: '', minutes: '60', atStart: false, note: '' },
                      })
                    }
                  >
                    Adicionar evento
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
