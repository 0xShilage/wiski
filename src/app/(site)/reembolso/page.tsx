import type { Metadata } from 'next';
import { LegalDocument } from '@/components/layout/LegalDocument';

export const metadata: Metadata = {
  title: 'Reembolso',
  description:
    'Termo de Reembolso, Estorno e Restituição de Contribuições Financeiras do Wiski: quando e como um patrocínio pode ser devolvido.',
};

/** /reembolso: the refund terms (2026-11-03), accepted at checkout. */
export default function ReembolsoPage() {
  return <LegalDocument doc="refund" />;
}
