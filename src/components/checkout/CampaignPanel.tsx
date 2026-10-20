'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { CampaignChips, CampaignProgress, CampaignStatus } from '@/components/catalog/CampaignBits';
import { PontoInk } from '@/components/brand/generated';
import type { Problem } from '@/lib/api-fetch';
import { formatBRL, MIN_CONTRIBUTION_CENTS } from '@/lib/catalog/pricing';
import type { PublicCampaign } from '@/lib/catalog/types';
import { CheckoutSheet } from './CheckoutSheet';
import type { CheckoutContext } from './types';
import { useEventStream } from './useEventStream';

const QUICK = [500, 1000, 2000, 5000];

type Progress = Pick<
  PublicCampaign,
  'goalCents' | 'raisedCents' | 'remainingCents' | 'supporterCount' | 'state'
>;

/**
 * The campaign box on a series/franchise page (11 §2.2): the live progress bar (SSE, polling
 * fallback) and the contribution picker — R$ 5 / 10 / 20 / 50 or any whole amount, capped at
 * what's left (pending Pix already excluded) — then the shared checkout sheet.
 */
export function CampaignPanel({
  ctx,
  title,
  campaign,
}: {
  ctx: CheckoutContext;
  title: string;
  campaign: PublicCampaign;
}) {
  const ids = useId();
  const [c, setC] = useState<PublicCampaign>(campaign);
  const [amount, setAmount] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [announce, setAnnounce] = useState('');
  const raised = useRef(campaign.raisedCents);

  // Live updates only once the box is on screen and the page has settled: a phone visitor who
  // never scrolls to it costs no stream (each IP gets at most 6).
  const panel = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);
  useEffect(() => {
    const el = panel.current;
    if (!el || !('IntersectionObserver' in window)) return;
    let timer: number | null = null;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && timer === null) {
        timer = window.setTimeout(() => setLive(true), 2_000);
        io.disconnect();
      }
    });
    io.observe(el);
    return () => {
      io.disconnect();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  useEventStream<Progress>({
    url:
      live && (c.state === 'OPEN' || c.state === 'PAUSED')
        ? `/api/v1/campaigns/${c.id}/events`
        : null,
    event: 'progress',
    pollUrl: `/api/v1/campaigns/${c.id}`,
    fromPoll: (json) => (json as { campaign?: Progress }).campaign ?? null,
    onData: (p) => {
      if (p.raisedCents > raised.current) {
        setAnnounce(`Arrecadado agora: ${formatBRL(p.raisedCents)} de ${formatBRL(p.goalCents)}.`);
      }
      raised.current = p.raisedCents;
      setC((prev) => ({
        ...prev,
        goalCents: p.goalCents,
        raisedCents: p.raisedCents,
        remainingCents: p.remainingCents,
        supporterCount: p.supporterCount,
        state: p.state,
      }));
    },
  });

  const remaining = c.remainingCents;
  const canContribute = c.state === 'OPEN' && remaining > 0;
  // Same rule as the server: whole reais from R$ 5 that close the goal exactly or leave at
  // least R$ 5 for the next person (a smaller remainder could never be paid).
  const maxOpen = remaining - MIN_CONTRIBUTION_CENTS;
  const valid = (cents: number) =>
    cents >= MIN_CONTRIBUTION_CENTS &&
    cents % 100 === 0 &&
    (cents === remaining || cents <= maxOpen);
  const quick = QUICK.filter(valid);
  const closing =
    remaining >= MIN_CONTRIBUTION_CENTS && !quick.includes(remaining) ? remaining : null;
  const rangeHint =
    maxOpen >= MIN_CONTRIBUTION_CENTS
      ? `De ${formatBRL(MIN_CONTRIBUTION_CENTS)} até ${formatBRL(maxOpen)}, ou exatamente ${formatBRL(remaining)} para completar a meta. Sem centavos.`
      : `Faltam ${formatBRL(remaining)}: só esse valor completa a meta.`;

  function pickCustom(v: string) {
    setCustom(v);
    setCustomError(null);
    if (!v.trim()) {
      setAmount(null);
      return;
    }
    const reais = Number(v.replace(/\D/g, ''));
    const cents = reais * 100;
    if (!Number.isSafeInteger(cents) || !valid(cents)) {
      setAmount(null);
      setCustomError(rangeHint);
      return;
    }
    setAmount(cents);
  }

  function onProblem(pr: Problem): boolean {
    if (pr.code === 'AMOUNT_ABOVE_REMAINING' && typeof pr.remainingCents === 'number') {
      setC((prev) => ({ ...prev, remainingCents: pr.remainingCents! }));
      setAmount(null);
      setOpen(false);
      setCustomError(pr.detail);
      return true;
    }
    if (pr.code === 'CAMPAIGN_CLOSED') {
      setOpen(false);
      setC((prev) => ({ ...prev, state: 'PAUSED' }));
      return true;
    }
    return false;
  }

  return (
    <div className="wf-panel" id="contribuir" ref={panel}>
      <h2>Campanha coletiva</h2>
      <CampaignProgress c={c} />
      <CampaignStatus c={c} />
      <CampaignChips c={c} />
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      {canContribute ? (
        <form
          className="wf-contrib"
          onSubmit={(e) => {
            e.preventDefault();
            if (amount !== null && valid(amount)) setOpen(true);
          }}
        >
          <fieldset className="wf-fieldset">
            <legend>Quanto você quer contribuir?</legend>
            <div className="wf-amounts">
              {quick.map((q) => (
                <label key={q} className="wf-amount">
                  <input
                    type="radio"
                    name={`${ids}-amount`}
                    checked={amount === q && !custom}
                    onChange={() => {
                      setCustom('');
                      setCustomError(null);
                      setAmount(q);
                    }}
                  />
                  <span>{formatBRL(q).replace(',00', '')}</span>
                </label>
              ))}
              {closing !== null ? (
                <label className="wf-amount wf-amount--wide">
                  <input
                    type="radio"
                    name={`${ids}-amount`}
                    checked={amount === closing && !custom}
                    onChange={() => {
                      setCustom('');
                      setCustomError(null);
                      setAmount(closing);
                    }}
                  />
                  <span>{formatBRL(closing)} · completa a meta</span>
                </label>
              ) : null}
            </div>
            {remaining >= MIN_CONTRIBUTION_CENTS ? (
              <label className="wf-field mt-3" htmlFor={`${ids}-custom`}>
                Outro valor (em reais)
                <span className="wf-money">
                  <span aria-hidden="true">R$</span>
                  <input
                    id={`${ids}-custom`}
                    className="wf-input"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="off"
                    maxLength={7}
                    value={custom}
                    onChange={(e) => pickCustom(e.target.value)}
                    aria-invalid={customError ? true : undefined}
                    aria-describedby={`${ids}-custom-hint`}
                  />
                </span>
                <span
                  id={`${ids}-custom-hint`}
                  className={`wf-hint ${customError ? 'wf-hint--err' : ''}`}
                >
                  {customError ?? rangeHint}
                </span>
              </label>
            ) : null}
          </fieldset>
          <button
            type="submit"
            className="wf-btn wf-btn--neon"
            disabled={amount === null}
            aria-disabled={amount === null || undefined}
          >
            <PontoInk aria-hidden className="size-3" />
            {amount !== null ? `Contribuir com ${formatBRL(amount)}` : 'Contribuir'}
          </button>
          <p className="wf-hint mt-2">
            O valor fica reservado enquanto o Pix não é pago (até 35 minutos). A barra mostra só o
            que já foi pago.
          </p>
        </form>
      ) : (
        <span className="wf-btn wf-btn--done mt-4" aria-disabled="true">
          {c.state === 'PAUSED' ? 'Contribuições pausadas' : 'Meta atingida'}
        </span>
      )}

      <CheckoutSheet
        ctx={ctx}
        open={open}
        onClose={() => setOpen(false)}
        kicker="Contribuir com a campanha"
        title={title}
        endpoint={`/api/v1/campaigns/${c.id}/contributions`}
        payload={amount !== null ? { amountCents: amount } : null}
        submitLabel={amount !== null ? `Gerar Pix de ${formatBRL(amount)}` : 'Gerar Pix'}
        legalNote="Se a meta não for atingida no prazo, o prazo é prorrogado e o valor continua na campanha até ela ser assistida."
        onProblem={onProblem}
      >
        {amount !== null ? (
          <table className="wf-breakdown">
            <caption className="sr-only">Resumo do valor</caption>
            <tbody>
              <tr>
                <th scope="row">Contribuição</th>
                <td>{formatBRL(amount)}</td>
              </tr>
              <tr className="is-total">
                <th scope="row">Total</th>
                <td>{formatBRL(amount)}</td>
              </tr>
            </tbody>
          </table>
        ) : null}
      </CheckoutSheet>
    </div>
  );
}
