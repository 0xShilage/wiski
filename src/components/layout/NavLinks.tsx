'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId, useRef } from 'react';
import { IconClose } from '@/components/ui/icons';
import { INFO_LINKS, NAV_ITEMS } from './nav-items';

const BAR = NAV_ITEMS.filter((i) => i.desktop === 'bar');
const MORE = NAV_ITEMS.filter((i) => i.desktop === 'more');
const INFO = INFO_LINKS.filter((l) => l.drawer);

/**
 * Desktop tabs; the active one gets aria-current="page" (styled with the neon underline). No
 * prefetch (2026-11-04): every page is rendered per request, so prefetching only warms a thin shell,
 * while ten tabs × two segment requests on every page view ate into nginx's per-IP burst.
 *
 * "Mais ▾" (2026-11-09): thirteen tabs no longer fit next to the logo, so the less used ones open
 * from it. Like HBO Max's menu, it is a full-height drawer, here from the right where the button
 * sits: big links, a short line, then the footer pages smaller, over a dark veil that fades in
 * (CSS `.wf-drawer`). A native popover: Esc, a click on the veil and the ✕ close it, and it sits
 * after the button in the tab order. The button glows when the open page is one of them.
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
    <>
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
      </nav>
      <div id={menuId} ref={menu} popover="auto" className="wf-drawer">
        <div className="wf-drawer__panel">
          <button
            type="button"
            className="wf-drawer__close"
            popoverTarget={menuId}
            popoverTargetAction="hide"
            aria-label="Fechar menu"
          >
            <IconClose />
          </button>
          <nav aria-label="Mais">
            <ul aria-label="Mais páginas" className="wf-drawer__main">
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
            <hr className="wf-drawer__rule" />
            <ul aria-label="Informações" className="wf-drawer__info">
              {INFO.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    prefetch={false}
                    aria-current={path === l.href ? 'page' : undefined}
                    onClick={close}
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>
    </>
  );
}
