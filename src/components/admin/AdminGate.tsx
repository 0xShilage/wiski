import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/Logo';
import { card } from '@/components/ui/styles';
import { getCurrentSession } from '@/server/auth/current';
import { countPasskeys, isMfaFresh } from '@/server/auth/passkeys';
import type { SessionContext } from '@/server/auth/session';
import { PasskeyGate } from './PasskeyGate';

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
 * Every /admin page: MODERATOR / STREAMER only (others: 404), with a passkey verified in the last
 * 10 minutes (11 §9, O6). Returns the session, or the gate to render instead. The API behind the
 * page re-checks all of it on every call.
 */
export async function adminGate(
  path: string,
): Promise<{ ctx: SessionContext } | { gate: ReactNode }> {
  const ctx = await getCurrentSession();
  if (!ctx) redirect(`/perfil?returnTo=${encodeURIComponent(path)}`);
  if (ctx.user.role === 'USER') notFound();
  if ((await countPasskeys(ctx.user.id)) === 0) {
    return {
      gate: (
        <Gate title="Cadastre uma passkey">
          <p className="text-fg/90">
            O painel pede uma passkey além do login com o Google. Cadastre a sua (leva um minuto).
          </p>
          <Link href="/perfil/seguranca" className="wf-btn wf-btn--neon">
            Cadastrar passkey
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
            Use sua passkey para abrir o painel. Ela vale por 10 minutos.
          </p>
          <PasskeyGate />
        </Gate>
      ),
    };
  }
  return { ctx };
}
