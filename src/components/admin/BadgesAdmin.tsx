'use client';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { BadgeArt } from '@/components/badges/BadgeArt';
import { fmtDateTime, fromLocalInput, toLocalInput } from '@/lib/admin/types';
import { BADGE_DESCRIPTION_MAX, BADGE_NAME_MAX, type BadgeView } from '@/lib/badges';
import type { Picture } from '@/lib/media';
import { adminFetch } from '@/lib/passkey-client';
import { BadgeArtDrop } from './BadgeArtDrop';

type AdminBadge = BadgeView & { assetId: string };
type Draft = {
  id: string | null;
  assetId: string | null;
  picture: Picture | null;
  still: Picture | null;
  name: string;
  description: string;
  startsAt: string;
  endsAt: string;
  /** '' with keepCode: unchanged on an edit */
  code: string;
  keepCode: boolean;
  hadCode: boolean;
  maxClaims: string;
};

const STATE_PT = { open: 'Aberto', upcoming: 'Agendado', closed: 'Encerrado' } as const;

function emptyDraft(): Draft {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const end = new Date(now.getTime() + 6 * 3_600_000);
  return {
    id: null,
    assetId: null,
    picture: null,
    still: null,
    name: '',
    description: '',
    startsAt: toLocalInput(now.toISOString()),
    endsAt: toLocalInput(end.toISOString()),
    code: '',
    keepCode: false,
    hadCode: false,
    maxClaims: '',
  };
}

/**
 * Admin › Emblemas (2026-11-12): create a time-limited badge (art, name, story, the claim window in
 * Brasília time, an optional claim word said on stream, an optional limit), see who has how many,
 * edit, end early, or delete one nobody has claimed.
 */
