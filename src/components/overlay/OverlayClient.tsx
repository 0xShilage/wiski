'use client';
import { useEffect, useState } from 'react';

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
  | { type: 'new-sponsorship'; title: string; sponsor: string | null }
  | { type: 'ready' };

const KEY = /^#k=(wfo_[\w-]{43})$/;

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
} as const;
const KIND_LABEL = { MOVIE: 'Filmes', SERIES: 'Séries', FRANCHISE: 'Franquias' } as const;

/**
 * OBS browser source (01 §3.4): the key in the URL fragment is exchanged once for the overlay
 * cookie and removed from the address; then one SSE stream per widget. Everything is rendered as
 * text — the server already sanitised it and the schema checked it.
 */
export function OverlayClient({ widget }: { widget: keyof typeof LABEL }) {
  const [ev, setEv] = useState<Ev | null>(null);
  const [flash, setFlash] = useState<{ n: number; title: string; sponsor: string | null } | null>(
    null,
  );
  const [problem, setProblem] = useState<Problem | null>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let attempt = 0;
    /** the key in this address does not list this widget (another key in the cookie might) */
    let keyLacksWidget = false;

    const retry = (ms: number) => {
      if (!stopped) timer = setTimeout(connect, ms);
    };

    /** The stream never opened: ask once why (EventSource does not expose the status). */
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
      attempt += 1;
      if (status === 401) {
        setProblem(keyLacksWidget ? 'not-in-key' : 'denied');
        retry(60_000); // a new key may be added in the dashboard meanwhile
      } else if (status === 200) {
        retry(1_000);
      } else {
        setProblem(status === 429 ? 'busy' : 'offline');
        retry(Math.min(30_000, 2_000 * 2 ** Math.min(attempt, 4)));
      }
    }

    function connect() {
      if (stopped) return;
      es?.close();
      es = new EventSource(`/api/v1/overlay/stream?widget=${widget}`);
      let opened = false;
      es.onopen = () => {
        opened = true;
        attempt = 0;
        setProblem(null);
      };
      es.onerror = () => {
        // once open, EventSource reconnects by itself; if it never opened, find out why
        if (!opened) {
          es?.close();
          void diagnose();
        }
      };
      es.onmessage = (msg) => {
        let data: Ev;
        try {
          data = JSON.parse(msg.data) as Ev;
        } catch {
          return;
        }
        if (data.type === 'new-sponsorship') {
          setFlash((f) => ({ n: (f?.n ?? 0) + 1, title: data.title, sponsor: data.sponsor }));
        } else setEv(data);
      };
    }

    void (async () => {
      const m = KEY.exec(window.location.hash);
      if (m) {
        let res: Response | null = null;
        try {
          res = await fetch('/api/v1/overlay/session', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ key: m[1] }),
            credentials: 'same-origin',
          });
        } catch {
          res = null;
        }
        if (res?.ok) {
          history.replaceState(null, '', window.location.pathname);
          const body = (await res.json().catch(() => null)) as { widgets?: string[] } | null;
          if (body?.widgets && !body.widgets.includes(widget)) keyLacksWidget = true;
        } else if (res?.status === 401) {
          setProblem('bad-key');
          return;
        }
        // offline / rate-limited: keep the key in the address and try the stream anyway
      }
      connect();
    })();
    return () => {
      stopped = true;
      es?.close();
      if (timer) clearTimeout(timer);
    };
  }, [widget]);

  if (problem && !ev) {
    return (
      <div className="wf-overlay__box">
        <p className="wf-overlay__sub">{PROBLEM_TEXT[problem](LABEL[widget].replace(/!$/, ''))}</p>
      </div>
    );
  }

  if (widget === 'patrocinio') {
    return flash ? (
      <div key={flash.n} className="wf-overlay__box wf-overlay__flash" role="status">
        <p className="wf-overlay__label">{LABEL.patrocinio}</p>
        <p className="wf-overlay__title">{flash.title}</p>
        <p className="wf-overlay__sub">{flash.sponsor ? `por ${flash.sponsor}` : 'por Anônimo'}</p>
      </div>
    ) : null;
  }
  if (!ev) return null;

  if (ev.type === 'now-playing') {
    if (!ev.title) return null;
    return (
      <div className="wf-overlay__box">
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
      <div className="wf-overlay__box">
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
    return (
      <div className="wf-overlay__box">
        <p className="wf-overlay__label">{LABEL.meta}</p>
        <p className="wf-overlay__sub">{ev.title}</p>
        <progress
          className="wf-progress"
          max={100}
          value={ev.percent}
          aria-label={`${ev.percent}%`}
        />
        <p className="wf-overlay__sub">
          {ev.current !== null && ev.target !== null
            ? `${ev.current.toLocaleString('pt-BR')} de ${ev.target.toLocaleString('pt-BR')} · ${ev.percent}%`
            : `${ev.percent}%`}
        </p>
      </div>
    );
  }
  if (ev.type === 'goal-total') {
    if (!ev.titles) return null;
    return (
      <div className="wf-overlay__box wf-overlay__total">
        <p className="wf-overlay__label">{LABEL['meta-total']}</p>
        <p className="wf-overlay__total-pct">{ev.percent}%</p>
        <progress
          className="wf-progress"
          max={100}
          value={ev.percent}
          aria-label={`${ev.percent}%`}
        />
        <p className="wf-overlay__sub">
          {ev.funded} de {ev.titles} {ev.titles === 1 ? 'título garantido' : 'títulos garantidos'}
        </p>
        <ul className="wf-overlay__kinds">
          {ev.kinds
            .filter((k) => k.titles > 0)
            .map((k) => (
              <li key={k.kind}>
                <span>{KIND_LABEL[k.kind]}</span>
                <progress
                  className="wf-progress"
                  max={100}
                  value={k.percent}
                  aria-label={`${KIND_LABEL[k.kind]}: ${k.percent}%`}
                />
                <small>
                  {k.percent}% · {k.funded}/{k.titles}
                </small>
              </li>
            ))}
        </ul>
      </div>
    );
  }
  return null;
}
