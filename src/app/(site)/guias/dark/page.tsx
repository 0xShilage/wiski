import type { Metadata } from 'next';
import { DarkGuide } from '@/components/guides/DarkGuide';
import { clampEpisode } from '@/lib/guides/dark-s1';

export const metadata: Metadata = {
  title: 'Guia de Winden: Dark, 1ª temporada sem spoilers',
  description:
    'Mapa de Winden, as épocas e as quatro famílias da 1ª temporada de Dark. Você diz até qual episódio assistiu; o guia não mostra nada além disso.',
};

/**
 * /guias/dark — Guia de Winden (2026-11-11): a spoiler-free companion to the first season of
 * "Dark" for the live. Static data (src/lib/guides/dark-s1.ts); `?ep=N` opens at episode N.
 */
export default async function DarkGuidePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).ep;
  const fromUrl = typeof raw === 'string' && clampEpisode(raw) === Number(raw);
  return (
    <div className="wf-page">
      <header className="wf-guide__head">
        <p className="wf-guide__eyebrow">Guia sem spoilers · Dark, 1ª temporada</p>
        <h1 className="wf-guide__h1">Guia de Winden</h1>
        <p className="wf-guide__lead">
          Para acompanhar a série com a gente sem se perder. Diga até qual episódio você já
          assistiu: o mapa, as épocas e as famílias só mostram o que a série já mostrou até ali, e
          nada aqui explica os mistérios.
        </p>
      </header>
      <DarkGuide initialEp={fromUrl ? clampEpisode(raw) : 1} fromUrl={fromUrl} />
    </div>
  );
}
