'use client';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { verifyTotp } from '@/lib/mfa-client';
import { verifyPasskey } from '@/lib/passkey-client';

/**
 * The second-factor check (96 h, remembered in this browser): a 6-digit code from the
 * authenticator app, one of the recovery codes, or a passkey — whichever the account has.
 */
export function MfaGate({ totp, passkeys }: { totp: boolean; passkeys: boolean }) {
  const router = useRouter();
  const id = useId();
  const [mode, setMode] = useState<'code' | 'recovery'>('code');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await verifyTotp(mode === 'code' ? { code: value } : { recoveryCode: value });
    setBusy(false);
    if (!r.ok) {
      setError(r.problem.detail);
      setValue('');
      return;
    }
    if (r.data.method === 'recovery') {
      setNotice(
        `Código de recuperação usado. Restam ${r.data.recoveryLeft}. Gere novos em Perfil › Segurança.`,
      );
      setTimeout(() => router.refresh(), 2500);
      return;
    }
    router.refresh();
  }

  return (
    <div className="grid gap-4 text-left">
      {totp ? (
        <form onSubmit={submit} className="grid gap-3">
          <label className="wf-field" htmlFor={`${id}-code`}>
            <span>
              {mode === 'code'
                ? 'Código de 6 dígitos do app autenticador'
                : 'Código de recuperação (ex.: ABCDE-23456)'}
            </span>
            <input
              id={`${id}-code`}
              className="wf-input wf-otp"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoComplete="one-time-code"
              inputMode={mode === 'code' ? 'numeric' : 'text'}
              pattern={mode === 'code' ? '\\d{6}' : undefined}
              maxLength={mode === 'code' ? 6 : 16}
              required
              autoFocus
            />
          </label>
          <button type="submit" className="wf-btn wf-btn--neon" disabled={busy}>
            {busy ? 'Conferindo…' : 'Confirmar'}
          </button>
          <button
            type="button"
            className="wf-linkbtn text-sm"
            onClick={() => {
              setMode(mode === 'code' ? 'recovery' : 'code');
              setValue('');
              setError(null);
            }}
          >
            {mode === 'code'
              ? 'Perdi o celular: usar um código de recuperação'
              : 'Usar o app autenticador'}
          </button>
        </form>
      ) : null}
      {passkeys ? (
        <button
          type="button"
          className={totp ? 'wf-btn wf-btn--ghost' : 'wf-btn wf-btn--neon'}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const res = await verifyPasskey();
            setBusy(false);
            if (res.ok) router.refresh();
            else setError(res.problem.detail);
          }}
        >
          {busy && !totp ? 'Aguardando a passkey…' : 'Verificar com passkey'}
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-warning">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
