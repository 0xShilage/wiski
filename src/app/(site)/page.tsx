import type { Metadata } from 'next';
import { Mascote } from '@/components/brand/Mascote';
import { HeroCarousel } from '@/components/catalog/HeroCarousel';
import { UpNext } from '@/components/live/UpNext';
import { listPublic } from '@/server/catalog/read';
import { publicSchedule } from '@/server/live/public';

export const metadata: Metadata = {
  title: { absolute: 'Wiski — Filmes' },
  description:
    'Patrocine o próximo filme da live do Wiski: escolha, pague com Pix e assista junto.',
};

/** `/` = Filmes (O9): the hero carousel with the live movies in slot order, then the next lives. */
export default async function FilmesPage() {
  const [movies, sessions] = await Promise.all([listPublic('MOVIE'), publicSchedule()]);
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
      <UpNext sessions={sessions} />
    </>
  );
}
