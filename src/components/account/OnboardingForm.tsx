'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { button } from '@/components/ui/styles';
import { apiFetch } from '@/lib/api-fetch';
import { type AvatarKey, DEFAULT_AVATAR } from '@/lib/avatars';
import { AvatarPicker } from './AvatarPicker';
import { UsernameField } from './UsernameField';

export function OnboardingForm({ next }: { next: string }) {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [avatarKey, setAvatarKey] = useState<AvatarKey>(DEFAULT_AVATAR);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await apiFetch('/api/v1/me/onboarding', {
      method: 'POST',
      body: { username, avatarKey },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.problem.errors?.[0]?.message ?? res.problem.detail);
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-8" noValidate>
      <UsernameField value={username} onChange={setUsername} />
      <AvatarPicker value={avatarKey} onChange={setAvatarKey} />
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger"
        >
          {error}
        </p>
      ) : null}
      <button type="submit" className={`${button.primary} w-full sm:w-auto`} disabled={busy}>
        {busy ? 'Salvando…' : 'Criar meu perfil'}
      </button>
    </form>
  );
}
