/**
 * Badges (2026-11-04): earned from facts that are already public under the viewer's username —
 * movie sponsorships and campaign contributions shown with their name (never anonymous ones),
 * visible reviews, likes on those reviews, how long they've been here, the VIP perk. No amounts.
 * Pure rules: the server counts, this decides. Shared by the profile pages and the tests.
 */
export type AchievementGroup = 'sponsor' | 'backer' | 'review' | 'likes' | 'member' | 'vip';

export type AchievementStats = {
  /** movie sponsorships (paid, not refunded) with the sponsor's name shown */
  sponsorships: number;
  /** series/franchise contributions (paid, not refunded) with the name shown */
  contributions: number;
  /** visible reviews */
  reviews: number;
  /** likes received on visible reviews */
  likes: number;
  /** whole days since the account was created */
  memberDays: number;
  vip: boolean;
};

type Metric = Exclude<keyof AchievementStats, 'vip'> | 'vip';

export type Achievement = {
  id: string;
  group: AchievementGroup;
  label: string;
  /** how to earn it, shown under locked badges */
  how: string;
  metric: Metric;
  target: number;
};

export const ACHIEVEMENTS: readonly Achievement[] = [
  {
    id: 'sponsor-1',
    group: 'sponsor',
    label: 'Primeiro patrocínio',
    how: 'Patrocine um filme',
    metric: 'sponsorships',
    target: 1,
  },
  {
    id: 'sponsor-5',
    group: 'sponsor',
    label: 'Patrocinador',
    how: 'Patrocine 5 filmes',
    metric: 'sponsorships',
    target: 5,
  },
  {
    id: 'sponsor-10',
    group: 'sponsor',
    label: 'Mecenas',
    how: 'Patrocine 10 filmes',
    metric: 'sponsorships',
    target: 10,
  },
  {
    id: 'sponsor-25',
    group: 'sponsor',
    label: 'Lenda da fila',
    how: 'Patrocine 25 filmes',
    metric: 'sponsorships',
    target: 25,
  },
  {
    id: 'backer-1',
    group: 'backer',
    label: 'Apoiador',
    how: 'Contribua com uma série ou franquia',
    metric: 'contributions',
    target: 1,
  },
  {
    id: 'backer-5',
    group: 'backer',
    label: 'Produtor',
    how: 'Contribua 5 vezes com séries ou franquias',
    metric: 'contributions',
    target: 5,
  },
  {
    id: 'review-1',
    group: 'review',
    label: 'Primeira crítica',
    how: 'Avalie um título assistido',
    metric: 'reviews',
    target: 1,
  },
  {
    id: 'review-10',
    group: 'review',
    label: 'Crítico',
    how: 'Escreva 10 avaliações',
    metric: 'reviews',
    target: 10,
  },
  {
    id: 'review-25',
    group: 'review',
    label: 'Crítico de cinema',
    how: 'Escreva 25 avaliações',
    metric: 'reviews',
    target: 25,
  },
  {
    id: 'likes-10',
    group: 'likes',
    label: 'Boa de papo',
    how: 'Receba 10 curtidas nas suas avaliações',
    metric: 'likes',
    target: 10,
  },
  {
    id: 'likes-50',
    group: 'likes',
    label: 'Voz da galera',
    how: 'Receba 50 curtidas nas suas avaliações',
    metric: 'likes',
    target: 50,
  },
  {
    id: 'member-365',
    group: 'member',
    label: 'Veterano',
    how: 'Um ano de conta',
    metric: 'memberDays',
    target: 365,
  },
  {
    id: 'vip',
    group: 'vip',
    label: 'VIP',
    how: 'Recebeu o VIP do streamer',
    metric: 'vip',
    target: 1,
  },
];

export type AchievementResult = Achievement & { earned: boolean; value: number };

export function evaluateAchievements(stats: AchievementStats): AchievementResult[] {
  return ACHIEVEMENTS.map((a) => {
    const value = a.metric === 'vip' ? (stats.vip ? 1 : 0) : Math.max(0, stats[a.metric]);
    return { ...a, value: Math.min(value, a.target), earned: value >= a.target };
  });
}

/** Earned badges only, the highest of each group first within the group order. */
export function earnedAchievements(stats: AchievementStats): AchievementResult[] {
  return evaluateAchievements(stats).filter((a) => a.earned);
}
