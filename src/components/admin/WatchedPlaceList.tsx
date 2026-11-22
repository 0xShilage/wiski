'use client';
import Link from 'next/link';
import { useState } from 'react';
import { MediaPicture } from '@/components/media/MediaPicture';
import { KIND_ONE, KIND_PATH } from '@/lib/catalog/kinds';
import { adminFetch } from '@/lib/passkey-client';
import type { AdminWatched } from '@/server/catalog/read';

type Item = AdminWatched['items'][number];
type Row = Item & { busy?: boolean; note?: { ok: boolean; text: string } | undefined };

const date = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'America/Sao_Paulo',
});

/**
 * Admin › Assistidos (2026-11-22): one row per watched title with a two-way selector — "Visto em
 * live" / "Visto fora da live". A change saves at once (compare-and-set on the title's version)
 * and says so on the row; a failure puts the old tag back and says why.
 */
export function WatchedPlaceList({ items }: { items: Item[] }) {
  const [rows, setRows] = useState<Row[]>(items);
  const patch = (id: string, change: Partial<Row>) =>
    setRows((all) => all.map((r) => (r.id === id ? { ...r, ...change } : r)));

  async function choose(row: Row, offStream: boolean) {
    if (row.busy || row.offStream === offStream) return;
    const before = row.offStream;
    patch(row.id, { offStream, busy: true, note: undefined });
    const r = await adminFetch<{ offStream: boolean; version: number }>(
      `/api/v1/admin/catalog/items/${row.id}/watched-place`,
      { method: 'PUT', body: { expectedVersion: row.version, offStream } },
    );
    if (!r.ok) {
      patch(row.id, {
        offStream: before,
        busy: false,
        note: {
          ok: false,
          text:
            r.problem.code === 'VERSION_CONFLICT'
              ? 'Alguém mudou este título agora. Recarregue a página.'
              : r.problem.detail,
        },
      });
      return;
    }
    patch(row.id, {
      offStream: r.data.offStream,
      version: r.data.version,
      busy: false,
      note: {
        ok: true,
        text: r.data.offStream ? 'Agora: visto fora da live.' : 'Agora: visto em live.',
      },
    });
  }

  if (!rows.length) {
    return <p className="wf-muted">Nenhum título assistido com esses filtros.</p>;
  }
  return (
    <ul className="wf-watched-list" aria-label="Títulos assistidos">
      {rows.map((row) => (
        <li key={row.id} className="wf-watched-row">
          <span className="wf-watched-row__poster" aria-hidden="true">
            {row.poster ? <MediaPicture picture={row.poster} alt="" sizes="48px" /> : null}
          </span>
          <span className="wf-watched-row__info">
            <Link
              href={`/${KIND_PATH[row.kind]}/${row.slug}`}
              prefetch={false}
              className="wf-watched-row__title"
            >
              {row.title}
            </Link>
            <span className="wf-watched-row__meta">
              {KIND_ONE[row.kind]}
              {row.year ? ` · ${row.year}` : ''} · assistido em{' '}
              <time dateTime={row.watchedAt}>{date.format(new Date(row.watchedAt))}</time>
              {row.archived ? ' · arquivado' : ''}
            </span>
          </span>
          <fieldset className="wf-place" disabled={row.busy}>
            <legend className="sr-only">Onde “{row.title}” foi visto</legend>
            <label className={row.offStream ? 'wf-place__opt' : 'wf-place__opt is-on'}>
              <input
                type="radio"
                name={`place-${row.id}`}
                checked={!row.offStream}
                onChange={() => void choose(row, false)}
              />
              Visto em live
            </label>
            <label className={row.offStream ? 'wf-place__opt is-on is-off' : 'wf-place__opt'}>
              <input
                type="radio"
                name={`place-${row.id}`}
                checked={row.offStream}
                onChange={() => void choose(row, true)}
              />
              Visto fora da live
            </label>
          </fieldset>
          <span className="wf-watched-row__note" role="status">
            {row.note ? (
              <span className={row.note.ok ? 'wf-watched-row__ok' : 'wf-watched-row__err'}>
                {row.note.text}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
