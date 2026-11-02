'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import { enrolPasskey, verifyPasskey } from '@/lib/passkey-client';
import { confirmPresence } from '@/lib/step-up-client';

type Item = {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  synced: boolean;
};

/** /perfil/seguranca › Passkeys: enrol, verify and remove (MODERATOR / STREAMER). */
export function PasskeyPanel({
  items,
  verified,
  stepUpUrl,
}: {
  items: Item[];
  verified: boolean;
  stepUpUrl: string;
}) {
  const router = useRouter();
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Sao_Paulo',
    }).format(new Date(iso));

  async function run(
    fn: () => Promise<{
      ok: boolean;
      problem?: { code: string; detail: string; stepUpUrl?: string; stepUpFactors?: string };
    }>,
    ok: string,
  ) {
    setBusy(true);
    setMsg(null);
    const res = await fn();
    setBusy(false);
    if (res.ok) {
      setMsg({ kind: 'ok', text: ok });
      router.refresh();
    } else if (res.problem?.code === 'STEP_UP_REQUIRED') {
      const confirmed = await confirmPresence({
        status: 401,
        code: res.problem.code,
        detail: res.problem.detail,
        stepUpUrl: res.problem.stepUpUrl ?? stepUpUrl,
        ...(res.problem.stepUpFactors ? { stepUpFactors: res.problem.stepUpFactors } : {}),
      });
      if (confirmed)
        setMsg({ kind: 'ok', text: 'Confirmado. Toque no botão de novo para concluir.' });
    } else {
      setMsg({ kind: 'err', text: res.problem?.detail ?? 'Erro inesperado.' });
    }
  }

  return (
    <div className="space-y-6">
      <p className={items.length ? 'text-success' : 'text-fg-muted'} role="status">
        {items.length
          ? `${items.length} passkey${items.length === 1 ? '' : 's'} cadastrada${items.length === 1 ? '' : 's'}.`
          : 'Nenhuma passkey cadastrada (opcional se você usa o app autenticador).'}
      </p>
      {items.length ? (
        <ul className="divide-y divide-border/60 rounded-md border border-border/60">
          {items.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="font-semibold">{p.label ?? 'Passkey'}</p>
                <p className="text-sm text-fg-muted">
                  Criada em {fmt(p.createdAt)}
                  {p.lastUsedAt ? ` · último uso ${fmt(p.lastUsedAt)}` : ''}
                  {p.synced ? ' · sincronizada' : ' · só neste dispositivo'}
                </p>
              </div>
              <button
                type="button"
                className="wf-btn wf-btn--ghost wf-btn--sm"
                disabled={busy}
                onClick={() =>
                  run(
                    () => apiFetch(`/api/v1/me/passkeys/${p.id}`, { method: 'DELETE' }),
                    'Passkey removida.',
                  )
                }
              >
                Remover<span className="sr-only"> {p.label ?? 'passkey'}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid min-w-0 grow basis-56 gap-1 text-sm">
          Nome (opcional)
          <input
            className="min-h-11 w-full min-w-0 rounded-sm border border-border bg-surface-2 px-3 py-2 text-base"
            value={label}
            maxLength={40}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ex.: Notebook, Celular"
          />
        </label>
        <button
          type="button"
          className="wf-btn wf-btn--neon"
          disabled={busy}
          onClick={() => run(() => enrolPasskey(label.trim()), 'Passkey cadastrada.')}
        >
          Adicionar passkey
        </button>
        {items.length && !verified ? (
          <button
            type="button"
            className="wf-btn wf-btn--ghost"
            disabled={busy}
            onClick={() => run(verifyPasskey, 'Verificado por 96 horas neste navegador.')}
          >
            Verificar agora
          </button>
        ) : null}
      </div>
      {msg ? (
        <p role="alert" className={msg.kind === 'ok' ? 'text-success' : 'text-danger'}>
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
