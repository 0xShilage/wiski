'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { HeroCarousel } from '@/components/catalog/HeroCarousel';
import { IconClose } from '@/components/ui/icons';
import { AGE_LABEL, AGE_RATINGS } from '@/lib/catalog/age-rating';
import {
  DEFAULT_CAMPAIGN_DAYS,
  formatBRL,
  franchiseGoalCents,
  moviePriceCents,
  seriesGoalCents,
} from '@/lib/catalog/pricing';
import type { PublicItem } from '@/lib/catalog/types';
import { parseYoutubeId } from '@/lib/catalog/youtube';
import type { Picture } from '@/lib/media';
import type { Problem } from '@/lib/api-fetch';
import { adminFetch } from '@/lib/passkey-client';
import { MediaDrop } from './MediaDrop';
import {
  type AdminItem,
  type AdminListItem,
  emptyForm,
  fieldsFrom,
  type Form,
  formFrom,
  KIND_UI,
  type Kind,
} from './types';

type Msg = { kind: 'ok' | 'err'; text: string; conflict?: boolean } | null;

const relTime = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
};
const chars = (s: string) => Array.from(s).length;
const NOTE: Record<string, string> = { create: 'criado', save: 'salvo' };
const noteLabel = (n: string) =>
  n.startsWith('revert:') ? `revertido para v${n.slice(7)}` : (NOTE[n] ?? n);

