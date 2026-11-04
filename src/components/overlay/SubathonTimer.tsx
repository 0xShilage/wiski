'use client';
import { useEffect, useRef, useState } from 'react';
import { formatClock, formatDelta } from '@/lib/subathon';

export type SubathonEv = {
  type: 'subathon';
  status: 'READY' | 'RUNNING' | 'PAUSED' | 'ENDED';
  title: string;
  remainingSeconds: number;
  endsAt: string | null;
  serverNow: string;
  last: { id: string; seconds: number; label: string | null } | null;
};

const STATE_TEXT: Record<SubathonEv['status'], string | null> = {
  READY: 'Começa em breve',
  RUNNING: null,
  PAUSED: 'Pausado',
  ENDED: 'Fim do subathon!',
};
const POP_MS = 4_500;

/**
 * The subathon widget (2026-11-03): the countdown runs in OBS on its own, from endsAt and the
 * server's clock (so a wrong clock on the streaming PC doesn't shift it); every contribution
 * pops "+5:00 · Sub de …" for a few seconds. Text nodes only.
 */
export function SubathonTimer({ ev }: { ev: SubathonEv }) {
  /** server clock − this clock (ms), measured when each event arrives */
  const offset = useRef(0);
  /** the server's time as of the ticker's last beat (null before the first beat) */
  const [serverTime, setServerTime] = useState<number | null>(null);
  const [pops, setPops] = useState<{ id: string; seconds: number; label: string | null }[]>([]);
  const [bump, setBump] = useState(0);
  const seen = useRef(new Set<string>());
  /** one removal timer per pop; a later update must not cancel an earlier pop's timer */
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const all = timers.current;
    return () => all.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    offset.current = Date.parse(ev.serverNow) - Date.now();
  }, [ev.serverNow]);

  useEffect(() => {
    const last = ev.last;
    if (!last || seen.current.has(last.id) || last.seconds === 0) return;
    seen.current.add(last.id);
    setPops((p) => [...p.slice(-3), last]);
    setBump((n) => n + 1);
    const t = setTimeout(() => {
      timers.current.delete(t);
      setPops((p) => p.filter((x) => x.id !== last.id));
    }, POP_MS);
    timers.current.add(t);
  }, [ev]);

  useEffect(() => {
    if (ev.status !== 'RUNNING') return;
    const t = setInterval(() => setServerTime(Date.now() + offset.current), 250);
    return () => clearInterval(t);
  }, [ev.status]);

  const left =
    ev.status === 'RUNNING' && ev.endsAt
      ? Math.max(
          0,
          Math.ceil(
            (Date.parse(ev.endsAt) - Math.max(serverTime ?? 0, Date.parse(ev.serverNow))) / 1000,
          ),
        )
      : ev.status === 'ENDED'
        ? 0
        : ev.remainingSeconds;
  const state = ev.status === 'RUNNING' && left === 0 ? STATE_TEXT.ENDED : STATE_TEXT[ev.status];

  return (
    <div className="wf-subathon" data-status={left === 0 ? 'ENDED' : ev.status}>
      <p className="wf-subathon__label">{ev.title}</p>
      <p key={bump} className={bump ? 'wf-subathon__clock is-bumped' : 'wf-subathon__clock'}>
        {formatClock(left)}
      </p>
      {state ? <p className="wf-subathon__state">{state}</p> : null}
      <ul className="wf-subathon__pops" aria-live="polite">
        {pops.map((p) => (
          <li key={p.id} className={p.seconds < 0 ? 'is-minus' : ''}>
            <strong>{formatDelta(p.seconds)}</strong>
            {p.label ? <span>{p.label}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
