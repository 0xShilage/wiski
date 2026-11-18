'use client';
import { useEffect, useId, useState } from 'react';
import { BINGO_ITEM_MAX, bingoResetText, placeText, type StaffBingo } from '@/lib/bingo';
import { fmtDateTime } from '@/lib/admin/types';
import { adminFetch } from '@/lib/passkey-client';
import { NameBadgeMark } from '@/components/community/NameBadge';

type Toast = { ok: boolean; text: string } | null;

/**
 * Admin › Bingo (2026-11-16): the 18 items as buttons — press one when it happens in the chat or
 * on stream (press again to take it back, unless it already made someone win). New bingos are
 * found by the server and announced on the overlay and in chat. Below, the items' texts.
 */
export function BingoBoard({ initial }: { initial: StaffBingo }) {
  const id = useId();
  const [page, setPage] = useState(initial);
  const [busy, setBusy] = useState<number | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [texts, setTexts] = useState(() => initial.items.map((i) => i.text));
  const [saving, setSaving] = useState(false);

  // other moderators call items too: the board follows the live stream (2026-11-18), with a slow
  // poll in case it drops
  useEffect(() => {
    const reread = () =>
      void adminFetch<StaffBingo>('/api/v1/admin/bingo').then((r) => {
        if (r.ok) setPage(r.data);
      });
    let soon: ReturnType<typeof setTimeout> | undefined;
    let first = true;
    const source =
      typeof EventSource === 'undefined' ? null : new EventSource('/api/v1/bingo/events');
    if (source) {
      source.onmessage = () => {
        if (first) {
          first = false;
          return;
        }
        clearTimeout(soon);
        soon = setTimeout(reread, 300);
      };
    }
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') reread();
    }, 60_000);
    return () => {
      clearInterval(t);
      clearTimeout(soon);
      source?.close();
    };
  }, []);

  const called = new Map(page.calls.map((c) => [c.position, c]));

  async function toggle(position: number) {
    if (busy !== null) return;
    const on = !called.has(position);
    setBusy(position);
    setToast(null);
    const r = await adminFetch<{ view: StaffBingo; winners: number }>('/api/v1/admin/bingo/calls', {
      method: 'POST',
      body: { position, called: on },
    });
    setBusy(null);
    if (!r.ok) {
      setToast({ ok: false, text: r.problem.detail });
      return;
    }
    setPage(r.data.view);
    const w = r.data.winners;
    setToast({
      ok: true,
      text: !on
        ? 'Item desmarcado.'
        : w
          ? `Item marcado. ${w === 1 ? '1 pessoa fez' : `${w} pessoas fizeram`} bingo!`
          : 'Item marcado.',
    });
  }

  async function saveItems(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setToast(null);
    const r = await adminFetch<{ items: StaffBingo['items'] }>('/api/v1/admin/bingo/items', {
      method: 'PUT',
      body: { items: texts },
    });
    setSaving(false);
    if (!r.ok) {
      setToast({ ok: false, text: r.problem.errors?.[0]?.message ?? r.problem.detail });
      return;
    }
    setPage((p) => ({ ...p, items: r.data.items }));
    setTexts(r.data.items.map((i) => i.text));
    setToast({ ok: true, text: 'Itens salvos.' });
  }

  return (
    <div className="wf-bingo-admin">
      <p className="wf-bingo-admin__stats">
        <span>
          <strong>{page.calls.length}</strong> de 18 itens marcados
        </span>
        <span>
          <strong>{page.cards}</strong> {page.cards === 1 ? 'cartela' : 'cartelas'} hoje
        </span>
        <span>
          <strong>{page.winners.length}</strong> {page.winners.length === 1 ? 'bingo' : 'bingos'}
        </span>
        <span>Recomeça {bingoResetText(page.nextReset)}</span>
      </p>

      <div aria-live="polite">
        {toast ? (
          <p
            role={toast.ok ? undefined : 'alert'}
            className={toast.ok ? 'wf-toast wf-toast--ok' : 'wf-toast wf-toast--err'}
          >
            {toast.text}
          </p>
        ) : null}
      </div>

      <section aria-labelledby={`${id}-board`} className="wf-bingo-admin__items">
        <h2 id={`${id}-board`} className="wf-h2">
          Aconteceu?
        </h2>
        <ul className="wf-bingo-admin__board">
          {page.items.map((it) => {
            const c = called.get(it.position);
            return (
              <li key={it.position}>
                <button
                  type="button"
                  className="wf-bingo-admin__call"
                  aria-pressed={!!c}
                  disabled={busy !== null}
                  onClick={() => toggle(it.position)}
                  title={
                    c
                      ? `Marcado ${fmtDateTime(c.calledAt)}${c.calledBy ? ` por @${c.calledBy}` : ''}`
                      : undefined
                  }
                >
                  <span className="wf-bingo-admin__num">{it.position}</span>
                  <span>{it.text}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby={`${id}-winners`} className="wf-bingo-admin__items">
        <h2 id={`${id}-winners`} className="wf-h2">
          Ganhadores de hoje
        </h2>
        {page.winners.length ? (
          <ol className="wf-bingo__winners">
            {page.winners.map((w) => (
              <li key={w.username}>
                <span className="wf-bingo__place">{placeText(w.place)}</span>
                <span className="wf-named">
                  <NameBadgeMark badge={w.badge} />@{w.username}
                </span>
                <span className="wf-muted text-sm">{fmtDateTime(w.wonAt)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="wf-muted text-sm">Ninguém fez bingo hoje ainda.</p>
        )}
      </section>

      <form onSubmit={saveItems} className="wf-bingo-admin__items" aria-labelledby={`${id}-items`}>
        <h2 id={`${id}-items`} className="wf-h2">
          Os 18 itens
        </h2>
        <p className="wf-muted text-sm">
          O que pode acontecer no chat ou na live. Até {BINGO_ITEM_MAX} caracteres cada. Mudar um
          texto vale na hora para todas as cartelas (a posição continua a mesma).
        </p>
        <ol>
          {texts.map((t, i) => (
            <li key={i}>
              <label className="sr-only" htmlFor={`${id}-item-${i}`}>
                Item {i + 1}
              </label>
              <input
                id={`${id}-item-${i}`}
                className="wf-input"
                value={t}
                maxLength={BINGO_ITEM_MAX}
                required
                onChange={(e) => {
                  const v = e.target.value;
                  setTexts((all) => all.map((x, j) => (j === i ? v : x)));
                }}
              />
            </li>
          ))}
        </ol>
        <div>
          <button type="submit" className="wf-btn wf-btn--neon" disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar itens'}
          </button>
        </div>
      </form>
    </div>
  );
}
