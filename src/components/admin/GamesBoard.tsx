'use client';
import { useId, useState } from 'react';
import { MediaPicture } from '@/components/media/MediaPicture';
import type { Picture } from '@/lib/media';
import { adminFetch } from '@/lib/passkey-client';
import { MediaDrop } from './MediaDrop';

type Status = 'PLAYING' | 'FINISHED' | 'DROPPED';
export type GameRow = {
  id: string;
  title: string;
  platform: string | null;
  year: number | null;
  status: Status;
  note: string | null;
  vodUrl: string | null;
  finishedOn: string | null;
  coverId: string | null;
  cover: Picture | null;
  version: number;
};

const STATUS_PT: Record<Status, string> = {
  PLAYING: 'Jogando',
  FINISHED: 'Zerado',
  DROPPED: 'Dropado',
};

type Form = {
  title: string;
  platform: string;
  year: string;
  status: Status;
  note: string;
  vodUrl: string;
  finishedOn: string;
  coverId: string | null;
  cover: Picture | null;
};
const empty: Form = {
  title: '',
  platform: '',
  year: '',
  status: 'PLAYING',
  note: '',
  vodUrl: '',
  finishedOn: '',
  coverId: null,
  cover: null,
};
const formOf = (g: GameRow): Form => ({
  title: g.title,
  platform: g.platform ?? '',
  year: g.year ? String(g.year) : '',
  status: g.status,
  note: g.note ?? '',
  vodUrl: g.vodUrl ?? '',
  finishedOn: g.finishedOn ?? '',
  coverId: g.coverId,
  cover: g.cover,
});

/**
 * Jogos (2026-11-09): add, edit and remove the games shown on /jogos. One form, used for a new
 * game or the one being edited; the list below opens a game for editing.
 */
