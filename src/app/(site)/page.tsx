import type { Metadata } from 'next';
import { BadgeCallout } from '@/components/badges/BadgeCallout';
import { RecapCallout } from '@/components/recap/RecapCallout';
import { Mascote } from '@/components/brand/Mascote';
import { HeroCarousel } from '@/components/catalog/HeroCarousel';
import { MovieGrid } from '@/components/catalog/MovieGrid';
import { ProgressBlock } from '@/components/live/ProgressBlock';
import { TwitchLive } from '@/components/live/TwitchLive';
import { UpNext } from '@/components/live/UpNext';
import { HomePopup } from '@/components/site/HomePopup';
import { parseFilter } from '@/lib/catalog/filter';
import { defaultRecapYear, isRecapSeason } from '@/lib/recap';
import { openBadges } from '@/server/badges/badges';
import { watchProgress } from '@/server/catalog/progress';
import { listPublic } from '@/server/catalog/read';
import { getEnv } from '@/server/env';
import { liveNow, publicSchedule } from '@/server/live/public';
import { homePopup } from '@/server/site/appearance';

export const metadata: Metadata = {
  title: { absolute: 'Wiski — Filmes' },
  description:
    'Patrocine o próximo filme da live do Wiski: escolha, pague com Pix e assista junto.',
};

/**
 * `/` = Filmes (O9): the hero carousel with the live movies in slot order, every available movie
 * at once (2026-11-02; filters and sort 2026-11-04), the next lives, the progress block (Phase 6) and — while a live is "Ao
 * vivo" in Cronograma — the Twitch player (click to load). 2026-11-10: the home pop-up, once per
 * visitor each time it is switched on (Admin › Aparência).
 */
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function FilmesPage({ searchParams }: Props) {
  const initialFilter = parseFilter(await searchParams, 'movies');
  const [movies, sessions, progress, live, popup, emblems] = await Promise.all([
    listPublic('MOVIE'),
    publicSchedule(),
    watchProgress(),
    liveNow(),
    homePopup(),
    openBadges(),
  ]);
  const now = new Date();
  return (
    <>
      <h1 className="sr-only">Filmes — patrocine o próximo filme da live</h1>
      {movies.length ? (
        <HeroCarousel items={movies} />
      ) : (
        <section className="wf-hero wf-hero--empty" aria-label="Filmes">
          <div className="wf-hero__stage">
            <div className="wf-hero__content">
              <h2 className="wf-hero__title">Em breve</h2>
              <p className="wf-hero__synopsis">
                A moderação está escolhendo os filmes. Volte daqui a pouco para patrocinar o próximo
                da live.
              </p>
            </div>
          </div>
          <div className="wf-hero__art" aria-hidden="true">
            <div className="mx-auto mt-[18vh] w-56 opacity-80">
              <Mascote pose={1} colour="lavender" />
            </div>
          </div>
        </section>
      )}
      {isRecapSeason(now) ? <RecapCallout year={defaultRecapYear(now)} home /> : null}
      <BadgeCallout badges={emblems} />
      <MovieGrid items={movies} initialFilter={initialFilter} />
      <UpNext sessions={sessions} />
      <ProgressBlock progress={progress} />
      {live ? <TwitchLive parent={new URL(getEnv().APP_ORIGIN).hostname} /> : null}
      {popup ? <HomePopup popup={popup} /> : null}
    </>
  );
}
