import type { AchievementGroup } from '@/lib/achievements';
import type { NameBadge } from '@/lib/name-badge';
import { BadgeArt } from '@/components/badges/BadgeArt';
import {
  IconBingo,
  IconBulb,
  IconCalendar,
  IconFilm,
  IconHeart,
  IconLayers,
  IconMedal,
  IconPlay,
  IconSparkle,
  IconStar,
} from '@/components/ui/icons';

type IconC = (p: { className?: string }) => React.JSX.Element;

const GROUP_ICON: Record<AchievementGroup, IconC> = {
  sponsor: IconFilm,
  backer: IconLayers,
  review: IconStar,
  likes: IconHeart,
  bingo: IconBingo,
  member: IconCalendar,
  vip: IconSparkle,
};
const ROLE_ICON: Record<'MODERATOR' | 'SUPER_MODERATOR' | 'STREAMER', IconC> = {
  STREAMER: IconPlay,
  SUPER_MODERATOR: IconBulb,
  MODERATOR: IconMedal,
};

/**
 * The badge next to a @username (2026-11-15), Twitch style: a small square with the event badge's
 * art (its still frame, so lists stay calm), a conquista's ring and icon, or the team role. The
 * name shows on hover (title) and to screen readers. Classes only (CSP: no inline styles).
 */
export function NameBadgeMark({
  badge,
  size = 'sm',
}: {
  badge: NameBadge | null | undefined;
  /** sm: next to a name in a list (18 px); md: the profile heading (28 px) */
  size?: 'sm' | 'md';
}) {
  if (!badge) return null;
  const cls = `wf-nb wf-nb--${size} wf-nb--${badge.kind}`;
  if (badge.kind === 'emblem') {
    return (
      <span className={cls} title={badge.name}>
        <BadgeArt
          picture={badge.still ?? badge.picture}
          still={null}
          name={badge.name}
          size={size === 'md' ? 28 : 18}
        />
      </span>
    );
  }
  if (badge.kind === 'achievement') {
    const Icon = GROUP_ICON[badge.group];
    return (
      <span
        className={`${cls} wf-nb--${badge.group}`}
        title={badge.name}
        role="img"
        aria-label={`Conquista ${badge.name}`}
      >
        <Icon className="wf-nb__icon" />
      </span>
    );
  }
  const Icon = ROLE_ICON[badge.role];
  return (
    <span
      className={`${cls} wf-nb--role-${badge.role.toLowerCase()}`}
      title={badge.name}
      role="img"
      aria-label={badge.name}
    >
      <Icon className="wf-nb__icon" />
    </span>
  );
}
