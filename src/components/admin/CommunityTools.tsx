'use client';
import { useId, useState } from 'react';
import { fmtDateTime } from '@/lib/admin/types';
import { LINK_LABEL_MAX, LINK_NOTE_MAX } from '@/lib/links';
import { adminFetch } from '@/lib/passkey-client';

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

const KIND_PT = { MOVIE: 'Filme', SERIES: 'Série', FRANCHISE: 'Franquia' } as const;

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

type Status = 'NEW' | 'ACCEPTED' | 'DISMISSED';
export type AdminSuggestion = {
  id: string;
  kind: 'MOVIE' | 'SERIES' | 'FRANCHISE';
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
