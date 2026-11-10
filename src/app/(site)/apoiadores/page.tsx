import type { Metadata } from 'next';
import Link from 'next/link';
import { MediaPicture } from '@/components/media/MediaPicture';
import { KIND_PATH } from '@/lib/catalog/kinds';
import { supportersWall } from '@/server/wall/wall';

export const metadata: Metadata = {
  title: 'Apoiadores',
  description: 'Quem patrocinou os filmes, séries e franquias da live do Wiski. Muito obrigada!',
};

/**
 * /apoiadores (2026-11-09): the supporters wall — for each sponsored title, the names of the
 * sponsors who chose to appear here at checkout. Nobody is listed without ticking the box.
 */
export default async function ApoiadoresPage() {
  const wall = await supportersWall();
  return (
    <div className="wf-page wf-seen">
      <h1 className="wf-h1">Mural de apoiadores</h1>
      <p className="wf-seen__intro">
        Muito obrigada a quem patrocina a live! 🍿🎥 Aqui aparecem só as pessoas que marcaram “Quero
        aparecer no mural de apoiadores” ao patrocinar.
      </p>
      {wall.length ? (
        <ul className="wf-wall">
          {wall.map((e) => (
            <li key={e.itemId} className="wf-wall__card">
              <Link
                href={`/${KIND_PATH[e.kind]}/${e.slug}`}
                className="wf-wall__poster"
                prefetch={false}
                aria-hidden="true"
                tabIndex={-1}
              >
                {e.poster ? <MediaPicture picture={e.poster} alt="" sizes="96px" /> : null}
              </Link>
              <div className="wf-wall__body">
                <h2 className="wf-wall__title">
                  <Link href={`/${KIND_PATH[e.kind]}/${e.slug}`} prefetch={false}>
                    {e.title}
                  </Link>
                </h2>
                <p className="wf-wall__thanks">
                  {e.campaign ? 'Obrigada a quem apoiou:' : 'Obrigada a quem patrocinou:'}
                </p>
                <ul className="wf-wall__names" aria-label={`Apoiadores de ${e.title}`}>
                  {e.names.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="wf-seen__intro">
          Ninguém por aqui ainda. Ao patrocinar,{' '}
          <Link href="/" className="underline">
            marque a opção do mural
          </Link>{' '}
          para aparecer.
        </p>
      )}
    </div>
  );
}
