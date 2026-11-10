import type { Metadata } from 'next';
import { CampaignsView } from '@/components/catalog/CampaignsView';
import { parseFilter } from '@/lib/catalog/filter';
import { listPublic } from '@/server/catalog/read';

export const metadata: Metadata = {
  title: 'Animes',
  description: 'Campanhas coletivas para assistir animes na live do Wiski.',
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** /animes (2026-11-09): like Séries — a goal per season, a few episodes per live. */
export default async function AnimesPage({ searchParams }: Props) {
  return (
    <CampaignsView
      title="Animes"
      lead="Campanhas coletivas: cada pessoa contribui com quanto quiser, a partir de R$ 5. Quando a meta é atingida, o anime entra na programação da live."
      kindPath="animes"
      items={await listPublic('ANIME')}
      initialFilter={parseFilter(await searchParams, 'campaigns')}
    />
  );
}
