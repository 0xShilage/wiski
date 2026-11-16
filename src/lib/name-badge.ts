import type { AchievementGroup } from './achievements';
import type { Picture } from './media';

/**
 * "Emblema ao lado do nome" (2026-11-15): like a Twitch chat badge, one small badge the viewer picks
 * that follows their @username around the site — reviews, the ranking, their profile. It can be an
 * event badge they claimed (its art), a conquista they earned (its ring and icon) or, for the team,
 * their role. Shared by the server (which decides what may be shown) and the components.
 */
export type NameBadge =
  | { kind: 'emblem'; slug: string; name: string; picture: Picture | null; still: Picture | null }
  | { kind: 'achievement'; id: string; name: string; group: AchievementGroup }
  | { kind: 'role'; role: 'MODERATOR' | 'SUPER_MODERATOR' | 'STREAMER'; name: string };

/** What the viewer picks on /perfil (and what the API accepts). */
export type NameBadgeChoice =
  | { kind: 'none' }
  | { kind: 'role' }
  | { kind: 'emblem'; slug: string }
  | { kind: 'achievement'; id: string };

/** The choices offered on /perfil, the current one marked. */
export type NameBadgeOptions = {
  current: NameBadgeChoice;
  options: { choice: Exclude<NameBadgeChoice, { kind: 'none' }>; badge: NameBadge }[];
  /** false when the viewer hides conquistas and emblemas: the badge doesn't show either */
  visible: boolean;
};

export const choiceKey = (c: NameBadgeChoice): string =>
  c.kind === 'emblem'
    ? `emblem:${c.slug}`
    : c.kind === 'achievement'
      ? `achievement:${c.id}`
      : c.kind;
