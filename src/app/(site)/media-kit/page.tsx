import type { Metadata } from 'next';
import { LegalPlaceholder } from '@/components/layout/LegalPlaceholder';

export const metadata: Metadata = { title: 'Media kit', robots: { index: false } };

export default function MediaKitPage() {
  return (
    <LegalPlaceholder title="Media kit" provisional={false}>
      <p>
        Números da live, público e formatos de parceria serão publicados aqui em breve. Enquanto
        isso, fale com a gente pela página de contato.
      </p>
    </LegalPlaceholder>
  );
}
