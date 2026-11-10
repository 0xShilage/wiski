'use client';
import { useId, useState } from 'react';
import { formatBRL } from '@/lib/catalog/pricing';
import type { ManualCandidateView } from '@/lib/admin/types';
import { adminFetch } from '@/lib/passkey-client';
import { centsToReais, reaisToCents } from './types';

const KIND_GROUP = {
  MOVIE: 'Filmes',
  SERIES: 'Séries',
  FRANCHISE: 'Franquias',
  ANIME: 'Animes',
} as const;

/**
 * "Já pago" (2026-11-02; moderators too since 2026-11-08): register a payment received outside the site. The title
 * enters the queue like a site sale — a movie is sponsored, a contribution counts towards its
 * campaign — without a Pix, an e-mail or a stream alert.
 */
export function ManualPaymentForm({ onDone }: { onDone: (text: string, ok: boolean) => void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ManualCandidateView[] | null>(null);
  const [itemId, setItemId] = useState('');
  const [amount, setAmount] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [wall, setWall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = list?.find((c) => c.itemId === itemId) ?? null;

  async function load() {
    const r = await adminFetch<{ candidates: ManualCandidateView[] }>(
      '/api/v1/admin/orders/manual',
    );
    if (r.ok) setList(r.data.candidates);
    else setError(r.problem.detail);
  }

  function choose(v: string) {
    setItemId(v);
    const c = list?.find((x) => x.itemId === v);
    setAmount(c ? centsToReais(c.defaultCents) : '');
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!chosen) return;
    const cents = reaisToCents(amount);
    if (cents === null || !Number.isInteger(cents) || cents < 1 || cents > chosen.maxCents) {
      setError(
        chosen.kind === 'MOVIE'
          ? 'Informe o valor recebido (ex.: 60 ou 59,90).'
          : `Informe de R$ 0,01 até ${formatBRL(chosen.maxCents)} (o que falta na campanha).`,
      );
      return;
    }
    const what = chosen.kind === 'MOVIE' ? 'patrocínio' : 'contribuição';
    if (
      !window.confirm(
        `Registrar ${formatBRL(cents)} de ${what} para “${chosen.title}” como já pago? O título entra na fila.`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    const r = await adminFetch('/api/v1/admin/orders/manual', {
      method: 'POST',
      body: {
        itemId: chosen.itemId,
        amountCents: cents,
        ...(name.trim() ? { sponsorName: name, wall } : {}),
        ...(message.trim() ? { message } : {}),
        idempotencyKey: crypto.randomUUID(),
      },
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.problem.errors?.[0]?.message ?? r.problem.detail);
      return;
    }
    setItemId('');
    setAmount('');
    setName('');
    setMessage('');
    setWall(false);
    setList(null);
    setOpen(false);
    onDone(`Pagamento de “${chosen.title}” registrado: entrou na fila.`, true);
  }

  if (!open) {
    return (
      <p>
        <button
          type="button"
          className="wf-btn wf-btn--sm wf-btn--ghost"
          onClick={() => {
            setOpen(true);
            void load();
          }}
        >
          Já pago (registrar pagamento fora do site)
        </button>
      </p>
    );
  }

  const groups = (['MOVIE', 'SERIES', 'ANIME', 'FRANCHISE'] as const)
    .map((k) => ({ k, items: (list ?? []).filter((c) => c.kind === k) }))
    .filter((g) => g.items.length);

  return (
    <form
      className="wf-ops-card wf-ops-form"
      onSubmit={(e) => void submit(e)}
      aria-labelledby={`${id}-h`}
    >
      <h2 id={`${id}-h`} className="full m-0 text-base">
        Já pago
      </h2>
      <p className="full wf-muted m-0 text-sm">
        Para quem pagou fora do site (Pix direto, combinado na live). O filme fica patrocinado ou o
        valor entra na campanha, e o título vai para a fila. Nenhum e-mail ou alerta é enviado.
      </p>
      <label className="wf-field full" htmlFor={`${id}-item`}>
        Título
        <select
          id={`${id}-item`}
          value={itemId}
          required
          disabled={!list}
          onChange={(e) => choose(e.target.value)}
        >
          <option value="">{list ? 'Escolher título…' : 'Carregando…'}</option>
          {groups.map((g) => (
            <optgroup key={g.k} label={KIND_GROUP[g.k]}>
              {g.items.map((c) => (
                <option key={c.itemId} value={c.itemId}>
                  {c.slot ? `${String(c.slot).padStart(2, '0')} · ` : ''}
                  {c.title}
                  {c.kind === 'MOVIE' ? '' : ` (faltam ${formatBRL(c.maxCents)})`}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {list && !list.length ? (
        <p className="full wf-muted m-0 text-sm">
          Nenhum título livre: filmes já patrocinados e campanhas completas não aparecem aqui.
        </p>
      ) : null}
      <label className="wf-field" htmlFor={`${id}-amount`}>
        Valor recebido (R$)
        <input
          id={`${id}-amount`}
          inputMode="decimal"
          autoComplete="off"
          maxLength={12}
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      <label className="wf-field" htmlFor={`${id}-name`}>
        Nome público (opcional)
        <input
          id={`${id}-name`}
          autoComplete="off"
          maxLength={24}
          placeholder="vazio = Anônimo"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="wf-switch">
        <input
          type="checkbox"
          checked={wall && !!name.trim()}
          disabled={!name.trim()}
          onChange={(e) => setWall(e.target.checked)}
        />
        A pessoa quer aparecer no mural de apoiadores
      </label>
      <label className="wf-field full" htmlFor={`${id}-msg`}>
        Mensagem na live (opcional)
        <input
          id={`${id}-msg`}
          autoComplete="off"
          maxLength={140}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </label>
      {error ? (
        <p className="full wf-hint wf-hint--err m-0" role="alert">
          {error}
        </p>
      ) : null}
      <div className="full wf-ops-actions">
        <button type="submit" className="wf-btn wf-btn--sm wf-btn--neon" disabled={busy || !chosen}>
          Registrar como pago
        </button>
        <button
          type="button"
          className="wf-btn wf-btn--sm wf-btn--ghost"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
