import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ItemDetail } from '@/components/catalog/ItemDetail';
import { getPublic } from '@/server/catalog/read';

type Props = { params: Promise<{ slug: string }> };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function load(slug: string) {
  return SLUG.test(slug) && slug.length <= 80 ? getPublic('SERIES', slug) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const item = await load((await params).slug);
  if (!item) return { title: 'Série não encontrada' };
  const image = item.backdrop?.fallback;
  return {
    title: item.title,
    description: item.synopsis.slice(0, 200),
    openGraph: {
      title: item.title,
      description: item.synopsis.slice(0, 200),
      ...(image
        ? { images: [{ url: image, width: item.backdrop!.width, height: item.backdrop!.height }] }
        : {}),
    },
  };
}

/** /series/[slug] — shareable detail page (11 §3). */
export default async function Page({ params }: Props) {
  const item = await load((await params).slug);
  if (!item) notFound();
  return <ItemDetail item={item} />;
}
