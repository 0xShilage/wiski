import type { Metadata } from 'next';
import { Mascote } from '@/components/brand/Mascote';
import { publicLinks } from '@/server/links/links';

export const metadata: Metadata = {
  title: 'Links',
  description: 'Onde encontrar o Wiski: canais, redes sociais e comunidade.',
};

/** /links (Phase 6): the streamer's link-in-bio page, in the order she set in the dashboard. */
export default async function LinksPage() {
  const links = await publicLinks();
  return (
    <div className="wf-page wf-links">
      <header className="wf-links__head">
        <div className="wf-links__avatar" aria-hidden="true">
          <Mascote pose={1} colour="lavender" />
        </div>
        <h1 className="wf-h1">Links</h1>
        <p className="wf-links__intro">Onde encontrar o Wiski fora daqui.</p>
      </header>
      {links.length ? (
        <ul className="wf-links__list">
          {links.map((l) => (
            <li key={l.id}>
              <a className="wf-links__btn" href={l.url} rel="me noreferrer">
                <span className="wf-links__text">
                  <span className="wf-links__label">{l.label}</span>
                  {l.note ? <span className="wf-links__note">{l.note}</span> : null}
                </span>
                <span className="wf-links__where">{l.platform ?? l.host}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="wf-links__empty">Os links chegam em breve.</p>
      )}
    </div>
  );
}
