import type { Metadata } from 'next';
import { CampaignsView } from '@/components/catalog/CampaignsView';
import { parseFilter } from '@/lib/catalog/filter';
import { listPublic } from '@/server/catalog/read';

export const metadata: Metadata = {
  title: 'Franquias',
  description: 'Campanhas coletivas para maratonar franquias inteiras na live do Wiski.',
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function FranquiasPage({ searchParams }: Props) {
  return (
    <CampaignsView
      title="Franquias"
      lead="Sagas inteiras, financiadas juntas: contribua com quanto quiser, a partir de R$ 5. A meta é a soma do valor de cada filme; quando ela é atingida, a maratona entra na programação da live."
      kindPath="franquias"
      items={await listPublic('FRANCHISE')}
      initialFilter={parseFilter(await searchParams, 'campaigns')}
    />
  );
}
