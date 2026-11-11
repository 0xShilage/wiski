'use client';
import { useId, useState } from 'react';
import { apiFetch, type Problem } from '@/lib/api-fetch';

type Kind = 'MOVIE' | 'SERIES' | 'FRANCHISE' | 'ANIME' | 'GAME';
type Status = 'NEW' | 'ACCEPTED' | 'DISMISSED' | 'WATCHED';
export type Mine = {
  id: string;
  kind: Kind;
  title: string;
  year: number | null;
  status: Status;
  createdAt: string;
};

const KIND_PT: Record<Kind, string> = {
  MOVIE: 'Filme',
  SERIES: 'Série',
  FRANCHISE: 'Franquia',
  ANIME: 'Anime',
  GAME: 'Jogo',
};
const STATUS_PT: Record<Status, string> = {
  NEW: 'Esperando',
  ACCEPTED: 'Aceita',
  WATCHED: 'Já assistida',
  DISMISSED: 'Não desta vez',
};
const date = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'America/Sao_Paulo',
});

/** Sugestões (Phase 6): the form and "Suas sugestões" with what the moderation decided. */
export function SuggestionForm({ initial }: { initial: Mine[] }) {
  const id = useId();
  const [mine, setMine] = useState(initial);
  const [f, setF] = useState({ kind: 'MOVIE' as Kind, title: '', year: '', note: '' });
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const err = (path: string) => problem?.errors?.find((e) => e.path === path)?.message;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setProblem(null);
    setSent(false);
    const r = await apiFetch<{ mine: Mine[] }>('/api/v1/suggestions', {
      method: 'POST',
      body: {
        kind: f.kind,
        title: f.title,
        year: f.year ? Number(f.year) : null,
        note: f.note.trim() ? f.note : null,
      },
    });
    setBusy(false);
    if (r.ok) {
      setMine(r.data.mine);
      setF({ ...f, title: '', year: '', note: '' });
      setSent(true);
      return;
    }
    setProblem(r.problem);
  }

  return (
    <>
      <form className="wf-suggest__card" onSubmit={submit} noValidate>
        <fieldset className="wf-suggest__kinds">
          <legend>O que você quer sugerir?</legend>
          {(Object.keys(KIND_PT) as Kind[]).map((k) => (
            <label key={k} className={f.kind === k ? 'is-on' : ''}>
              <input
                type="radio"
                name={`${id}-kind`}
                value={k}
                checked={f.kind === k}
                onChange={() => setF({ ...f, kind: k })}
              />
              {KIND_PT[k]}
            </label>
          ))}
        </fieldset>
        <div className="wf-suggest__row">
          <label className="wf-field" htmlFor={`${id}-title`}>
            <span>Nome</span>
            <input
              id={`${id}-title`}
              className="wf-input"
              maxLength={120}
              required
              value={f.title}
              onChange={(e) => setF({ ...f, title: e.target.value })}
              aria-invalid={err('title') ? 'true' : undefined}
              aria-describedby={err('title') ? `${id}-title-err` : undefined}
            />
            {err('title') ? (
              <small id={`${id}-title-err`} className="wf-hint wf-hint--err">
                {err('title')}
              </small>
            ) : null}
          </label>
          <label className="wf-field" htmlFor={`${id}-year`}>
            <span>Ano (opcional)</span>
            <input
              id={`${id}-year`}
              className="wf-input"
              type="number"
              inputMode="numeric"
              min={1888}
              max={2100}
              value={f.year}
              onChange={(e) => setF({ ...f, year: e.target.value })}
              aria-invalid={err('year') ? 'true' : undefined}
            />
          </label>
        </div>
        <label className="wf-field" htmlFor={`${id}-note`}>
          <span>Por que esse? (opcional)</span>
          <textarea
            id={`${id}-note`}
            className="wf-input"
            rows={3}
            maxLength={280}
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
            aria-invalid={err('note') ? 'true' : undefined}
            aria-describedby={err('note') ? `${id}-note-err` : undefined}
          />
          {err('note') ? (
            <small id={`${id}-note-err`} className="wf-hint wf-hint--err">
              {err('note')}
            </small>
          ) : null}
        </label>
        {problem && !problem.errors?.length ? (
          <p role="alert" className="wf-toast wf-toast--err">
            {problem.detail}
          </p>
        ) : null}
        {sent ? (
          <p role="status" className="wf-toast wf-toast--ok">
            Sugestão enviada! A moderação vai dar uma olhada.
          </p>
        ) : null}
        <button type="submit" className="wf-btn wf-btn--neon" disabled={busy || !f.title.trim()}>
          {busy ? 'Enviando…' : 'Enviar sugestão'}
        </button>
        <p className="wf-suggest__fine">Até 5 sugestões por dia.</p>
      </form>

      <section className="wf-suggest__mine" aria-labelledby={`${id}-mine`}>
        <h2 id={`${id}-mine`} className="wf-h2">
          Suas sugestões
        </h2>
        {mine.length ? (
          <ul>
            {mine.map((m) => (
              <li key={m.id}>
                <span className="wf-suggest__title">
                  {m.title}
                  {m.year ? ` (${m.year})` : ''}
                </span>
                <span className="wf-suggest__meta">
                  {KIND_PT[m.kind]} · {date.format(new Date(m.createdAt))}
                </span>
                <span
                  className={
                    m.status === 'ACCEPTED'
                      ? 'wf-pill wf-pill--ok'
                      : m.status === 'WATCHED'
                        ? 'wf-pill wf-pill--ok'
                        : m.status === 'DISMISSED'
                          ? 'wf-pill'
                          : 'wf-pill wf-pill--warn'
                  }
                >
                  {STATUS_PT[m.status]}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="wf-suggest__meta">Você ainda não sugeriu nada.</p>
        )}
      </section>
    </>
  );
}
