import type { Metadata } from 'next';
import { CampaignsView } from '@/components/catalog/CampaignsView';
import { listPublic } from '@/server/catalog/read';

export const metadata: Metadata = {
  title: 'Franquias',
  description: 'Campanhas coletivas para maratonar franquias inteiras na live do Wiski.',
};

export default async function FranquiasPage() {
  return (
    <CampaignsView
      title="Franquias"
      lead="Sagas inteiras, financiadas juntas: contribua com quanto quiser, a partir de R$ 5. A meta é a soma do valor de cada filme; quando ela é atingida, a maratona entra na programação da live."
      kindPath="franquias"
      items={await listPublic('FRANCHISE')}
    />
  );
}
