'use client';
import { useId, useRef, useState } from 'react';
import {
  ANNOUNCE_KINDS,
  ANNOUNCE_LABEL,
  ANNOUNCE_PLACEHOLDERS,
  type AnnounceKind,
  type AnnounceSettings,
  announceProblem,
  fillAnnouncement,
} from '@/lib/announce';
import { CHAT_MAX, chatLength } from '@/lib/chat';
import { adminFetch } from '@/lib/passkey-client';

const WHEN: Record<AnnounceKind, string> = {
  start: 'Quando alguém clica em “Começar agora” na Agenda.',
  now: 'Quando um filme, série ou evento é marcado como “Agora assistindo”.',
  badge:
    'Quando um emblema está aberto durante a live (uma vez por emblema). A palavra do evento nunca vai no chat.',
};

/**
 * Chat da live › Anúncios automáticos (2026-11-13): the three messages the bot posts on its own,
 * each with a switch, its text with clickable placeholders, and a preview with example values.
 */
export function AnnouncePanel({ initial, ready }: { initial: AnnounceSettings; ready: boolean }) {
  const id = useId();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const boxes = useRef<Partial<Record<AnnounceKind, HTMLTextAreaElement | null>>>({});
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);

  function insert(kind: AnnounceKind, key: string) {
    const el = boxes.current[kind];
    const token = `{${key}}`;
    const text = draft[kind].text;
    const at = el ? el.selectionStart : text.length;
    const end = el ? el.selectionEnd : text.length;
    const next = text.slice(0, at) + token + text.slice(end);
    setDraft({ ...draft, [kind]: { ...draft[kind], text: next } });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  }

  async function save(next = draft) {
    setBusy(true);
    setToast(null);
    const r = await adminFetch<{ announce: AnnounceSettings }>('/api/v1/admin/chat/announce', {
      method: 'PUT',
      body: next,
    });
    setBusy(false);
    if (!r.ok) {
      setToast({ ok: false, text: r.problem.errors?.[0]?.message ?? r.problem.detail });
      return;
    }
    setSaved(r.data.announce);
    setDraft(r.data.announce);
    setToast({ ok: true, text: 'Anúncios salvos.' });
  }

  return (
    <section className="wf-ops-card wf-announce" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Anúncios automáticos</h2>
      <p className="wf-chat-help">
        O bot avisa o chat sozinho nesses momentos. Cada aviso sai uma vez só e fica no histórico
        como “automático”.
        {ready ? '' : ' O bot do StreamElements ainda não está configurado no servidor.'}
      </p>
      <div className="wf-announce__list">
        {ANNOUNCE_KINDS.map((k) => {
          const a = draft[k];
          const example = Object.fromEntries(
            ANNOUNCE_PLACEHOLDERS[k].map((p) => [p.key, p.example]),
          );
          const preview = fillAnnouncement(a.text, example);
          const problem = a.text ? announceProblem(k, a.text) : 'Escreva o aviso.';
          const box = `${id}-${k}`;
          return (
            <div key={k} className={`wf-announce__item${a.on ? '' : ' is-off'}`}>
              <div className="wf-announce__head">
                <h3 id={`${box}-h`}>{ANNOUNCE_LABEL[k]}</h3>
                <label className="wf-switch">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={a.on}
                    aria-describedby={`${box}-when`}
                    onChange={(e) => setDraft({ ...draft, [k]: { ...a, on: e.target.checked } })}
                  />
                  <span>{a.on ? 'Ligado' : 'Desligado'}</span>
                </label>
              </div>
              <p id={`${box}-when`} className="wf-chat-help">
                {WHEN[k]}
              </p>
              <label className="sr-only" htmlFor={box}>
                Texto do aviso: {ANNOUNCE_LABEL[k]}
              </label>
              <textarea
                id={box}
                ref={(el) => {
                  boxes.current[k] = el;
                }}
                className="wf-input"
                rows={2}
                value={a.text}
                disabled={!a.on}
                aria-invalid={problem ? true : undefined}
                aria-describedby={`${box}-preview`}
                onChange={(e) => setDraft({ ...draft, [k]: { ...a, text: e.target.value } })}
              />
              <div className="wf-chat-insert" role="group" aria-label="Inserir no aviso">
                {ANNOUNCE_PLACEHOLDERS[k].map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    className="wf-chat-chip"
                    disabled={!a.on}
                    onClick={() => insert(k, p.key)}
                  >
                    + {p.label}
                  </button>
                ))}
              </div>
              <p id={`${box}-preview`} className="wf-announce__preview">
                {problem ? (
                  <span className="wf-hint wf-hint--err">{problem}</span>
                ) : (
                  <>
                    <span className="wf-muted">Exemplo: </span>
                    {preview}
                    <span className="wf-muted">
                      {' '}
                      ({chatLength(preview)}/{CHAT_MAX})
                    </span>
                  </>
                )}
              </p>
            </div>
          );
        })}
      </div>
      <div className="wf-chat-actions">
        <button
          type="button"
          className="wf-btn wf-btn--neon"
          disabled={busy || !dirty}
          onClick={() => void save()}
        >
          Salvar anúncios
        </button>
        <button
          type="button"
          className="wf-btn wf-btn--ghost"
          disabled={busy || !dirty}
          onClick={() => setDraft(saved)}
        >
          Desfazer
        </button>
      </div>
      {toast ? (
        <p role="status" className={toast.ok ? 'wf-toast wf-toast--ok' : 'wf-toast wf-toast--err'}>
          {toast.text}
        </p>
      ) : null}
    </section>
  );
}
