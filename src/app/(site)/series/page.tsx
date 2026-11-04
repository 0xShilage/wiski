import type { Metadata } from 'next';
import { CampaignsView } from '@/components/catalog/CampaignsView';
import { parseFilter } from '@/lib/catalog/filter';
import { listPublic } from '@/server/catalog/read';

export const metadata: Metadata = {
  title: 'Séries',
  description: 'Campanhas coletivas para assistir séries na live do Wiski.',
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SeriesPage({ searchParams }: Props) {
  return (
    <CampaignsView
      title="Séries"
      lead="Campanhas coletivas: cada pessoa contribui com quanto quiser, a partir de R$ 5. Quando a meta é atingida, a série entra na programação da live."
      kindPath="series"
      items={await listPublic('SERIES')}
      initialFilter={parseFilter(await searchParams, 'campaigns')}
    />
  );
}
