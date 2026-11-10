'use client';
import { useId, useState } from 'react';
import { adminFetch } from '@/lib/passkey-client';

export type AlertSettingsView = {
  voice: boolean;
  voiceName: string;
  chat: boolean;
  voiceReady: boolean;
  chatReady: boolean;
};

/**
 * "Alerta de patrocínio" (2026-11-09): the chime always plays; the voice (Google, pt-BR) reads the
 * name, the title and the message; the StreamElements bot thanks the sponsor in chat.
 * "Testar alerta" sends a sample to every "Novo patrocínio" source (never to chat).
 */
export function AlertSettingsPanel({
  initial,
  voices,
}: {
  initial: AlertSettingsView;
  voices: readonly { id: string; label: string }[];
}) {
  const id = useId();
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(next: AlertSettingsView) {
    setBusy(true);
    setToast(null);
    const r = await adminFetch<{ alerts: AlertSettingsView }>('/api/v1/admin/alerts', {
      method: 'PUT',
      body: { voice: next.voice, voiceName: next.voiceName, chat: next.chat },
    });
    setBusy(false);
    if (r.ok) {
      setS(r.data.alerts);
      setToast({ ok: true, text: 'Salvo.' });
    } else setToast({ ok: false, text: r.problem.detail });
  }

  async function test() {
    setBusy(true);
    setToast(null);
    const r = await adminFetch<{ voice: boolean }>('/api/v1/admin/alerts/test', {
      method: 'POST',
    });
    setBusy(false);
    setToast(
      r.ok
        ? {
            ok: true,
            text: r.data.voice
              ? 'Alerta de teste enviado, com voz.'
              : 'Alerta de teste enviado (sem voz).',
          }
        : { ok: false, text: r.problem.detail },
    );
  }

  return (
    <section className="wf-ops-card" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Alerta de patrocínio</h2>
      <p className="wf-muted m-0 text-sm">
        Cada patrocínio (pelo site ou “Já pago”) aparece no overlay “Novo patrocínio” com o nome — o
        @ de quem está logado ou o nome digitado por quem não tem conta — e a mensagem, toca um
        sininho e pode ser lido em voz alta. Links e palavrões são tirados antes de ir para a live.
        No OBS, marque “Controlar áudio via OBS” na fonte do overlay para o som entrar na live.
      </p>
      {toast ? (
        <p role="status" className={toast.ok ? 'wf-toast wf-toast--ok' : 'wf-toast wf-toast--err'}>
          {toast.text}
        </p>
      ) : null}
      <div className="wf-ops-form mt-3">
        <label className="wf-switch full">
          <input
            type="checkbox"
            checked={s.voice}
            disabled={busy || !s.voiceReady}
            onChange={(e) => void save({ ...s, voice: e.target.checked })}
          />
          Ler o patrocínio em voz alta (português do Brasil)
        </label>
        {s.voiceReady ? null : (
          <p className="wf-hint full m-0">
            Falta a chave do Google Text-to-Speech no servidor (GOOGLE_TTS_API_KEY). Sem ela, só o
            sininho toca.
          </p>
        )}
        <label className="wf-field" htmlFor={`${id}-voice`}>
          <span>Voz</span>
          <select
            id={`${id}-voice`}
            className="wf-input"
            value={s.voiceName}
            disabled={busy || !s.voiceReady}
            onChange={(e) => void save({ ...s, voiceName: e.target.value })}
          >
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <label className="wf-switch full">
          <input
            type="checkbox"
            checked={s.chat}
            disabled={busy || !s.chatReady}
            onChange={(e) => void save({ ...s, chat: e.target.checked })}
          />
          Agradecer no chat pelo bot do StreamElements: “Fulano patrocinou Título! Muito obrigada
          por seu apoio 🍿🎥”
        </label>
        {s.chatReady ? null : (
          <p className="wf-hint full m-0">
            Falta o JWT do StreamElements no servidor (STREAMELEMENTS_JWT).
          </p>
        )}
        <span className="wf-ops-actions full">
          <button
            type="button"
            className="wf-btn wf-btn--sm wf-btn--ghost"
            disabled={busy}
            onClick={() => void test()}
          >
            Testar alerta
          </button>
        </span>
      </div>
    </section>
  );
}
