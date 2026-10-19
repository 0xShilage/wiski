import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Avatar } from '@/components/Avatar';
import { LogoutButton } from '@/components/account/LogoutButton';
import { ProfileForm } from '@/components/account/ProfileForm';
import { Mascote } from '@/components/brand/Mascote';
import { button, card, heading } from '@/components/ui/styles';
import { resolveAvatarKey } from '@/lib/avatars';
import { formatDate, formatMonthYear } from '@/lib/format';
import { nextUsernameChange } from '@/server/auth/accounts';
import { getCurrentSession } from '@/server/auth/current';
import { isGoogleLoginConfigured } from '@/server/env';
import { safeReturnTo } from '@/server/security/return-to';

export const metadata: Metadata = { title: 'Perfil', robots: { index: false } };

const ERRORS: Record<string, string> = {
  cancelado: 'Você cancelou o login no Google. Tente de novo quando quiser.',
  expirado: 'O login expirou ou foi aberto em outra aba. Comece de novo por aqui.',
  email: 'Sua conta Google precisa ter o e-mail verificado para entrar.',
  conta: 'Esta conta não está disponível.',
  indisponivel: 'O login está indisponível no momento. Tente mais tarde.',
  falha: 'Não foi possível concluir o login. Tente de novo.',
};

const ROLE_LABEL = { USER: null, MODERATOR: 'Moderação', STREAMER: 'Streamer' } as const;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * /perfil (11 §2.4): logged out → Google sign-in (was /entrar); logged in → profile and account
 * (was /conta). Both old paths answer 301 here.
 */
export default async function PerfilPage({ searchParams }: Props) {
  const params = await searchParams;
  const ctx = await getCurrentSession();

  if (!ctx) {
    const returnTo = safeReturnTo(typeof params.returnTo === 'string' ? params.returnTo : null);
    const error = typeof params.erro === 'string' ? ERRORS[params.erro] : undefined;
    const available = isGoogleLoginConfigured();
    const href = `/api/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`;
    return (
      <div className="wf-page wf-page--narrow grid place-items-center">
        <div className={`${card} w-full max-w-md space-y-6 text-center`}>
          <div className="mx-auto w-28">
            <Mascote pose={4} colour="lavender" />
          </div>
          <h1 className="wf-h1">Entrar</h1>
          <p className="text-fg/90">
            Use sua conta Google para avaliar o que assistimos na live, acompanhar seus patrocínios
            e contribuições e escolher seu avatar. Não pedimos senha.
          </p>
          {error ? (
            <p
              role="alert"
              className="rounded-md border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger"
            >
              {error}
            </p>
          ) : null}
          {available ? (
            // A plain link, not a form: `form-action 'self'` would block a form's redirect to Google.
            <a href={href} className="wf-btn wf-btn--neon w-full" rel="nofollow">
              Entrar com Google
            </a>
          ) : (
            <p className="wf-notice">
              Login indisponível neste ambiente (cliente OAuth do Google não configurado).
            </p>
          )}
          <p className="text-xs text-fg-muted">
            Ao entrar, você concorda com os{' '}
            <a className="underline" href="/termos">
              Termos de uso
            </a>{' '}
            e a{' '}
            <a className="underline" href="/privacidade">
              Política de privacidade
            </a>
            .
          </p>
        </div>
      </div>
    );
  }

  const { user } = ctx;
  if (!user.username) redirect('/bem-vindo?next=%2Fperfil');
  const nextChange = nextUsernameChange(user);
  const privileged = user.role !== 'USER';

  return (
    <div className="wf-page wf-page--narrow space-y-8">
      <h1 className="sr-only">Perfil</h1>
      <section
        className={`${card} flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between`}
      >
        <div className="flex items-center gap-4">
          <Avatar avatarKey={user.avatarKey} size={64} />
          <div>
            <p className="text-h2 font-semibold text-lilac">@{user.username}</p>
            <p className="text-sm text-fg-muted">Membro desde {formatMonthYear(user.createdAt)}</p>
            {ROLE_LABEL[user.role] ? (
              <p className="mt-1 inline-block rounded-pill bg-accent/20 px-2.5 py-0.5 text-xs font-semibold text-accent">
                {ROLE_LABEL[user.role]}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href={`/u/${user.username}`} className={button.secondary}>
            Perfil público
          </Link>
          <Link href="/perfil/sessoes" className={button.secondary}>
            Sessões ativas
          </Link>
          {privileged ? (
            <>
              <Link href="/perfil/seguranca" className={button.secondary}>
                Passkeys
              </Link>
              <Link href="/admin/catalogo" className={button.primary}>
                Painel
              </Link>
            </>
          ) : null}
          <LogoutButton />
        </div>
      </section>

      <section aria-labelledby="editar-perfil" className={card}>
        <h2 id="editar-perfil" className={`${heading.h3} mb-6`}>
          Editar perfil
        </h2>
        <ProfileForm
          username={user.username}
          avatarKey={resolveAvatarKey(user.avatarKey)}
          canChangeUsername={nextChange === null}
          nextChangeLabel={nextChange ? formatDate(nextChange) : null}
        />
      </section>

      <section aria-labelledby="meus-pedidos" className={card}>
        <h2 id="meus-pedidos" className={`${heading.h3} mb-2`}>
          Meus patrocínios e contribuições
        </h2>
        <p className="text-fg/90">
          Quando os pagamentos com Pix abrirem, seus patrocínios de filmes e contribuições para
          séries e franquias aparecem aqui.
        </p>
      </section>
    </div>
  );
}
