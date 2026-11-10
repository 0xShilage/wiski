'use client';
import { useId, useState } from 'react';
import { MediaDrop } from '@/components/admin/MediaDrop';
import type { Picture } from '@/lib/media';
import { adminFetch } from '@/lib/passkey-client';
import { SEASON_HINT, SEASON_LABEL, SEASONS, type Season } from '@/lib/season';

export type SeasonView = { theme: 'none' | Season; until: string | null };
export type PopupView = {
  id: string;
  active: boolean;
  title: string;
  body: string;
  imageId: string | null;
  image: Picture | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  until: string | null;
  shownFrom: string | null;
} | null;

type Toast = { ok: boolean; text: string } | null;

function ToastLine({ toast }: { toast: Toast }) {
  return toast ? (
    <p role="status" className={toast.ok ? 'wf-toast wf-toast--ok' : 'wf-toast wf-toast--err'}>
      {toast.text}
    </p>
  ) : null;
}

/** "Tema sazonal" (2026-11-10): none / Natal / Halloween / Aniversário da Iara, optional last day. */
export function SeasonPanel({ initial }: { initial: SeasonView }) {
  const id = useId();
  const [s, setS] = useState(initial);
  const [until, setUntil] = useState(initial.until ?? '');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  async function save(theme: SeasonView['theme'], last: string) {
    setBusy(true);
    setToast(null);
    const r = await adminFetch<{ season: SeasonView }>('/api/v1/admin/season', {
      method: 'PUT',
      body: { theme, until: theme === 'none' ? null : last || null },
    });
    setBusy(false);
    if (r.ok) {
      setS(r.data.season);
      setUntil(r.data.season.until ?? '');
      setToast({
        ok: true,
        text:
          r.data.season.theme === 'none'
            ? 'Tema desligado: o site voltou ao normal.'
            : `Tema “${SEASON_LABEL[r.data.season.theme]}” ligado. Recarregue o site para ver.`,
      });
    } else setToast({ ok: false, text: r.problem.detail });
  }

  return (
    <section className="wf-ops-card" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Tema sazonal</h2>
      <p className="wf-muted m-0 text-sm">
        Muda o fundo, a cor do brilho e o logo do site inteiro, com um enfeite ao lado do logo. Os
        overlays do OBS não mudam.
      </p>
      <ToastLine toast={toast} />
      <fieldset className="wf-season-pick mt-3" disabled={busy}>
        <legend className="sr-only">Tema</legend>
        <label className="wf-season-opt">
          <input
            type="radio"
            name={`${id}-theme`}
            checked={s.theme === 'none'}
            onChange={() => void save('none', '')}
          />
          <span>
            <b>Nenhum</b>
            <small>O visual de sempre.</small>
          </span>
        </label>
        {SEASONS.map((k) => (
          <label key={k} className="wf-season-opt">
            <input
              type="radio"
              name={`${id}-theme`}
              checked={s.theme === k}
              onChange={() => void save(k, until)}
            />
            <span>
              <b>{SEASON_LABEL[k]}</b>
              <small>{SEASON_HINT[k]}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="wf-ops-form mt-3">
        <label className="wf-field" htmlFor={`${id}-until`}>
          <span>Até (opcional)</span>
          <input
            id={`${id}-until`}
            type="date"
            className="wf-input"
            value={until}
            disabled={busy}
            onChange={(e) => setUntil(e.target.value)}
          />
        </label>
        <p className="wf-hint m-0">
          Último dia com o tema (horário de Brasília). Vazio: fica até você desligar.
        </p>
        <div className="wf-ops-actions full">
          <button
            type="button"
            className="wf-btn wf-btn--sm wf-btn--ghost"
            disabled={busy || s.theme === 'none' || (s.until ?? '') === until}
            onClick={() => void save(s.theme, until)}
          >
            Salvar data
          </button>
        </div>
      </div>
    </section>
  );
}

type PopupForm = {
  active: boolean;
  title: string;
  body: string;
  imageId: string | null;
  image: Picture | null;
  ctaLabel: string;
  ctaHref: string;
  until: string;
};

const formOf = (p: PopupView): PopupForm => ({
  active: p?.active ?? false,
  title: p?.title ?? '',
  body: p?.body ?? '',
  imageId: p?.imageId ?? null,
  image: p?.image ?? null,
  ctaLabel: p?.ctaLabel ?? '',
  ctaHref: p?.ctaHref ?? '',
  until: p?.until ?? '',
});

/**
 * "Pop-up da página inicial" (2026-11-10): shown once per visitor on the home page each time it
 * is switched on. Editing it while on doesn't show it again; "Mostrar de novo para todos" does.
 */
export function PopupPanel({ initial }: { initial: PopupView }) {
  const id = useId();
  const [saved, setSaved] = useState(initial);
  const [f, setF] = useState(() => formOf(initial));
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const set = (patch: Partial<PopupForm>) => setF((x) => ({ ...x, ...patch }));

  async function save(next: PopupForm, renew = false) {
    setBusy(true);
    setToast(null);
    const r = await adminFetch<{ popup: PopupView }>('/api/v1/admin/popup', {
      method: 'PUT',
      body: {
        active: next.active,
        title: next.title,
        body: next.body,
        imageId: next.imageId,
        ctaLabel: next.ctaLabel.trim() || null,
        ctaHref: next.ctaHref.trim() || null,
        until: next.until || null,
        ...(renew ? { renew: true } : {}),
      },
    });
    setBusy(false);
    if (r.ok) {
      const wasOn = saved?.active ?? false;
      setSaved(r.data.popup);
      setF(formOf(r.data.popup));
      setToast({
        ok: true,
        text: !next.active
          ? 'Pop-up desligado.'
          : renew || !wasOn
            ? 'Pop-up ligado: cada pessoa vai vê-lo uma vez na página inicial.'
            : 'Salvo. Quem já fechou o pop-up não vai vê-lo de novo.',
      });
    } else setToast({ ok: false, text: r.problem.detail });
  }

  return (
    <section className="wf-ops-card" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Pop-up da página inicial</h2>
      <p className="wf-muted m-0 text-sm">
        Aparece uma vez para cada pessoa na página inicial, cada vez que você liga. Depois de
        fechado, não volta — até você ligar de novo ou usar “Mostrar de novo para todos”.
      </p>
      <ToastLine toast={toast} />
      <p className="m-0 mt-2 text-sm">
        Agora: <b>{saved?.active ? 'ligado' : 'desligado'}</b>
        {saved?.active && saved.until ? ` até ${saved.until.split('-').reverse().join('/')}` : ''}
      </p>
      <form
        className="wf-ops-form mt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save(f);
        }}
      >
        <label className="wf-field full" htmlFor={`${id}-title`}>
          <span>Título</span>
          <input
            id={`${id}-title`}
            className="wf-input"
            maxLength={80}
            value={f.title}
            onChange={(e) => set({ title: e.target.value })}
          />
        </label>
        <label className="wf-field full" htmlFor={`${id}-body`}>
          <span>Texto</span>
          <textarea
            id={`${id}-body`}
            className="wf-input"
            rows={4}
            maxLength={600}
            value={f.body}
            onChange={(e) => set({ body: e.target.value })}
          />
        </label>
        <div className="full">
          <MediaDrop
            role="BACKDROP"
            label="Imagem 16:9 (opcional)"
            hint="mínimo 1920×1080"
            className="wf-drop--backdrop"
            picture={f.image}
            onUploaded={(imageId, image) => set({ imageId, image })}
            onClear={() => set({ imageId: null, image: null })}
          />
        </div>
        <label className="wf-field" htmlFor={`${id}-cta`}>
          <span>Texto do botão (opcional)</span>
          <input
            id={`${id}-cta`}
            className="wf-input"
            maxLength={30}
            placeholder="Ver a agenda"
            value={f.ctaLabel}
            onChange={(e) => set({ ctaLabel: e.target.value })}
          />
        </label>
        <label className="wf-field" htmlFor={`${id}-href`}>
          <span>Link do botão</span>
          <input
            id={`${id}-href`}
            className="wf-input"
            placeholder="/cronograma ou https://…"
            value={f.ctaHref}
            onChange={(e) => set({ ctaHref: e.target.value })}
          />
        </label>
        <label className="wf-field" htmlFor={`${id}-until`}>
          <span>Até (opcional)</span>
          <input
            id={`${id}-until`}
            type="date"
            className="wf-input"
            value={f.until}
            onChange={(e) => set({ until: e.target.value })}
          />
        </label>
        <label className="wf-switch full">
          <input
            type="checkbox"
            checked={f.active}
            onChange={(e) => set({ active: e.target.checked })}
          />
          Ligado
        </label>
        <div className="wf-ops-actions full">
          <button type="submit" className="wf-btn wf-btn--sm wf-btn--neon" disabled={busy}>
            Salvar pop-up
          </button>
          {saved?.active ? (
            <button
              type="button"
              className="wf-btn wf-btn--sm wf-btn--ghost"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    'Mostrar o pop-up de novo para todo mundo, inclusive quem já fechou?',
                  )
                )
                  void save({ ...f, active: true }, true);
              }}
            >
              Mostrar de novo para todos
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
