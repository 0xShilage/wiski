import { cookies } from 'next/headers';
import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { SeasonBadge } from '@/components/brand/SeasonBadge';
import { NEON_COOKIE } from '@/lib/neon';
import { liveStatus, type LiveStatus } from '@/server/live/public';
import { logger } from '@/server/log';
import { currentSeason } from '@/server/site/appearance';
import { LiveBar } from './LiveBar';
import { NavLinks } from './NavLinks';
import { NeonIgnite } from './NeonIgnite';

async function safeLiveStatus(): Promise<LiveStatus> {
  try {
    return await liveStatus();
  } catch (err) {
    logger.warn({ err }, 'live status unavailable');
    return { live: false, now: null };
  }
}

/**
 * Header (design §2): "Wiski" logo with a lavender glow, the tabs, no search. It overlays the
 * page top (the Filmes hero runs underneath); pages start below it via .wf-page. 2026-11-10: the
 * "AO VIVO" bar above it while a live is on, and the logo lighting up like a neon sign on a
 * browser's first visit. And the season's piece next to the logo while a theme is on.
 */
export async function SiteHeader() {
  const [live, jar, season] = await Promise.all([safeLiveStatus(), cookies(), currentSeason()]);
  const ignite = !jar.has(NEON_COOKIE);
  return (
    <header className="wf-header">
      <LiveBar initial={live} />
      <div className="wf-header__inner">
        <Link
          href="/"
          className={ignite ? 'wf-logo wf-logo--ignite' : 'wf-logo'}
          aria-label="Wiski — Filmes (página inicial)"
        >
          <Logo />
          {season ? <SeasonBadge season={season} /> : null}
        </Link>
        {ignite ? <NeonIgnite /> : null}
        <NavLinks />
      </div>
    </header>
  );
}
