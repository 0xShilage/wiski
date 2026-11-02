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
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let es: EventSource | null = null;
    let stopped = false;
    void (async () => {
      const m = KEY.exec(window.location.hash);
      if (m) {
        await fetch('/api/v1/overlay/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key: m[1] }),
          credentials: 'same-origin',
        });
        history.replaceState(null, '', window.location.pathname);
      }
      if (stopped) return;
      es = new EventSource(`/api/v1/overlay/stream?widget=${widget}`);
      let opened = false;
      es.onopen = () => {
        opened = true;
        setDenied(false);
      };
      es.onerror = () => {
        // never connected: the key is missing, revoked or not for this widget — stop retrying
        if (!opened) {
          es?.close();
          setDenied(true);
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
    })();
    return () => {
      stopped = true;
      es?.close();
    };
  }, [widget]);

  if (denied && !ev) {
    return (
      <div className="wf-overlay__box">
        <p className="wf-overlay__sub">Overlay sem acesso: confira a chave no painel.</p>
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
