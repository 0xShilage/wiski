'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { apiFetch, type Problem } from '@/lib/api-fetch';
import { formatBRL } from '@/lib/catalog/pricing';
import type { BreakdownLine, CheckoutProps } from '@/lib/checkout/types';
import { BuyerFields, buyerPayload, emptyBuyer, fieldErrors, type BuyerState } from './BuyerFields';
import { Turnstile, type TurnstileHandle } from './Turnstile';

type Quote = { breakdown: BreakdownLine[]; totalCents: number; available: boolean };
type Created = { publicCode: string; accessToken: string };

/**
 * "Patrocine agora" (11 §2.1): queue-jump tier, optional voucher, live breakdown from the server
 * quote (the client never computes a price), buyer fields, Turnstile → POST /api/v1/sponsorships
 * → the order page with the Pix. `expectedTotalCents` is the total the buyer saw: if the server
 * disagrees it answers 409 PRICE_CHANGED and the form shows the new total instead of charging it.
 */
export function MovieCheckout({ movieId, props }: { movieId: string; props: CheckoutProps }) {
  const id = useId();
  const router = useRouter();
  const [tier, setTier] = useState<string | null>(null);
  const [voucherInput, setVoucherInput] = useState('');
  const [voucher, setVoucher] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteProblem, setQuoteProblem] = useState<Problem | null>(null);
  const [buyer, setBuyer] = useState<BuyerState>(emptyBuyer);
  const [token, setToken] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const [captchaDown, setCaptchaDown] = useState(false);
  const idem = useRef<string>(crypto.randomUUID());
  const turnstile = useRef<TurnstileHandle>(null);

  const fetchQuote = useCallback(
    () =>
      apiFetch<Quote>('/api/v1/sponsorships/quote', {
        method: 'POST',
        body: { movieId, queueJumpTier: tier, ...(voucher ? { voucherCode: voucher } : {}) },
      }),
    [movieId, tier, voucher],
  );
  const apply = useCallback((r: Awaited<ReturnType<typeof fetchQuote>>) => {
    if (r.ok) {
      setQuote(r.data);
      setQuoteProblem(null);
    } else {
      setQuoteProblem(r.problem);
      // a bad voucher is dropped (and the quote re-runs without it); anything else leaves no
      // valid price, so paying is disabled until the selection changes
      if (r.problem.code.startsWith('VOUCHER')) setVoucher(null);
      else setQuote(null);
    }
  }, []);
  const refresh = useCallback(() => fetchQuote().then(apply), [fetchQuote, apply]);

  useEffect(() => {
    let live = true;
    void fetchQuote().then((r) => {
      if (live) apply(r);
    });
    return () => {
      live = false;
    };
  }, [fetchQuote, apply]);

  // A new selection is a new order attempt.
  useEffect(() => {
    idem.current = crypto.randomUUID();
  }, [tier, voucher]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!quote || !token || busy) return;
    setBusy(true);
    setProblem(null);
    const r = await apiFetch<Created>('/api/v1/sponsorships', {
      method: 'POST',
      headers: { 'idempotency-key': idem.current, 'x-turnstile-token': token },
      body: {
        movieId,
        queueJumpTier: tier,
        ...(voucher ? { voucherCode: voucher } : {}),
        expectedTotalCents: quote.totalCents,
        ...buyerPayload(buyer, props),
      },
    });
    if (r.ok) {
      router.push(`/pedido/${r.data.publicCode}#t=${r.data.accessToken}`);
      return;
    }
    setBusy(false);
    setProblem(r.problem);
    turnstile.current?.reset();
    idem.current = crypto.randomUUID();
    if (r.problem.code === 'PRICE_CHANGED' || r.problem.code.startsWith('QUEUE_JUMP'))
      void refresh();
  }

  const errors = fieldErrors(problem?.errors);
  const total = quote?.totalCents ?? null;
  const canPay = Boolean(
    quote?.available && token && buyer.accepted && !busy && (props.signedIn || buyer.email),
  );

  return (
    <form className="wf-co" onSubmit={submit} noValidate aria-describedby={`${id}-status`}>
      {props.tiers.length ? (
        <fieldset className="wf-co__tiers">
          <legend>Quando entra na live</legend>
          <label className={`wf-tier ${tier === null ? 'is-on' : ''}`}>
            <input
              type="radio"
              name={`${id}-tier`}
              checked={tier === null}
              onChange={() => setTier(null)}
            />
            <span className="wf-tier__name">Fila normal</span>
            <span className="wf-tier__extra">incluso</span>
          </label>
          {props.tiers.map((t) => (
            <label key={t.id} className={`wf-tier ${tier === t.id ? 'is-on' : ''}`}>
              <input
                type="radio"
                name={`${id}-tier`}
                checked={tier === t.id}
                onChange={() => setTier(t.id)}
              />
              <span className="wf-tier__name">{t.label}</span>
              <span className="wf-tier__extra">+{t.bps / 100} %</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      <div className="wf-co__voucher">
        <label className="wf-field" htmlFor={`${id}-voucher`}>
          <span>Cupom (opcional)</span>
          <span className="wf-co__row">
            <input
              id={`${id}-voucher`}
              className="wf-input"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={32}
              value={voucherInput}
              onChange={(e) => setVoucherInput(e.target.value)}
            />
            <button
              type="button"
              className="wf-btn wf-btn--ghost wf-btn--sm"
              disabled={!voucherInput.trim()}
              onClick={() => setVoucher(voucherInput.trim().toUpperCase() || null)}
            >
              Aplicar
            </button>
          </span>
        </label>
      </div>

      <div className="wf-co__sum" aria-live="polite">
        {quote ? (
          <dl className="wf-bd">
            {quote.breakdown
              .filter((l) => l.key !== 'subtotal' || quote.breakdown.length > 4)
              .map((l) => (
                <div
                  key={l.key}
                  className={`wf-bd__row ${l.key === 'total' ? 'is-total' : ''} ${l.cents === null ? 'is-info' : ''}`}
                >
                  <dt>{l.label}</dt>
                  <dd>
                    {l.cents === null
                      ? ''
                      : l.cents < 0
                        ? `− ${formatBRL(-l.cents)}`
                        : formatBRL(l.cents)}
                  </dd>
                </div>
              ))}
          </dl>
        ) : quoteProblem ? null : (
          <p className="wf-co__muted">Calculando…</p>
        )}
        {props.perk &&
        quote?.breakdown.some((l) => l.key === 'discount' && !l.label.startsWith('Cupom')) ? (
          <p className="wf-hint wf-hint--ok">
            Seu desconto de {props.perk === 'VIP' ? 'VIP' : 'moderação'} já está aplicado.
          </p>
        ) : null}
        {quote && !quote.available ? (
          <p className="wf-hint wf-hint--err" role="alert">
            Este filme acabou de ser reservado por outra pessoa. Se o Pix dela não for pago em até
            35 minutos, ele volta a ficar disponível.
          </p>
        ) : null}
        {quoteProblem ? (
          <p className="wf-hint wf-hint--err" role="alert">
            {quoteProblem.detail}
          </p>
        ) : null}
      </div>

      <BuyerFields props={props} value={buyer} onChange={setBuyer} errors={errors} />

      <Turnstile
        ref={turnstile}
        siteKey={props.siteKey}
        action="sponsor"
        onToken={(t) => {
          setToken(t);
          if (t) setCaptchaDown(false);
        }}
        onError={() => setCaptchaDown(true)}
      />
      {captchaDown ? (
        <p className="wf-hint wf-hint--err" role="alert">
          Não foi possível carregar a verificação anti-robô. Recarregue a página e tente de novo.
        </p>
      ) : null}

      {problem ? (
        <p className="wf-co__error" role="alert">
          {problem.code === 'PRICE_CHANGED'
            ? `O preço mudou para ${formatBRL(Number(problem.totalCents ?? 0))}. Confira e confirme de novo.`
            : problem.detail}
        </p>
      ) : null}

      <button
        type="submit"
        className="wf-btn wf-btn--neon"
        disabled={!canPay}
        aria-describedby={`${id}-status`}
      >
        {busy ? 'Gerando Pix…' : total !== null ? `Gerar Pix · ${formatBRL(total)}` : 'Gerar Pix'}
      </button>
      <p id={`${id}-status`} className="wf-co__muted wf-co__fine">
        O Pix vale 30 minutos e o filme fica reservado para você enquanto isso. Confira o nome do
        recebedor no app do banco antes de pagar.
      </p>
    </form>
  );
}
