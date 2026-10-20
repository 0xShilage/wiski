'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { PontoInk } from '@/components/brand/generated';
import { apiFetch, type Problem } from '@/lib/api-fetch';
import { formatBRL } from '@/lib/catalog/pricing';
import { Breakdown } from './Breakdown';
import { CheckoutSheet } from './CheckoutSheet';
import type { CheckoutContext, Quote, QuoteLine } from './types';

const PLACEMENT_HINT = {
  AHEAD_OF_REGULAR: 'Passa à frente dos patrocínios comuns na fila da live.',
  TOP: 'Vai para o topo da fila: é o próximo filme da live.',
} as const;

type Props = {
  ctx: CheckoutContext;
  item: { id: string; slug: string; title: string; priceCents: number | null };
};

/**
 * "Patrocine agora" → the movie checkout sheet: live quote (perks when signed in, voucher,
 * Prioridade / Topo da fila), then the shared buyer fields. Opens by itself when the page is
 * reached through `#patrocinar` (the CTA on the home hero and cards).
 */
export function MovieCheckout({ ctx, item }: Props) {
  const [open, setOpen] = useState(false);
  const [tier, setTier] = useState<string | null>(null);
  const [voucher, setVoucher] = useState<string | null>(null);
  const [voucherDraft, setVoucherDraft] = useState('');
  const [voucherError, setVoucherError] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const seq = useRef(0);
  const ids = useId();

  useEffect(() => {
    if (window.location.hash === '#patrocinar') {
      // A deep link from "Patrocine agora" elsewhere on the site opens the sheet directly.
      const t = window.setTimeout(() => setOpen(true), 0);
      return () => window.clearTimeout(t);
    }
  }, []);

  const requote = useCallback(
    async (next: { tier: string | null; voucher: string | null }) => {
      const n = ++seq.current;
      const res = await apiFetch<Quote>('/api/v1/orders/quote', {
        method: 'POST',
        body: { itemId: item.id, queueJumpTierId: next.tier, voucherCode: next.voucher },
      });
      if (n !== seq.current) return; // a newer request superseded this one
      if (res.ok) {
        setQuote(res.data);
        setQuoteError(null);
        return;
      }
      const pr = res.problem;
      // Drop the add-on that failed; the effect below quotes again without it.
      if (next.voucher && pr.code.startsWith('VOUCHER')) {
        setVoucherError(pr.detail);
        setVoucher(null);
        return;
      }
      if (next.tier && pr.code.startsWith('QUEUE_JUMP')) {
        setNotice(pr.detail);
        setTier(null);
        return;
      }
      setQuote(null);
      setQuoteError(pr.detail);
    },
    [item.id],
  );

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => void requote({ tier, voucher }), 0);
    return () => window.clearTimeout(t);
  }, [open, tier, voucher, requote]);

  function onProblem(pr: Problem): boolean {
    if (pr.code === 'PRICE_CHANGED' && pr.breakdown && quote) {
      const b = pr.breakdown as { lines: QuoteLine[]; totalCents: number };
      setQuote({ ...quote, breakdown: b });
      return true;
    }
    if (pr.code.startsWith('VOUCHER')) {
      setVoucherError(pr.detail);
      setVoucher(null);
      return true;
    }
    if (pr.code.startsWith('QUEUE_JUMP')) {
      setTier(null);
      return true;
    }
    return false;
  }

  const total = quote?.breakdown.totalCents ?? null;
  const payload =
    quote && total !== null
      ? {
          itemId: item.id,
          queueJumpTierId: tier,
          voucherCode: voucher,
          expectedTotalCents: total,
        }
      : null;

  return (
    <>
      <button type="button" className="wf-btn wf-btn--neon" onClick={() => setOpen(true)}>
        <PontoInk aria-hidden className="size-3" />
        Patrocine agora
      </button>
      <CheckoutSheet
        ctx={ctx}
        open={open}
        onClose={() => {
          setOpen(false);
          if (window.location.hash === '#patrocinar') {
            history.replaceState(null, '', window.location.pathname + window.location.search);
          }
        }}
        kicker="Patrocinar filme"
        title={item.title}
        endpoint="/api/v1/orders"
        payload={payload}
        submitLabel={total !== null ? `Gerar Pix de ${formatBRL(total)}` : 'Gerar Pix'}
        onProblem={onProblem}
      >
        {quote && quote.queueJump.length ? (
          <fieldset className="wf-fieldset">
            <legend>Furar a fila (opcional)</legend>
            <div className="wf-choices">
              <label className="wf-choice">
                <input
                  type="radio"
                  name={`${ids}-tier`}
                  checked={tier === null}
                  onChange={() => setTier(null)}
                />
                <span>
                  <b>Ordem normal</b>
                  <small>Entra na fila da live por ordem de pagamento.</small>
                </span>
              </label>
              {quote.queueJump.map((t) => (
                <label key={t.id} className="wf-choice">
                  <input
                    type="radio"
                    name={`${ids}-tier`}
                    checked={tier === t.id}
                    onChange={() => {
                      setNotice(null);
                      setTier(t.id);
                    }}
                  />
                  <span>
                    <b>
                      {t.label} <span className="wf-choice__tag">+{t.bps / 100}%</span>
                    </b>
                    <small>{PLACEMENT_HINT[t.placement]}</small>
                  </span>
                </label>
              ))}
            </div>
            {notice ? (
              <p role="status" className="wf-hint wf-hint--err">
                {notice}
              </p>
            ) : null}
          </fieldset>
        ) : null}

        <details className="wf-voucher" open={voucher !== null || voucherError !== null}>
          <summary>Tenho um cupom</summary>
          <div className="wf-voucher__row">
            <label className="sr-only" htmlFor={`${ids}-voucher`}>
              Código do cupom
            </label>
            <input
              id={`${ids}-voucher`}
              className="wf-input"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={40}
              placeholder="Código do cupom"
              value={voucherDraft}
              onChange={(e) => setVoucherDraft(e.target.value)}
              aria-invalid={voucherError ? true : undefined}
              aria-describedby={voucherError ? `${ids}-voucher-err` : undefined}
            />
            {voucher ? (
              <button
                type="button"
                className="wf-btn wf-btn--ghost wf-btn--sm"
                onClick={() => {
                  setVoucher(null);
                  setVoucherDraft('');
                }}
              >
                Remover
              </button>
            ) : (
              <button
                type="button"
                className="wf-btn wf-btn--ghost wf-btn--sm"
                disabled={!voucherDraft.trim()}
                onClick={() => {
                  setVoucherError(null);
                  setVoucher(voucherDraft.trim().toUpperCase());
                }}
              >
                Aplicar
              </button>
            )}
          </div>
          {voucherError ? (
            <p id={`${ids}-voucher-err`} role="status" className="wf-hint wf-hint--err">
              {voucherError}
            </p>
          ) : null}
        </details>

        {quote ? (
          <Breakdown lines={quote.breakdown.lines} />
        ) : quoteError ? (
          <p role="alert" className="wf-alert">
            {quoteError}
          </p>
        ) : (
          <p className="wf-muted" role="status">
            Calculando o valor…
          </p>
        )}
        <p className="wf-hint">Ao gerar o Pix, o filme fica reservado para você por 35 minutos.</p>
      </CheckoutSheet>
    </>
  );
}
