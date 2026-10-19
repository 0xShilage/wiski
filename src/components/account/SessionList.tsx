'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { button } from '@/components/ui/styles';
import { apiFetch } from '@/lib/api-fetch';

export type SessionItem = {
  id: string;
  device: string;
  lastSeen: string;
  created: string;
  current: boolean;
};

export function SessionList({ items }: { items: SessionItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function revoke(id: string | 'others', current = false) {
    setBusy(id);
    setError(null);
    const res = await apiFetch(
      id === 'others' ? '/api/v1/me/sessions' : `/api/v1/me/sessions/${id}`,
      { method: 'DELETE' },
    );
    setBusy(null);
    if (!res.ok) return setError(res.problem.detail);
    if (current) router.replace('/perfil');
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border/60 rounded-md border border-border/60">
        {items.map((s) => (
          <li
            key={s.id}
            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="font-semibold text-lilac">
                {s.device}
                {s.current ? (
                  <span className="ml-2 rounded-pill bg-accent/20 px-2 py-0.5 text-xs text-accent">
                    este dispositivo
                  </span>
                ) : null}
              </p>
              <p className="text-sm text-fg-muted">
                Último uso: {s.lastSeen} · Entrou em: {s.created}
              </p>
            </div>
            <button
              type="button"
              className={button.danger}
              disabled={busy !== null}
              onClick={() => revoke(s.id, s.current)}
            >
              {busy === s.id ? 'Encerrando…' : s.current ? 'Sair deste' : 'Encerrar'}
            </button>
          </li>
        ))}
      </ul>
      {items.length > 1 ? (
        <button
          type="button"
          className={button.secondary}
          disabled={busy !== null}
          onClick={() => revoke('others')}
        >
          {busy === 'others' ? 'Encerrando…' : 'Sair de todos os outros dispositivos'}
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