export function BadgesAdmin({ badges }: { badges: AdminBadge[] }) {
  const id = useId();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function edit(b: AdminBadge) {
    setErrors({});
    setDraft({
      id: b.id,
      assetId: b.assetId,
      picture: b.picture,
      still: b.still,
      name: b.name,
      description: b.description,
      startsAt: toLocalInput(b.startsAt),
      endsAt: toLocalInput(b.endsAt),
      code: '',
      keepCode: b.needsCode,
      hadCode: b.needsCode,
      maxClaims: b.maxClaims === null ? '' : String(b.maxClaims),
    });
  }

  async function save(d: Draft) {
    if (!d.assetId) {
      setErrors({ assetId: 'Envie a arte do emblema.' });
      return;
    }
    setBusy(true);
    setToast(null);
    setErrors({});
    const body = {
      name: d.name,
      description: d.description,
      assetId: d.assetId,
      startsAt: fromLocalInput(d.startsAt),
      endsAt: fromLocalInput(d.endsAt),
      ...(d.id && d.keepCode && !d.code ? {} : { code: d.code.trim() ? d.code : null }),
      maxClaims: d.maxClaims.trim() ? Number(d.maxClaims) : null,
    };
    const r = await adminFetch<{ id: string; slug: string }>(
      d.id ? `/api/v1/admin/badges/${d.id}` : '/api/v1/admin/badges',
      { method: d.id ? 'PATCH' : 'POST', body },
    );
    setBusy(false);
    if (!r.ok) {
      const fieldErrors: Record<string, string> = {};
      for (const e of r.problem.errors ?? []) fieldErrors[e.path ?? ''] = e.message;
      setErrors(fieldErrors);
      setToast({ ok: false, text: r.problem.errors?.[0]?.message ?? r.problem.detail });
      return;
    }
    setDraft(null);
    setToast({ ok: true, text: d.id ? 'Emblema atualizado.' : `Emblema criado: /emblemas` });
    router.refresh();
  }

  async function act(b: AdminBadge, what: 'end' | 'delete') {
    if (
      what === 'delete' &&
      !window.confirm(`Apagar o emblema “${b.name}”? Isso não pode ser desfeito.`)
    )
      return;
    setBusy(true);
    const r = await adminFetch<unknown>(
      what === 'end' ? `/api/v1/admin/badges/${b.id}/end` : `/api/v1/admin/badges/${b.id}`,
      { method: what === 'end' ? 'POST' : 'DELETE' },
    );
    setBusy(false);
    setToast(
      r.ok
        ? { ok: true, text: what === 'end' ? `“${b.name}” encerrado.` : `“${b.name}” apagado.` }
        : { ok: false, text: r.problem.detail },
    );
    if (r.ok) router.refresh();
  }

  const field = (k: string) =>
    errors[k] ? (
      <span className="wf-hint wf-hint--err" role="alert">
        {errors[k]}
      </span>
    ) : null;

  return (
    <>
      {toast ? (
        <p role="status" className={toast.ok ? 'wf-toast wf-toast--ok' : 'wf-toast wf-toast--err'}>
          {toast.text}
        </p>
      ) : null}

      {draft ? (
        <form
          className="wf-ops-card wf-badge-form"
          aria-label={draft.id ? 'Editar emblema' : 'Novo emblema'}
          onSubmit={(e) => {
            e.preventDefault();
            void save(draft);
          }}
        >
          <h2>{draft.id ? 'Editar emblema' : 'Novo emblema'}</h2>
          <div className="wf-badge-form__grid">
            <div>
              <BadgeArtDrop
                picture={draft.picture}
                still={draft.still}
                onUploaded={(assetId, picture, still) =>
                  setDraft({ ...draft, assetId, picture, still })
                }
              />
              {field('assetId')}
            </div>
            <div className="wf-badge-form__fields">
              <label className="wf-field" htmlFor={`${id}-name`}>
                Nome
                <input
                  id={`${id}-name`}
                  className="wf-input"
                  value={draft.name}
                  maxLength={BADGE_NAME_MAX}
                  placeholder="Ex.: Maratona Senhor dos Anéis"
                  required
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
                {field('name')}
              </label>
              <label className="wf-field" htmlFor={`${id}-desc`}>
                História do emblema <small className="wf-muted">(opcional)</small>
                <textarea
                  id={`${id}-desc`}
                  className="wf-input"
                  rows={2}
                  value={draft.description}
                  maxLength={BADGE_DESCRIPTION_MAX}
                  placeholder="Ex.: Para quem aguentou as 12 horas da trilogia estendida."
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
                {field('description')}
              </label>
              <div className="wf-badge-form__row">
                <label className="wf-field" htmlFor={`${id}-start`}>
                  Abre em (Brasília)
                  <input
                    id={`${id}-start`}
                    type="datetime-local"
                    className="wf-input"
                    value={draft.startsAt}
                    required
                    onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })}
                  />
                  {field('startsAt')}
                </label>
                <label className="wf-field" htmlFor={`${id}-end`}>
                  Fecha em (Brasília)
                  <input
                    id={`${id}-end`}
                    type="datetime-local"
                    className="wf-input"
                    value={draft.endsAt}
                    required
                    onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })}
                  />
                  {field('endsAt')}
                </label>
              </div>
              <div className="wf-badge-form__row">
                <label className="wf-field" htmlFor={`${id}-code`}>
                  Palavra do evento <small className="wf-muted">(opcional)</small>
                  <input
                    id={`${id}-code`}
                    className="wf-input"
                    value={draft.code}
                    maxLength={60}
                    autoComplete="off"
                    placeholder={
                      draft.keepCode
                        ? 'Mantida (escreva para trocar)'
                        : 'Dita na live; sem ela, livre'
                    }
                    onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                  />
                  {field('code')}
                  {draft.id && draft.hadCode ? (
                    <span className="wf-check">
                      <input
                        id={`${id}-nocode`}
                        type="checkbox"
                        checked={!draft.keepCode && !draft.code}
                        onChange={(e) =>
                          setDraft({ ...draft, keepCode: !e.target.checked, code: '' })
                        }
                      />
                      <label htmlFor={`${id}-nocode`}>Tirar a palavra</label>
                    </span>
                  ) : null}
                </label>
                <label className="wf-field" htmlFor={`${id}-max`}>
                  Limite de resgates <small className="wf-muted">(opcional)</small>
                  <input
                    id={`${id}-max`}
                    type="number"
                    min={1}
                    inputMode="numeric"
                    className="wf-input"
                    value={draft.maxClaims}
                    placeholder="Sem limite"
                    onChange={(e) => setDraft({ ...draft, maxClaims: e.target.value })}
                  />
                  {field('maxClaims')}
                </label>
              </div>
              <div className="wf-chat-actions">
                <button type="submit" className="wf-btn wf-btn--neon" disabled={busy}>
                  {draft.id ? 'Salvar' : 'Criar emblema'}
                </button>
                <button
                  type="button"
                  className="wf-btn wf-btn--ghost"
                  onClick={() => setDraft(null)}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="wf-btn wf-btn--neon"
          onClick={() => {
            setErrors({});
            setDraft(emptyDraft());
          }}
        >
          Novo emblema
        </button>
      )}

      <section className="wf-ops-card" aria-labelledby={`${id}-list`}>
        <h2 id={`${id}-list`}>Todos os emblemas</h2>
        {badges.length ? (
          <ul className="wf-ops-list">
            {badges.map((b) => (
              <li key={b.id} className="wf-ops-row wf-badge-row">
                <BadgeArt picture={b.picture} still={b.still} name={b.name} size={64} />
                <div className="wf-ops-row__main">
                  <span className="wf-ops-row__title">
                    {b.name}{' '}
                    <span className={`wf-badge-state wf-badge-state--${b.state}`}>
                      {STATE_PT[b.state]}
                    </span>
                  </span>
                  <span className="wf-muted">
                    {fmtDateTime(b.startsAt)} → {fmtDateTime(b.endsAt)} ·{' '}
                    {b.claims === 1 ? '1 resgate' : `${b.claims} resgates`}
                    {b.maxClaims ? ` de ${b.maxClaims}` : ''}
                    {b.needsCode ? ' · com palavra' : ''}
                  </span>
                </div>
                <div className="wf-chat-preset__actions">
                  <button
                    type="button"
                    className="wf-btn wf-btn--ghost wf-btn--sm"
                    onClick={() => edit(b)}
                  >
                    Editar<span className="sr-only"> {b.name}</span>
                  </button>
                  {b.state !== 'closed' ? (
                    <button
                      type="button"
                      className="wf-btn wf-btn--ghost wf-btn--sm"
                      disabled={busy}
                      onClick={() => void act(b, 'end')}
                    >
                      Encerrar agora<span className="sr-only"> {b.name}</span>
                    </button>
                  ) : null}
                  {b.claims === 0 ? (
                    <button
                      type="button"
                      className="wf-btn wf-btn--ghost wf-btn--sm wf-chat-del"
                      disabled={busy}
                      onClick={() => void act(b, 'delete')}
                    >
                      Apagar<span className="sr-only"> {b.name}</span>
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="wf-muted">Nenhum emblema ainda. Crie o primeiro para o próximo evento.</p>
        )}
      </section>
    </>
  );
}
