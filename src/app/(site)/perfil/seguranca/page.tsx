import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PasskeyPanel } from '@/components/admin/PasskeyPanel';
import { card } from '@/components/ui/styles';
import { getCurrentSession } from '@/server/auth/current';
import { isMfaFresh, listPasskeys } from '@/server/auth/passkeys';
import { isStepUpFresh, stepUpUrl } from '@/server/auth/step-up';

export const metadata: Metadata = { title: 'Passkeys', robots: { index: false } };

/** /perfil/seguranca — passkeys, the second factor the moderation needs for /admin (O6). */
export default async function SegurancaPage() {
  const ctx = await getCurrentSession();
  if (!ctx) redirect('/perfil?returnTo=%2Fperfil%2Fseguranca');
  if (ctx.user.role === 'USER') notFound();
  const items = await listPasskeys(ctx.user.id);
  return (
    <div className="wf-page wf-page--narrow">
      <div className={`${card} space-y-6`}>
        <p>
          <Link href="/perfil" className="text-sm text-fg-muted underline-offset-4 hover:underline">
            ← Perfil
          </Link>
        </p>
        <h1 className="wf-h1">Passkeys</h1>
        <p className="text-fg/90">
          O painel da moderação pede uma passkey (biometria, PIN do aparelho ou chave de segurança)
          além do login com o Google. Assim, mesmo que alguém copie sua sessão, não consegue alterar
          o catálogo.
        </p>
        {!isStepUpFresh(ctx.session) ? (
          <p className="wf-notice">
            Para cadastrar ou remover uma passkey, o site vai pedir que você entre com o Google de
            novo (vale por 10 minutos).
          </p>
        ) : null}
        <PasskeyPanel
          items={items.map((p) => ({
            id: p.id,
            label: p.label,
            createdAt: p.createdAt.toISOString(),
            lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
            synced: p.backedUp,
          }))}
          verified={isMfaFresh(ctx.session)}
          stepUpUrl={stepUpUrl('/perfil/seguranca')}
        />
      </div>
    </div>
  );
}
