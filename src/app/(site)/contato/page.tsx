import type { Metadata } from 'next';
import { LegalPlaceholder } from '@/components/layout/LegalPlaceholder';

export const metadata: Metadata = { title: 'Contato', robots: { index: false } };

export default function ContatoPage() {
  return (
    <LegalPlaceholder title="Contato" provisional={false}>
      <p>
        O formulário de contato para marcas e parceiros abre em breve. Para assuntos de privacidade
        e dados pessoais (LGPD), use o canal indicado na Política de privacidade.
      </p>
    </LegalPlaceholder>
  );
}
