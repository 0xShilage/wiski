'use client';

import { useEffect, useId, useState } from 'react';
import { field } from '@/components/ui/styles';
import { apiFetch } from '@/lib/api-fetch';
import { normalizeUsername, USERNAME_MAX, usernameRuleViolation } from '@/lib/username';

type Remote = { name: string; available: boolean; error?: string };

/** Username input with local rule checks and a debounced availability lookup. */
export function UsernameField({
  value,
  onChange,
  current,
}: {
  value: string;
  onChange: (v: string) => void;
  current?: string | null;
}) {
  const id = useId();
  const name = normalizeUsername(value);
  const unchanged = !name || name === current;
  const rule = unchanged ? null : usernameRuleViolation(name);
  const needsRemote = !unchanged && rule === null;
  const [remote, setRemote] = useState<Remote | null>(null);

  useEffect(() => {
    if (!needsRemote) return;
    const check = async () => {
      const res = await apiFetch<{ available: boolean }>(
        `/api/v1/usernames/availability?u=${encodeURIComponent(name)}`,
      );
      setRemote(
        res.ok
          ? { name, available: res.data.available }
          : { name, available: false, error: res.problem.detail },
      );
    };
    const timer = setTimeout(() => void check(), 400);
    return () => clearTimeout(timer);
  }, [name, needsRemote]);

  const status: { kind: 'idle' | 'checking' | 'ok' | 'error'; message: string } = unchanged
    ? { kind: 'idle', message: '' }
    : rule
      ? { kind: 'error', message: rule }
      : remote?.name !== name
        ? { kind: 'checking', message: 'Verificando…' }
        : remote.error
          ? { kind: 'error', message: remote.error }
          : remote.available
            ? { kind: 'ok', message: 'Disponível!' }
            : { kind: 'error', message: 'Esse nome já está em uso ou reservado.' };

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-semibold text-lilac">
        Nome de usuário
      </label>
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-fg-muted">
          @
        </span>
        <input
          id={id}
          name="username"
          className={field}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={USERNAME_MAX}
          aria-describedby={`${id}-hint ${id}-status`}
          aria-invalid={status.kind === 'error'}
          required
        />
      </div>
      <p id={`${id}-hint`} className="text-xs text-fg-muted">
        3 a 20 caracteres: letras minúsculas sem acento, números e _.
      </p>
      <p
        id={`${id}-status`}
        aria-live="polite"
        className={
          status.kind === 'ok'
            ? 'text-sm text-success'
            : status.kind === 'error'
              ? 'text-sm text-danger'
              : 'text-sm text-fg-muted'
        }
      >
        {status.message}
      </p>
    </div>
  );
}
