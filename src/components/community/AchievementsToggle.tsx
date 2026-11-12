'use client';
import { useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';

/** /perfil: badges on the public profile and a place in /ranking — on or off. */
export function AchievementsToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function change(next: boolean) {
    // optimistic: the switch moves at once and goes back if the save fails
    setOn(next);
    setBusy(true);
    setMsg(null);
    const r = await apiFetch<{ ok: true }>('/api/v1/me/profile', {
      method: 'PATCH',
      body: { showAchievements: next },
    });
    setBusy(false);
    if (r.ok) {
      setMsg({
        ok: true,
        text: next
          ? 'Suas conquistas aparecem no perfil público e no ranking.'
          : 'Suas conquistas ficam só aqui, e você saiu do ranking.',
      });
    } else {
      setOn(!next);
      setMsg({ ok: false, text: r.problem.detail });
    }
  }

  return (
    <div className="wf-badges-toggle">
      <label className="wf-switch">
        <input
          type="checkbox"
          checked={on}
          disabled={busy}
          onChange={(e) => void change(e.target.checked)}
        />
        Mostrar minhas conquistas e emblemas no perfil público e no ranking
      </label>
      {msg ? (
        <p role="status" className={msg.ok ? 'wf-toast wf-toast--ok' : 'wf-toast wf-toast--err'}>
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
