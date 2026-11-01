'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { verifyTotp } from '@/lib/mfa-client';
import { verifyPasskey } from '@/lib/passkey-client';
import { registerStepUpHost, type StepUpFactors } from '@/lib/step-up-client';

type Pending = { factors: StepUpFactors; resolve: (ok: boolean) => void };

/**
 * "Confirme que é você" (2026-11-01): a native modal <dialog> that asks for the authenticator
 * code (or a recovery code, or the passkey) when an action needs a recent proof of presence.
 * Confirming stamps the session (valid 10 minutes for these actions) and the action is sent
 * again by the caller. Mounted once in the root layout; renders nothing until asked.
 */
export function StepUpHost() {
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [mode, setMode] = useState<'code' | 'recovery'>('code');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    registerStepUpHost(
      (factors) =>
        new Promise<boolean>((resolve) => {
          setMode('code');
          setValue('');
          setError(null);
          setPending({ factors, resolve });
        }),
    );
    return () => registerStepUpHost(null);
  }, []);

  useEffect(() => {
    const d = ref.current;
    if (pending && d && !d.open) d.showModal();
  }, [pending]);

  function finish(ok: boolean) {
    pending?.resolve(ok);
    setPending(null);
    ref.current?.close();
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !value.trim()) return;
    setBusy(true);
    setError(null);
    const r = await verifyTotp(mode === 'code' ? { code: value.trim() } : { recoveryCode: value });
    setBusy(false);
    if (r.ok) finish(true);
    else {
      setError(r.problem.detail);
      setValue('');
    }
  }

  async function confirmWithPasskey() {
    setBusy(true);
    setError(null);
    const r = await verifyPasskey();
    setBusy(false);
    if (r.ok) finish(true);
    else setError(r.problem.detail);
  }

  return (
    <dialog
      ref={ref}
      className="wf-stepup"
      aria-labelledby={`${id}-t`}
      aria-describedby={`${id}-d`}
      onCancel={(e) => {
        e.preventDefault();
        finish(false);
      }}
    >
      {pending ? (
        <div className="wf-stepup__body">
          <h2 id={`${id}-t`} className="wf-stepup__title">
            Confirme que é você
          </h2>
          <p id={`${id}-d`} className="wf-stepup__text">
            Esta ação pede uma confirmação recente.{' '}
            {pending.factors.totp
              ? 'Digite o código de 6 dígitos do seu app autenticador.'
              : 'Use sua passkey ou um código de recuperação.'}
          </p>
          {pending.factors.totp ? (
            <form className="wf-stepup__form" onSubmit={submitCode}>
              <label className="wf-field" htmlFor={`${id}-c`}>
                <span>{mode === 'code' ? 'Código do app' : 'Código de recuperação'}</span>
                <input
                  id={`${id}-c`}
                  className="wf-input"
                  autoComplete="one-time-code"
                  inputMode={mode === 'code' ? 'numeric' : 'text'}
                  maxLength={mode === 'code' ? 6 : 20}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  aria-invalid={error ? 'true' : undefined}
                  aria-describedby={error ? `${id}-e` : undefined}
                  autoFocus
                />
              </label>
              <button
                type="submit"
                className="wf-btn wf-btn--neon"
                disabled={busy || !value.trim()}
              >
                {busy ? 'Confirmando…' : 'Confirmar'}
              </button>
            </form>
          ) : null}
          {error ? (
            <p id={`${id}-e`} role="alert" className="wf-hint wf-hint--err">
              {error}
            </p>
          ) : null}
          <div className="wf-stepup__alt">
            {pending.factors.passkey ? (
              <button
                type="button"
                className="wf-btn wf-btn--ghost"
                disabled={busy}
                onClick={() => void confirmWithPasskey()}
              >
                Usar passkey
              </button>
            ) : null}
            {pending.factors.totp ? (
              <button
                type="button"
                className="wf-linkbtn text-sm"
                onClick={() => {
                  setMode(mode === 'code' ? 'recovery' : 'code');
                  setValue('');
                  setError(null);
                }}
              >
                {mode === 'code' ? 'Usar um código de recuperação' : 'Usar o código do app'}
              </button>
            ) : null}
            <button
              type="button"
              className="wf-linkbtn text-sm"
              disabled={busy}
              onClick={() => finish(false)}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
