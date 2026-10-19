'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS } from './nav-items';

/** Desktop tabs; the active one gets aria-current="page" (styled with the neon underline). */
export function NavLinks() {
  const path = usePathname() ?? '/';
  return (
    <nav aria-label="Principal" className="wf-nav">
      {NAV_ITEMS.map((item) => (
        <Link key={item.href} href={item.href} aria-current={item.match(path) ? 'page' : undefined}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
