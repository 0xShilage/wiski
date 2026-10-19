import type { Metadata } from 'next';
import { LegalPlaceholder } from '@/components/layout/LegalPlaceholder';

export const metadata: Metadata = { title: 'Política de reembolso' };

export default function ReembolsoPage() {
  return (
    <LegalPlaceholder title="Política de reembolso">
      <p>
        A política de reembolso dos patrocínios será publicada aqui antes de os pagamentos serem
        abertos.
      </p>
    </LegalPlaceholder>
  );
}
