'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { button } from '@/components/ui/styles';
import { apiFetch } from '@/lib/api-fetch';
import { type AvatarKey } from '@/lib/avatars';
import { normalizeUsername } from '@/lib/username';
import { AvatarPicker } from './AvatarPicker';
import { UsernameField } from './UsernameField';

type Props = {
  username: string;
  avatarKey: AvatarKey;
  canChangeUsername: boolean;
  nextChangeLabel: string | null;
};

export function ProfileForm({
  username,
  avatarKey: initialAvatar,
  canChangeUsername,
  nextChangeLabel,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState(username);
  const [avatarKey, setAvatarKey] = useState<AvatarKey>(initialAvatar);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body: { username?: string; avatarKey?: AvatarKey } = {};
    if (normalizeUsername(name) !== username) body.username = name;
    if (avatarKey !== initialAvatar) body.avatarKey = avatarKey;
    if (!body.username && !body.avatarKey)
      return setMessage({ ok: true, text: 'Nada para salvar.' });
    setBusy(true);
    const res = await apiFetch('/api/v1/me/profile', { method: 'PATCH', body });
    setBusy(false);
    if (!res.ok)
      return setMessage({
        ok: false,
        text: res.problem.errors?.[0]?.message ?? res.problem.detail,
      });
    setMessage({ ok: true, text: 'Perfil atualizado.' });
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-8" noValidate>
      {canChangeUsername ? (
        <UsernameField value={name} onChange={setName} current={username} />
      ) : (
        <p className="text-sm text-fg-muted">
          Você poderá trocar o nome de usuário novamente{' '}
          {nextChangeLabel ? `a partir de ${nextChangeLabel}` : 'em breve'}.
        </p>
      )}
      <AvatarPicker value={avatarKey} onChange={setAvatarKey} />
      {message ? (
        <p role="status" className={message.ok ? 'text-sm text-success' : 'text-sm text-danger'}>
          {message.text}
        </p>
      ) : null}
      <button type="submit" className={button.primary} disabled={busy}>
        {busy ? 'Salvando…' : 'Salvar alterações'}
      </button>
    </form>
  );
}
