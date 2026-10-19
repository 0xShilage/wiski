'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { verifyPasskey } from '@/lib/passkey-client';

/** Shown instead of the dashboard until this session presents a passkey (≤ 10 min). */
export function PasskeyGate() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid gap-4">
      <button
        type="button"
        className="wf-btn wf-btn--neon"
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
        {busy ? 'Aguardando a passkey…' : 'Verificar com passkey'}
      </button>
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
