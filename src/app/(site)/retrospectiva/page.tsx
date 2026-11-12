import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { RecapStories } from '@/components/recap/RecapStories';
import {
  RECAP_FIRST_YEAR,
  defaultRecapYear,
  parseRecapYear,
  personaOf,
  recapCards,
  saoPauloYear,
} from '@/lib/recap';
import { getCurrentSession } from '@/server/auth/current';
import { isGoogleLoginConfigured } from '@/server/env';
import { recapFor } from '@/server/recap/recap';

export const metadata: Metadata = {
  title: 'Seu ano na Wiskiflix',
  description: 'A sua retrospectiva na live da Iara: o que você patrocinou, avaliou e colecionou.',
  robots: { index: false },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * /retrospectiva (2026-11-12): "Seu ano na Wiskiflix" — the signed-in viewer's year as story
 * cards (`?ano=` for another year since the site opened). Private: only the viewer's own numbers,
 * never amounts.
 */
export default async function RecapPage({ searchParams }: Props) {
  const now = new Date();
  const raw = (await searchParams).ano;
  const year = parseRecapYear(Array.isArray(raw) ? raw[0] : raw, now) ?? defaultRecapYear(now);
  const ctx = await getCurrentSession();
  if (!ctx) {
    const returnTo = encodeURIComponent('/retrospectiva');
    return (
      <div className="wf-page wf-page--narrow wf-recap-page">
        <h1 className="wf-h1">Seu ano na Wiskiflix</h1>
        <p className="wf-recap-page__lead">
          Entre para ver o que você patrocinou, avaliou e colecionou na live em {year}.
        </p>
        {isGoogleLoginConfigured() ? (
          <a className="wf-btn wf-btn--neon" href={`/api/auth/google/start?returnTo=${returnTo}`}>
            Entrar com Google
          </a>
        ) : null}
      </div>
    );
  }
  if (!ctx.user.username) redirect('/bem-vindo?next=%2Fretrospectiva');
  const recap = await recapFor(ctx.user, year, now);
  const current = saoPauloYear(now).year;
  const years = Array.from({ length: current - RECAP_FIRST_YEAR + 1 }, (_, i) => current - i);
  return (
    <div className="wf-page wf-recap-page">
      <h1 className="sr-only">Seu ano na Wiskiflix {year}</h1>
      <RecapStories recap={recap} cards={recapCards(recap)} persona={personaOf(recap.mine)} />
      {years.length > 1 ? (
        <nav className="wf-recap-page__years" aria-label="Outros anos">
          {years.map((y) => (
            <Link
              key={y}
              href={`/retrospectiva?ano=${y}`}
              aria-current={y === year ? 'page' : undefined}
            >
              {y}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
