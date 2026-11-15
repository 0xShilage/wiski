'use client';
import { useId, useState } from 'react';
import { adminFetch } from '@/lib/passkey-client';
import { KIND_UI, type Kind } from './types';

/** At most this many lines per round (each one is a Wikidata lookup and a new draft). */
export const BULK_MAX = 20;

type Row = {
  title: string;
  year: number | null;
  state: 'waiting' | 'working' | 'done' | 'exists' | 'error';
  itemId?: string;
  note?: string;
};

/** "O Senhor dos Anéis (2001)" or "Duna, 2021" → title + year; a year inside a title stays. */
export function parseLine(line: string): { title: string; year: number | null } | null {
  const s = line.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const m = /^(.*?\S)\s*(?:\((1[89]\d{2}|20\d{2})\)|,\s*(1[89]\d{2}|20\d{2}))$/.exec(s);
  if (m) return { title: m[1]!.trim(), year: Number(m[2] ?? m[3]) };
  return { title: s, year: null };
}

/**
 * "Adicionar vários" (2026-11-15): one title per line → one draft each, filled from Wikidata,
 * in order. One request per line, so each line shows how it went; a title already in the catalog
 * is skipped. Images and synopsis are added afterwards in each draft.
 */
export function BulkAdd({
  kind,
  onOpen,
  onDone,
  onClose,
}: {
  kind: Kind;
  onOpen: (id: string) => void;
  /** after the round: reload the board */
  onDone: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const ui = KIND_UI[kind];
  const lines = text
    .split('\n')
    .map(parseLine)
    .filter((l): l is NonNullable<typeof l> => l !== null);
  const tooMany = lines.length > BULK_MAX;

  async function run() {
    if (!lines.length || tooMany) return;
    const list: Row[] = lines.map((l) => ({ ...l, state: 'waiting' }));
    setRows(list);
    setRunning(true);
    const put = (i: number, patch: Partial<Row>) =>
      setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
    for (let i = 0; i < list.length; i++) {
      put(i, { state: 'working' });
      const { title, year } = list[i]!;
      const res = await adminFetch<{
        result: { itemId: string; title: string; missing: string[] };
      }>('/api/v1/admin/catalog/quick-add', {
        method: 'POST',
        body: { kind, title, ...(year ? { year } : {}) },
      });
      if (res.ok) {
        const r = res.data.result;
        put(i, {
          state: 'done',
          itemId: r.itemId,
          title: r.title,
          note: r.missing.length ? `Confira: ${r.missing.join(' · ')}` : 'Preenchido pelo Wikidata',
        });
      } else if (res.problem.code === 'ALREADY_IN_CATALOG') {
        put(i, { state: 'exists', note: 'Já está no catálogo' });
      } else {
        put(i, { state: 'error', note: res.problem.detail });
      }
    }
    setRunning(false);
    setText('');
    onDone();
  }

  const made = rows.filter((r) => r.state === 'done').length;
  return (
    <section className="wf-bulk" aria-labelledby={`${id}-h`}>
      <div className="wf-editor__head">
        <h2 id={`${id}-h`}>Adicionar vários · {ui.many}</h2>
        <button type="button" className="wf-linkbtn" onClick={onClose} disabled={running}>
          Fechar
        </button>
      </div>
      <p className="wf-hint mt-2">
        Um título por linha, com o ano entre parênteses se quiser acertar a versão (ex.: “Duna
        (2021)”). Cada um vira um rascunho preenchido pelo Wikidata, na ordem da lista. Depois é só
        abrir cada um para pôr pôster, fundo e sinopse. Até {BULK_MAX} por vez.
      </p>
      <div className="wf-form">
        <label className="wf-field full">
          <span className="wf-field__row">
            <span>Títulos</span>
            <span className={tooMany ? 'wf-hint--err' : 'wf-hint'} aria-live="polite">
              {lines.length} / {BULK_MAX}
            </span>
          </span>
          <textarea
            className="wf-input"
            rows={8}
            value={text}
            disabled={running}
            placeholder={
              kind === 'MOVIE'
                ? 'O Senhor dos Anéis: A Sociedade do Anel (2001)\nO Senhor dos Anéis: As Duas Torres (2002)\nO Senhor dos Anéis: O Retorno do Rei (2003)'
                : 'Um título por linha'
            }
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <div className="wf-actions full">
          <button
            type="button"
            className="wf-btn wf-btn--neon"
            disabled={running || !lines.length || tooMany}
            onClick={() => void run()}
          >
            {running
              ? 'Criando…'
              : `Criar ${lines.length || ''} rascunho${lines.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
      {rows.length ? (
        <>
          <ol className="wf-bulk__rows" aria-label="Resultado">
            {rows.map((r, i) => (
              <li key={i} className={`is-${r.state}`}>
                <span className="wf-bulk__mark" aria-hidden="true">
                  {r.state === 'done'
                    ? '✓'
                    : r.state === 'exists'
                      ? '='
                      : r.state === 'error'
                        ? '!'
                        : r.state === 'working'
                          ? '…'
                          : '·'}
                </span>
                <span className="wf-bulk__title">
                  {r.title}
                  {r.year ? ` (${r.year})` : ''}
                  {r.note ? <small>{r.note}</small> : null}
                </span>
                {r.itemId ? (
                  <button type="button" className="wf-linkbtn" onClick={() => onOpen(r.itemId!)}>
                    Abrir
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
          {!running ? (
            <p className="wf-hint" role="status">
              {made} rascunho{made === 1 ? '' : 's'} criado{made === 1 ? '' : 's'}.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
