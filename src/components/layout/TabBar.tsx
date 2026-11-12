'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId, useRef } from 'react';
import {
  IconBulb,
  IconCalendar,
  IconEye,
  IconFilm,
  IconLayers,
  IconLink,
  IconMore,
  IconQueue,
  IconSparkles,
  IconGamepad,
  IconHeart,
  IconStar,
  IconTv,
  IconUser,
  IconWheel,
  IconMedal,
} from '@/components/ui/icons';
import { NAV_ITEMS } from './nav-items';

const ICON: Record<
  (typeof NAV_ITEMS)[number]['href'],
  (p: { className?: string }) => React.JSX.Element
> = {
  '/': IconFilm,
  '/series': IconTv,
  '/franquias': IconLayers,
  '/fila': IconQueue,
  '/animes': IconSparkles,
  '/jogos': IconGamepad,
  '/apoiadores': IconHeart,
  '/cronograma': IconCalendar,
  '/assistidos': IconEye,
  '/avaliacoes': IconStar,
  '/sugestoes': IconBulb,
  '/roleta': IconWheel,
  '/emblemas': IconMedal,
  '/links': IconLink,
  '/perfil': IconUser,
};

const BAR = NAV_ITEMS.filter((i) => i.mobile === 'bar');
const MORE = NAV_ITEMS.filter((i) => i.mobile === 'more');

/**
 * Phones (≤ 760 px): a fixed bottom bar — Filmes · Séries · Franquias · Cronograma · Perfil ·
 * Mais (Phase 6). "Mais" opens a native popover (light dismiss and Esc for free) with Fila, Assistidos,
 * Avaliações, Sugestões, Roleta and Links. Hidden on larger screens, where the header shows every tab.
 * No prefetch, like the header tabs (NavLinks).
 */
export function TabBar() {
  const path = usePathname() ?? '/';
  const menuId = useId();
  const menu = useRef<HTMLDivElement>(null);
  const activeMore = MORE.find((i) => i.match(path));
  const close = () => {
    try {
      menu.current?.hidePopover();
    } catch {
      // already closed
    }
  };

  const tab = (item: (typeof NAV_ITEMS)[number]) => {
    const Icon = ICON[item.href];
    return (
      <Link
        key={item.href}
        href={item.href}
        prefetch={false}
        aria-current={item.match(path) ? 'page' : undefined}
      >
        <Icon />
        <span>{item.label}</span>
      </Link>
    );
  };

  return (
    <nav aria-label="Principal (celular)" className="wf-tabbar">
      {BAR.map(tab)}
      <button
        type="button"
        className={activeMore ? 'wf-tabbar__more is-active' : 'wf-tabbar__more'}
        popoverTarget={menuId}
      >
        <IconMore />
        <span>
          Mais
          {activeMore ? <span className="sr-only"> (você está em {activeMore.label})</span> : null}
        </span>
      </button>
      <div id={menuId} ref={menu} popover="auto" className="wf-more">
        <ul aria-label="Mais páginas">
          {MORE.map((item) => {
            const Icon = ICON[item.href];
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  prefetch={false}
                  aria-current={item.match(path) ? 'page' : undefined}
                  onClick={close}
                >
                  <Icon />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
