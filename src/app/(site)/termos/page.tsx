import type { Metadata } from 'next';
import { LegalPlaceholder } from '@/components/layout/LegalPlaceholder';

export const metadata: Metadata = { title: 'Termos de uso' };

export default function TermosPage() {
  return (
    <LegalPlaceholder title="Termos de uso">
      <p>
        Os termos de uso do site, dos patrocínios e da comunidade de avaliações serão publicados
        aqui.
      </p>
    </LegalPlaceholder>
  );
}
