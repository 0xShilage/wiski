import type { AchievementGroup, AchievementResult } from '@/lib/achievements';
import {
  IconCalendar,
  IconFilm,
  IconHeart,
  IconLayers,
  IconSparkle,
  IconStar,
} from '@/components/ui/icons';

const ICON: Record<AchievementGroup, (p: { className?: string }) => React.JSX.Element> = {
  sponsor: IconFilm,
  backer: IconLayers,
  review: IconStar,
  likes: IconHeart,
  member: IconCalendar,
  vip: IconSparkle,
};

/**
 * Badges (2026-11-04): a glowing ring per earned badge; on /perfil the locked ones too, dimmed,
 * with what's missing ("3 de 5"). Text nodes and classes only (CSP: no inline styles).
 */
export function AchievementBadges({
  items,
  showLocked = false,
  labelledBy,
}: {
  items: AchievementResult[];
  showLocked?: boolean;
  labelledBy: string;
}) {
  const shown = showLocked ? items : items.filter((a) => a.earned);
  if (!shown.length) return null;
  return (
    <ul className="wf-badges" aria-labelledby={labelledBy}>
      {shown.map((a) => {
        const Icon = ICON[a.group];
        return (
          <li
            key={a.id}
            className={a.earned ? 'wf-badge-item is-earned' : 'wf-badge-item'}
            aria-label={`${a.label}${a.earned ? '' : ` — bloqueada: ${a.how}`}`}
          >
            <span
              className={`wf-badge-item__ring wf-badge-item__ring--${a.group}`}
              aria-hidden="true"
            >
              <Icon className="wf-badge-item__icon" />
            </span>
            <span className="wf-badge-item__label">{a.label}</span>
            {a.earned ? null : (
              <span className="wf-badge-item__how">
                {a.how}
                {a.target > 1 && a.metric !== 'memberDays' ? ` · ${a.value} de ${a.target}` : ''}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
