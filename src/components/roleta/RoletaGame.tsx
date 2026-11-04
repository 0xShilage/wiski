'use client';
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { apiFetch, type Problem } from '@/lib/api-fetch';
import {
  nextResetText,
  PRIZE_LABEL,
  ROLETA_SLICES,
  ROLETA_SPINS_PER_DAY,
  SLICE_LABEL,
  type RoletaPrize,
  type RoletaPrizeStatus,
} from '@/lib/roleta';

export type MyPrize = {
  id: string;
  prize: RoletaPrize;
  status: RoletaPrizeStatus;
  createdAt: string;
  twitchLogin: string | null;
  coupon: { code: string; endsAt: string | null; used: boolean } | null;
};
export type RoletaView = { open: boolean; spinsLeft: number; nextAt: string; prizes: MyPrize[] };
type SpinResult = { slot: number; prize: RoletaPrize; won: MyPrize | null; view: RoletaView };

/** Who is looking: signed out, not onboarded yet, suspended, or able to spin. */
export type RoletaViewer = 'guest' | 'onboarding' | 'suspended' | 'ready';

const N = ROLETA_SLICES.length;
const STEP = 360 / N;
const SPIN_MS = 5_200;
const TURNS = 6;
const R = 100;

const STATUS_PT: Record<RoletaPrizeStatus, string> = {
  PENDING: 'Aguardando entrega',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado',
};
const date = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'America/Sao_Paulo',
});

/** a point on the wheel: angle in degrees clockwise from the top */
function pt(deg: number, r: number) {
  const a = (deg * Math.PI) / 180;
  return `${(r * Math.sin(a)).toFixed(3)} ${(-r * Math.cos(a)).toFixed(3)}`;
}
function slicePath(i: number) {
  const a0 = i * STEP - STEP / 2;
  const a1 = i * STEP + STEP / 2;
  return `M0 0 L${pt(a0, R)} A${R} ${R} 0 0 1 ${pt(a1, R)} Z`;
}
const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);

/**
 * The wheel (2026-11-04): pure SVG with presentation attributes (no inline styles: the CSP has no
 * 'unsafe-inline'); the rotation is a `transform` attribute driven by requestAnimationFrame. The
 * server decides the prize; the wheel only travels to the slice it was told.
 */
function Wheel({ rotation, gid }: { rotation: number; gid: string }) {
  return (
    <svg
      className="wf-roleta__wheel"
      viewBox="-118 -122 236 240"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${gid}-prize`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f3d9ff" />
          <stop offset="0.5" stopColor="#c9a8ff" />
          <stop offset="1" stopColor="#f2a7dd" />
        </linearGradient>
        <radialGradient id={`${gid}-hub`} cx="0.5" cy="0.4" r="0.6">
          <stop offset="0" stopColor="#4b3670" />
          <stop offset="1" stopColor="#1f1530" />
        </radialGradient>
      </defs>
      <circle className="wf-roleta__rim" r={R + 9} />
      <g transform={`rotate(${rotation.toFixed(3)})`}>
        {ROLETA_SLICES.map((p, i) => {
          const prize = p !== 'NADA';
          return (
            <g key={i}>
              <path
                d={slicePath(i)}
                className={prize ? 'wf-roleta__slice is-prize' : 'wf-roleta__slice'}
                fill={prize ? `url(#${gid}-prize)` : i % 2 ? '#4f3d72' : '#2e2141'}
              />
              <text
                className={prize ? 'wf-roleta__label is-prize' : 'wf-roleta__label'}
                transform={
                  // labels on the lower half read towards the centre, so none is upside down
                  i * STEP > 90 && i * STEP < 270
                    ? `rotate(${i * STEP + 90}) translate(-58 0)`
                    : `rotate(${i * STEP - 90}) translate(58 0)`
                }
                textAnchor="middle"
                dominantBaseline="central"
              >
                {SLICE_LABEL[p]}
              </text>
            </g>
          );
        })}
        {ROLETA_SLICES.map((_, i) => (
          <circle
            key={`peg-${i}`}
            className="wf-roleta__peg"
            r="2.6"
            cx={(R + 2.5) * Math.sin(((i * STEP - STEP / 2) * Math.PI) / 180)}
            cy={-(R + 2.5) * Math.cos(((i * STEP - STEP / 2) * Math.PI) / 180)}
          />
        ))}
      </g>
      <circle className="wf-roleta__hub" r="24" fill={`url(#${gid}-hub)`} />
      <path
        className="wf-roleta__hub-icon"
        d="M0 -13 C1.5 -4 4 -1.5 13 0 C4 1.5 1.5 4 0 13 C-1.5 4 -4 1.5 -13 0 C-4 -1.5 -1.5 -4 0 -13 Z"
      />
      <path className="wf-roleta__pointer" d="M-11 -121 L11 -121 L0 -96 Z" />
    </svg>
  );
}

