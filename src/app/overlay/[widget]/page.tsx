import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OverlayClient } from '@/components/overlay/OverlayClient';

export const metadata: Metadata = { title: 'Overlay', robots: { index: false, follow: false } };

const WIDGETS = ['agora', 'fila', 'meta', 'meta-total', 'patrocinio'] as const;
type Props = { params: Promise<{ widget: string }> };

/** /overlay/[widget] — an OBS browser source (transparent page, key in the URL fragment). */
export default async function OverlayPage({ params }: Props) {
  const { widget } = await params;
  if (!(WIDGETS as readonly string[]).includes(widget)) notFound();
  return (
    <main className="wf-overlay" aria-live="polite">
      <h1 className="sr-only">Overlay da live</h1>
      <OverlayClient widget={widget as (typeof WIDGETS)[number]} />
    </main>
  );
}
