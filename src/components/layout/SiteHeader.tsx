import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { NavLinks } from './NavLinks';

/**
 * Header (design §2): "Wiski" logo with a lavender glow, five tabs, no search. It overlays the
 * page top (the Filmes hero runs underneath); pages start below it via .wf-page.
 */
export function SiteHeader() {
  return (
    <header className="wf-header">
      <div className="wf-header__inner">
        <Link href="/" className="wf-logo" aria-label="Wiski — Filmes (página inicial)">
          <Logo />
        </Link>
        <NavLinks />
      </div>
    </header>
  );
}
