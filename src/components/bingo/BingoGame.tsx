'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { NameBadgeMark } from '@/components/community/NameBadge';
import { apiFetch, type Problem } from '@/lib/api-fetch';
import { bingoResetText, lineCells, placeText, type MyBingo } from '@/lib/bingo';

/** Who is looking: signed out, not onboarded yet, suspended, or able to play. */
export type BingoViewer = 'guest' | 'onboarding' | 'suspended' | 'ready';

/** how often the page asks what was called while it is open (only while the tab is visible) */
const POLL_MS = 60_000;

/**
 * /bingo (2026-11-16): the viewer's 3×3 card, stamped as the team calls items; the completed line
 * glows. Today's calls and winners below. While the tab is visible the page listens to
 * /api/v1/bingo/events (2026-11-18) and re-reads the day the moment the team calls an item; a
 * slow poll (every 60 s) covers a dropped stream. The card itself is drawn by the server.
 */
export function BingoGame({
  initial,
  viewer,
  signInHref,
}: {
  initial: MyBingo;
  viewer: BingoViewer;
  signInHref: string | null;
}) {
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [news, setNews] = useState<string | null>(null);
  const [nextText, setNextText] = useState(() => bingoResetText(initial.nextReset));
  const hadWin = useRef(!!initial.win);

  const text = useMemo(() => new Map(view.items.map((i) => [i.position, i.text])), [view.items]);
  const called = useMemo(() => new Set(view.called), [view.called]);
  const glowing = useMemo(
    () => new Set(view.card ? lineCells(view.card.cells, view.win?.line ?? null) : []),
    [view.card, view.win],
  );

  const apply = useCallback((next: MyBingo) => {
    setView(next);
    setNextText(bingoResetText(next.nextReset));
    if (next.win && !hadWin.current) {
      setNews(`BINGO! Você completou uma linha e é o ${placeText(next.win.place)} lugar de hoje.`);
    }
    hadWin.current = !!next.win;
  }, []);

  const refresh = useCallback(async () => {
    const r = await apiFetch<MyBingo>('/api/v1/bingo');
    if (r.ok) apply(r.data);
  }, [apply]);

  useEffect(() => {
    if (viewer !== 'ready') return;
    let source: EventSource | null = null;
    let soon: ReturnType<typeof setTimeout> | undefined;
    let first = true;
    const open = () => {
      if (source || typeof EventSource === 'undefined') return;
      first = true;
      source = new EventSource('/api/v1/bingo/events');
      source.onmessage = () => {
        // the first message is the state when the stream opened: the page already has it,
        // unless the tab was hidden for a while (then re-read once)
        if (first) {
          first = false;
          return;
        }
        // a call can bring a few events together (the call, then the bingo): read once
        clearTimeout(soon);
        soon = setTimeout(() => void refresh(), 300);
      };
    };
    const close = () => {
      source?.close();
      source = null;
    };
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
        open();
      } else close();
    };
    if (document.visibilityState === 'visible') open();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(t);
      clearTimeout(soon);
      close();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [viewer, refresh]);

  async function takeCard() {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const r = await apiFetch<{ view: MyBingo; place: number | null }>('/api/v1/bingo/card', {
      method: 'POST',
      body: {},
    });
    setBusy(false);
    if (!r.ok) {
      setProblem(r.problem);
      return;
    }
    apply(r.data.view);
    if (!r.data.place) setNews('Sua cartela de hoje está pronta. Boa sorte!');
  }

  const card = view.card;
  return (
    <div className="wf-bingo">
      <section className="wf-bingo__stage" aria-labelledby="bingo-card">
        <h2 id="bingo-card" className="wf-h2">
          Sua cartela
        </h2>
        {card ? (
          <ol className={view.win ? 'wf-bingo__card is-won' : 'wf-bingo__card'}>
            {card.cells.map((p, i) => {
              const on = called.has(p);
              const line = glowing.has(i);
              return (
                <li
                  key={p}
                  className={['wf-bingo__cell', on && 'is-called', line && 'is-line']
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span className="wf-bingo__text">{text.get(p) ?? `Item ${p}`}</span>
                  {on ? (
                    <span className="wf-bingo__stamp">
                      <span className="sr-only">: aconteceu</span>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="wf-bingo__empty">
            {viewer === 'guest' ? (
              <>
                <p>Entre com sua conta Google para receber sua cartela de hoje.</p>
                {signInHref ? (
                  <a href={signInHref} className="wf-btn wf-btn--neon" rel="nofollow">
                    Entrar com Google
                  </a>
                ) : (
                  <p className="wf-notice">Login indisponível neste ambiente.</p>
                )}
              </>
            ) : viewer === 'onboarding' ? (
              <>
                <p>Escolha seu nome de usuário antes de jogar.</p>
                <Link href="/bem-vindo" className="wf-btn wf-btn--neon">
                  Escolher nome de usuário
                </Link>
              </>
            ) : viewer === 'suspended' ? (
              <p className="wf-notice">Sua conta está suspensa e não pode jogar o bingo agora.</p>
            ) : (
              <>
                <p>Sua cartela de hoje tem 9 coisas que podem acontecer na live. Sorte!</p>
                <button
                  type="button"
                  className="wf-btn wf-btn--neon"
                  onClick={takeCard}
                  disabled={busy}
                >
                  {busy ? 'Sorteando…' : 'Pegar minha cartela'}
                </button>
              </>
            )}
          </div>
        )}
        <div aria-live="polite" className="wf-bingo__result">
          {view.win ? (
            <p className="wf-toast wf-toast--ok">
              <strong>BINGO!</strong> Você é o {placeText(view.win.place)} lugar de hoje.
            </p>
          ) : news ? (
            <p className="wf-toast">{news}</p>
          ) : null}
          {problem ? (
            <p role="alert" className="wf-toast wf-toast--err">
              {problem.detail}
            </p>
          ) : null}
        </div>
        <p className="wf-bingo__fine">Cartelas novas todo dia às 16h · próxima {nextText}.</p>
      </section>

      <section className="wf-bingo__side" aria-labelledby="bingo-called">
        <h2 id="bingo-called" className="wf-h2">
          Já aconteceu hoje
        </h2>
        {view.called.length ? (
          <ol className="wf-bingo__called">
            {[...view.called].reverse().map((p) => (
              <li key={p} className={card?.cells.includes(p) ? 'is-mine' : undefined}>
                {text.get(p) ?? `Item ${p}`}
                {card?.cells.includes(p) ? (
                  <span className="sr-only"> (na sua cartela)</span>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="wf-muted text-sm">Nada ainda. A equipe marca cada item quando acontece.</p>
        )}

        <h2 id="bingo-winners" className="wf-h2">
          Ganhadores de hoje
        </h2>
        {view.winners.length ? (
          <ol className="wf-bingo__winners" aria-labelledby="bingo-winners">
            {view.winners.map((w) => (
              <li key={w.username}>
                <span className="wf-bingo__place">{placeText(w.place)}</span>
                <Avatar avatarKey={w.avatarKey} size={32} alt="" />
                <Link href={`/u/${w.username}`} prefetch={false} className="wf-bingo__who">
                  <span className="wf-named">
                    <NameBadgeMark badge={w.badge} />@{w.username}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <p className="wf-muted text-sm">Ninguém fez bingo hoje ainda.</p>
        )}
      </section>
    </div>
  );
}
