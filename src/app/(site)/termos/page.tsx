import type { Metadata } from 'next';
import { LegalDocument } from '@/components/layout/LegalDocument';

export const metadata: Metadata = { title: 'Termos de uso' };

export default function TermosPage() {
  return <LegalDocument type="TERMS" />;
}
