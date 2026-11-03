import type { Metadata } from 'next';
import { Img } from '@/components/Img';
import { PlatformIcon } from '@/components/links/PlatformIcon';
import { LINKS_PHOTO_SRC } from '@/lib/links';
import { publicLinks } from '@/server/links/links';

export const metadata: Metadata = {
  title: 'Links',
  description: 'Onde encontrar a Iara: canais, redes sociais e comunidade.',
};

/** /links (Phase 6): the streamer's link-in-bio page, in the order she set in the dashboard. */
export default async function LinksPage() {
  const links = await publicLinks();
  return (
    <div className="wf-page wf-links">
      <header className="wf-links__head">
        <div className="wf-links__avatar">
          <Img
            src={LINKS_PHOTO_SRC}
            alt="Foto da Iara"
            width={120}
            height={120}
            unoptimized
            className="size-full"
          />
        </div>
        <h1 className="wf-h1">Links</h1>
        <p className="wf-links__intro">Onde encontrar a Iara fora daqui.</p>
      </header>
      {links.length ? (
        <ul className="wf-links__list">
          {links.map((l) => {
            // "Twitch" next to a button already named "Twitch" says nothing new
            const where = l.platform ?? l.host;
            const showWhere = where.toLowerCase() !== l.label.toLowerCase();
            return (
              <li key={l.id}>
                <a className="wf-links__btn" href={l.url} rel="me noreferrer">
                  <span className="wf-links__icon">
                    <PlatformIcon platform={l.platform} />
                  </span>
                  <span className="wf-links__text">
                    <span className="wf-links__label">{l.label}</span>
                    {l.note ? <span className="wf-links__note">{l.note}</span> : null}
                  </span>
                  {showWhere ? <span className="wf-links__where">{where}</span> : null}
                </a>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="wf-links__empty">Os links chegam em breve.</p>
      )}
    </div>
  );
}
