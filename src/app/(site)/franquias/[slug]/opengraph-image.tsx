import { OG_SIZE, titleOgImage } from '@/server/og/title-image';

/** The title's own share image (2026-11-14, src/server/og/title-image.tsx). */
export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'Wiskiflix';

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  return titleOgImage('FRANCHISE', (await params).slug);
}
