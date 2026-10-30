'use client';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import { apiFetch, type Problem } from '@/lib/api-fetch';
import { formatBRL } from '@/lib/catalog/pricing';
import type { CheckoutProps } from '@/lib/checkout/types';
import { BuyerFields, buyerPayload, emptyBuyer, fieldErrors, type BuyerState } from './BuyerFields';
import { Turnstile, type TurnstileHandle } from './Turnstile';

type Created = { publicCode: string; accessToken: string };
const QUICK = [500, 1000, 2000, 5000];

/**
 * "Contribuir" (11 §2.2): whole-real amounts from R$ 5, quick buttons, never above what's left
 * (the server enforces it; the form caps and explains). No perks, vouchers or queue jump.
 */
export function ContributionForm({
  campaignId,
  remainingCents,
  props,
}: {
  campaignId: string;
  remainingCents: number;
  props: CheckoutProps;
}) {
  const id = useId();
  const router = useRouter();
  const min = props.contributionMinCents;
  const [remaining, setRemaining] = useState(remainingCents);
  const [reais, setReais] = useState(String(Math.min(10, Math.floor(remainingCents / 100))));
  const [buyer, setBuyer] = useState<BuyerState>(emptyBuyer);
  const [token, setToken] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const [captchaDown, setCaptchaDown] = useState(false);
  const idem = useRef<string>(crypto.randomUUID());
  const turnstile = useRef<TurnstileHandle>(null);

  const cents = /^\d{1,5}$/.test(reais) ? Number(reais) * 100 : NaN;
  const tooSmall = Number.isFinite(cents) && cents < min;
  const tooBig = Number.isFinite(cents) && cents > remaining;
  const valid = Number.isFinite(cents) && !tooSmall && !tooBig;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !token || busy) return;
    setBusy(true);
    setProblem(null);
    const r = await apiFetch<Created>(`/api/v1/campaigns/${campaignId}/contributions`, {
      method: 'POST',
      headers: { 'idempotency-key': idem.current, 'x-turnstile-token': token },
      body: { amountCents: cents, ...buyerPayload(buyer, props) },
    });
    if (r.ok) {
      router.push(`/pedido/${r.data.publicCode}#t=${r.data.accessToken}`);
      return;
    }
    setBusy(false);
    setProblem(r.problem);
    turnstile.current?.reset();
    idem.current = crypto.randomUUID();
    if (r.problem.remainingCents) setRemaining(Number(r.problem.remainingCents));
  }

  if (remaining < min) {
    return (
      <p className="wf-co__muted mt-4">
        Faltam só {formatBRL(remaining)} para a meta — menos que a contribuição mínima. O streamer
        fecha a campanha por aqui.
      </p>
    );
  }

  return (
    <form className="wf-co" onSubmit={submit} noValidate>
      <fieldset className="wf-co__amounts">
        <legend>Quanto você quer contribuir?</legend>
        <div className="wf-co__quick">
          {QUICK.filter((q) => q <= remaining).map((q) => (
            <button
              key={q}
              type="button"
              className={`wf-chip-btn ${cents === q ? 'is-on' : ''}`}
              aria-pressed={cents === q}
              onClick={() => setReais(String(q / 100))}
            >
              {formatBRL(q).replace(',00', '')}
            </button>
          ))}
        </div>
        <label className="wf-field" htmlFor={`${id}-amount`}>
          <span>Outro valor (reais inteiros)</span>
          <span className="wf-co__row">
            <span className="wf-co__prefix" aria-hidden="true">
              R$
            </span>
            <input
              id={`${id}-amount`}
              className="wf-input"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={5}
              value={reais}
              onChange={(e) => setReais(e.target.value.replace(/\D/g, ''))}
              aria-invalid={!valid ? 'true' : undefined}
              aria-describedby={`${id}-amount-hint`}
            />
          </span>
          <span id={`${id}-amount-hint`} className={!valid ? 'wf-hint wf-hint--err' : 'wf-hint'}>
            {tooBig
              ? `Faltam ${formatBRL(remaining)} para a meta — contribua até esse valor.`
              : `A partir de ${formatBRL(min).replace(',00', '')}, até ${formatBRL(remaining)}.`}
          </span>
        </label>
      </fieldset>

      <BuyerFields
        props={props}
        value={buyer}
        onChange={setBuyer}
        errors={fieldErrors(problem?.errors)}
      />

      <Turnstile
        ref={turnstile}
        siteKey={props.siteKey}
        action="contribute"
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
          {problem.detail}
        </p>
      ) : null}

      <button
        type="submit"
        className="wf-btn wf-btn--neon"
        disabled={!valid || !token || !buyer.accepted || busy || (!props.signedIn && !buyer.email)}
      >
        {busy ? 'Gerando Pix…' : valid ? `Gerar Pix · ${formatBRL(cents)}` : 'Gerar Pix'}
      </button>
      <p className="wf-co__muted wf-co__fine">
        O valor fica reservado por 30 minutos enquanto você paga. Se a meta não for atingida no
        prazo, o streamer prorroga — o dinheiro não é devolvido.
      </p>
    </form>
  );
}
