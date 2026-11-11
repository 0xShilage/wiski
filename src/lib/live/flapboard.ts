/**
 * Split-flap board (2026-11-11): the Cronograma's upcoming titles as an airport departures board.
 * Pure: builds the fixed-width rows and the letters shown while they flip into place.
 */

export const FLAP_COLS = { day: 6, time: 5, title: 18, status: 8 } as const;
export const FLAP_ROWS = 8;
export const FLAP_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export type FlapStatus = 'live' | 'next' | 'later';
export const FLAP_STATUS_TEXT: Record<FlapStatus, string> = {
  live: 'AO VIVO',
  next: 'PRÓXIMA',
  later: 'AGENDADO',
};

export type FlapRow = {
  key: string;
  /** fixed width, upper case, padded with spaces */
  day: string;
  time: string;
  title: string;
  status: string;
  tone: FlapStatus;
  /** the sentence for screen readers (the tiles are hidden from them) */
  label: string;
};

type Session = {
  id: string;
  startsAt: string;
  live: boolean;
  past: boolean;
  titles: {
    title: string;
    done: boolean;
    kind: string;
    slug?: string | null;
    part?: string | null;
  }[];
};

const dayFmt = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'short',
  day: 'numeric',
  timeZone: 'America/Sao_Paulo',
});
const longDayFmt = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'America/Sao_Paulo',
});
const timeFmt = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

/** Upper case, fitted to `len` cells: cut with "…" → "." when too long, padded with spaces. */
export function fit(text: string, len: number): string {
  const up = text.toLocaleUpperCase('pt-BR').replace(/\s+/g, ' ').trim();
  const chars = [...up];
  if (chars.length > len)
    return `${chars
      .slice(0, len - 1)
      .join('')
      .trimEnd()}.`.padEnd(len, ' ');
  return up.padEnd(len, ' ');
}

/** "QUI 13" from a session start (São Paulo calendar). */
export function flapDay(iso: string): string {
  const parts = dayFmt.formatToParts(new Date(iso));
  const wd = (parts.find((p) => p.type === 'weekday')?.value ?? '').replace('.', '').slice(0, 3);
  const d = parts.find((p) => p.type === 'day')?.value ?? '';
  return fit(`${wd} ${d}`, FLAP_COLS.day);
}

/** The board's rows: titles not yet watched on lives that haven't ended, in order, at most 8. */
export function departures(sessions: Session[], limit = FLAP_ROWS): FlapRow[] {
  const rows: FlapRow[] = [];
  let nextId: string | null = null;
  for (const s of sessions) {
    if (s.past) continue;
    if (!s.live && nextId === null) nextId = s.id;
    const tone: FlapStatus = s.live ? 'live' : s.id === nextId ? 'next' : 'later';
    s.titles.forEach((t, n) => {
      if (t.done || rows.length >= limit) return;
      const name = t.part ? `${t.title} ${t.part}` : t.title;
      rows.push({
        key: `${s.id}:${n}`,
        day: flapDay(s.startsAt),
        time: fit(timeFmt.format(new Date(s.startsAt)), FLAP_COLS.time),
        title: fit(name, FLAP_COLS.title),
        status: fit(FLAP_STATUS_TEXT[tone], FLAP_COLS.status),
        tone,
        label: `${longDayFmt.format(new Date(s.startsAt))}, ${timeFmt.format(new Date(s.startsAt))}: ${name} — ${
          tone === 'live' ? 'ao vivo agora' : tone === 'next' ? 'próxima live' : 'agendado'
        }`,
      });
    });
  }
  return rows;
}

/** When the n-th cell of row r stops flipping, in ms after the board starts. */
export function settleAt(row: number, cell: number): number {
  return 200 + row * 140 + cell * 32;
}

/**
 * The letter a cell shows at `elapsed` ms: a pseudo-random letter while flipping (the same for a
 * given tick, so a re-render shows the same frame), then its own. Spaces settle straight away.
 */
export function flapChar(target: string, row: number, cell: number, elapsed: number): string {
  if (target === ' ' || elapsed >= settleAt(row, cell)) return target;
  const tick = Math.floor(elapsed / 70);
  const h = Math.imul((row * 131 + cell * 31 + tick * 17) ^ 0x9e3779b9, 2654435761) >>> 0;
  return FLAP_CHARSET[h % FLAP_CHARSET.length]!;
}

/** The board is settled once the last cell of the last row is. */
export function flapDuration(rows: number): number {
  const cells = FLAP_COLS.day + FLAP_COLS.time + FLAP_COLS.title + FLAP_COLS.status;
  return settleAt(Math.max(0, rows - 1), cells - 1) + 70;
}
