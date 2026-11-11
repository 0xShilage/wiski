'use client';
import { useEffect, useRef, useState } from 'react';
import { FLAP_COLS, flapChar, flapDuration, type FlapRow } from '@/lib/live/flapboard';

const COLS = ['day', 'time', 'title', 'status'] as const;
const OFFSET = {
  day: 0,
  time: FLAP_COLS.day,
  title: FLAP_COLS.day + FLAP_COLS.time,
  status: FLAP_COLS.day + FLAP_COLS.time + FLAP_COLS.title,
} as const;
const HEAD = { day: 'Dia', time: 'Hora', title: 'Título', status: 'Situação' } as const;

/**
 * Split-flap board (2026-11-11): the next titles on the Cronograma as a departures board. The
 * server sends the final letters (that's also what shows without JavaScript or with "reduce
 * motion"); when the board scrolls into view, every cell flips through letters and settles, row
 * after row. Each letter is remounted when it changes, which replays the flap animation. Screen
 * readers get one sentence per row; the tiles are hidden from them.
 */
export function FlapBoard({ rows }: { rows: FlapRow[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(Number.POSITIVE_INFINITY);
  /** idle: the final letters (server render, reduce motion, not seen yet); then running → done */
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const total = flapDuration(rows.length);
    let timer = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        const start = performance.now();
        setPhase('running');
        const step = () => {
          const t = performance.now() - start;
          setElapsed(t >= total ? Number.POSITIVE_INFINITY : t);
          if (t < total) timer = window.setTimeout(step, 70);
          else setPhase('done');
        };
        step();
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearTimeout(timer);
    };
  }, [rows.length]);

  return (
    <div ref={ref} className="wf-flap" data-flap={phase}>
      <div className="wf-flap__head" aria-hidden="true">
        {COLS.map((c) => (
          <span key={c} className={`wf-flap__h wf-flap__h--${c}`}>
            {HEAD[c]}
          </span>
        ))}
      </div>
      <ol className="wf-flap__rows">
        {rows.map((row, r) => (
          <li key={row.key} className={`wf-flap__row wf-flap__row--${row.tone}`}>
            <span className="sr-only">{row.label}</span>
            {COLS.map((c) => (
              <span key={c} className={`wf-flap__cell wf-flap__cell--${c}`} aria-hidden="true">
                {[...row[c]].map((ch, i) => {
                  const shown = flapChar(ch, r, OFFSET[c] + i, elapsed);
                  return (
                    <span key={i} className="wf-flap__tile">
                      <span key={shown} className="wf-flap__glyph">
                        {shown === ' ' ? ' ' : shown}
                      </span>
                    </span>
                  );
                })}
              </span>
            ))}
          </li>
        ))}
      </ol>
    </div>
  );
}
