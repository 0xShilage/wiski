'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { IconClose } from '@/components/ui/icons';
import { apiFetch, type Problem } from '@/lib/api-fetch';
import type { CheckoutContext, CheckoutResponse } from './types';
import { useTurnstile } from './useTurnstile';

export type BuyerFields = {
  contactEmail?: string;
  displayName?: string;
  message?: string;
  showSponsorName: boolean;
  legal: CheckoutContext['legal'];
};

type Props = {
  ctx: CheckoutContext;
  open: boolean;
  onClose: () => void;
  kicker: string;
  title: string;
  /** price breakdown / amount picker, above the buyer fields */
  children: ReactNode;
  endpoint: string;
  /** item-specific part of the body (null = not ready to submit yet) */
  payload: Record<string, unknown> | null;
  submitLabel: string;
  /** extra line under the legal checkbox (campaign wording) */
  legalNote?: string;
  /** a 409/422 the parent handles (price changed, amount above remaining…); true = handled */
  onProblem?: (p: Problem) => boolean;
};

const FIELD_ORDER = ['contactEmail', 'displayName', 'message', 'legal', 'turnstile'] as const;
type FieldKey = (typeof FIELD_ORDER)[number];

const EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/**
 * The checkout sheet (13 §3 step 12): a modal <dialog> (bottom sheet on phones) with the buyer
 * fields, the legal checkbox and Turnstile. Posts with an Idempotency-Key that is reused only
 * for a retry of the very same body, then opens the order page with the access token in the
 * fragment (never sent to the server on navigation).
 */
const noop = () => () => {};

export function CheckoutSheet(p: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  // Portalled to <body> so the sheet inherits nothing from the panel it was opened from.
  const client = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (p.open && !d.open) d.showModal();
    if (!p.open && d.open) d.close();
  }, [p.open, client]);

  if (!client) return null;
  return createPortal(
    <dialog
      ref={dialog}
      className="wf-sheet"
      aria-labelledby="checkout-title"
      onClose={p.onClose}
      onClick={(e) => {
        // a click on the backdrop (the dialog box itself, outside the panel) closes it
        if (e.target === dialog.current) p.onClose();
      }}
    >
      {p.open ? <SheetBody {...p} /> : null}
    </dialog>,
    document.body,
  );
}

