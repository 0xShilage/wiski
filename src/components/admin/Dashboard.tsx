'use client';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { Logo } from '@/components/brand/Logo';
import { IconPlus } from '@/components/ui/icons';
import { adminFetch } from '@/lib/passkey-client';
import { ItemEditor } from './ItemEditor';
import { OpsNav, type OpsCounts } from './OpsNav';
import { SlotBoard } from './SlotBoard';
import { type AdminItem, type AdminListItem, KIND_UI, type Kind, LIMIT, tileState } from './types';

type Counts = Record<Kind, number>;
const KINDS: Kind[] = ['MOVIE', 'SERIES', 'FRANCHISE'];
const ROLE_LABEL = { MODERATOR: 'Moderação', STREAMER: 'Streamer', USER: '' } as const;

/**
 * /admin/catalogo (11 §4, design §4): sidebar with the live counts, the slot board and the editor.
 * State lives here; every call goes through adminFetch (passkey re-check inline, step-up prompts).
 */
export function Dashboard({
  initialKind,
  initialItems,
  initialCounts,
  initialItem,
  user,
  ops = { waiting: 0, attention: 0, texts: 0, unread: 0, suggestions: 0, roleta: 0 },
}: {
  initialKind: Kind;
  initialItems: AdminListItem[];
  initialCounts: Counts;
  initialItem: AdminItem | null;
  user: { username: string; role: 'MODERATOR' | 'STREAMER' | 'USER' };
  /** sidebar badges (moderation, orders, contact) */
  ops?: OpsCounts;
}) {
  const [kind, setKind] = useState<Kind>(initialKind);
  const [items, setItems] = useState(initialItems);
  const [counts, setCounts] = useState(initialCounts);
  const [item, setItem] = useState<AdminItem | null>(initialItem);
  const [newSlot, setNewSlot] = useState<number | null | undefined>(
    initialItem ? undefined : undefined,
  );
  const [editorKey, setEditorKey] = useState(0);
  const [announce, setAnnounce] = useState('');
  const [boardError, setBoardError] = useState<string | null>(null);

  const syncUrl = (k: Kind, id: string | null) => {
    const q = new URLSearchParams({ tipo: KIND_UI[k].tipo, ...(id ? { item: id } : {}) });
    window.history.replaceState(null, '', `/admin/catalogo?${q.toString()}`);
  };

  const reload = useCallback(async (k: Kind) => {
    const res = await adminFetch<{ counts: Counts; items: AdminListItem[] }>(
      `/api/v1/admin/catalog/items?kind=${k}`,
    );
    if (res.ok) {
      setItems(res.data.items);
      setCounts(res.data.counts);
    }
  }, []);

  const open = useCallback(
    async (id: string, k: Kind = kind) => {
      const res = await adminFetch<{ item: AdminItem }>(`/api/v1/admin/catalog/items/${id}`);
      if (res.ok) {
        setItem(res.data.item);
        setNewSlot(undefined);
        setEditorKey((x) => x + 1);
        syncUrl(k, id);
      }
    },
    [kind],
  );

  const switchKind = async (k: Kind) => {
    setKind(k);
    setItem(null);
    setNewSlot(undefined);
    setItems([]);
    syncUrl(k, null);
    await reload(k);
  };

  const startNew = (slot: number | null) => {
    setItem(null);
    setNewSlot(slot);
    setEditorKey((x) => x + 1);
    syncUrl(kind, null);
  };

  const move = async (id: string, to: number) => {
    const a = items.find((i) => i.id === id);
    if (!a?.slot || a.slot === to) return;
    const b = items.find(
      (i) => i.slot === to && ['ACTIVE', 'SPONSORED', 'FUNDED', 'WATCHED'].includes(i.status),
    );
    const slots = [{ id: a.id, slot: to }, ...(b ? [{ id: b.id, slot: a.slot }] : [])];
    setBoardError(null);
    const res = await adminFetch('/api/v1/admin/catalog/slots', {
      method: 'PUT',
      body: { kind, slots },
    });
    if (res.ok) {
      setAnnounce(
        `${a.title} movido para a vaga ${to}${b ? `; ${b.title} foi para a vaga ${a.slot}` : ''}.`,
      );
      await reload(kind);
      if (item?.id === a.id || item?.id === b?.id) await open(item!.id);
    } else {
      setBoardError(res.problem.detail);
    }
  };

  const drafts = items.filter((i) => i.status === 'DRAFT' && i.id !== item?.id);
  const editing = item !== null || newSlot !== undefined;
  const states = new Set(items.map(tileState));

  return (
    <div className="wf-admin">
      <aside className="wf-admin__side" aria-label="Painel">
        <Link href="/" className="wf-logo" aria-label="Wiski — ver o site">
          <Logo />
        </Link>
        <p className="wf-admin__group">Catálogo</p>
        <nav className="wf-admin__nav" aria-label="Catálogo">
          {KINDS.map((k) => (
            <a
              key={k}
              href={`/admin/catalogo?tipo=${KIND_UI[k].tipo}`}
              aria-current={k === kind ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                void switchKind(k);
              }}
            >
              {KIND_UI[k].many}
              <small>
                {counts[k]}/{LIMIT[k]}
              </small>
            </a>
          ))}
        </nav>
        <OpsNav counts={ops} role={user.role} />
        <div className="wf-admin__me">
          <p className="m-0 font-semibold">
            @{user.username} · {ROLE_LABEL[user.role]}
          </p>
          <p className="wf-admin__ok m-0 mt-1">● Verificação em duas etapas ok</p>
          <Link href="/perfil" className="wf-linkbtn text-xs">
            Perfil
          </Link>
        </div>
      </aside>

      <section className="wf-admin__board" aria-labelledby="board-title">
        <div className="wf-admin__head">
          <h1 className="wf-h1" id="board-title">
            {KIND_UI[kind].many}
          </h1>
          <button type="button" className="wf-btn wf-btn--neon" onClick={() => startNew(null)}>
            <IconPlus /> {KIND_UI[kind].nova}
          </button>
        </div>
        <ul className="wf-legend" aria-label="Legenda">
          <li className="s-ACTIVE">Ativo</li>
          {kind === 'MOVIE' ? (
            <>
              <li className="s-RESERVED">Reservado (Pix pendente)</li>
              <li className="s-SPONSORED">Patrocinado</li>
            </>
          ) : (
            <>
              <li className="s-FUNDED">Meta atingida</li>
              {states.has('PAUSED') ? (
                <li className="s-RESERVED">Pausada (prazo encerrado)</li>
              ) : null}
            </>
          )}
          <li className="s-WATCHED">Assistido → substituir</li>
          <li className="s-DRAFT">Rascunho</li>
          <li className="list-none before:hidden">Arraste (ou Alt + setas) para mudar a ordem</li>
        </ul>
        {boardError ? (
          <p role="alert" className="wf-toast wf-toast--err">
            {boardError}
          </p>
        ) : null}
        <SlotBoard
          kind={kind}
          items={items}
          selectedId={item?.id ?? null}
          onSelect={(id) => void open(id)}
          onNew={startNew}
          onMove={(id, to) => void move(id, to)}
        />
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
      </section>

      <section className="wf-admin__editor" aria-label="Editor">
        {editing ? (
          <ItemEditor
            key={editorKey}
            kind={kind}
            item={item}
            newSlot={newSlot ?? null}
            role={user.role}
            drafts={drafts}
            onChanged={(fresh) => {
              void reload(kind);
              if (fresh) {
                setItem(fresh);
                syncUrl(kind, fresh.id);
              } else if (item) {
                void open(item.id);
              }
            }}
            onDeleted={() => {
              setItem(null);
              setNewSlot(undefined);
              syncUrl(kind, null);
              void reload(kind);
            }}
          />
        ) : (
          <div className="grid h-full place-items-center text-center">
            <p className="wf-muted max-w-xs">
              Escolha uma vaga para editar, ou clique em “{KIND_UI[kind].nova}”.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
