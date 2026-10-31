import type { Metadata } from 'next';
import Link from 'next/link';
import { SuggestionForm } from '@/components/suggestions/SuggestionForm';
import { getCurrentSession } from '@/server/auth/current';
import { isGoogleLoginConfigured } from '@/server/env';
import { mySuggestions } from '@/server/suggestions/suggestions';

export const metadata: Metadata = {
  title: 'Sugestões',
  description: 'Sugira um filme, série ou franquia para a live do Wiski.',
};

/**
 * /sugestoes (Phase 6): signed-in viewers suggest titles; only the moderation and the streamer
 * read them. Signed out → a sign-in link that comes back here.
 */
export default async function SugestoesPage() {
  const ctx = await getCurrentSession();
  const mine = ctx ? await mySuggestions(ctx.user.id) : [];
  return (
    <div className="wf-page wf-suggest">
      <h1 className="wf-h1">Sugestões</h1>
      <p className="wf-suggest__intro">
        Tem um filme, série ou franquia que você quer ver na live? Conte pra gente. Só a moderação e
        o streamer leem as sugestões, e elas ajudam a escolher o que entra no catálogo.
      </p>
      {!ctx ? (
        <div className="wf-suggest__card">
          <p>Entre com sua conta Google para sugerir.</p>
          {isGoogleLoginConfigured() ? (
            <a
              href={`/api/auth/google/start?returnTo=${encodeURIComponent('/sugestoes')}`}
              className="wf-btn wf-btn--neon"
              rel="nofollow"
            >
              Entrar com Google
            </a>
          ) : (
            <p className="wf-notice">Login indisponível neste ambiente.</p>
          )}
        </div>
      ) : !ctx.user.username ? (
        <div className="wf-suggest__card">
          <p>Escolha seu nome de usuário antes de sugerir.</p>
          <Link href="/bem-vindo" className="wf-btn wf-btn--neon">
            Escolher nome de usuário
          </Link>
        </div>
      ) : ctx.user.status !== 'ACTIVE' ? (
        <p className="wf-notice">Sua conta está suspensa e não pode enviar sugestões agora.</p>
      ) : (
        <SuggestionForm initial={mine} />
      )}
    </div>
  );
}
