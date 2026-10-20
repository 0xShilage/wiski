import type { Metadata } from 'next';
import { LegalDocument } from '@/components/layout/LegalDocument';

export const metadata: Metadata = { title: 'Política de privacidade' };

export default function PrivacidadePage() {
  return <LegalDocument type="PRIVACY" />;
}
