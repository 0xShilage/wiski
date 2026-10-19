'use client';
import { type DragEvent, type KeyboardEvent, useState } from 'react';
import { MediaPicture } from '@/components/media/MediaPicture';
import { IconPlus } from '@/components/ui/icons';
import { type AdminListItem, type Kind, LIMIT, STATE_LABEL, tileState } from './types';

const LIVE = new Set(['ACTIVE', 'SPONSORED', 'FUNDED', 'WATCHED']);

/**
 * The slot board (11 §4): numbered positions of the carousel/grid. Live items can be dragged to
 * another slot (swap) or moved with Alt + ← / → on the keyboard; empty slots start a new draft.
 */
export function SlotBoard({
  kind,
  items,
  selectedId,
  onSelect,
  onNew,
  onMove,
}: {
  kind: Kind;
  items: AdminListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: (slot: number | null) => void;
  onMove: (id: string, toSlot: number) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overSlot, setOverSlot] = useState<number | null>(null);
  const limit = LIMIT[kind];
  const live = new Map(
    items.filter((i) => LIVE.has(i.status) && i.slot).map((i) => [i.slot as number, i]),
  );
  const drafts = items.filter((i) => i.status === 'DRAFT');
  const planned = new Map(
    drafts.filter((d) => d.slot && !live.has(d.slot)).map((d) => [d.slot as number, d]),
  );
  const unplanned = drafts.filter((d) => !d.slot || live.has(d.slot));

  const drop = (slot: number) => (e: DragEvent) => {
    e.preventDefault();
    setOverSlot(null);
    const id = dragId ?? e.dataTransfer.getData('text/plain');
    setDragId(null);
    if (id) onMove(id, slot);
  };
  const dragOver = (slot: number) => (e: DragEvent) => {
    if (!dragId) return;
    e.preventDefault();
    setOverSlot(slot);
  };
  const keyMove = (item: AdminListItem) => (e: KeyboardEvent) => {
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const to = (item.slot as number) + (e.key === 'ArrowRight' ? 1 : -1);
    if (to >= 1 && to <= limit) onMove(item.id, to);
  };

  return (
    <>
      <ol className="wf-slots" aria-label={`Vagas (${limit})`}>
        {Array.from({ length: limit }, (_, k) => k + 1).map((slot) => {
          const item = live.get(slot) ?? planned.get(slot);
          const n = String(slot).padStart(2, '0');
          if (!item) {
            return (
              <li key={slot}>
                <button
                  type="button"
                  className={`wf-slot wf-slot--empty ${overSlot === slot ? 'is-dragover' : ''}`}
                  onClick={() => onNew(slot)}
                  onDragOver={dragOver(slot)}
                  onDragLeave={() => setOverSlot(null)}
                  onDrop={drop(slot)}
                  aria-label={`Vaga ${n} livre — criar rascunho`}
                >
                  <span className="wf-slot__n" aria-hidden="true">
                    {n}
                  </span>
                  <IconPlus />
                </button>
              </li>
            );
          }
          const state = tileState(item);
          const isLive = LIVE.has(item.status);
          return (
            <li key={slot}>
              <button
                type="button"
                className={`wf-slot wf-slot--${state} ${overSlot === slot ? 'is-dragover' : ''}`}
                aria-current={item.id === selectedId ? 'true' : undefined}
                // WCAG 2.5.3: the visible "<n> <state>" comes first and in order, then the title.
                aria-label={`Vaga ${n}, ${STATE_LABEL[state] ?? state}: ${item.title}${isLive ? '. Alt + setas para mover' : ''}`}
                title={item.title}
                draggable={isLive}
                onDragStart={(e) => {
                  setDragId(item.id);
                  e.dataTransfer.setData('text/plain', item.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOverSlot(null);
                }}
                onDragOver={dragOver(slot)}
                onDragLeave={() => setOverSlot(null)}
                onDrop={drop(slot)}
                onKeyDown={isLive ? keyMove(item) : undefined}
                onClick={() => onSelect(item.id)}
              >
                <MediaPicture picture={item.poster} alt="" sizes="96px" />
                <span className="wf-slot__n" aria-hidden="true">
                  {n}
                </span>{' '}
                {/* the space keeps "01 Ativo" two words for the name check */}
                <span className="wf-slot__state" aria-hidden="true">
                  {STATE_LABEL[state] ?? state}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {unplanned.length ? (
        <section className="wf-drafts" aria-labelledby="rascunhos">
          <h3 id="rascunhos" className="wf-admin__group m-0">
            Rascunhos sem vaga
          </h3>
          <ul>
            {unplanned.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  aria-current={d.id === selectedId ? 'true' : undefined}
                  onClick={() => onSelect(d.id)}
                >
                  {d.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
