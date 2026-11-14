'use client';
import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { fmtDateTime } from '@/lib/admin/types';
import {
  CHAT_MAX,
  chatLength,
  chatProblem,
  type ChatVars,
  expand,
  oneLine,
  PLACEHOLDERS,
  type PlaceholderKey,
  PRESET_LABEL_MAX,
  PRESET_MAX,
} from '@/lib/chat';
import { adminFetch } from '@/lib/passkey-client';

/**
 * Admin › Chat da live (2026-11-11): write to the Twitch chat as the StreamElements bot. A
 * composer with placeholders ({site}, {agora}, {proxima}, filled in when it is sent) and a preview
 * of the line as it will show; "Mensagens prontas" to send in one click; and the last messages
 * sent from here, by whom. Ctrl/⌘ + Enter sends. Refreshes every 30 s while the tab is visible.
 */
type Preset = { id: string; label: string; text: string };
type Sent = {
  id: string;
  at: string;
  by: string | null;
  text: string;
  ok: boolean;
  auto: 'start' | 'now' | 'badge' | null;
};
export type ChatPanelData = {
  ready: boolean;
  live: boolean;
  vars: ChatVars;
  presets: Preset[];
  history: Sent[];
};
type Toast = { ok: boolean; text: string } | null;

const TOKEN_SPLIT = /(\{(?:site|agora|proxima)\})/;

/** The text with its placeholders shown as chips (missing ones flagged). */
function WithTokens({ text, vars }: { text: string; vars: ChatVars | null }) {
  return (
    <>
      {text.split(TOKEN_SPLIT).map((part, i) => {
        const m = /^\{(site|agora|proxima)\}$/.exec(part);
        if (!m) return <Fragment key={i}>{part}</Fragment>;
        const key = m[1] as PlaceholderKey;
        const value = vars?.[key];
        if (vars && !value)
          return (
            <mark key={i} className="wf-chat-token wf-chat-token--missing">
              {PLACEHOLDERS.find((p) => p.key === key)!.label}?
            </mark>
          );
        return (
          <mark key={i} className="wf-chat-token">
            {vars ? value : `{${key}}`}
          </mark>
        );
      })}
    </>
  );
}

