'use client';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import { Turnstile, type TurnstileHandle } from '@/components/checkout/Turnstile';
import { IconStar } from '@/components/ui/icons';
import { apiFetch, type Problem } from '@/lib/api-fetch';
import { REVIEW_BODY_MAX, STARS_LABEL, type OwnReview } from '@/lib/reviews/types';
import { codePoints } from './format';

/**
 * Write or edit a review (03 §5.4, Q15): whole stars, up to 2000 characters, spoiler toggle.
 * Creating needs Turnstile; editing doesn't. The server sanitises and is the judge of length.
 */
export function ReviewForm({
  itemId,
  siteKey,
  editing,
  onCancel,
}: {
  itemId: string;
  siteKey: string;
  /** present = edit mode */
  editing?: OwnReview;
  onCancel?: () => void;
}) {
  const id = useId();
  const router = useRouter();
  const [rating, setRating] = useState(editing?.rating ?? 0);
  const [hover, setHover] = useState(0);
  const [body, setBody] = useState(editing?.body ?? '');
  const [spoiler, setSpoiler] = useState(editing?.containsSpoilers ?? false);
  const [token, setToken] = useState<string | null>(null);
  const [captchaDown, setCaptchaDown] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const turnstile = useRef<TurnstileHandle>(null);

  const length = codePoints(body.trim());
  const tooLong = length > REVIEW_BODY_MAX;
  const valid = rating >= 1 && length >= 1 && !tooLong;
  const shown = hover || rating;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy || (!editing && !token)) return;
    setBusy(true);
    setProblem(null);
    const r = editing
      ? await apiFetch(`/api/v1/reviews/${editing.id}`, {
          method: 'PATCH',
          body: { rating, body, containsSpoilers: spoiler },
        })
      : await apiFetch(`/api/v1/items/${itemId}/reviews`, {
          method: 'POST',
          headers: { 'x-turnstile-token': token! },
          body: { rating, body, containsSpoilers: spoiler },
        });
    setBusy(false);
    if (r.ok) {
      onCancel?.();
      router.refresh();
      return;
    }
    setProblem(r.problem);
    turnstile.current?.reset();
  }

  const bodyError = problem?.errors?.find((e) => e.path === 'body')?.message;

  return (
    <form className="wf-co wf-reviewform" onSubmit={submit} noValidate>
      <fieldset className="wf-starpick" onMouseLeave={() => setHover(0)}>
        <legend>Sua nota</legend>
        <div className="wf-starpick__row">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className={n <= shown ? 'is-on' : ''} onMouseEnter={() => setHover(n)}>
              <input
                type="radio"
                name={`${id}-rating`}
                value={n}
                checked={rating === n}
                onChange={() => setRating(n)}
              />
              <IconStar className="wf-star" />
              <span className="sr-only">
                {n} {n === 1 ? 'estrela' : 'estrelas'} — {STARS_LABEL[n]}
              </span>
            </label>
          ))}
          <span className="wf-starpick__word" aria-hidden="true">
            {shown ? STARS_LABEL[shown] : 'Escolha de 1 a 5'}
          </span>
        </div>
      </fieldset>

      <label className="wf-field" htmlFor={`${id}-body`}>
        <span>O que você achou?</span>
        <textarea
          id={`${id}-body`}
          className="wf-input"
          rows={5}
          value={body}
          maxLength={REVIEW_BODY_MAX * 2}
          onChange={(e) => setBody(e.target.value)}
          aria-invalid={tooLong || bodyError ? 'true' : undefined}
          aria-describedby={`${id}-body-hint`}
        />
        <span
          id={`${id}-body-hint`}
          className={tooLong || bodyError ? 'wf-hint wf-hint--err' : 'wf-hint'}
        >
          {bodyError ??
            `${length}/${REVIEW_BODY_MAX}. Links aparecem como texto; mais de 2 vão para a moderação.`}
        </span>
      </label>

      <label className="wf-check">
        <input type="checkbox" checked={spoiler} onChange={(e) => setSpoiler(e.target.checked)} />
        <span>Minha avaliação tem spoiler (o texto fica escondido até a pessoa clicar)</span>
      </label>

      {editing ? null : (
        <>
          <Turnstile
            ref={turnstile}
            siteKey={siteKey}
            action="review"
            onToken={(t) => {
              setToken(t);
              if (t) setCaptchaDown(false);
            }}
            onError={() => setCaptchaDown(true)}
          />
          {captchaDown ? (
            <p className="wf-hint wf-hint--err" role="alert">
              Não foi possível carregar a verificação anti-robô. Recarregue a página e tente de
              novo.
            </p>
          ) : null}
        </>
      )}

      {problem && !bodyError ? (
        <p className="wf-co__error" role="alert">
          {problem.detail}
        </p>
      ) : null}

      <div className="wf-co__row wf-co__row--end">
        {onCancel ? (
          <button type="button" className="wf-btn wf-btn--ghost" onClick={onCancel}>
            Cancelar
          </button>
        ) : null}
        <button
          type="submit"
          className="wf-btn wf-btn--neon"
          disabled={!valid || busy || (!editing && !token)}
        >
          {busy ? 'Enviando…' : editing ? 'Salvar alterações' : 'Publicar avaliação'}
        </button>
      </div>
    </form>
  );
}
