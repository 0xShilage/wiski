'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { playAlert } from './alert-sound';
import { GoalRing, type GoalIcon } from './GoalRing';
import { SubathonTimer, type SubathonEv } from './SubathonTimer';

type Ev =
  | {
      type: 'now-playing';
      title: string | null;
      kind: string | null;
      sponsor: string | null;
      message: string | null;
    }
  | { type: 'queue'; items: { title: string; sponsor: string | null; jumped: boolean }[] }
  | {
      type: 'goal';
      title: string | null;
      metric: string | null;
      current: number | null;
      target: number | null;
      percent: number;
    }
  | {
      type: 'goal-total';
      percent: number;
      titles: number;
      funded: number;
      kinds: {
        kind: 'MOVIE' | 'SERIES' | 'FRANCHISE';
        titles: number;
        funded: number;
        percent: number;
      }[];
    }
  | {
      type: 'new-sponsorship';
      title: string;
      sponsor: string | null;
      message?: string | null;
      voice?: boolean;
      id?: string;
      at?: string;
    }
  | SubathonEv
  | { type: 'show'; seconds: number }
  | { type: 'ready' };

const KEY = /^#k=(wfo_[\w-]{43})$/;
/** no ping (every 20 s) for this long → reconnect */
const WATCHDOG_MS = 50_000;
/** how long "Novo patrocínio" stays at least (longer while the voice reads it) */
const FLASH_MS = 8_500;
/** the fade-out at the end of an alert, and the pause before the next one */
const LEAVE_MS = 600;

type Alert = {
  n: number;
  title: string;
  sponsor: string | null;
  message: string | null;
  id?: string | undefined;
  voice: boolean;
  leaving: boolean;
};
/**
 * "Agora assistindo" and "Próximos da fila" pop in (2026-11-06): two minutes when what they show
 * changes, and when !agora / !fila is typed in chat (a `show` event); hidden otherwise.
 */
const POP_MS = 120_000;
const isPop = (w: string) => w === 'agora' || w === 'fila';
/** what a pop-in widget shows, to tell a real change from the same snapshot after a reconnect */
function signature(e: Ev): string | null {
  if (e.type === 'now-playing') return e.title ? `${e.title}|${e.sponsor}|${e.message}` : null;
  if (e.type === 'queue') return e.items.map((i) => i.title).join('|') || null;
  return null;
}

type Problem = 'bad-key' | 'not-in-key' | 'denied' | 'busy' | 'offline';
/** What the streamer sees in the OBS preview when a widget can't show (never on a working one). */
const PROBLEM_TEXT: Record<Problem, (widget: string) => string> = {
  'bad-key': () => 'Chave inválida ou revogada: crie outra em Admin › Overlays e copie o endereço.',
  'not-in-key': (w) =>
    `Esta chave não inclui “${w}”: crie uma chave com esse widget marcado em Admin › Overlays.`,
  denied: (w) =>
    `Sem acesso a “${w}”: abra o endereço completo (com #k=…) de uma chave que inclua esse widget.`,
  busy: () => 'Muitas conexões agora; tentando de novo…',
  offline: () => 'Sem conexão com o site; tentando de novo…',
};
const LABEL = {
  agora: 'Agora assistindo',
  fila: 'Próximos da fila',
  meta: 'Meta',
  'meta-total': 'Meta total',
  patrocinio: 'Novo patrocínio!',
  subathon: 'Subathon',
} as const;
const KIND_LABEL = { MOVIE: 'Filmes', SERIES: 'Séries', FRANCHISE: 'Franquias' } as const;
const KIND_ICON: Record<keyof typeof KIND_LABEL, GoalIcon> = {
  MOVIE: 'film',
  SERIES: 'tv',
  FRANCHISE: 'stack',
};
const METRIC_ICON: Record<string, GoalIcon> = {
  SPONSORSHIP_COUNT: 'heart',
  SPONSORSHIP_REVENUE_CENTS: 'sparkle',
  WATCHED_MINUTES: 'clock',
};
const num = (n: number) => n.toLocaleString('pt-BR');