export function GamesBoard({ initial }: { initial: GameRow[] }) {
  const id = useId();
  const [games, setGames] = useState(initial);
  const [editing, setEditing] = useState<GameRow | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  async function reload() {
    const r = await adminFetch<{ games: GameRow[] }>('/api/v1/admin/games');
    if (r.ok) setGames(r.data.games);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setToast(null);
    const body = {
      title: form.title,
      platform: form.platform.trim() || null,
      year: form.year ? Number(form.year) : null,
      status: form.status,
      note: form.note.trim() || null,
      vodUrl: form.vodUrl.trim() || null,
      finishedOn: form.status !== 'PLAYING' && form.finishedOn ? form.finishedOn : null,
      coverId: form.coverId,
    };
    const r = editing
      ? await adminFetch(`/api/v1/admin/games/${editing.id}`, {
          method: 'PATCH',
          body: { ...body, expectedVersion: editing.version },
        })
      : await adminFetch('/api/v1/admin/games', { method: 'POST', body });
    setBusy(false);
    if (r.ok) {
      setToast({ ok: true, text: editing ? 'Jogo salvo.' : 'Jogo adicionado.' });
      setEditing(null);
      setForm(empty);
      await reload();
    } else setToast({ ok: false, text: r.problem.detail });
  }

  async function remove(g: GameRow) {
    if (!window.confirm(`Tirar “${g.title}” da página Jogos?`)) return;
    setBusy(true);
    const r = await adminFetch(`/api/v1/admin/games/${g.id}`, { method: 'DELETE' });
    setBusy(false);
    setToast(r.ok ? { ok: true, text: 'Jogo removido.' } : { ok: false, text: r.problem.detail });
    if (editing?.id === g.id) {
      setEditing(null);
      setForm(empty);
    }
    await reload();
  }

  return (
    <div className="grid gap-4">
      {toast ? (
        <p role="status" className={toast.ok ? 'wf-toast wf-toast--ok' : 'wf-toast wf-toast--err'}>
          {toast.text}
        </p>
      ) : null}
      <form
        className="wf-ops-card wf-ops-form"
        aria-label={editing ? `Editar ${editing.title}` : 'Novo jogo'}
        onSubmit={(e) => void save(e)}
      >
        <h2 className="full">{editing ? `Editar “${editing.title}”` : 'Novo jogo'}</h2>
        <div className="wf-game-form__cover">
          <MediaDrop
            role="POSTER"
            label="Capa 2:3"
            hint="mínimo 600×900"
            className="wf-drop--poster"
            picture={form.cover}
            onUploaded={(coverId, cover) => set({ coverId, cover })}
            onClear={() => set({ coverId: null, cover: null })}
          />
        </div>
        <label className="wf-field full" htmlFor={`${id}-t`}>
          <span>Nome do jogo</span>
          <input
            id={`${id}-t`}
            className="wf-input"
            maxLength={120}
            value={form.title}
            onChange={(e) => set({ title: e.target.value })}
            required
          />
        </label>
        <label className="wf-field" htmlFor={`${id}-p`}>
          <span>Plataforma (opcional)</span>
          <input
            id={`${id}-p`}
            className="wf-input"
            maxLength={40}
            placeholder="PC, PS5, Switch…"
            value={form.platform}
            onChange={(e) => set({ platform: e.target.value })}
          />
        </label>
        <label className="wf-field" htmlFor={`${id}-y`}>
          <span>Ano (opcional)</span>
          <input
            id={`${id}-y`}
            type="number"
            min={1950}
            max={2100}
            className="wf-input"
            value={form.year}
            onChange={(e) => set({ year: e.target.value })}
          />
        </label>
        <label className="wf-field" htmlFor={`${id}-s`}>
          <span>Situação</span>
          <select
            id={`${id}-s`}
            className="wf-input"
            value={form.status}
            onChange={(e) => set({ status: e.target.value as Status })}
          >
            {(Object.keys(STATUS_PT) as Status[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_PT[s]}
              </option>
            ))}
          </select>
        </label>
        {form.status !== 'PLAYING' ? (
          <label className="wf-field" htmlFor={`${id}-f`}>
            <span>{form.status === 'FINISHED' ? 'Zerado em' : 'Dropado em'} (opcional)</span>
            <input
              id={`${id}-f`}
              type="date"
              className="wf-input"
              value={form.finishedOn}
              onChange={(e) => set({ finishedOn: e.target.value })}
            />
          </label>
        ) : null}
        <label className="wf-field full" htmlFor={`${id}-v`}>
          <span>Link do VOD (Twitch ou YouTube, opcional)</span>
          <input
            id={`${id}-v`}
            type="url"
            className="wf-input"
            maxLength={300}
            placeholder="https://www.twitch.tv/videos/…"
            value={form.vodUrl}
            onChange={(e) => set({ vodUrl: e.target.value })}
          />
        </label>
        <label className="wf-field full" htmlFor={`${id}-n`}>
          <span>Comentário (opcional)</span>
          <input
            id={`${id}-n`}
            className="wf-input"
            maxLength={140}
            value={form.note}
            onChange={(e) => set({ note: e.target.value })}
          />
        </label>
        <span className="wf-ops-actions full">
          <button type="submit" className="wf-btn wf-btn--sm wf-btn--neon" disabled={busy}>
            {editing ? 'Salvar jogo' : 'Adicionar jogo'}
          </button>
          {editing ? (
            <button
              type="button"
              className="wf-linkbtn text-xs"
              onClick={() => {
                setEditing(null);
                setForm(empty);
              }}
            >
              Cancelar
            </button>
          ) : null}
        </span>
      </form>

      <section className="wf-ops-card" aria-labelledby={`${id}-list`}>
        <h2 id={`${id}-list`}>Na página ({games.length})</h2>
        {games.length ? (
          <ul className="wf-ops-list">
            {games.map((g) => (
              <li key={g.id} className="wf-ops-row">
                {g.cover ? (
                  <span className="wf-ops-thumb">
                    <MediaPicture picture={g.cover} alt="" sizes="48px" />
                  </span>
                ) : null}
                <div className="wf-ops-row__main">
                  <span className="wf-ops-row__title">{g.title}</span>
                  <span className="wf-muted text-xs">
                    {STATUS_PT[g.status]}
                    {g.platform ? ` · ${g.platform}` : ''}
                    {g.year ? ` · ${g.year}` : ''}
                  </span>
                </div>
                <div className="wf-ops-actions">
                  <button
                    type="button"
                    className="wf-btn wf-btn--sm wf-btn--ghost"
                    disabled={busy}
                    onClick={() => {
                      setEditing(g);
                      setForm(formOf(g));
                      setToast(null);
                    }}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="wf-linkbtn text-xs"
                    disabled={busy}
                    onClick={() => void remove(g)}
                  >
                    Remover
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="wf-muted">Nenhum jogo ainda.</p>
        )}
      </section>
    </div>
  );
}
