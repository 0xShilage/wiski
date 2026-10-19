import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Dashboard } from '@/components/admin/Dashboard';
import { PasskeyGate } from '@/components/admin/PasskeyGate';
import { Logo } from '@/components/brand/Logo';
import { card } from '@/components/ui/styles';
import { getCurrentSession } from '@/server/auth/current';
import { countPasskeys, isMfaFresh } from '@/server/auth/passkeys';
import { adminCounts, getAdmin, listAdmin } from '@/server/catalog/read';

export const metadata: Metadata = { title: 'Catálogo' };

const TIPO = { filmes: 'MOVIE', series: 'SERIES', franquias: 'FRANCHISE' } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function Gate({ title, children }: { title: string; children: React.ReactNode }) {
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
 * /admin/catalogo — MODERATOR / STREAMER only (others: 404). Needs a passkey verified in the last
 * 10 minutes (11 §9, O6); every API call behind it re-checks the same on the server.
 */
export default async function CatalogoPage({ searchParams }: Props) {
  const ctx = await getCurrentSession();
  if (!ctx) redirect('/perfil?returnTo=%2Fadmin%2Fcatalogo');
  if (ctx.user.role === 'USER') notFound();

  if ((await countPasskeys(ctx.user.id)) === 0) {
    return (
      <Gate title="Cadastre uma passkey">
        <p className="text-fg/90">
          O painel pede uma passkey além do login com o Google. Cadastre a sua (leva um minuto).
        </p>
        <Link href="/perfil/seguranca" className="wf-btn wf-btn--neon">
          Cadastrar passkey
        </Link>
      </Gate>
    );
  }
  if (!isMfaFresh(ctx.session)) {
    return (
      <Gate title="Confirme que é você">
        <p className="text-fg/90">Use sua passkey para abrir o painel. Ela vale por 10 minutos.</p>
        <PasskeyGate />
      </Gate>
    );
  }

  const params = await searchParams;
  const tipo =
    typeof params.tipo === 'string' && params.tipo in TIPO
      ? (params.tipo as keyof typeof TIPO)
      : 'filmes';
  const kind = TIPO[tipo];
  const id = typeof params.item === 'string' && UUID.test(params.item) ? params.item : null;
  const [items, counts, item] = await Promise.all([
    listAdmin(kind),
    adminCounts(),
    id ? getAdmin(id) : Promise.resolve(null),
  ]);

  return (
    <Dashboard
      initialKind={kind}
      initialItems={items}
      initialCounts={counts}
      initialItem={item && item.kind === kind ? item : null}
      user={{ username: ctx.user.username ?? 'moderacao', role: ctx.user.role }}
    />
  );
}
