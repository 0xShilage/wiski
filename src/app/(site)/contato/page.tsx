import type { Metadata } from 'next';
import { ContactForm } from '@/components/contact/ContactForm';
import { card } from '@/components/ui/styles';
import { contactFormToken } from '@/server/contact/contact';
import { getEnv } from '@/server/env';

export const metadata: Metadata = {
  title: 'Contato',
  description: 'Fale com a Wiskiflix: marcas, parcerias e imprensa.',
};

/** /contato (Phase 4): the contact form for brands and partners. */
export default function ContatoPage() {
  return (
    <div className="wf-page wf-page--narrow">
      <article className={`${card} space-y-5 leading-relaxed`}>
        <h1 className="wf-h1">Contato</h1>
        <p>
          Marcas, parcerias e imprensa: conte o que você tem em mente. Os números da live estão no{' '}
          <a className="underline" href="/media-kit">
            media kit
          </a>
          . Para assuntos de privacidade e dados pessoais (LGPD), use o canal indicado na{' '}
          <a className="underline" href="/privacidade#secao-1">
            Política de privacidade
          </a>
          .
        </p>
        <ContactForm siteKey={getEnv().TURNSTILE_SITE_KEY} formToken={contactFormToken()} />
      </article>
    </div>
  );
}
