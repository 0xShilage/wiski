/**
 * Trilha da maratona (2026-11-13): a series, anime or franchise watched over several lives, drawn
 * on its page as a board-game route. It follows the lives themselves — the parts booked in the
 * Agenda ("T1 · E1–E4", "Filme 2: …") and marked done there — so it moves on its own as the
 * marathon goes. Pure, for the page and the tests.
 */
import type { PublicItem } from './catalog/types';

export type TrailPart = {
  label: string;
  status: 'DONE' | 'PLAYING' | 'SCHEDULED';
  /** when it was marked done (DONE), else when its live starts */
  at: string | null;
  episodes: number | null;
  franchisePosition: number | null;
};

export type TrailStop = {
  label: string;
  title: string;
  state: 'done' | 'next' | 'todo';
  /** the "você está aqui" pin (the last part the live reached, while the marathon goes on) */
  here: boolean;
  /** when the live got there */
  at: string | null;
};

export type Trail = { stops: TrailStop[]; summary: string; complete: boolean };

type TrailInput = Pick<PublicItem, 'kind' | 'films' | 'watchedAt' | 'episodeCount'> & {
  parts: TrailPart[];
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function marathonTrail(item: TrailInput): Trail | null {
  if (item.kind === 'MOVIE') return null;
  const complete = item.watchedAt !== null;
  const done = item.parts.filter((p) => p.status === 'DONE');
  const upcoming = item.parts.filter((p) => p.status !== 'DONE');
  if (!done.length && !complete) return null; // not started on stream yet
  const last = done.at(-1) ?? null;

  if (item.kind === 'FRANCHISE') {
    if (item.films.length < 2) return null;
    const seen = new Set(done.map((p) => p.franchisePosition));
    const at = new Map(done.map((p) => [p.franchisePosition, p.at]));
    let nextGiven = false;
    const stops: TrailStop[] = item.films.map((f) => {
      const isDone = complete || seen.has(f.position);
      const state = isDone ? 'done' : nextGiven ? 'todo' : ((nextGiven = true), 'next');
      return { label: String(f.position), title: f.title, state, here: false, at: null };
    });
    const n = stops.filter((s) => s.state === 'done').length;
    if (!complete && last?.franchisePosition) {
      const i = item.films.findIndex((f) => f.position === last.franchisePosition);
      if (i >= 0) {
        stops[i]!.here = true;
        stops[i]!.at = at.get(last.franchisePosition) ?? null;
      }
    }
    return {
      stops,
      complete,
      summary: complete
        ? `Maratona concluída: ${plural(item.films.length, 'filme', 'filmes')}.`
        : `${n} de ${item.films.length} filmes assistidos.`,
    };
  }

  // series and animes: one stop per live part, then the next one, then the finish line
  const stops: TrailStop[] = done.map((p) => ({
    label: p.label,
    title: p.label,
    state: 'done',
    here: false,
    at: p.at,
  }));
  if (!complete) {
    stops.at(-1)!.here = true;
    const next = upcoming[0];
    stops.push({
      label: next?.label ?? 'Próximos episódios',
      title: next?.label ?? 'Próximos episódios',
      state: 'next',
      here: false,
      at: null,
    });
  }
  if (!done.length) return null; // watched without parts on the Agenda: nothing to draw
  const finish = item.kind === 'ANIME' ? 'Fim do anime' : 'Fim da série';
  stops.push({
    label: 'Fim',
    title: finish,
    state: complete ? 'done' : 'todo',
    here: false,
    at: null,
  });
  const eps = done.reduce((s, p) => s + (p.episodes ?? 0), 0);
  const lives = plural(done.length, 'live', 'lives');
  const summary = complete
    ? `Maratona concluída${done.length ? ` em ${lives}` : ''}.`
    : item.episodeCount && eps
      ? `${eps} de ${item.episodeCount} episódios em ${lives}.`
      : `${lives} até agora.`;
  return { stops, complete, summary };
}
