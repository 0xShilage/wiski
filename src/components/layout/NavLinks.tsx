'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId, useRef } from 'react';
import { NAV_ITEMS } from './nav-items';

const BAR = NAV_ITEMS.filter((i) => i.desktop === 'bar');
const MORE = NAV_ITEMS.filter((i) => i.desktop === 'more');

/**
 * Desktop tabs; the active one gets aria-current="page" (styled with the neon underline). No
 * prefetch (2026-11-04): every page is rendered per request, so prefetching only warms a thin shell,
 * while ten tabs × two segment requests on every page view ate into nginx's per-IP burst.
 * 2026-11-09: with Animes, Jogos and Fila there are thirteen tabs, more than fit next to the
 * logo, so the less used ones open from "Mais ▾" (a native popover: light dismiss and Esc for
 * free), like on phones. The button glows when the open page is one of them.
 */
export function NavLinks() {
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
  return (
    <nav aria-label="Principal" className="wf-nav">
      {BAR.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          prefetch={false}
          aria-current={item.match(path) ? 'page' : undefined}
        >
          {item.label}
        </Link>
      ))}
      <button
        type="button"
        className={activeMore ? 'wf-nav__more is-active' : 'wf-nav__more'}
        popoverTarget={menuId}
      >
        Mais
        {activeMore ? <span className="sr-only"> (você está em {activeMore.label})</span> : null}
        <span aria-hidden="true"> ▾</span>
      </button>
      <div id={menuId} ref={menu} popover="auto" className="wf-nav__menu">
        <ul aria-label="Mais páginas">
          {MORE.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                prefetch={false}
                aria-current={item.match(path) ? 'page' : undefined}
                onClick={close}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
