/**
 * Trilha da maratona (2026-11-13): a series, anime or franchise watched over several lives, drawn
 * on its page as a board-game route — one stop per season (or film), the watched ones filled in,
 * the next one pulsing, "você está aqui" where the live stopped. Pure, for the page and the tests.
 */
import type { PublicItem } from './catalog/types';

export type TrailStop = { label: string; title: string; state: 'done' | 'next' | 'todo' };
export type Trail = {
  stops: TrailStop[];
  done: number;
  total: number;
  /** when the count last moved (null once the whole title is watched without one) */
  since: string | null;
  complete: boolean;
  unit: { one: string; many: string };
};

type TrailInput = Pick<
  PublicItem,
  'kind' | 'seasonCount' | 'films' | 'partsWatched' | 'partsWatchedAt' | 'watchedAt'
>;

export function marathonTrail(item: TrailInput): Trail | null {
  if (item.kind === 'MOVIE') return null;
  const franchise = item.kind === 'FRANCHISE';
  const total = franchise ? item.films.length : (item.seasonCount ?? 0);
  if (total < 2) return null;
  const complete = item.watchedAt !== null;
  const done = complete ? total : Math.min(item.partsWatched, total);
  if (done === 0) return null; // not started: nothing to show yet
  const stops: TrailStop[] = Array.from({ length: total }, (_, i) => ({
    label: franchise ? String(i + 1) : `T${i + 1}`,
    title: franchise ? item.films[i]!.title : `Temporada ${i + 1}`,
    state: i < done ? 'done' : i === done ? 'next' : 'todo',
  }));
  return {
    stops,
    done,
    total,
    since: item.partsWatchedAt,
    complete,
    unit: franchise ? { one: 'filme', many: 'filmes' } : { one: 'temporada', many: 'temporadas' },
  };
}
