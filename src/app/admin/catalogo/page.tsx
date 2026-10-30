import type { Metadata } from 'next';
import { adminGate } from '@/components/admin/AdminGate';
import { Dashboard } from '@/components/admin/Dashboard';
import { adminCounts, getAdmin, listAdmin } from '@/server/catalog/read';
import { waitingCount } from '@/server/reviews/moderation';

export const metadata: Metadata = { title: 'Catálogo' };

const TIPO = { filmes: 'MOVIE', series: 'SERIES', franquias: 'FRANCHISE' } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * /admin/catalogo — MODERATOR / STREAMER only (others: 404). Needs a passkey verified in the last
 * 10 minutes (11 §9, O6); every API call behind it re-checks the same on the server.
 */
export default async function CatalogoPage({ searchParams }: Props) {
  const g = await adminGate('/admin/catalogo');
  if ('gate' in g) return g.gate;
  const { ctx } = g;
  const params = await searchParams;
  const tipo =
    typeof params.tipo === 'string' && params.tipo in TIPO
      ? (params.tipo as keyof typeof TIPO)
      : 'filmes';
  const kind = TIPO[tipo];
  const id = typeof params.item === 'string' && UUID.test(params.item) ? params.item : null;
  const [items, counts, item, waiting] = await Promise.all([
    listAdmin(kind),
    adminCounts(),
    id ? getAdmin(id) : Promise.resolve(null),
    waitingCount(),
  ]);

  return (
    <Dashboard
      initialKind={kind}
      initialItems={items}
      initialCounts={counts}
      initialItem={item && item.kind === kind ? item : null}
      user={{ username: ctx.user.username ?? 'moderacao', role: ctx.user.role }}
      waiting={waiting}
    />
  );
}