/** The editor panel (11 §4): every field, live price/goal, trailer check, images, actions. */
export function ItemEditor({
  kind,
  item,
  newSlot,
  role,
  drafts,
  onChanged,
  onDeleted,
}: {
  kind: Kind;
  item: AdminItem | null;
  newSlot: number | null;
  role: 'MODERATOR' | 'STREAMER' | 'USER';
  drafts: AdminListItem[];
  /** after any successful write: the fresh item (or null to just reload the board) */
  onChanged: (item: AdminItem | null) => void;
  onDeleted: () => void;
}) {
  const [form, setForm] = useState<Form>(() => (item ? formFrom(item) : emptyForm(newSlot)));
  const [pics, setPics] = useState<Record<'poster' | 'backdrop' | 'logo', Picture | null>>(() => ({
    poster: item?.media.poster ?? null,
    backdrop: item?.media.backdrop ?? null,
    logo: item?.media.logo ?? null,
  }));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [goal, setGoal] = useState('');
  const [days, setDays] = useState(String(DEFAULT_CAMPAIGN_DAYS));
  const [replaceWith, setReplaceWith] = useState('');
  const preview = useRef<HTMLDialogElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loadedVersion, setLoadedVersion] = useState(item?.version ?? 0);

  // A new version from the server (save, revert, another action) replaces the form — unless the
  // moderator has unsaved edits, which are never overwritten silently. (State adjusted during
  // render, React's pattern for state derived from props.)
  if (item && item.version !== loadedVersion && !dirty) {
    setLoadedVersion(item.version);
    setForm(formFrom(item));
    setPics({ poster: item.media.poster, backdrop: item.media.backdrop, logo: item.media.logo });
  }

  useEffect(() => {
    const d = preview.current;
    if (!d) return;
    if (previewOpen && !d.open) d.showModal();
    if (!previewOpen && d.open) d.close();
  }, [previewOpen]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };
  const isNew = !item;
  const status = item?.status ?? 'DRAFT';
  const isDraft = status === 'DRAFT';
  const live = !isDraft && status !== 'ARCHIVED';
  const ui = KIND_UI[kind];

  const runtime = Number(form.runtimeMinutes);
  const money = useMemo(() => {
    try {
      if (kind === 'MOVIE') return { label: 'Preço calculado', cents: moviePriceCents(runtime) };
      if (kind === 'SERIES')
        return { label: 'Meta pela fórmula', cents: seriesGoalCents(Number(form.seasonCount)) };
      const films = form.films
        .filter((f) => f.title.trim())
        .map((f) => ({ runtimeMinutes: Number(f.runtimeMinutes) }));
      return { label: 'Meta pela fórmula', cents: franchiseGoalCents(films) };
    } catch {
      return null;
    }
  }, [kind, runtime, form.seasonCount, form.films]);
  const ytId = form.trailer.trim() ? parseYoutubeId(form.trailer) : null;

  function fail(p: Problem) {
    const fieldErrors: Record<string, string> = {};
    for (const e of p.errors ?? [])
      fieldErrors[e.path.replace(/^fields\./, '').split('.')[0]!] = e.message;
    setErrors(fieldErrors);
    setMsg({ kind: 'err', text: p.detail, conflict: p.code === 'VERSION_CONFLICT' });
  }

  async function call<T>(path: string, init: Parameters<typeof adminFetch>[1], ok: string) {
    setBusy(true);
    setMsg(null);
    setErrors({});
    const res = await adminFetch<T>(path, init);
    setBusy(false);
    if (!res.ok) {
      fail(res.problem);
      return null;
    }
    setMsg({ kind: 'ok', text: ok });
    return res.data;
  }

  /** Save; returns the fresh item (null on failure). */
  async function save(): Promise<AdminItem | null> {
    const fields = fieldsFrom(form, kind, isDraft);
    const data = isNew
      ? await call<{ item: AdminItem }>(
          '/api/v1/admin/catalog/items',
          {
            method: 'POST',
            body: {
              kind,
              ...fields,
              runtimeMinutes:
                kind === 'FRANCHISE'
                  ? Math.max(
                      1,
                      form.films.reduce((s, f) => s + (Number(f.runtimeMinutes) || 0), 0),
                    )
                  : Number(form.runtimeMinutes) || 0,
            },
          },
          'Rascunho criado.',
        )
      : await call<{ item: AdminItem }>(
          `/api/v1/admin/catalog/items/${item.id}`,
          { method: 'PATCH', body: { expectedVersion: item.version, fields } },
          live ? 'Alterações publicadas (no ar).' : 'Rascunho salvo.',
        );
    if (data) {
      setDirty(false);
      onChanged(data.item);
    }
    return data?.item ?? null;
  }

  async function publish() {
    const current = dirty || isNew ? await save() : item;
    if (!current) return;
    const data = await call<{ item: AdminItem }>(
      `/api/v1/admin/catalog/items/${current.id}/publish`,
      { method: 'POST', body: { expectedVersion: current.version } },
      'Publicado: o filme já aparece no carrossel.',
    );
    if (data) onChanged(data.item);
  }

  async function openCampaign() {
    const current = dirty || isNew ? await save() : item;
    if (!current) return;
    const goalCents = goal.trim() ? Math.round(Number(goal.replace(',', '.')) * 100) : undefined;
    const data = await call<{ item: AdminItem }>(
      `/api/v1/admin/campaigns/${current.id}/open`,
      {
        method: 'POST',
        body: {
          expectedVersion: current.version,
          days: Number(days),
          ...(goalCents ? { goalCents } : {}),
        },
      },
      'Campanha aberta.',
    );
    if (data) onChanged(data.item);
  }

  async function simple(
    path: string,
    body: unknown,
    ok: string,
    confirmText?: string,
  ): Promise<boolean> {
    if (confirmText && !window.confirm(confirmText)) return false;
    const data = await call<{ item?: AdminItem }>(
      path,
      { method: 'POST', ...(body === undefined ? {} : { body }) },
      ok,
    );
    if (data) onChanged(data.item ?? null);
    return !!data;
  }

  const previewItem: PublicItem = {
    id: item?.id ?? 'preview',
    kind,
    slug: item?.slug ?? 'previa',
    slot: 1,
    title: form.title || 'Sem título',
    originalTitle: form.originalTitle || null,
    year: Number(form.year) || null,
    runtimeMinutes: runtime || 1,
    ageRating: form.ageRating || null,
    genres: form.genres
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean),
    synopsis: form.synopsis,
    director: form.director || null,
    cast: [],
    seasonsLabel: form.seasonsLabel || null,
    seasonCount: Number(form.seasonCount) || null,
    episodeCount: Number(form.episodeCount) || null,
    trailerYoutubeId: ytId,
    poster: pics.poster,
    backdrop: pics.backdrop,
    logo: pics.logo,
    state: 'ACTIVE',
    watchedAt: null,
    priceCents: kind === 'MOVIE' && money ? money.cents : null,
    sponsorName: null,
    campaign: null,
    films: [],
  };

  const err = (k: string) =>
    errors[k] ? (
      <span className="wf-hint wf-hint--err" id={`e-${k}`}>
        {errors[k]}
      </span>
    ) : null;
  const inv = (k: string) =>
    errors[k] ? { 'aria-invalid': true as const, 'aria-describedby': `e-${k}` } : {};
  const missing = item?.missing ?? [];

  return (
    <div>
      <div className="wf-editor__head">
        <h2>
          {isNew ? ui.nova : `Editar ${ui.one}`}
          {form.slot || item?.slot
            ? ` · vaga ${String(item?.slot ?? form.slot).padStart(2, '0')}`
            : ''}
        </h2>
        {item ? (
          <span className="wf-hint">
            versão {item.version} · salvo {relTime(item.updatedAt)}
            {dirty ? ' · alterações não salvas' : ''}
          </span>
        ) : null}
      </div>
      {live ? (
        <p className="wf-hint mt-2">
          Este título está no ar: salvar publica as alterações na hora (o histórico permite
          reverter).
        </p>
      ) : null}

      <form
        className="wf-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        noValidate
      >
        <label className="wf-field full">
          Título
          <input
            className="wf-input"
            value={form.title}
            maxLength={120}
            required
            onChange={(e) => set('title', e.target.value)}
            {...inv('title')}
          />
          {err('title')}
        </label>
        <label className="wf-field">
          Título original
          <input
            className="wf-input"
            value={form.originalTitle}
            maxLength={120}
            onChange={(e) => set('originalTitle', e.target.value)}
          />
        </label>
        <label className="wf-field">
          Ano
          <input
            className="wf-input"
            inputMode="numeric"
            value={form.year}
            maxLength={4}
            onChange={(e) => set('year', e.target.value)}
            {...inv('year')}
          />
          {err('year')}
        </label>
        {kind !== 'FRANCHISE' ? (
          <label className="wf-field">
            {kind === 'MOVIE' ? 'Duração (minutos)' : 'Duração total (minutos)'}
            <input
              className="wf-input"
              inputMode="numeric"
              value={form.runtimeMinutes}
              maxLength={5}
              onChange={(e) => set('runtimeMinutes', e.target.value)}
              {...inv('runtimeMinutes')}
            />
            {err('runtimeMinutes')}
          </label>
        ) : null}
        <label className="wf-field">
          Classificação indicativa
          <select
            className="wf-input"
            value={form.ageRating}
            onChange={(e) => set('ageRating', e.target.value as Form['ageRating'])}
            {...inv('ageRating')}
          >
            <option value="">Escolha…</option>
            {AGE_RATINGS.map((r) => (
              <option key={r} value={r}>
                {r === 'L' ? 'L — livre' : `${AGE_LABEL[r]} anos`}
              </option>
            ))}
          </select>
          {err('ageRating')}
        </label>
        {money ? (
          <p className="full m-0 text-sm" aria-live="polite">
            {money.label}: <b className="text-lavender">{formatBRL(money.cents)}</b>
          </p>
        ) : null}

        {kind === 'SERIES' ? (
          <>
            <label className="wf-field">
              Temporadas incluídas
              <input
                className="wf-input"
                value={form.seasonsLabel}
                maxLength={60}
                placeholder="Temporadas 1–3"
                onChange={(e) => set('seasonsLabel', e.target.value)}
                {...inv('seasonsLabel')}
              />
              {err('seasonsLabel')}
            </label>
            <label className="wf-field">
              Nº de temporadas (meta)
              <input
                className="wf-input"
                inputMode="numeric"
                value={form.seasonCount}
                maxLength={3}
                onChange={(e) => set('seasonCount', e.target.value)}
                {...inv('seasonCount')}
              />
              {err('seasonCount')}
            </label>
            <label className="wf-field">
              Episódios
              <input
                className="wf-input"
                inputMode="numeric"
                value={form.episodeCount}
                maxLength={5}
                onChange={(e) => set('episodeCount', e.target.value)}
              />
            </label>
          </>
        ) : null}

        {kind === 'FRANCHISE' ? (
          <fieldset className="wf-field full m-0 border-0 p-0">
            <legend className="mb-2">
              Filmes da franquia (meta = soma do preço de cada filme)
            </legend>
            <ol className="wf-films-edit m-0 list-none p-0">
              {form.films.map((f, i) => (
                <li key={i}>
                  <input
                    className="wf-input"
                    aria-label={`Filme ${i + 1}: título`}
                    value={f.title}
                    maxLength={120}
                    onChange={(e) =>
                      set(
                        'films',
                        form.films.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)),
                      )
                    }
                  />
                  <input
                    className="wf-input"
                    aria-label={`Filme ${i + 1}: ano`}
                    inputMode="numeric"
                    placeholder="Ano"
                    value={f.year}
                    maxLength={4}
                    onChange={(e) =>
                      set(
                        'films',
                        form.films.map((x, j) => (j === i ? { ...x, year: e.target.value } : x)),
                      )
                    }
                  />
                  <input
                    className="wf-input"
                    aria-label={`Filme ${i + 1}: duração em minutos`}
                    inputMode="numeric"
                    placeholder="min"
                    value={f.runtimeMinutes}
                    maxLength={3}
                    onChange={(e) =>
                      set(
                        'films',
                        form.films.map((x, j) =>
                          j === i ? { ...x, runtimeMinutes: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="wf-linkbtn"
                    onClick={() =>
                      set(
                        'films',
                        form.films.filter((_, j) => j !== i),
                      )
                    }
                  >
                    Remover<span className="sr-only"> filme {i + 1}</span>
                  </button>
                </li>
              ))}
            </ol>
            <button
              type="button"
              className="wf-btn wf-btn--ghost wf-btn--sm mt-2 justify-self-start"
              onClick={() =>
                set('films', [...form.films, { title: '', year: '', runtimeMinutes: '' }])
              }
            >
              + Adicionar filme
            </button>
            {err('franchiseEntries')}
          </fieldset>
        ) : null}

        <label className="wf-field full">
          Gêneros (separados por vírgula)
          <input
            className="wf-input"
            value={form.genres}
            placeholder="Ficção científica, Aventura"
            onChange={(e) => set('genres', e.target.value)}
            {...inv('genres')}
          />
          {err('genres')}
        </label>
        <label className="wf-field full">
          <span className="wf-field__row">
            <span>Sinopse</span>
            <span
              aria-live="polite"
              className={chars(form.synopsis) > 600 ? 'wf-hint--err' : 'wf-hint'}
            >
              {chars(form.synopsis)} / 600
            </span>
          </span>
          <textarea
            className="wf-input"
            value={form.synopsis}
            rows={4}
            onChange={(e) => set('synopsis', e.target.value)}
            {...inv('synopsis')}
          />
          {err('synopsis')}
        </label>
        <label className="wf-field">
          Direção
          <input
            className="wf-input"
            value={form.director}
            maxLength={160}
            onChange={(e) => set('director', e.target.value)}
          />
        </label>
        <label className="wf-field">
          Elenco principal (vírgulas)
          <input
            className="wf-input"
            value={form.cast}
            onChange={(e) => set('cast', e.target.value)}
            {...inv('cast')}
          />
          {err('cast')}
        </label>
        <label className="wf-field full">
          Trailer (link do YouTube)
          <input
            className={`wf-input ${ytId ? 'is-valid' : ''}`}
            value={form.trailer}
            maxLength={300}
            placeholder="https://youtu.be/…"
            onChange={(e) => set('trailer', e.target.value)}
            aria-invalid={form.trailer.trim() && !ytId ? true : undefined}
            aria-describedby="trailer-hint"
          />
          <span
            id="trailer-hint"
            className={`wf-hint ${form.trailer.trim() ? (ytId ? 'wf-hint--ok' : 'wf-hint--err') : ''}`}
          >
            {!form.trailer.trim()
              ? 'Opcional. Só o ID do vídeo é guardado.'
              : ytId
                ? `✓ ID válido (${ytId}) · o player só carrega quando o visitante clica`
                : 'Link do YouTube inválido.'}
          </span>
        </label>
        {isDraft ? (
          <label className="wf-field">
            Vaga planejada
            <input
              className="wf-input"
              inputMode="numeric"
              value={form.slot}
              maxLength={2}
              onChange={(e) => set('slot', e.target.value)}
              {...inv('slot')}
            />
            {err('slot')}
          </label>
        ) : null}

        <div className="wf-field full">
          <span>
            Imagens · JPEG, PNG, WebP ou AVIF (SVG não é aceito); imagens grandes são reduzidas
            automaticamente
          </span>
          <div className="wf-drops">
            <MediaDrop
              role="POSTER"
              label="Pôster 2:3"
              hint="mínimo 600×900"
              className="wf-drop--poster"
              picture={pics.poster}
              onUploaded={(id, p) => {
                set('posterId', id);
                setPics((x) => ({ ...x, poster: p }));
              }}
              onClear={() => {
                set('posterId', null);
                setPics((x) => ({ ...x, poster: null }));
              }}
            />
            <MediaDrop
              role="BACKDROP"
              label="Fundo 16:9 · mín. 1920×1080"
              hint="mínimo 1920×1080"
              className="wf-drop--backdrop"
              picture={pics.backdrop}
              onUploaded={(id, p) => {
                set('backdropId', id);
                setPics((x) => ({ ...x, backdrop: p }));
              }}
              onClear={() => {
                set('backdropId', null);
                setPics((x) => ({ ...x, backdrop: null }));
              }}
            />
            <MediaDrop
              role="LOGO"
              label="Logo do título (PNG transparente, opcional)"
              hint="mínimo 480 px de largura, com transparência"
              className="wf-drop--logo"
              picture={pics.logo}
              onUploaded={(id, p) => {
                set('logoId', id);
                setPics((x) => ({ ...x, logo: p }));
              }}
              onClear={() => {
                set('logoId', null);
                setPics((x) => ({ ...x, logo: null }));
              }}
            />
          </div>
          {err('posterId') ?? err('backdropId') ?? err('logoId')}
          <span className="wf-hint">
            Toda imagem é reconvertida no servidor e os metadados (EXIF/GPS) são removidos.
          </span>
        </div>

        {isDraft && missing.length && !dirty ? (
          <p className="full wf-hint">
            Falta para publicar:{' '}
            {missing.map((m) => m.message.replace(/\.$/, '').toLowerCase()).join(' · ')}.
          </p>
        ) : null}

        <div className="wf-actions full">
          <button
            type="button"
            className="wf-btn wf-btn--ghost"
            onClick={() => setPreviewOpen(true)}
          >
            Ver como visitante
          </button>
          <button type="submit" className="wf-btn wf-btn--ghost" disabled={busy}>
            {live ? 'Salvar alterações' : 'Salvar rascunho'}
          </button>
          {isDraft && kind === 'MOVIE' ? (
            <button
              type="button"
              className="wf-btn wf-btn--neon"
              disabled={busy}
              onClick={() => void publish()}
            >
              Publicar
            </button>
          ) : null}
        </div>
      </form>

      {msg ? (
        <div
          role={msg.kind === 'err' ? 'alert' : 'status'}
          className={`wf-toast wf-toast--${msg.kind}`}
        >
          {msg.text}{' '}
          {msg.conflict ? (
            <button type="button" className="wf-linkbtn" onClick={() => onChanged(null)}>
              Recarregar
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Campaigns: the streamer opens them (goal + deadline, Google step-up). */}
      {isDraft && kind !== 'MOVIE' ? (
        <section className="wf-history" aria-labelledby="abrir">
          <h3 id="abrir" className="text-base font-semibold">
            Abrir campanha
          </h3>
          {role === 'STREAMER' ? (
            <div className="wf-form">
              <label className="wf-field">
                Meta (R$, vazio = fórmula{money ? ` ${formatBRL(money.cents)}` : ''})
                <input
                  className="wf-input"
                  inputMode="decimal"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                />
              </label>
              <label className="wf-field">
                Prazo (dias)
                <input
                  className="wf-input"
                  inputMode="numeric"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
              </label>
              <div className="full">
                <button
                  type="button"
                  className="wf-btn wf-btn--neon"
                  disabled={busy}
                  onClick={() => void openCampaign()}
                >
                  Abrir campanha
                </button>
              </div>
            </div>
          ) : (
            <p className="wf-hint">Pronto? O streamer abre a campanha (define meta e prazo).</p>
          )}
        </section>
      ) : null}

      {item && live ? (
        <section className="wf-history" aria-labelledby="no-ar">
          <h3 id="no-ar" className="text-base font-semibold">
            No ar
          </h3>
          <div className="wf-actions mt-3">
            {status !== 'WATCHED' ? (
              <button
                type="button"
                className="wf-btn wf-btn--ghost wf-btn--sm"
                disabled={busy}
                onClick={() =>
                  void simple(
                    `/api/v1/admin/catalog/items/${item.id}/watched`,
                    undefined,
                    'Marcado como assistido.',
                    'Marcar como assistido na live? As avaliações serão liberadas.',
                  )
                }
              >
                Marcar como assistido
              </button>
            ) : null}
            <select
              className="wf-input max-w-64"
              aria-label="Rascunho que entra na vaga"
              value={replaceWith}
              onChange={(e) => setReplaceWith(e.target.value)}
            >
              <option value="">Só liberar a vaga</option>
              {drafts.map((d) => (
                <option key={d.id} value={d.id}>
                  Substituir por: {d.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="wf-btn wf-btn--ghost wf-btn--sm"
              disabled={busy}
              onClick={() =>
                void simple(
                  `/api/v1/admin/catalog/items/${item.id}/replace`,
                  { replacementId: replaceWith || null },
                  'Vaga liberada.',
                  'Arquivar este título e liberar a vaga?',
                ).then((done) => {
                  if (done) onDeleted();
                })
              }
            >
              Substituir
            </button>
          </div>
          {item.campaign ? (
            <div className="mt-4 grid gap-2 text-sm">
              <p className="m-0">
                Campanha: {formatBRL(item.campaign.raisedCents)} de{' '}
                {formatBRL(item.campaign.goalCents)} · prazo{' '}
                {new Intl.DateTimeFormat('pt-BR', {
                  dateStyle: 'short',
                  timeZone: 'America/Sao_Paulo',
                }).format(new Date(item.campaign.deadlineAt))}
                {item.campaign.extensions ? ` · ${item.campaign.extensions} prorrogação(ões)` : ''}
              </p>
              {role === 'STREAMER' &&
              (item.campaign.state === 'OPEN' || item.campaign.state === 'PAUSED') ? (
                <div className="wf-actions mt-0">
                  <button
                    type="button"
                    className="wf-btn wf-btn--ghost wf-btn--sm"
                    disabled={busy}
                    onClick={() => {
                      const d = window.prompt('Prorrogar por quantos dias?', '7');
                      if (d && /^\d{1,3}$/.test(d))
                        void simple(
                          `/api/v1/admin/campaigns/${item.id}/extend`,
                          { days: Number(d) },
                          'Prazo prorrogado (aparece no site).',
                        );
                    }}
                  >
                    Prorrogar prazo
                  </button>
                  <button
                    type="button"
                    className="wf-btn wf-btn--ghost wf-btn--sm"
                    disabled={busy}
                    onClick={() => {
                      const v = window.prompt('Nova meta em reais (menor que a atual):', '');
                      if (v && /^\d{1,7}$/.test(v))
                        void simple(
                          `/api/v1/admin/campaigns/${item.id}/goal`,
                          { goalCents: Number(v) * 100 },
                          'Meta atualizada.',
                        );
                    }}
                  >
                    Baixar meta
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {item && isDraft && !item.publishedAt ? (
        <p className="mt-4">
          <button
            type="button"
            className="wf-linkbtn"
            onClick={async () => {
              if (!window.confirm('Excluir este rascunho?')) return;
              const res = await adminFetch(`/api/v1/admin/catalog/items/${item.id}`, {
                method: 'DELETE',
              });
              if (res.ok) onDeleted();
              else fail(res.problem);
            }}
          >
            Excluir rascunho
          </button>
        </p>
      ) : null}

      {item?.revisions.length ? (
        <section className="wf-history" aria-labelledby="historico">
          <h3 id="historico" className="text-base font-semibold">
            Histórico
          </h3>
          <ol>
            {item.revisions.map((r) => (
              <li key={r.version}>
                <span>
                  v{r.version} ·{' '}
                  {new Intl.DateTimeFormat('pt-BR', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                    timeZone: 'America/Sao_Paulo',
                  }).format(new Date(r.createdAt))}{' '}
                  · {r.editor} · {noteLabel(r.note)}
                </span>
                {r.version !== item.version ? (
                  <button
                    type="button"
                    className="wf-linkbtn"
                    disabled={busy}
                    onClick={() =>
                      void simple(
                        `/api/v1/admin/catalog/items/${item.id}/revert`,
                        { expectedVersion: item.version, toVersion: r.version },
                        `Revertido para a versão ${r.version}.`,
                        `Reverter o conteúdo para a versão ${r.version}? (cria uma nova versão)`,
                      )
                    }
                  >
                    Reverter<span className="sr-only"> para a versão {r.version}</span>
                  </button>
                ) : (
                  <span className="wf-hint">atual</span>
                )}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <dialog
        ref={preview}
        className="wf-preview"
        aria-label="Prévia: como o visitante vê"
        onClose={() => setPreviewOpen(false)}
      >
        <div className="wf-preview__bar">
          <button
            type="button"
            className="wf-btn wf-btn--ghost wf-btn--sm"
            onClick={() => setPreviewOpen(false)}
          >
            Fechar prévia <IconClose />
          </button>
        </div>
        {previewOpen ? <HeroCarousel items={[previewItem]} label="Prévia" preview /> : null}
      </dialog>
    </div>
  );
}
