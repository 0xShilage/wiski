'use client';
import { useId, useState } from 'react';
import { fmtDateTime } from '@/lib/admin/types';
import { LINK_LABEL_MAX, LINK_NOTE_MAX } from '@/lib/links';
import type { Picture } from '@/lib/media';
import { adminFetch } from '@/lib/passkey-client';
import { MediaDrop } from './MediaDrop';

/** Phase 6 dashboard panels: the Links page (streamer) and viewer suggestions (moderation). */

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

const KIND_PT = {
  MOVIE: 'Filme',
  SERIES: 'Série',
  FRANCHISE: 'Franquia',
  ANIME: 'Anime',
  GAME: 'Jogo',
} as const;

// ── Links ─────────────────────────────────────────────────────────────────────

export type AdminLink = {
  id: string;
  label: string;
  note: string | null;
  url: string;
  visible: boolean;
  position: number;
  platform: string | null;
  host: string;
};

type LinkForm = { label: string; note: string; url: string };
const EMPTY: LinkForm = { label: '', note: '', url: '' };

function LinkFields({
  id,
  form,
  onChange,
}: {
  id: string;
  form: LinkForm;
  onChange: (f: LinkForm) => void;
}) {
  return (
    <>
      <label className="wf-field" htmlFor={`${id}-l`}>
        <span>Nome do botão</span>
        <input
          id={`${id}-l`}
          className="wf-input"
          maxLength={LINK_LABEL_MAX}
          placeholder="Twitch"
          value={form.label}
          onChange={(e) => onChange({ ...form, label: e.target.value })}
          required
        />
      </label>
      <label className="wf-field" htmlFor={`${id}-u`}>
        <span>Endereço (https://)</span>
        <input
          id={`${id}-u`}
          className="wf-input"
          type="url"
          inputMode="url"
          maxLength={300}
          placeholder="https://twitch.tv/seu_canal"
          value={form.url}
          onChange={(e) => onChange({ ...form, url: e.target.value })}
          required
        />
      </label>
      <label className="wf-field" htmlFor={`${id}-n`}>
        <span>Linha de apoio (opcional)</span>
        <input
          id={`${id}-n`}
          className="wf-input"
          maxLength={LINK_NOTE_MAX}
          placeholder="Lives de terça a sábado"
          value={form.note}
          onChange={(e) => onChange({ ...form, note: e.target.value })}
        />
      </label>
    </>
  );
}

export function LinksPanel({ initial }: { initial: AdminLink[] }) {
  const id = useId();
  const { busy, act, view } = useAct();
  const [links, setLinks] = useState(initial);
  const [form, setForm] = useState<LinkForm>(EMPTY);
  const [editing, setEditing] = useState<{ id: string; form: LinkForm } | null>(null);

  async function reload() {
    const r = await adminFetch<{ links: AdminLink[] }>('/api/v1/admin/links');
    if (r.ok) setLinks(r.data.links);
  }
  async function move(index: number, by: -1 | 1) {
    const ids = links.map((l) => l.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved!);
    const r = await act<{ links: AdminLink[] }>('Ordem salva', '/api/v1/admin/links/order', {
      method: 'PUT',
      body: { ids },
    });
    if (r.ok) setLinks(r.data.links);
    else await reload();
  }

  return (
    <>
      {view}
      <form
        className="wf-ops-card"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await act('Link adicionado', '/api/v1/admin/links', {
            method: 'POST',
            body: { label: form.label, url: form.url, note: form.note || null },
          });
          if (r.ok) setForm(EMPTY);
          await reload();
        }}
      >
        <h2>Novo link</h2>
        <div className="wf-ops-form">
          <LinkFields id={id} form={form} onChange={setForm} />
          <button type="submit" className="wf-btn wf-btn--neon" disabled={busy}>
            Adicionar
          </button>
        </div>
      </form>

      <ol className="wf-ops-list" aria-label="Links, na ordem da página">
        {links.map((l, i) => (
          <li key={l.id} className="wf-ops-card">
            {editing?.id === l.id ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const r = await act('Link salvo', `/api/v1/admin/links/${l.id}`, {
                    method: 'PATCH',
                    body: {
                      label: editing.form.label,
                      url: editing.form.url,
                      note: editing.form.note || null,
                    },
                  });
                  if (r.ok) setEditing(null);
                  await reload();
                }}
              >
                <div className="wf-ops-form">
                  <LinkFields
                    id={`${id}-${l.id}`}
                    form={editing.form}
                    onChange={(f) => setEditing({ id: l.id, form: f })}
                  />
                  <button type="submit" className="wf-btn wf-btn--neon" disabled={busy}>
                    Salvar
                  </button>
                  <button
                    type="button"
                    className="wf-btn wf-btn--ghost"
                    onClick={() => setEditing(null)}
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="wf-ops-row__main">
                  <span className="wf-ops-row__title">
                    {i + 1}. {l.label}{' '}
                    {l.visible ? null : <span className="wf-pill wf-pill--warn">Oculto</span>}
                  </span>
                  <span className="wf-muted text-xs wf-break">
                    {l.platform ? `${l.platform} · ` : ''}
                    {l.url}
                    {l.note ? ` · ${l.note}` : ''}
                  </span>
                </div>
                <div className="wf-ops-actions">
                  <button
                    type="button"
                    className="wf-btn wf-btn--sm wf-btn--ghost"
                    disabled={busy || i === 0}
                    aria-label={`Subir ${l.label}`}
                    onClick={() => void move(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="wf-btn wf-btn--sm wf-btn--ghost"
                    disabled={busy || i === links.length - 1}
                    aria-label={`Descer ${l.label}`}
                    onClick={() => void move(i, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="wf-btn wf-btn--sm wf-btn--ghost"
                    disabled={busy}
                    onClick={() =>
                      setEditing({
                        id: l.id,
                        form: { label: l.label, url: l.url, note: l.note ?? '' },
                      })
                    }
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="wf-btn wf-btn--sm wf-btn--ghost"
                    disabled={busy}
                    onClick={async () => {
                      await act(
                        l.visible ? 'Link ocultado' : 'Link visível',
                        `/api/v1/admin/links/${l.id}`,
                        { method: 'PATCH', body: { visible: !l.visible } },
                      );
                      await reload();
                    }}
                  >
                    {l.visible ? 'Ocultar' : 'Mostrar'}
                  </button>
                  <button
                    type="button"
                    className="wf-linkbtn text-xs"
                    disabled={busy}
                    onClick={async () => {
                      if (!window.confirm(`Apagar o link "${l.label}"?`)) return;
                      await act('Link apagado', `/api/v1/admin/links/${l.id}`, {
                        method: 'DELETE',
                      });
                      await reload();
                    }}
                  >
                    Apagar
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ol>
      {links.length ? null : (
        <p className="wf-muted">
          Nenhum link ainda. A página /links mostra uma mensagem de espera.
        </p>
      )}
    </>
  );
}

// ── Suggestions ───────────────────────────────────────────────────────────────

type Status = 'NEW' | 'ACCEPTED' | 'DISMISSED' | 'WATCHED';
export type AdminSuggestion = {
  id: string;
  kind: 'MOVIE' | 'SERIES' | 'FRANCHISE' | 'ANIME' | 'GAME';
  title: string;
  year: number | null;
  note: string | null;
  status: Status;
  createdAt: string;
  reviewedAt: string | null;
  author: string | null;
  reviewer: string | null;
  alsoSuggested: number;
};
type Page = { suggestions: AdminSuggestion[]; next: string | null; waiting: number };

export function SuggestionsBoard({ initial }: { initial: Page }) {
  const { busy, act, view } = useAct();
  const [page, setPage] = useState(initial);
  const [status, setStatus] = useState<Status>('NEW');

  async function reload(s = status, before?: string) {
    const q = new URLSearchParams({ status: s, ...(before ? { before } : {}) });
    const r = await adminFetch<Page>(`/api/v1/admin/suggestions?${q}`);
    if (r.ok) {
      setPage(
        before ? { ...r.data, suggestions: [...page.suggestions, ...r.data.suggestions] } : r.data,
      );
    }
  }
  async function decide(s: AdminSuggestion, to: Status) {
    await act(
      to === 'ACCEPTED'
        ? 'Sugestão aceita'
        : to === 'DISMISSED'
          ? 'Sugestão dispensada'
          : to === 'WATCHED'
            ? 'Marcada como já assistida'
            : 'Reaberta',
      `/api/v1/admin/suggestions/${s.id}`,
      { method: 'PATCH', body: { status: to, expectedStatus: s.status } },
    );
    await reload();
  }

  return (
    <>
      {view}
      <div className="wf-seg" role="group" aria-label="Situação">
        {(
          [
            ['NEW', `Novas${page.waiting ? ` (${page.waiting})` : ''}`],
            ['ACCEPTED', 'Aceitas'],
            ['WATCHED', 'Já assistidas'],
            ['DISMISSED', 'Dispensadas'],
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
        {page.suggestions.map((s) => (
          <li key={s.id} className="wf-ops-card">
            <div className="wf-ops-row__main">
              <span className="wf-ops-row__title">
                {s.title}
                {s.year ? ` (${s.year})` : ''} <span className="wf-pill">{KIND_PT[s.kind]}</span>
                {s.alsoSuggested ? (
                  <span className="wf-pill wf-pill--warn">
                    +{s.alsoSuggested} {s.alsoSuggested === 1 ? 'pessoa pediu' : 'pessoas pediram'}
                  </span>
                ) : null}
              </span>
              <span className="wf-muted text-xs">
                @{s.author ?? 'removido'} · {fmtDateTime(s.createdAt)}
                {s.reviewedAt
                  ? ` · decidida por @${s.reviewer ?? 'removido'} em ${fmtDateTime(s.reviewedAt)}`
                  : ''}
              </span>
            </div>
            {s.note ? <p className="wf-review__body">{s.note}</p> : null}
            <div className="wf-ops-actions">
              {s.status !== 'ACCEPTED' ? (
                <button
                  type="button"
                  className="wf-btn wf-btn--sm wf-btn--neon"
                  disabled={busy}
                  onClick={() => void decide(s, 'ACCEPTED')}
                >
                  Aceitar
                </button>
              ) : null}
              {s.status !== 'WATCHED' ? (
                <button
                  type="button"
                  className="wf-btn wf-btn--sm wf-btn--ghost"
                  disabled={busy}
                  onClick={() => void decide(s, 'WATCHED')}
                >
                  Já assistido
                </button>
              ) : null}
              {s.status !== 'DISMISSED' ? (
                <button
                  type="button"
                  className="wf-btn wf-btn--sm wf-btn--ghost"
                  disabled={busy}
                  onClick={() => void decide(s, 'DISMISSED')}
                >
                  Dispensar
                </button>
              ) : null}
              {s.status !== 'NEW' ? (
                <button
                  type="button"
                  className="wf-linkbtn text-xs"
                  disabled={busy}
                  onClick={() => void decide(s, 'NEW')}
                >
                  Reabrir
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {page.suggestions.length ? null : <p className="wf-muted">Nenhuma sugestão aqui.</p>}
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

// ── Estreias ("Próximas temporadas") ─────────────────────────────────────────

export type AdminReleaseRow = {
  id: string;
  itemId: string | null;
  itemTitle: string | null;
  title: string;
  seasonLabel: string;
  releaseDate: string;
  yearOnly: boolean;
  note: string | null;
  posterId: string | null;
  poster: Picture | null;
  editor: string | null;
  updatedAt: string;
};
type SeriesOption = { id: string; title: string; status: string };
type ReleaseForm = {
  itemId: string;
  title: string;
  seasonLabel: string;
  /** only the year is known */
  yearOnly: boolean;
  releaseDate: string;
  releaseYear: string;
  note: string;
  posterId: string | null;
  poster: Picture | null;
};
const EMPTY_RELEASE: ReleaseForm = {
  itemId: '',
  title: '',
  seasonLabel: '',
  yearOnly: false,
  releaseDate: '',
  releaseYear: '',
  note: '',
  posterId: null,
  poster: null,
};
const dayFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});

function ReleaseFields({
  id,
  form,
  series,
  onChange,
}: {
  id: string;
  form: ReleaseForm;
  series: SeriesOption[];
  onChange: (f: ReleaseForm) => void;
}) {
  return (
    <>
      <label className="wf-field" htmlFor={`${id}-s`}>
        <span>Série do catálogo (opcional)</span>
        <select
          id={`${id}-s`}
          className="wf-ops-select"
          value={form.itemId}
          onChange={(e) => onChange({ ...form, itemId: e.target.value })}
        >
          <option value="">Outra série (digite o nome)</option>
          {series.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
              {s.status === 'DRAFT' ? ' (rascunho)' : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="wf-field" htmlFor={`${id}-t`}>
        <span>{form.itemId ? 'Nome (opcional: usa o do catálogo)' : 'Nome da série'}</span>
        <input
          id={`${id}-t`}
          className="wf-input"
          maxLength={120}
          value={form.title}
          required={!form.itemId}
          onChange={(e) => onChange({ ...form, title: e.target.value })}
        />
      </label>
      <label className="wf-field" htmlFor={`${id}-l`}>
        <span>Temporada</span>
        <input
          id={`${id}-l`}
          className="wf-input"
          maxLength={40}
          placeholder="Temporada 3"
          value={form.seasonLabel}
          required
          onChange={(e) => onChange({ ...form, seasonLabel: e.target.value })}
        />
      </label>
      {form.yearOnly ? (
        <label className="wf-field" htmlFor={`${id}-y`}>
          <span>Ano previsto</span>
          <input
            id={`${id}-y`}
            type="number"
            inputMode="numeric"
            className="wf-input"
            min={2000}
            max={2100}
            step={1}
            placeholder={String(new Date().getFullYear() + 1)}
            value={form.releaseYear}
            required
            onChange={(e) => onChange({ ...form, releaseYear: e.target.value })}
          />
        </label>
      ) : (
        <label className="wf-field" htmlFor={`${id}-d`}>
          <span>Data de estreia</span>
          <input
            id={`${id}-d`}
            type="date"
            className="wf-input"
            min="2000-01-01"
            max="2100-12-31"
            value={form.releaseDate}
            required
            onChange={(e) => onChange({ ...form, releaseDate: e.target.value })}
          />
        </label>
      )}
      <label className="wf-check" htmlFor={`${id}-yo`}>
        <input
          id={`${id}-yo`}
          type="checkbox"
          checked={form.yearOnly}
          onChange={(e) => onChange({ ...form, yearOnly: e.target.checked })}
        />
        <span>Só sei o ano</span>
      </label>
      <label className="wf-field" htmlFor={`${id}-n`}>
        <span>Observação (opcional)</span>
        <input
          id={`${id}-n`}
          className="wf-input"
          maxLength={80}
          placeholder="Netflix · data a confirmar"
          value={form.note}
          onChange={(e) => onChange({ ...form, note: e.target.value })}
        />
      </label>
      <div className="wf-field wf-rel-poster">
        <span>Pôster (opcional)</span>
        <MediaDrop
          role="POSTER"
          label="Pôster 2:3"
          hint="mínimo 600×900; sem pôster, usa o da série do catálogo"
          className="wf-drop--poster"
          picture={form.poster}
          onUploaded={(posterId, poster) => onChange({ ...form, posterId, poster })}
          onClear={() => onChange({ ...form, posterId: null, poster: null })}
        />
        <span className="wf-muted text-xs">
          Sem pôster próprio, a série do catálogo empresta o dela (quando já é pública).
        </span>
      </div>
    </>
  );
}

const releaseBody = (f: ReleaseForm) => ({
  itemId: f.itemId || null,
  title: f.title.trim() || null,
  seasonLabel: f.seasonLabel,
  ...(f.yearOnly ? { releaseYear: Number(f.releaseYear) } : { releaseDate: f.releaseDate }),
  note: f.note.trim() || null,
  posterId: f.posterId,
});

export function ReleasesPanel({
  initial,
}: {
  initial: { releases: AdminReleaseRow[]; series: SeriesOption[] };
}) {
  const id = useId();
  const { busy, act, view } = useAct();
  const [data, setData] = useState(initial);
  const [form, setForm] = useState<ReleaseForm>(EMPTY_RELEASE);
  const [editing, setEditing] = useState<{ id: string; form: ReleaseForm } | null>(null);

  async function reload() {
    const r = await adminFetch<typeof initial>('/api/v1/admin/releases');
    if (r.ok) setData(r.data);
  }

  return (
    <>
      {view}
      <form
        className="wf-ops-card"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await act('Estreia adicionada', '/api/v1/admin/releases', {
            method: 'POST',
            body: releaseBody(form),
          });
          if (r.ok) setForm(EMPTY_RELEASE);
          await reload();
        }}
      >
        <h2>Nova estreia</h2>
        <div className="wf-ops-form">
          <ReleaseFields id={id} form={form} series={data.series} onChange={setForm} />
          <button type="submit" className="wf-btn wf-btn--neon" disabled={busy}>
            Adicionar
          </button>
        </div>
      </form>

      <ul className="wf-ops-list" aria-label="Estreias, da mais próxima à mais distante">
        {data.releases.map((r) => (
          <li key={r.id} className="wf-ops-card">
            {editing?.id === r.id ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const res = await act('Estreia salva', `/api/v1/admin/releases/${r.id}`, {
                    method: 'PATCH',
                    body: releaseBody(editing.form),
                  });
                  if (res.ok) setEditing(null);
                  await reload();
                }}
              >
                <div className="wf-ops-form">
                  <ReleaseFields
                    id={`${id}-${r.id}`}
                    form={editing.form}
                    series={data.series}
                    onChange={(f) => setEditing({ id: r.id, form: f })}
                  />
                  <button type="submit" className="wf-btn wf-btn--neon" disabled={busy}>
                    Salvar
                  </button>
                  <button
                    type="button"
                    className="wf-btn wf-btn--ghost"
                    onClick={() => setEditing(null)}
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="wf-ops-row__main">
                  <span className="wf-ops-row__title">
                    {r.title} · {r.seasonLabel}{' '}
                    {r.itemId ? <span className="wf-pill">No catálogo</span> : null}
                    {r.posterId ? <span className="wf-pill">Pôster próprio</span> : null}
                  </span>
                  <span className="wf-muted text-xs">
                    {r.yearOnly
                      ? `Previsão: ${r.releaseDate.slice(0, 4)}`
                      : `Estreia em ${dayFmt.format(new Date(`${r.releaseDate}T12:00:00Z`))}`}
                    {r.note ? ` · ${r.note}` : ''} · editado por @{r.editor ?? 'removido'}
                  </span>
                </div>
                <div className="wf-ops-actions">
                  <button
                    type="button"
                    className="wf-btn wf-btn--sm wf-btn--ghost"
                    disabled={busy}
                    onClick={() =>
                      setEditing({
                        id: r.id,
                        form: {
                          itemId: r.itemId ?? '',
                          title: r.title,
                          seasonLabel: r.seasonLabel,
                          yearOnly: r.yearOnly,
                          releaseDate: r.yearOnly ? '' : r.releaseDate,
                          releaseYear: r.yearOnly ? r.releaseDate.slice(0, 4) : '',
                          note: r.note ?? '',
                          posterId: r.posterId,
                          poster: r.poster,
                        },
                      })
                    }
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="wf-linkbtn text-xs"
                    disabled={busy}
                    onClick={async () => {
                      if (!window.confirm(`Apagar a estreia de "${r.title}"?`)) return;
                      await act('Estreia apagada', `/api/v1/admin/releases/${r.id}`, {
                        method: 'DELETE',
                      });
                      await reload();
                    }}
                  >
                    Apagar
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {data.releases.length ? null : (
        <p className="wf-muted">
          Nenhuma estreia cadastrada. O Cronograma mostra uma mensagem de espera.
        </p>
      )}
    </>
  );
}
