'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  IconCalendar,
  IconFilm,
  IconLayers,
  IconStar,
  IconTv,
  IconUser,
} from '@/components/ui/icons';
import { NAV_ITEMS } from './nav-items';

const ICONS = [IconFilm, IconTv, IconLayers, IconCalendar, IconStar, IconUser] as const;

/** Phones (≤ 760 px): the six tabs as a fixed bottom bar (O10). Hidden on larger screens. */
export function TabBar() {
  const path = usePathname() ?? '/';
  return (
    <nav aria-label="Principal (celular)" className="wf-tabbar">
      {NAV_ITEMS.map((item, i) => {
        const Icon = ICONS[i]!;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={item.match(path) ? 'page' : undefined}
          >
            <Icon />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
