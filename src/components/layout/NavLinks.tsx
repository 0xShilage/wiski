'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS } from './nav-items';

/**
 * Desktop tabs; the active one gets aria-current="page" (styled with the neon underline). No
 * prefetch (2026-11-04): every page is rendered per request, so prefetching only warms a thin shell,
 * while ten tabs × two segment requests on every page view ate into nginx's per-IP burst.
 */
export function NavLinks() {
  const path = usePathname() ?? '/';
  return (
    <nav aria-label="Principal" className="wf-nav">
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          prefetch={false}
          aria-current={item.match(path) ? 'page' : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
