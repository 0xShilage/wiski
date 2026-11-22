import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { adminPage } from '@/components/admin/admin-page';
import { WatchedPlaceList } from '@/components/admin/WatchedPlaceList';
import type { ItemKind } from '@/generated/prisma/enums';
import { adminWatched } from '@/server/catalog/read';

export const metadata: Metadata = { title: 'Assistidos' };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const TAGS = [
  { id: null, label: 'Todos', off: undefined },
  { id: 'em-live', label: 'Visto em live', off: false },
  { id: 'fora-da-live', label: 'Visto fora da live', off: true },
] as const;
const KINDS = [
  { id: null, label: 'Todos os tipos', kind: undefined },
  { id: 'filmes', label: 'Filmes', kind: 'MOVIE' },
  { id: 'series', label: 'Séries', kind: 'SERIES' },
  { id: 'franquias', label: 'Franquias', kind: 'FRANCHISE' },
  { id: 'animes', label: 'Animes', kind: 'ANIME' },
] as const satisfies readonly { id: string | null; label: string; kind: ItemKind | undefined }[];

/**
 * /admin/assistidos (2026-11-22): every watched title with its tag — "Visto em live" or "Visto fora
 * da live" — to move it from one to the other (a title logged the wrong way). Filters by tag and
 * kind, and a search; the tag saves as soon as it changes.
 */
export default async function WatchedAdminPage({ searchParams }: Props) {
  const p = await adminPage('/admin/assistidos');
  if ('gate' in p) return p.gate;
  const q = await searchParams;
  const tag = TAGS.find((t) => t.id === one(q.tag)) ?? TAGS[0];
  const kind = KINDS.find((k) => k.id === one(q.tipo)) ?? KINDS[0];
  const search = (one(q.q) ?? '').slice(0, 80);
  const data = await adminWatched({ offStream: tag.off, kind: kind.kind, query: search || null });
  const href = (over: { tag?: string | null; tipo?: string | null }) => {
    const params = new URLSearchParams();
    const t = 'tag' in over ? over.tag : tag.id;
    const k = 'tipo' in over ? over.tipo : kind.id;
    if (t) params.set('tag', t);
    if (k) params.set('tipo', k);
    if (search) params.set('q', search);
    const s = params.toString();
    return s ? `/admin/assistidos?${s}` : '/admin/assistidos';
  };
  const total = data.counts.live + data.counts.off;
  return (
    <AdminShell
      active="assistidos"
      title="Assistidos"
      lead="Tudo o que já foi assistido. Mude a etiqueta entre “Visto em live” e “Visto fora da live” se algum título foi registrado do jeito errado: salva na hora. A data, o patrocínio e as avaliações continuam iguais."
      {...p.shell}
    >
      <div className="wf-watched-admin">
        <nav aria-label="Filtrar por etiqueta" className="wf-seg">
          {TAGS.map((t) => (
            <Link
              key={t.label}
              href={href({ tag: t.id })}
              aria-current={t.id === tag.id ? 'page' : undefined}
            >
              {t.label}{' '}
              <span className="wf-watched-admin__n">
                {t.off === undefined ? total : t.off ? data.counts.off : data.counts.live}
              </span>
            </Link>
          ))}
        </nav>
        <div className="wf-watched-admin__bar">
          <nav aria-label="Filtrar por tipo" className="wf-watched-admin__kinds">
            {KINDS.map((k) => (
              <Link
                key={k.label}
                href={href({ tipo: k.id })}
                aria-current={k.id === kind.id ? 'page' : undefined}
              >
                {k.label}
              </Link>
            ))}
          </nav>
          <form
            method="get"
            action="/admin/assistidos"
            role="search"
            className="wf-watched-admin__search"
          >
            {tag.id ? <input type="hidden" name="tag" value={tag.id} /> : null}
            {kind.id ? <input type="hidden" name="tipo" value={kind.id} /> : null}
            <label htmlFor="assistidos-busca" className="sr-only">
              Buscar título
            </label>
            <input
              id="assistidos-busca"
              name="q"
              type="search"
              className="wf-input"
              placeholder="Buscar título"
              defaultValue={search}
              maxLength={80}
            />
            <button type="submit" className="wf-btn wf-btn--ghost">
              Buscar
            </button>
          </form>
        </div>
        <WatchedPlaceList key={`${tag.id}-${kind.id}-${search}`} items={data.items} />
      </div>
    </AdminShell>
  );
}
