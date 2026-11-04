import Link from 'next/link';
import { Img } from '@/components/Img';

/** Footer (11 §3): the ranking (2026-11-04), legal pages, media kit, contact and the LGPD channel. */
const LINKS = [
  { href: '/ranking', label: 'Ranking' },
  { href: '/privacidade', label: 'Termos e privacidade' },
  { href: '/reembolso', label: 'Reembolso' },
  { href: '/privacidade#secao-1', label: 'Canal de privacidade (LGPD)' },
  { href: '/media-kit', label: 'Media kit' },
  { href: '/contato', label: 'Contato' },
] as const;

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="wf-footer">
      <div className="wf-footer__inner">
        <Img
          src="/brand/submarca-lavender.png"
          alt="Wiski"
          width={392}
          height={195}
          unoptimized
          className="h-10 w-auto"
        />
        <nav aria-label="Informações e contato">
          <ul>
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href}>{l.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="wf-footer__legal">© {year} Wiski. Todos os direitos reservados.</p>
      </div>
    </footer>
  );
}
