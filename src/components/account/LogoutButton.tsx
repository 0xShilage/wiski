'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { button } from '@/components/ui/styles';
import { apiFetch } from '@/lib/api-fetch';

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={button.secondary}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await apiFetch('/api/auth/logout', { method: 'POST' });
        router.replace('/');
        router.refresh();
      }}
    >
      {busy ? 'Saindo…' : 'Sair'}
    </button>
  );
}
