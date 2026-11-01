import type { Metadata } from 'next';
import { LegalDocument } from '@/components/layout/LegalDocument';

export const metadata: Metadata = {
  title: 'Termos e privacidade',
  description:
    'Política de Privacidade e Proteção de Dados do Wiski, que também reúne os termos de uso.',
};

/** /privacidade: the single legal text (2026-11-01). /termos redirects here (next.config.ts). */
export default function PrivacidadePage() {
  return <LegalDocument />;
}