export function ChatPanel({ initial }: { initial: ChatPanelData }) {
  const id = useId();
  const [data, setData] = useState(initial);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [editing, setEditing] = useState<{
    index: number | null;
    label: string;
    text: string;
  } | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  async function reload() {
    const r = await adminFetch<ChatPanelData>('/api/v1/admin/chat');
    if (r.ok) setData(r.data);
  }
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, 30_000);
    return () => window.clearInterval(t);
  }, []);

  const line = oneLine(text);
  const { text: expanded, missing } = expand(line, data.vars);
  const length = chatLength(expanded);
  const problem = line ? (missing.length ? null : chatProblem(expanded)) : null;
  const canSend = data.ready && !!line && !missing.length && !problem && !busy;

  async function send(message: string, from: 'composer' | 'preset') {
    setBusy(true);
    setToast(null);
    const r = await adminFetch<{ sent: Sent }>('/api/v1/admin/chat', {
      method: 'POST',
      body: { text: message },
    });
    setBusy(false);
    if (r.ok) {
      setToast({ ok: true, text: `Enviada no chat: “${r.data.sent.text}”` });
      if (from === 'composer') setText('');
    } else {
      setToast({ ok: false, text: r.problem.errors?.[0]?.message ?? r.problem.detail });
    }
    await reload();
  }

  async function savePresets(next: Preset[], label: string) {
    setBusy(true);
    setToast(null);
    const r = await adminFetch<{ presets: Preset[] }>('/api/v1/admin/chat/presets', {
      method: 'PUT',
      body: { presets: next },
    });
    setBusy(false);
    if (r.ok) {
      setData((d) => ({ ...d, presets: r.data.presets }));
      setToast({ ok: true, text: label });
      return true;
    }
    setToast({ ok: false, text: r.problem.errors?.[0]?.message ?? r.problem.detail });
    return false;
  }

  function insert(key: PlaceholderKey) {
    const el = box.current;
    const token = `{${key}}`;
    if (!el) return setText((t) => `${t}${token}`);
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = `${text.slice(0, start)}${token}${text.slice(end)}`;
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function move(index: number, by: -1 | 1) {
    const next = [...data.presets];
    const [p] = next.splice(index, 1);
    next.splice(index + by, 0, p!);
    void savePresets(next, 'Ordem salva.');
  }

  const counterClass =
    length > CHAT_MAX
      ? 'wf-chat-count is-over'
      : length > CHAT_MAX - 50
        ? 'wf-chat-count is-near'
        : 'wf-chat-count';

  return (
    <>
      <div className="wf-chat-status" role="group" aria-label="Situação">
        <span className={data.ready ? 'wf-chat-pill is-ok' : 'wf-chat-pill is-off'}>
          {data.ready ? 'Bot do StreamElements pronto' : 'Bot do StreamElements não configurado'}
        </span>
        <span className={data.live ? 'wf-chat-pill is-live' : 'wf-chat-pill'}>
          {data.live ? 'Ao vivo agora' : 'Fora do ar'}
        </span>
        {data.vars.agora ? <span className="wf-chat-pill">Passando: {data.vars.agora}</span> : null}
      </div>
      {!data.ready ? (
        <p className="wf-toast wf-toast--err">
          Falta o STREAMELEMENTS_JWT no app.env do servidor (o mesmo usado pelo Subathon e pelo
          agradecimento de patrocínio). Sem ele, nada é enviado.
        </p>
      ) : null}
      {toast ? (
        <p role="status" className={toast.ok ? 'wf-toast wf-toast--ok' : 'wf-toast wf-toast--err'}>
          {toast.text}
        </p>
      ) : null}

      <div className="wf-chat-grid">
        <div className="wf-chat-col">
          <form
            className="wf-ops-card wf-chat-composer"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSend) void send(text, 'composer');
            }}
          >
            <h2>Escrever no chat</h2>
            <label className="wf-field" htmlFor={`${id}-msg`}>
              <span className="wf-field__row">
                <span>Mensagem</span>
                <span className={counterClass} aria-live="polite">
                  {length}/{CHAT_MAX}
                </span>
              </span>
              <textarea
                id={`${id}-msg`}
                ref={box}
                className="wf-input"
                rows={3}
                value={text}
                placeholder="Escreva para o chat… (Ctrl + Enter envia)"
                aria-describedby={`${id}-help`}
                aria-invalid={!!problem || missing.length > 0}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    if (canSend) void send(text, 'composer');
                  }
                }}
              />
            </label>
            <div className="wf-chat-insert" role="group" aria-label="Inserir na mensagem">
              {PLACEHOLDERS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className="wf-chat-chip"
                  onClick={() => insert(p.key)}
                  title={data.vars[p.key] ?? 'Indisponível agora'}
                >
                  + {p.label}
                  <small>{data.vars[p.key] ?? 'indisponível agora'}</small>
                </button>
              ))}
            </div>
            <p id={`${id}-help`} className="wf-chat-help">
              Os campos entre chaves são preenchidos na hora do envio. Comandos do Twitch (“/” ou
              “.” no começo) não são enviados daqui.
            </p>

            <div className="wf-chat-preview" aria-label="Como vai aparecer no chat">
              <span className="wf-chat-preview__who">
                <span className="wf-chat-preview__badge" aria-hidden="true">
                  ★
                </span>
                StreamElements:
              </span>{' '}
              {line ? (
                <WithTokens text={line} vars={data.vars} />
              ) : (
                <span className="wf-chat-preview__empty">sua mensagem aparece aqui</span>
              )}
            </div>
            {missing.length ? (
              <p className="wf-chat-warn">
                Não dá para enviar agora:{' '}
                {missing
                  .map((k) =>
                    k === 'agora'
                      ? 'nada está marcado como passando'
                      : k === 'proxima'
                        ? 'não há live planejada'
                        : 'endereço indisponível',
                  )
                  .join('; ')}
                .
              </p>
            ) : problem ? (
              <p className="wf-chat-warn">{problem}</p>
            ) : null}

            <div className="wf-chat-actions">
              <button type="submit" className="wf-btn wf-btn--neon" disabled={!canSend}>
                Enviar no chat
              </button>
              <button
                type="button"
                className="wf-btn wf-btn--ghost"
                disabled={!line || data.presets.length >= PRESET_MAX || busy}
                onClick={() => setEditing({ index: null, label: '', text: line })}
              >
                Salvar como pronta
              </button>
              {text ? (
                <button type="button" className="wf-btn wf-btn--ghost" onClick={() => setText('')}>
                  Limpar
                </button>
              ) : null}
            </div>
          </form>

          <section className="wf-ops-card" aria-labelledby={`${id}-presets`}>
            <div className="wf-chat-head">
              <h2 id={`${id}-presets`}>Mensagens prontas</h2>
              <button
                type="button"
                className="wf-btn wf-btn--ghost wf-btn--sm"
                disabled={data.presets.length >= PRESET_MAX || busy}
                onClick={() => setEditing({ index: null, label: '', text: '' })}
              >
                Nova
              </button>
            </div>
            {editing ? (
              <form
                className="wf-chat-edit"
                aria-label={
                  editing.index === null ? 'Nova mensagem pronta' : 'Editar mensagem pronta'
                }
                onSubmit={async (e) => {
                  e.preventDefault();
                  const next = [...data.presets];
                  const item = { label: editing.label, text: editing.text };
                  if (editing.index === null) next.push({ id: '', ...item });
                  else next[editing.index] = { ...next[editing.index]!, ...item };
                  const body = next.map((p) => (p.id ? p : { label: p.label, text: p.text }));
                  if (await savePresets(body as Preset[], 'Mensagem pronta salva.'))
                    setEditing(null);
                }}
              >
                <label className="wf-field" htmlFor={`${id}-plabel`}>
                  Nome do botão
                  <input
                    id={`${id}-plabel`}
                    className="wf-input"
                    value={editing.label}
                    maxLength={PRESET_LABEL_MAX}
                    placeholder="Ex.: Patrocinar"
                    onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                  />
                </label>
                <label className="wf-field" htmlFor={`${id}-ptext`}>
                  Mensagem
                  <textarea
                    id={`${id}-ptext`}
                    className="wf-input"
                    rows={2}
                    value={editing.text}
                    onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                  />
                </label>
                <div className="wf-chat-actions">
                  <button type="submit" className="wf-btn wf-btn--neon" disabled={busy}>
                    Salvar
                  </button>
                  <button
                    type="button"
                    className="wf-btn wf-btn--ghost"
                    onClick={() => setEditing(null)}
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            ) : null}
            {data.presets.length ? (
              <ul className="wf-ops-list">
                {data.presets.map((p, i) => {
                  const { missing: gaps } = expand(p.text, data.vars);
                  return (
                    <li key={p.id} className="wf-ops-row wf-chat-preset">
                      <div className="wf-ops-row__main">
                        <span className="wf-ops-row__title">{p.label}</span>
                        <span className="wf-chat-preset__text">
                          <WithTokens text={p.text} vars={null} />
                        </span>
                      </div>
                      <div className="wf-chat-preset__actions">
                        <button
                          type="button"
                          className="wf-btn wf-btn--neon wf-btn--sm"
                          disabled={!data.ready || busy || gaps.length > 0}
                          title={gaps.length ? 'Algum campo está indisponível agora' : undefined}
                          aria-label={`Enviar “${p.label}” no chat`}
                          onClick={() => void send(p.text, 'preset')}
                        >
                          Enviar
                        </button>
                        <button
                          type="button"
                          className="wf-btn wf-btn--ghost wf-btn--sm"
                          aria-label={`Usar “${p.label}” na caixa de mensagem`}
                          onClick={() => {
                            setText(p.text);
                            box.current?.focus();
                          }}
                        >
                          Usar
                        </button>
                        <button
                          type="button"
                          className="wf-btn wf-btn--ghost wf-btn--sm"
                          aria-label={`Editar “${p.label}”`}
                          onClick={() => setEditing({ index: i, label: p.label, text: p.text })}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="wf-btn wf-btn--ghost wf-btn--sm"
                          aria-label={`Subir “${p.label}”`}
                          disabled={i === 0 || busy}
                          onClick={() => move(i, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="wf-btn wf-btn--ghost wf-btn--sm"
                          aria-label={`Descer “${p.label}”`}
                          disabled={i === data.presets.length - 1 || busy}
                          onClick={() => move(i, 1)}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="wf-btn wf-btn--ghost wf-btn--sm wf-chat-del"
                          aria-label={`Apagar “${p.label}”`}
                          disabled={busy}
                          onClick={() =>
                            void savePresets(
                              data.presets.filter((_, j) => j !== i),
                              'Mensagem pronta apagada.',
                            )
                          }
                        >
                          Apagar
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="wf-chat-help">Nenhuma mensagem pronta. Crie uma com “Nova”.</p>
            )}
          </section>
        </div>

        <section className="wf-ops-card wf-chat-history" aria-labelledby={`${id}-history`}>
          <h2 id={`${id}-history`}>Enviadas</h2>
          {data.history.length ? (
            <ol className="wf-chat-log">
              {data.history.map((h) => (
                <li key={h.id} className={h.ok ? 'wf-chat-log__row' : 'wf-chat-log__row is-failed'}>
                  <div className="wf-chat-log__meta">
                    <time dateTime={h.at}>{fmtDateTime(h.at)}</time>
                    <span>{h.auto ? 'automático' : h.by ? `@${h.by}` : 'sistema'}</span>
                    <span className={h.ok ? 'wf-chat-pill is-ok' : 'wf-chat-pill is-off'}>
                      {h.ok ? 'Enviada' : 'Não enviada'}
                    </span>
                  </div>
                  <p className="wf-chat-log__text">{h.text}</p>
                  <button
                    type="button"
                    className="wf-btn wf-btn--ghost wf-btn--sm"
                    aria-label={`Usar de novo: ${h.text}`}
                    onClick={() => {
                      setText(h.text);
                      box.current?.focus();
                    }}
                  >
                    Usar de novo
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="wf-chat-help">Nada enviado ainda.</p>
          )}
        </section>
      </div>
    </>
  );
}
