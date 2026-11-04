/**
 * Live segments (2026-11-04): how a part of a series or franchise is named on the schedule, and a
 * first guess at how long it runs. Shared by the dashboard form and the server.
 */
export const SEGMENT_LABEL_MAX = 80;

/** "T1 · E1–E3", "T2 · E4". */
export function episodesLabel(season: number, from: number, to: number): string {
  return `T${season} · ${from === to ? `E${from}` : `E${from}–E${to}`}`;
}

/** "Filme 2: O Retorno", cut to fit the label column. */
export function filmLabel(position: number, title: string): string {
  const full = `Filme ${position}: ${title}`;
  const chars = [...full];
  return chars.length <= SEGMENT_LABEL_MAX
    ? full
    : `${chars.slice(0, SEGMENT_LABEL_MAX - 1).join('')}…`;
}

/** Minutes per episode: the series' total runtime over its episodes, else 45. */
export function minutesPerEpisode(item: {
  runtimeMinutes: number;
  episodeCount: number | null;
}): number {
  if (item.episodeCount && item.episodeCount > 0 && item.runtimeMinutes > 0) {
    return Math.max(1, Math.round(item.runtimeMinutes / item.episodeCount));
  }
  return 45;
}
