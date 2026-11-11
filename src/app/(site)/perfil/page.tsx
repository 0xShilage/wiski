import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DataTools } from '@/components/account/DataTools';
import { AchievementBadges } from '@/components/community/AchievementBadges';
import { AchievementsToggle } from '@/components/community/AchievementsToggle';
import { LogoutButton } from '@/components/account/LogoutButton';
import { MemberCard } from '@/components/account/MemberCard';
import { TicketStubs } from '@/components/account/TicketStubs';
import { ProfileForm } from '@/components/account/ProfileForm';
import { Mascote } from '@/components/brand/Mascote';
import { button, card, heading } from '@/components/ui/styles';
import { resolveAvatarKey } from '@/lib/avatars';
import { formatDate } from '@/lib/format';
import { nextUsernameChange } from '@/server/auth/accounts';
import { myOrders } from '@/server/checkout/access';
import { achievementsFor } from '@/server/community/achievements';
import { memberStats } from '@/server/community/member-card';
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
            <a className="underline" href="/privacidade">
              Termos de uso e a Política de privacidade
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
  const [orders, badges, stats] = await Promise.all([
    myOrders(user),
    achievementsFor(user),
    memberStats(user.id),
  ]);
  const earnedCount = badges.filter((b) => b.earned).length;

  return (
    <div className="wf-page wf-page--narrow space-y-8">
      <h1 className="sr-only">Perfil</h1>
      <section aria-label="Carteirinha de sócio" className="wf-member-wrap">
        <MemberCard
          user={{
            id: user.id,
            username: user.username,
            avatarKey: user.avatarKey,
            createdAt: user.createdAt,
            role: user.role,
            isVip: user.isVip,
          }}
          stats={stats}
        />
        <div className="wf-member-actions">
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

      <section aria-labelledby="minhas-conquistas" className={card}>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="minhas-conquistas" className={heading.h3}>
            Conquistas{' '}
            <span className="text-sm font-normal text-fg-muted">
              {earnedCount} de {badges.length}
            </span>
          </h2>
          <Link
            href="/ranking"
            className="text-sm text-lavender underline-offset-4 hover:underline"
          >
            Ver ranking
          </Link>
        </div>
        <p className="mb-4 text-sm text-fg-muted">
          Contam patrocínios e contribuições com seu nome visível (nunca os anônimos), suas
          avaliações e as curtidas que elas recebem. Valores nunca aparecem.
        </p>
        <AchievementBadges items={badges} showLocked labelledBy="minhas-conquistas" />
        <AchievementsToggle initial={user.showAchievements} />
      </section>

      <section aria-labelledby="meus-pedidos" className={card}>
        <h2 id="meus-pedidos" className={`${heading.h3} mb-2`}>
          Meus patrocínios e contribuições
        </h2>
        {orders.length === 0 ? (
          <p className="text-fg/90">
            Seus patrocínios de filmes e contribuições para séries e franquias aparecem aqui.
            Comprou sem login? Abra o link do pedido e toque em “Vincular à minha conta”.
          </p>
        ) : (
          <TicketStubs orders={orders} />
        )}
      </section>

      <section aria-labelledby="seus-dados" id="dados" className={card}>
        <h2 id="seus-dados" className={`${heading.h3} mb-4`}>
          Seus dados
        </h2>
        {user.role === 'STREAMER' ? (
          <a href="/api/v1/me/export" className="wf-btn wf-btn--ghost" download>
            Baixar meus dados
          </a>
        ) : (
          <DataTools username={user.username} />
        )}
      </section>
    </div>
  );
}
