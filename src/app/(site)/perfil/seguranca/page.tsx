import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { MfaGate } from '@/components/admin/MfaGate';
import { PasskeyPanel } from '@/components/admin/PasskeyPanel';
import { TotpPanel } from '@/components/admin/TotpPanel';
import { card, heading } from '@/components/ui/styles';
import { getCurrentSession } from '@/server/auth/current';
import { isMfaFresh, mfaVerifiedUntil } from '@/server/auth/mfa';
import { listPasskeys } from '@/server/auth/passkeys';
import { isStepUpFresh, stepUpUrl } from '@/server/auth/step-up';
import { recoveryLeft } from '@/server/auth/totp';

export const metadata: Metadata = {
  title: 'Verificação em duas etapas',
  robots: { index: false },
};

const fmt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

/**
 * /perfil/seguranca — the admin second factor (O6, changed 2026-10-31): authenticator app (TOTP)
 * and/or passkeys. Either one opens the panel for 96 hours in this browser.
 */
export default async function SegurancaPage() {
  const ctx = await getCurrentSession();
  if (!ctx) redirect('/perfil?returnTo=%2Fperfil%2Fseguranca');
  if (ctx.user.role === 'USER') notFound();
  const [items, left] = await Promise.all([listPasskeys(ctx.user.id), recoveryLeft(ctx.user.id)]);
  const totp = ctx.user.totpEnabledAt !== null;
  const hasFactor = totp || items.length > 0;
  const verified = isMfaFresh(ctx.session);
  const back = stepUpUrl('/perfil/seguranca');

  return (
    <div className="wf-page wf-page--narrow space-y-6">
      <div className={`${card} space-y-4`}>
        <p>
          <Link href="/perfil" className="text-sm text-fg-muted underline-offset-4 hover:underline">
            ← Perfil
          </Link>
        </p>
        <h1 className="wf-h1">Verificação em duas etapas</h1>
        <p className="text-fg/90">
          O painel pede um segundo passo além do login com o Google: um código do app autenticador
          ou uma passkey. Assim, mesmo que alguém consiga sua senha do Google ou copie sua sessão,
          não entra no painel. A verificação vale por 96 horas neste navegador; sair da conta pede
          de novo.
        </p>
        {hasFactor ? (
          verified && ctx.session.mfaAt ? (
            <p className="text-success" role="status">
              Verificado até {fmt.format(mfaVerifiedUntil(ctx.session.mfaAt))}.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-warning" role="status">
                Esta sessão ainda não foi verificada.
              </p>
              <MfaGate totp={totp} passkeys={items.length > 0} />
            </div>
          )
        ) : (
          <p className="wf-notice" role="status">
            Você ainda não ativou a verificação em duas etapas. Configure o app autenticador abaixo
            (recomendado) ou cadastre uma passkey.
          </p>
        )}
        {!isStepUpFresh(ctx.session) ? (
          <p className="text-sm text-fg-muted">
            Para ativar, remover ou gerar códigos, o site pede uma confirmação recente: o código do
            app (ou a passkey), se você já tiver um, ou entrar com o Google de novo. Vale por 10
            minutos.
          </p>
        ) : null}
      </div>

      <section className={`${card} space-y-4`} aria-labelledby="app-autenticador">
        <h2 id="app-autenticador" className={heading.h3}>
          App autenticador
        </h2>
        <p className="text-fg/90">
          Google Authenticator, Microsoft Authenticator, 1Password, Aegis ou outro app de códigos de
          6 dígitos. Inclui 6 códigos de recuperação para quando o celular não estiver à mão.
        </p>
        <TotpPanel
          enabled={totp}
          enabledAt={ctx.user.totpEnabledAt?.toISOString() ?? null}
          recoveryLeft={left}
          verified={verified}
          stepUpUrl={back}
        />
      </section>

      <section className={`${card} space-y-4`} aria-labelledby="passkeys">
        <h2 id="passkeys" className={heading.h3}>
          Passkeys
        </h2>
        <p className="text-fg/90">
          Biometria, PIN do aparelho ou chave de segurança. Opcional; também abre o painel.
        </p>
        <PasskeyPanel
          items={items.map((p) => ({
            id: p.id,
            label: p.label,
            createdAt: p.createdAt.toISOString(),
            lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
            synced: p.backedUp,
          }))}
          verified={verified}
          stepUpUrl={back}
        />
      </section>
    </div>
  );
}