/**
 * OBS browser source (01 §3.4): the key in the URL fragment is exchanged for the overlay cookie
 * and removed from the address; then one SSE stream per widget. Everything is rendered as text —
 * the server already sanitised it and the schema checked it.
 * 2026-11-05: the page reconnects by itself after any drop (with a watchdog on the server's
 * pings), signs in again with the key when the cookie expires, and gets back the "Novo
 * patrocínio" alerts it missed meanwhile, each shown once.
 * 2026-11-09: "Novo patrocínio" shows the sponsor's message, plays a chime and the spoken version
 * (when the server made one); alerts that arrive together wait their turn.
 */
export function OverlayClient({ widget }: { widget: keyof typeof LABEL }) {
  const [ev, setEv] = useState<Ev | null>(null);
  const [flash, setFlash] = useState<Alert | null>(null);
  const pending = useRef<Alert[]>([]);
  const playing = useRef(false);
  const counter = useRef(0);
  /** one alert at a time: chime + voice, fade out, then the next */
  const drain = useCallback(async () => {
    if (playing.current) return;
    playing.current = true;
    const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let next = pending.current.shift(); next; next = pending.current.shift()) {
      const n = next.n;
      setFlash(next);
      await playAlert(next, FLASH_MS);
      setFlash((f) => (f && f.n === n ? { ...f, leaving: true } : f));
      await pause(LEAVE_MS);
      setFlash((f) => (f && f.n === n ? null : f));
      await pause(LEAVE_MS);
    }
    playing.current = false;
  }, []);
  const enqueue = useCallback(
    (a: Omit<Alert, 'n' | 'leaving'>) => {
      counter.current += 1;
      pending.current.push({ ...a, n: counter.current, leaving: false });
      if (pending.current.length > 10) pending.current.shift(); // a flood: keep the latest
      void drain();
    },
    [drain],
  );
  const [problem, setProblem] = useState<Problem | null>(null);
  const [away, setAway] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = useRef<string | null>(null);
  /** show the widget for `ms`, then hide it */
  const popIn = useCallback((ms: number) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setAway(false);
    hideTimer.current = setTimeout(() => setAway(true), ms);
  }, []);
  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  useEffect(() => {
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let failures = 0;
    /** the key from the address, kept in memory to sign in again when the 12 h cookie runs out */
    let key: string | null = null;
    let lastExchange = 0;
    /** the key in this address does not list this widget (another key in the cookie might) */
    let keyLacksWidget = false;
    /** server time of the last thing received: alerts missed while reconnecting come back */
    let since: string | null = null;
    const seen: string[] = [];

    const later = (fn: () => void, ms: number) => {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(fn, ms);
    };
    const backoff = () => Math.min(30_000, 1_000 * 2 ** Math.min(failures, 5));

    /** Pings come every 20 s; silence means the connection died without closing. */
    function alive() {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        es?.close();
        es = null;
        failures += 1;
        later(connect, 1_000);
      }, WATCHDOG_MS);
    }

    async function exchange(): Promise<'ok' | 'bad' | 'later'> {
      if (!key) return 'bad';
      lastExchange = Date.now();
      let res: Response | null = null;
      try {
        res = await fetch('/api/v1/overlay/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key }),
          credentials: 'same-origin',
        });
      } catch {
        return 'later';
      }
      if (res.ok) {
        if (window.location.hash) history.replaceState(null, '', window.location.pathname);
        const body = (await res.json().catch(() => null)) as { widgets?: string[] } | null;
        keyLacksWidget = !!body?.widgets && !body.widgets.includes(widget);
        return 'ok';
      }
      return res.status === 401 ? 'bad' : 'later';
    }

    /** The stream didn't open: ask why (EventSource does not expose the status). */
    async function diagnose() {
      const ac = new AbortController();
      let status = 0;
      try {
        const r = await fetch(`/api/v1/overlay/stream?widget=${widget}`, {
          credentials: 'same-origin',
          signal: ac.signal,
        });
        status = r.status;
      } catch {
        status = 0; // offline or the site is restarting
      } finally {
        ac.abort();
      }
      if (stopped) return;
      failures += 1;
      if (status === 401) {
        // the cookie ran out (12 h) or was replaced: sign in again with the key we still hold
        if (key && Date.now() - lastExchange > 30_000) {
          const r = await exchange();
          if (r === 'ok') return later(connect, 500);
          if (r === 'bad') {
            setProblem('bad-key');
            return later(connect, 60_000);
          }
        }
        setProblem(keyLacksWidget ? 'not-in-key' : 'denied');
        later(connect, 60_000); // a new key may be added in the dashboard meanwhile
      } else if (status === 200) {
        later(connect, 1_000);
      } else {
        setProblem(status === 429 ? 'busy' : 'offline');
        later(connect, backoff());
      }
    }

    function connect() {
      if (stopped) return;
      es?.close();
      const url = `/api/v1/overlay/stream?widget=${widget}${since ? `&since=${encodeURIComponent(since)}` : ''}`;
      const source = new EventSource(url);
      es = source;
      let opened = false;
      source.onopen = () => {
        opened = true;
        failures = 0;
        setProblem(null);
        alive();
      };
      source.onerror = () => {
        // 2026-11-05: always reconnect ourselves. EventSource retries only some failures and
        // gives up for good on any non-200 answer (a deploy's 502, a 429, an expired cookie),
        // which left an overlay frozen until OBS reloaded it.
        if (es !== source) return;
        source.close();
        es = null;
        if (watchdog) clearTimeout(watchdog);
        if (opened) later(connect, failures ? backoff() : 1_000);
        else void diagnose();
      };
      source.addEventListener('ping', (msg) => {
        alive();
        try {
          const at = (JSON.parse((msg as MessageEvent<string>).data) as { at?: string }).at;
          if (at && (!since || at > since)) since = at;
        } catch {
          /* a ping is only a sign of life */
        }
      });
      source.onmessage = (msg) => {
        alive();
        let data: Ev;
        try {
          data = JSON.parse(msg.data) as Ev;
        } catch {
          return;
        }
        if (data.type === 'new-sponsorship') {
          if (data.id) {
            if (seen.includes(data.id)) return; // replayed after a reconnect, already shown
            seen.push(data.id);
            if (seen.length > 50) seen.shift();
          }
          if (data.at && (!since || data.at > since)) since = data.at;
          enqueue({
            title: data.title,
            sponsor: data.sponsor,
            message: data.message ?? null,
            id: data.id,
            voice: data.voice === true,
          });
        } else if (data.type === 'show') {
          if (isPop(widget)) popIn(data.seconds * 1000);
        } else {
          setEv(data);
          if (isPop(widget)) {
            const sig = signature(data);
            if (sig !== shown.current) {
              shown.current = sig;
              if (sig) popIn(POP_MS);
            }
          }
        }
      };
    }

    void (async () => {
      const m = KEY.exec(window.location.hash);
      if (m) {
        key = m[1]!;
        const r = await exchange();
        if (r === 'bad') {
          setProblem('bad-key');
          return;
        }
        // offline / rate-limited: try the stream anyway (another source may have set the cookie)
      }
      connect();
    })();
    return () => {
      stopped = true;
      es?.close();
      if (timer) clearTimeout(timer);
      if (watchdog) clearTimeout(watchdog);
    };
  }, [widget, popIn, enqueue]);

  // an alert already on screen finishes even if the stream drops meanwhile
  if (problem && !ev && !(widget === 'patrocinio' && flash)) {
    return (
      <div className="wf-overlay__box">
        <p className="wf-overlay__sub">{PROBLEM_TEXT[problem](LABEL[widget].replace(/!$/, ''))}</p>
      </div>
    );
  }

  if (widget === 'patrocinio') {
    return flash ? (
      <div
        key={flash.n}
        className={
          flash.leaving
            ? 'wf-overlay__box wf-overlay__flash is-leaving'
            : 'wf-overlay__box wf-overlay__flash'
        }
        role="status"
      >
        <p className="wf-overlay__label">{LABEL.patrocinio}</p>
        <p className="wf-overlay__title">{flash.title}</p>
        <p className="wf-overlay__sub">{flash.sponsor ? `por ${flash.sponsor}` : 'por Anônimo'}</p>
        {flash.message ? <p className="wf-overlay__message">“{flash.message}”</p> : null}
      </div>
    ) : null;
  }
  if (!ev) return null;

  if (ev.type === 'now-playing') {
    if (!ev.title) return null;
    return (
      <div className={away ? 'wf-overlay__box is-away' : 'wf-overlay__box'}>
        <p className="wf-overlay__label">{LABEL.agora}</p>
        <p className="wf-overlay__title">{ev.title}</p>
        {ev.sponsor ? <p className="wf-overlay__sub">Patrocínio: {ev.sponsor}</p> : null}
        {ev.message ? <p className="wf-overlay__sub">“{ev.message}”</p> : null}
      </div>
    );
  }
  if (ev.type === 'queue') {
    if (!ev.items.length) return null;
    return (
      <div className={away ? 'wf-overlay__box is-away' : 'wf-overlay__box'}>
        <p className="wf-overlay__label">{LABEL.fila}</p>
        <ol className="wf-overlay__queue">
          {ev.items.map((i, n) => (
            <li key={`${n}:${i.title}`}>
              <span>
                {n + 1}. {i.title}
              </span>
              {i.jumped ? <small>⚡</small> : null}
              {i.sponsor ? <small>{i.sponsor}</small> : null}
            </li>
          ))}
        </ol>
      </div>
    );
  }
  if (ev.type === 'goal') {
    if (!ev.title) return null;
    const unit = ev.metric === 'WATCHED_MINUTES' ? ' min' : '';
    return (
      <div className="wf-goal">
        <GoalRing
          percent={ev.percent}
          icon={METRIC_ICON[ev.metric ?? ''] ?? 'sparkle'}
          burst={ev.percent}
        />
        <div className="wf-goal__text">
          <p className="wf-goal__label">{LABEL.meta}</p>
          <p className="wf-goal__title">{ev.title}</p>
          <p className="wf-goal__value">
            {ev.current !== null && ev.target !== null
              ? `${num(ev.current)} / ${num(ev.target)}${unit} · ${ev.percent}%`
              : `${ev.percent}%`}
          </p>
          {ev.percent >= 100 ? <p className="wf-goal__done">Meta batida!</p> : null}
        </div>
      </div>
    );
  }
  if (ev.type === 'subathon') return <SubathonTimer ev={ev} />;
  if (ev.type === 'goal-total') {
    if (!ev.titles) return null;
    return (
      <div className="wf-goal wf-overlay__total">
        <GoalRing percent={ev.percent} icon="sparkle" burst={ev.percent} />
        <div className="wf-goal__text">
          <p className="wf-goal__label">{LABEL['meta-total']}</p>
          <p className="wf-goal__pct wf-overlay__total-pct">{ev.percent}%</p>
          <p className="wf-goal__value">
            {ev.funded} de {ev.titles} {ev.titles === 1 ? 'título garantido' : 'títulos garantidos'}
          </p>
          <ul className="wf-goal__kinds wf-overlay__kinds">
            {ev.kinds
              .filter((k) => k.titles > 0)
              .map((k) => (
                <li key={k.kind}>
                  <span>{KIND_LABEL[k.kind]}</span>
                  <GoalRing percent={k.percent} icon={KIND_ICON[k.kind]} size="sm" />
                  <small>
                    {k.percent}% · {k.funded}/{k.titles}
                  </small>
                </li>
              ))}
          </ul>
        </div>
      </div>
    );
  }
  return null;
}
