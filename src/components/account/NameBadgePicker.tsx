'use client';
import { useId, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import { choiceKey, type NameBadgeChoice, type NameBadgeOptions } from '@/lib/name-badge';
import { NameBadgeMark } from '@/components/community/NameBadge';

const KIND: Record<string, string> = {
  role: 'Equipe',
  emblem: 'Emblema',
  achievement: 'Conquista',
};

/**
 * /perfil: "Emblema ao lado do nome" (2026-11-15). Pick one of your event badges, conquistas or
 * (for the team) your role; it shows next to your @username in reviews, the ranking and your
 * profile. Saved on change; a preview shows how the name will look.
 */
export function NameBadgePicker({ username, data }: { username: string; data: NameBadgeOptions }) {
  const id = useId();
  const [current, setCurrent] = useState<NameBadgeChoice>(data.current);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const selected = data.options.find((o) => choiceKey(o.choice) === choiceKey(current));

  async function pick(next: NameBadgeChoice) {
    const before = current;
    setCurrent(next);
    setBusy(true);
    setMsg(null);
    const r = await apiFetch<{ ok: true }>('/api/v1/me/name-badge', {
      method: 'PUT',
      body: { choice: next },
    });
    setBusy(false);
    if (r.ok) {
      setMsg({
        ok: true,
        text: next.kind === 'none' ? 'Sem emblema ao lado do nome.' : 'Emblema salvo.',
      });
    } else {
      setCurrent(before);
      setMsg({ ok: false, text: r.problem.detail });
    }
  }

  return (
    <div className="wf-nb-pick">
      <div className="wf-nb-pick__preview" aria-live="polite">
        <span className="text-sm text-fg-muted">Assim seu nome aparece:</span>
        <span className="wf-named">
          <NameBadgeMark badge={selected?.badge ?? null} size="md" />@{username}
        </span>
      </div>
      {!data.visible ? (
        <p className="text-sm text-fg-muted">
          Suas conquistas e emblemas estão ocultos, então o emblema também não aparece para os
          outros. Ligue “Mostrar minhas conquistas e emblemas” acima para exibi-lo.
        </p>
      ) : null}
      {data.options.length ? (
        <fieldset className="wf-nb-pick__grid" aria-labelledby={`${id}-legend`} disabled={busy}>
          <legend id={`${id}-legend`} className="sr-only">
            Emblema ao lado do nome
          </legend>
          <label className="wf-nb-pick__opt">
            <input
              type="radio"
              name={`${id}-nb`}
              checked={current.kind === 'none'}
              onChange={() => void pick({ kind: 'none' })}
            />
            <span className="wf-nb-pick__none" aria-hidden="true">
              —
            </span>
            <span>Nenhum</span>
          </label>
          {data.options.map((o) => {
            const key = choiceKey(o.choice);
            return (
              <label key={key} className="wf-nb-pick__opt">
                <input
                  type="radio"
                  name={`${id}-nb`}
                  checked={choiceKey(current) === key}
                  onChange={() => void pick(o.choice)}
                />
                <NameBadgeMark badge={o.badge} size="md" />
                <span>
                  {o.badge.name}
                  <span className="wf-nb-pick__kind">{KIND[o.badge.kind]}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
      ) : (
        <p className="text-sm text-fg-muted">
          Ganhe uma conquista ou resgate um emblema em /emblemas para escolher o que aparece ao lado
          do seu nome.
        </p>
      )}
      {msg ? (
        <p role="status" className={msg.ok ? 'wf-toast wf-toast--ok' : 'wf-toast wf-toast--err'}>
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
