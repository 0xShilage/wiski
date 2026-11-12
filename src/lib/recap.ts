/**
 * "Seu ano na Wiskiflix" (2026-11-12): a viewer's year as swipeable story cards. Shared by the
 * server (which counts) and the player (which shows). Counts only — amounts never appear.
 */
import type { BadgeView } from '@/lib/badges';
import type { Picture } from '@/lib/media';

/** America/Sao_Paulo is a fixed −03:00 (no DST since 2019). */
const BRT_OFFSET_MS = 3 * 3_600_000;
/** the site's first year: nothing to look back on before it */
export const RECAP_FIRST_YEAR = 2026;

export function saoPauloYear(now: Date): { year: number; month: number } {
  const local = new Date(now.getTime() - BRT_OFFSET_MS);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() };
}

/** [start, end) of a São Paulo calendar year, as UTC instants. */
export function yearBounds(year: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, 0, 1) + BRT_OFFSET_MS),
    end: new Date(Date.UTC(year + 1, 0, 1) + BRT_OFFSET_MS),
  };
}

/** The year the page opens on: the current one, or last year during January. */
export function defaultRecapYear(now: Date): number {
  const { year, month } = saoPauloYear(now);
  return month === 0 && year - 1 >= RECAP_FIRST_YEAR ? year - 1 : year;
}

/** `?ano=` → a year that can be shown, or null (then the default). */
export function parseRecapYear(raw: unknown, now: Date): number | null {
  if (typeof raw !== 'string' || !/^\d{4}$/.test(raw)) return null;
  const y = Number(raw);
  return y >= RECAP_FIRST_YEAR && y <= saoPauloYear(now).year ? y : null;
}

/** December and January: the home page points to the recap. */
export function isRecapSeason(now: Date): boolean {
  const { month } = saoPauloYear(now);
  return month === 11 || month === 0;
}

export type RecapTitle = {
  slug: string;
  title: string;
  kind: 'MOVIE' | 'SERIES' | 'FRANCHISE' | 'ANIME';
  poster: Picture | null;
};

export type Recap = {
  year: number;
  username: string;
  avatarKey: string;
  memberSince: string;
  /** what the live watched this year (everyone's) */
  site: {
    titles: number;
    movies: number;
    series: number;
    movieMinutes: number;
    lives: number;
    wall: RecapTitle[];
  };
  mine: {
    sponsorships: number;
    sponsored: RecapTitle[];
    contributions: number;
    supported: RecapTitle[];
    /** running time of the films they sponsored that the live watched this year */
    minutes: number;
    reviews: number;
    averageRating: number | null;
    likesReceived: number;
    topReview: { title: string; slug: string; likes: number; rating: number } | null;
    suggestions: number;
    suggestionsTaken: number;
    spins: number;
    prizes: number;
    badges: BadgeView[];
  };
};

export type PersonaId =
  'patrocinio' | 'vaquinha' | 'critica' | 'curadoria' | 'emblemas' | 'roleta' | 'primeira-fila';

export type Persona = { id: PersonaId; title: string; line: string };

const PERSONAS: Record<PersonaId, Omit<Persona, 'id'>> = {
  patrocinio: {
    title: 'Quem banca a sessão',
    line: 'Sem você, a tela ficava escura. Os filmes entraram na live pelas suas mãos.',
  },
  vaquinha: {
    title: 'Mão na vaquinha',
    line: 'Cada cadeira que você ocupou ajudou uma série inteira a chegar à live.',
  },
  critica: {
    title: 'Voz da crítica',
    line: 'Suas avaliações deram o tom do que a gente assistiu.',
  },
  curadoria: {
    title: 'Faro para sugestões',
    line: 'Você sabe o que a live precisa ver antes de todo mundo.',
  },
  emblemas: {
    title: 'Caça-emblemas',
    line: 'Maratona, sessão especial, evento: você estava lá e tem o emblema para provar.',
  },
  roleta: {
    title: 'Sorte na roleta',
    line: 'Gira, gira, gira — e a roleta sorriu para você.',
  },
  'primeira-fila': {
    title: 'Primeira fila',
    line: 'O ano foi da live, e a live é de quem chega. Que venha o próximo!',
  },
};

/** Which role fits the viewer's year best (ties: the first one listed). */
export function personaOf(m: Recap['mine']): Persona {
  const scores: [PersonaId, number][] = [
    ['patrocinio', m.sponsorships * 3],
    ['vaquinha', m.contributions * 2],
    ['critica', m.reviews * 2 + m.likesReceived / 5],
    ['curadoria', m.suggestions + m.suggestionsTaken * 2],
    ['emblemas', m.badges.length * 1.5],
    ['roleta', m.prizes * 1.5],
  ];
  let best: [PersonaId, number] = ['primeira-fila', 0];
  for (const s of scores) if (s[1] > best[1]) best = s;
  return { id: best[0], ...PERSONAS[best[0]] };
}

/** "1 filme" / "3 filmes" */
export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;
}

/** 135 → "2 h 15 min"; 120 → "2 h"; 45 → "45 min" */
export function hoursLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h.toLocaleString('pt-BR')} h ${m} min` : `${h.toLocaleString('pt-BR')} h`;
}

export type CardId =
  | 'intro'
  | 'live'
  | 'sponsored'
  | 'supported'
  | 'reviews'
  | 'suggestions'
  | 'roleta'
  | 'badges'
  | 'persona'
  | 'final';

/** The cards of a year, in order: the ones with something to say about this viewer. */
export function recapCards(r: Recap): CardId[] {
  const m = r.mine;
  const cards: CardId[] = ['intro', 'live'];
  if (m.sponsorships) cards.push('sponsored');
  if (m.contributions) cards.push('supported');
  if (m.reviews || m.likesReceived) cards.push('reviews');
  if (m.suggestions) cards.push('suggestions');
  if (m.spins) cards.push('roleta');
  if (m.badges.length) cards.push('badges');
  cards.push('persona', 'final');
  return cards;
}

/** The numbers on the last card and on the shared image (zeros left out; at most six). */
export function recapHighlights(r: Recap): { value: string; label: string }[] {
  const m = r.mine;
  const out: { value: string; label: string }[] = [];
  const add = (n: number, one: string, many: string) => {
    if (n > 0) out.push({ value: n.toLocaleString('pt-BR'), label: n === 1 ? one : many });
  };
  add(m.sponsorships, 'filme patrocinado', 'filmes patrocinados');
  if (m.minutes > 0) out.push({ value: hoursLabel(m.minutes), label: 'de live por sua causa' });
  add(m.contributions, 'cadeira nas vaquinhas', 'cadeiras nas vaquinhas');
  add(m.reviews, 'avaliação', 'avaliações');
  add(m.likesReceived, 'curtida recebida', 'curtidas recebidas');
  add(m.suggestions, 'sugestão', 'sugestões');
  add(m.prizes, 'prêmio na Roleta', 'prêmios na Roleta');
  add(m.badges.length, 'emblema', 'emblemas');
  if (out.length === 0)
    add(r.site.titles, 'título assistido na live', 'títulos assistidos na live');
  return out.slice(0, 6);
}
