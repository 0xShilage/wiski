import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/Logo';
import { card } from '@/components/ui/styles';
import { getCurrentSession } from '@/server/auth/current';
import { factorsOf, hasFactor, isMfaFresh } from '@/server/auth/mfa';
import type { SessionContext } from '@/server/auth/session';
import { MfaGate } from './MfaGate';

function Gate({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="wf-gate">
      <div className={`${card} w-full max-w-md space-y-5 text-center`}>
        <Logo className="mx-auto h-9" />
        <h1 className="wf-h2">{title}</h1>
        {children}
      </div>
    </div>
  );
}

/**
 * Every /admin page: MODERATOR / STREAMER only (others: 404), with the second factor (authenticator
 * app or passkey) checked in the last 96 hours (11 §9, O6). Returns the session, or the gate to
 * render instead. The API behind the page re-checks all of it on every call.
 */
export async function adminGate(
  path: string,
): Promise<{ ctx: SessionContext } | { gate: ReactNode }> {
  const ctx = await getCurrentSession();
  if (!ctx) redirect(`/perfil?returnTo=${encodeURIComponent(path)}`);
  if (ctx.user.role === 'USER') notFound();
  const factors = await factorsOf(ctx.user.id);
  if (!hasFactor(factors)) {
    return {
      gate: (
        <Gate title="Ative a verificação em duas etapas">
          <p className="text-fg/90">
            O painel pede um segundo passo além do login com o Google: um código do app autenticador
            (Google Authenticator, Microsoft Authenticator…) ou uma passkey. Leva um minuto.
          </p>
          <Link href="/perfil/seguranca" className="wf-btn wf-btn--neon">
            Ativar agora
          </Link>
        </Gate>
      ),
    };
  }
  if (!isMfaFresh(ctx.session)) {
    return {
      gate: (
        <Gate title="Confirme que é você">
          <p className="text-fg/90">
            {factors.totp
              ? 'Digite o código do seu app autenticador.'
              : 'Use sua passkey para abrir o painel.'}{' '}
            Vale por 96 horas neste navegador.
          </p>
          <MfaGate totp={factors.totp} passkeys={factors.passkeys > 0} />
        </Gate>
      ),
    };
  }
  return { ctx };
}