export function RoletaGame({
  initial,
  viewer,
  signInHref,
}: {
  initial: RoletaView;
  viewer: RoletaViewer;
  signInHref: string | null;
}) {
  const gid = useId().replace(/[^\w-]/g, '');
  const [view, setView] = useState(initial);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<{ prize: RoletaPrize; left: number } | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [nextText, setNextText] = useState(() => nextResetText(initial.nextAt));
  const frame = useRef<number | null>(null);
  const rot = useRef(0);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  // the spins renew at 17:00: refresh once the next period has started
  const refresh = useCallback(async () => {
    const r = await apiFetch<RoletaView>('/api/v1/roleta');
    if (r.ok) {
      setView(r.data);
      setNextText(nextResetText(r.data.nextAt));
    }
  }, []);
  useEffect(() => {
    if (viewer !== 'ready') return;
    const t = setInterval(() => {
      if (Date.now() >= Date.parse(view.nextAt)) void refresh();
      else setNextText(nextResetText(view.nextAt));
    }, 30_000);
    return () => clearInterval(t);
  }, [viewer, view.nextAt, refresh]);

  function animateTo(slot: number, done: () => void) {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const from = rot.current;
    const jitter = (Math.random() - 0.5) * STEP * 0.6;
    const target = -slot * STEP + jitter;
    const delta = (((target - from) % 360) + 360) % 360;
    const to = from + (reduce ? 0 : TURNS * 360) + delta;
    const ms = reduce ? 450 : SPIN_MS;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const v = from + (to - from) * easeOut(k);
      rot.current = v;
      setRotation(v);
      if (k < 1) frame.current = requestAnimationFrame(tick);
      else {
        frame.current = null;
        rot.current = to % 360;
        setRotation(to % 360);
        done();
      }
    };
    frame.current = requestAnimationFrame(tick);
  }

  async function spin() {
    if (spinning || viewer !== 'ready') return;
    setSpinning(true);
    setProblem(null);
    setResult(null);
    const r = await apiFetch<SpinResult>('/api/v1/roleta/spin', { method: 'POST', body: {} });
    if (!r.ok) {
      setSpinning(false);
      setProblem(r.problem);
      if (r.problem.code === 'ROLETA_NO_SPINS' || r.problem.code === 'ROLETA_CLOSED')
        void refresh();
      return;
    }
    animateTo(r.data.slot, () => {
      setSpinning(false);
      setView(r.data.view);
      setNextText(nextResetText(r.data.view.nextAt));
      setResult({ prize: r.data.prize, left: r.data.view.spinsLeft });
    });
  }

  const left = view.spinsLeft;
  const canSpin = viewer === 'ready' && view.open && left > 0 && !spinning;

  return (
    <div className="wf-roleta">
      <section className="wf-roleta__stage" aria-labelledby={`${gid}-play`}>
        <h2 id={`${gid}-play`} className="sr-only">
          Girar a roleta
        </h2>
        <Wheel rotation={rotation} gid={gid} />
        <div className="wf-roleta__panel">
          {viewer === 'ready' ? (
            <p className="wf-roleta__left">
              <strong>{left}</strong>
              <span>
                {left === 1 ? 'giro' : 'giros'} de {ROLETA_SPINS_PER_DAY} hoje
              </span>
            </p>
          ) : null}
          {viewer === 'guest' ? (
            <>
              <p>Entre com sua conta Google para girar a roleta.</p>
              {signInHref ? (
                <a href={signInHref} className="wf-btn wf-btn--neon" rel="nofollow">
                  Entrar com Google
                </a>
              ) : (
                <p className="wf-notice">Login indisponível neste ambiente.</p>
              )}
            </>
          ) : viewer === 'onboarding' ? (
            <>
              <p>Escolha seu nome de usuário antes de girar.</p>
              <Link href="/bem-vindo" className="wf-btn wf-btn--neon">
                Escolher nome de usuário
              </Link>
            </>
          ) : viewer === 'suspended' ? (
            <p className="wf-notice">Sua conta está suspensa e não pode girar a roleta agora.</p>
          ) : !view.open ? (
            <p className="wf-notice">A roleta está fechada agora. Volte mais tarde.</p>
          ) : (
            <button
              type="button"
              className="wf-btn wf-btn--neon wf-roleta__spin"
              onClick={spin}
              disabled={!canSpin}
            >
              {spinning ? 'Girando…' : left > 0 ? 'Girar' : 'Sem giros hoje'}
            </button>
          )}
          <p className="wf-roleta__fine">
            {viewer === 'ready' && left === 0
              ? `Novos giros ${nextText}.`
              : `${ROLETA_SPINS_PER_DAY} giros por dia. Renovam todo dia às 17h e não acumulam.`}
          </p>
          <div aria-live="polite" className="wf-roleta__result">
            {result ? (
              result.prize === 'NADA' ? (
                <p className="wf-toast">
                  Nada desta vez.{' '}
                  {result.left > 0
                    ? `${result.left === 1 ? 'Resta 1 giro' : `Restam ${result.left} giros`} hoje.`
                    : `Novos giros ${nextText}.`}
                </p>
              ) : (
                <p className="wf-toast wf-toast--ok">
                  Você ganhou: <strong>{PRIZE_LABEL[result.prize]}</strong>! Veja abaixo como
                  receber.
                </p>
              )
            ) : null}
            {problem ? (
              <p role="alert" className="wf-toast wf-toast--err">
                {problem.detail}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {viewer === 'ready' && view.prizes.length ? (
        <section className="wf-roleta__mine" aria-labelledby={`${gid}-mine`}>
          <h2 id={`${gid}-mine`} className="wf-h2">
            Seus prêmios
          </h2>
          <ul>
            {view.prizes.map((p) => (
              <PrizeRow
                key={p.id}
                p={p}
                onChange={(np) =>
                  setView((v) => ({ ...v, prizes: v.prizes.map((x) => (x.id === np.id ? np : x)) }))
                }
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function PrizeRow({ p, onChange }: { p: MyPrize; onChange: (p: MyPrize) => void }) {
  const id = useId();
  const [login, setLogin] = useState(p.twitchLogin ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const byHand = p.prize === 'FILME' || p.prize === 'DOIS_FILMES' || p.prize === 'VIP_TWITCH';

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setProblem(null);
    setSaved(false);
    const r = await apiFetch<MyPrize>(`/api/v1/roleta/prizes/${p.id}`, {
      method: 'PATCH',
      body: { twitchLogin: login },
    });
    setBusy(false);
    if (r.ok) {
      onChange(r.data);
      setLogin(r.data.twitchLogin ?? '');
      setSaved(true);
    } else setProblem(r.problem);
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const fieldErr = problem?.errors?.find((e) => e.path === 'twitchLogin')?.message;
  return (
    <li className="wf-roleta__prize">
      <div className="wf-roleta__prize-head">
        <strong>{PRIZE_LABEL[p.prize]}</strong>
        <span className={`wf-roleta__status is-${p.status.toLowerCase()}`}>
          {p.prize === 'CUPOM_30' && p.status === 'DELIVERED'
            ? p.coupon?.used
              ? 'Usado'
              : 'Pronto para usar'
            : STATUS_PT[p.status]}
        </span>
        <small>{date.format(new Date(p.createdAt))}</small>
      </div>
      {p.coupon ? (
        <div className="wf-roleta__coupon">
          <code>{p.coupon.code}</code>
          {!p.coupon.used ? (
            <button
              type="button"
              className="wf-btn wf-btn--ghost"
              onClick={() => copy(p.coupon!.code)}
            >
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          ) : null}
          <p>
            30% de desconto em um filme
            {p.coupon.endsAt ? `, até ${date.format(new Date(p.coupon.endsAt))}` : ''}. Use o código
            no pagamento.
          </p>
        </div>
      ) : null}
      {byHand && p.status === 'PENDING' ? (
        <form className="wf-roleta__claim" onSubmit={save} noValidate>
          <label className="wf-field" htmlFor={`${id}-tw`}>
            <span>Seu usuário da Twitch</span>
            <input
              id={`${id}-tw`}
              className="wf-input"
              value={login}
              maxLength={26}
              autoComplete="off"
              spellCheck={false}
              placeholder="seu_usuario"
              onChange={(e) => setLogin(e.target.value)}
              aria-invalid={fieldErr ? 'true' : undefined}
              aria-describedby={`${id}-help`}
            />
          </label>
          <button type="submit" className="wf-btn wf-btn--ghost" disabled={busy || !login.trim()}>
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
          <p id={`${id}-help`} className={fieldErr ? 'wf-hint wf-hint--err' : 'wf-hint'}>
            {fieldErr ??
              (p.prize === 'VIP_TWITCH'
                ? 'O streamer usa seu usuário para te dar o VIP no canal.'
                : 'O streamer combina com você o filme pelo chat da live.')}
          </p>
          {saved ? (
            <p role="status" className="wf-toast wf-toast--ok">
              Salvo! O streamer já pode te entregar o prêmio.
            </p>
          ) : null}
          {problem && !fieldErr ? (
            <p role="alert" className="wf-toast wf-toast--err">
              {problem.detail}
            </p>
          ) : null}
        </form>
      ) : byHand && p.twitchLogin ? (
        <p className="wf-hint">Twitch: {p.twitchLogin}</p>
      ) : null}
    </li>
  );
}
