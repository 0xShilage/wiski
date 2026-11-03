'use client';
import { useId } from 'react';
import type { CheckoutProps } from '@/lib/checkout/types';

/**
 * Buyer part shared by both checkout forms (03 §5.3, Q10, Q16): contact e-mail for guests (the
 * order link and receipt), an optional public name for guests (shown only after moderation), the
 * "anônimo" choice, an optional message for the stream (shown at once; moderators can hide it), and acceptance of the legal
 * texts.
 */
export type BuyerState = {
  email: string;
  displayName: string;
  anonymous: boolean;
  message: string;
  accepted: boolean;
};

export const emptyBuyer: BuyerState = {
  email: '',
  displayName: '',
  anonymous: false,
  message: '',
  accepted: false,
};

export function buyerPayload(b: BuyerState, props: CheckoutProps) {
  return {
    ...(props.signedIn ? {} : { contactEmail: b.email.trim() }),
    ...(!props.signedIn && b.displayName.trim() ? { displayName: b.displayName.trim() } : {}),
    anonymous: b.anonymous,
    ...(b.message.trim() ? { message: b.message.trim() } : {}),
    legal: props.legal!,
  };
}

export function BuyerFields({
  props,
  value,
  onChange,
  errors,
}: {
  props: CheckoutProps;
  value: BuyerState;
  onChange: (b: BuyerState) => void;
  errors: Record<string, string>;
}) {
  const id = useId();
  const set = <K extends keyof BuyerState>(k: K, v: BuyerState[K]) =>
    onChange({ ...value, [k]: v });
  return (
    <div className="wf-co__buyer">
      {props.signedIn ? (
        <p className="wf-co__muted">
          Pedido na sua conta <b>{props.signedIn.email}</b>. O comprovante e o link do pedido ficam
          em Perfil.
        </p>
      ) : (
        <>
          <label className="wf-field" htmlFor={`${id}-email`}>
            <span>E-mail para o pedido</span>
            <input
              id={`${id}-email`}
              className="wf-input"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              maxLength={254}
              value={value.email}
              onChange={(e) => set('email', e.target.value)}
              aria-invalid={errors.contactEmail ? 'true' : undefined}
              aria-describedby={`${id}-email-hint`}
            />
            <span
              id={`${id}-email-hint`}
              className={errors.contactEmail ? 'wf-hint wf-hint--err' : 'wf-hint'}
            >
              {errors.contactEmail ?? 'Usamos só para o link do pedido. Não precisa de login.'}
            </span>
          </label>
          <label className="wf-field" htmlFor={`${id}-name`}>
            <span>Seu nome na live (opcional)</span>
            <input
              id={`${id}-name`}
              className="wf-input"
              type="text"
              maxLength={24}
              autoComplete="nickname"
              value={value.displayName}
              onChange={(e) => set('displayName', e.target.value)}
              aria-invalid={errors.displayName ? 'true' : undefined}
              aria-describedby={`${id}-name-hint`}
            />
            <span
              id={`${id}-name-hint`}
              className={errors.displayName ? 'wf-hint wf-hint--err' : 'wf-hint'}
            >
              {errors.displayName ??
                'Aparece depois de aprovado pela moderação. Sem nome: "Anônimo".'}
            </span>
          </label>
        </>
      )}
      <label className="wf-field" htmlFor={`${id}-msg`}>
        <span className="wf-field__row">
          <span>Mensagem para a live (opcional)</span>
          <span className="wf-co__muted">{[...value.message].length}/140</span>
        </span>
        <textarea
          id={`${id}-msg`}
          className="wf-input wf-co__msg"
          maxLength={140}
          rows={2}
          value={value.message}
          onChange={(e) => set('message', e.target.value)}
          aria-invalid={errors.message ? 'true' : undefined}
          aria-describedby={`${id}-msg-hint`}
        />
        <span id={`${id}-msg-hint`} className={errors.message ? 'wf-hint wf-hint--err' : 'wf-hint'}>
          {errors.message ??
            'Aparece na live quando o filme passar. A moderação pode ocultar mensagens ofensivas.'}
        </span>
      </label>
      <label className="wf-check">
        <input
          type="checkbox"
          checked={value.anonymous}
          onChange={(e) => set('anonymous', e.target.checked)}
        />
        <span>Patrocinar anonimamente (seu nome não aparece no site nem na live)</span>
      </label>
      <label className="wf-check">
        <input
          type="checkbox"
          required
          checked={value.accepted}
          onChange={(e) => set('accepted', e.target.checked)}
        />
        <span>
          Li e aceito os{' '}
          <a href="/privacidade" target="_blank" rel="noopener">
            Termos de uso e a Política de privacidade
          </a>{' '}
          e a{' '}
          <a href="/reembolso" target="_blank" rel="noopener">
            Termo de reembolso
          </a>{' '}
          (reembolso só nos casos previstos no termo).
        </span>
      </label>
    </div>
  );
}

/** Problem field errors → { path: message } for the inputs above. */
export function fieldErrors(errors: { path: string; message: string }[] | undefined) {
  const out: Record<string, string> = {};
  for (const e of errors ?? []) out[e.path.split('.')[0]!] ??= e.message;
  return out;
}
