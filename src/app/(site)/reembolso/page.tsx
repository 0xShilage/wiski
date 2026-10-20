import type { Metadata } from 'next';
import { LegalDocument } from '@/components/layout/LegalDocument';

export const metadata: Metadata = { title: 'Política de reembolso' };

export default function ReembolsoPage() {
  return <LegalDocument type="REFUND" />;
}
