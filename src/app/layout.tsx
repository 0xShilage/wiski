import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { StepUpHost } from '@/components/account/StepUpHost';
import { getCurrentSession } from '@/server/auth/current';
import { getEnv } from '@/server/env';
import { csrfTokenFor } from '@/server/security/csrf';
import { currentSeason } from '@/server/site/appearance';
import { fontVariables } from './fonts';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(getEnv().APP_ORIGIN),
    title: { default: 'Wiski', template: '%s · Wiski' },
    description:
      'Patrocine o próximo filme, série ou anime da live do Wiski e avalie com a comunidade.',
    applicationName: 'Wiski',
    referrer: 'strict-origin-when-cross-origin',
    formatDetection: { telephone: false, email: false, address: false },
    openGraph: { type: 'website', locale: 'pt_BR', siteName: 'Wiski' },
    robots: { index: true, follow: true },
  };
}

export const viewport: Viewport = {
  themeColor: '#1b1225',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

/**
 * Root layout. Every page is rendered per request (nonce CSP → no static HTML). The CSRF token
 * for the signed-in session is exposed in a meta tag for apiFetch() (03 §2).
 * 2026-11-10: `data-season` while a seasonal theme is on (Admin › Aparência) — the CSS
 * (styles/season.css) repaints the background pattern, the glow and the logo.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const [ctx, season] = await Promise.all([getCurrentSession(), currentSeason()]);
  return (
    <html lang="pt-BR" className={fontVariables} data-season={season ?? undefined}>
      <head>{ctx ? <meta name="csrf-token" content={csrfTokenFor(ctx.session.id)} /> : null}</head>
      <body className="flex min-h-dvh flex-col bg-bg font-sans text-fg antialiased">
        <a
          href="#conteudo"
          className="skip-link rounded-pill bg-accent px-4 py-2 font-semibold text-accent-fg"
        >
          Pular para o conteúdo
        </a>
        {children}
        <StepUpHost />
      </body>
    </html>
  );
}