function SheetBody(p: Props) {
  const ids = useId();
  const signedIn = p.ctx.signedIn;
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [showName, setShowName] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const attempt = useRef<{ key: string; body: string } | null>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const router = useRouter();
  const {
    ref: turnstileRef,
    token: tsToken,
    state: tsState,
    reset: tsReset,
  } = useTurnstile(p.ctx.turnstileSiteKey, 'checkout');

  const fieldId = (k: FieldKey) => `${ids}-${k}`;
  const errId = (k: FieldKey) => `${ids}-${k}-err`;
  const invalid = (k: FieldKey) =>
    errors[k] ? { 'aria-invalid': true as const, 'aria-describedby': errId(k) } : {};

  function focusFirst(errs: Partial<Record<FieldKey, string>>) {
    const first = FIELD_ORDER.find((k) => errs[k]);
    if (first) document.getElementById(fieldId(first))?.focus();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !p.payload) return;
    const errs: Partial<Record<FieldKey, string>> = {};
    if (!signedIn && !EMAIL.test(email.trim())) {
      errs.contactEmail = 'Informe um e-mail válido para receber o comprovante.';
    }
    if (!accepted) errs.legal = 'Para continuar, aceite os termos.';
    if (!tsToken) {
      errs.turnstile =
        tsState === 'error'
          ? 'A verificação de segurança não carregou. Recarregue a página.'
          : 'Aguarde a verificação de segurança terminar.';
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      setProblem(null);
      focusFirst(errs);
      return;
    }

    const body: Record<string, unknown> = {
      ...p.payload,
      showSponsorName: showName,
      legal: p.ctx.legal,
      ...(signedIn ? {} : { contactEmail: email.trim() }),
      ...(!signedIn && name.trim() ? { displayName: name.trim() } : {}),
      ...(message.trim() ? { message: message.trim() } : {}),
    };
    const json = JSON.stringify(body);
    if (attempt.current?.body !== json) attempt.current = { key: crypto.randomUUID(), body: json };

    setBusy(true);
    setProblem(null);
    const res = await apiFetch<CheckoutResponse>(p.endpoint, {
      method: 'POST',
      body,
      headers: { 'idempotency-key': attempt.current.key, 'x-turnstile-token': tsToken! },
    });
    if (res.ok) {
      const { order, accessToken } = res.data;
      router.push(`/pedido/${order.publicCode}#t=${accessToken}`);
      return;
    }
    setBusy(false);
    tsReset(); // Turnstile tokens are single-use
    const pr = res.problem;
    if (pr.status !== 0) attempt.current = null; // only a network failure retries the same key
    if (p.onProblem?.(pr)) {
      setProblem(pr.detail);
      return;
    }
    if (pr.code === 'VALIDATION_FAILED' && pr.errors?.length) {
      const fe: Partial<Record<FieldKey, string>> = {};
      for (const er of pr.errors) {
        const k = er.path.split('.')[0] as FieldKey;
        if (FIELD_ORDER.includes(k)) fe[k] ??= er.message;
      }
      setErrors(fe);
      if (Object.keys(fe).length) {
        focusFirst(fe);
        return;
      }
    }
    setProblem(pr.detail);
    requestAnimationFrame(() => alertRef.current?.focus());
  }

  return (
    <div className="wf-sheet__panel">
      <header className="wf-sheet__head">
        <div className="min-w-0">
          <p className="wf-kicker">{p.kicker}</p>
          <h2 id="checkout-title" className="wf-sheet__title">
            {p.title}
          </h2>
        </div>
        <button type="button" className="wf-iconbtn" aria-label="Fechar" onClick={p.onClose}>
          <IconClose />
        </button>
      </header>

      <form className="wf-sheet__body" onSubmit={submit} noValidate>
        {p.children}

        <fieldset className="wf-fieldset">
          <legend>Seus dados</legend>
          {signedIn ? (
            <p className="wf-muted text-sm">
              {p.ctx.viewer ? (
                <>
                  Você está conectado como <b>@{p.ctx.viewer.username}</b>.{' '}
                </>
              ) : null}
              O comprovante vai para o e-mail da sua conta Google.
            </p>
          ) : (
            <>
              <label className="wf-field" htmlFor={fieldId('contactEmail')}>
                E-mail para o comprovante
                <input
                  id={fieldId('contactEmail')}
                  className="wf-input"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  maxLength={254}
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  {...invalid('contactEmail')}
                />
                {errors.contactEmail ? (
                  <span id={errId('contactEmail')} className="wf-hint wf-hint--err">
                    {errors.contactEmail}
                  </span>
                ) : (
                  <span className="wf-hint">
                    Usado só para o comprovante e o link do pedido. Nunca aparece no site.
                  </span>
                )}
              </label>
              <label className="wf-field" htmlFor={fieldId('displayName')}>
                Nome que aparece no site (opcional)
                <input
                  id={fieldId('displayName')}
                  className="wf-input"
                  autoComplete="nickname"
                  maxLength={24}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  {...invalid('displayName')}
                />
                {errors.displayName ? (
                  <span id={errId('displayName')} className="wf-hint wf-hint--err">
                    {errors.displayName}
                  </span>
                ) : (
                  <span className="wf-hint">Passa pela moderação antes de aparecer.</span>
                )}
              </label>
            </>
          )}
          <label className="wf-field" htmlFor={fieldId('message')}>
            Mensagem para a live (opcional)
            <textarea
              id={fieldId('message')}
              className="wf-input wf-input--short"
              maxLength={140}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              {...invalid('message')}
            />
            <span
              id={errors.message ? errId('message') : undefined}
              className={`wf-hint ${errors.message ? 'wf-hint--err' : ''}`}
            >
              {errors.message ?? `${message.length}/140 · passa pela moderação`}
            </span>
          </label>
          <label className="wf-check">
            <input
              type="checkbox"
              checked={showName}
              onChange={(e) => setShowName(e.target.checked)}
            />
            <span>
              {signedIn && p.ctx.viewer
                ? `Mostrar @${p.ctx.viewer.username} como apoiador`
                : 'Mostrar meu nome como apoiador'}
            </span>
          </label>
        </fieldset>

        <div className="wf-legalbox">
          <label className="wf-check" htmlFor={fieldId('legal')}>
            <input
              id={fieldId('legal')}
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              {...invalid('legal')}
            />
            <span>
              Li e aceito os{' '}
              <a href="/termos" target="_blank" rel="noopener">
                Termos de uso
              </a>
              , a{' '}
              <a href="/privacidade" target="_blank" rel="noopener">
                Política de privacidade
              </a>{' '}
              e a{' '}
              <a href="/reembolso" target="_blank" rel="noopener">
                Política de reembolso
              </a>
              . Pagamentos não são reembolsáveis.
            </span>
          </label>
          {p.legalNote ? <p className="wf-hint mt-2">{p.legalNote}</p> : null}
          {errors.legal ? (
            <p id={errId('legal')} className="wf-hint wf-hint--err mt-2">
              {errors.legal}
            </p>
          ) : null}
        </div>

        <div>
          <div
            ref={turnstileRef}
            id={fieldId('turnstile')}
            tabIndex={-1}
            className="wf-turnstile"
            aria-label="Verificação de segurança"
            role="group"
          />
          {errors.turnstile ? (
            <p id={errId('turnstile')} className="wf-hint wf-hint--err">
              {errors.turnstile}
            </p>
          ) : null}
        </div>

        {problem ? (
          <p ref={alertRef} tabIndex={-1} role="alert" className="wf-alert">
            {problem}
          </p>
        ) : null}

        {!p.ctx.payable ? (
          <p className="wf-notice">
            Pagamentos indisponíveis neste ambiente (Mercado Pago não configurado).
          </p>
        ) : null}

        <div className="wf-sheet__foot">
          <button
            type="submit"
            className="wf-btn wf-btn--neon"
            disabled={busy || !p.payload || !p.ctx.payable}
            aria-busy={busy || undefined}
          >
            {busy ? 'Gerando o Pix…' : p.submitLabel}
          </button>
          <p className="wf-hint text-center">
            Pagamento por Pix, processado pelo Mercado Pago. O Pix vale por 30 minutos.
          </p>
        </div>
      </form>
    </div>
  );
}
