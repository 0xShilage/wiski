'use client';
import { useId, useState } from 'react';
import type { BadgeView } from '@/lib/badges';
import { adminFetch } from '@/lib/passkey-client';
import { BadgeArt } from './BadgeArt';

export type BadgeViewer = 'guest' | 'onboarding' | 'suspended' | 'ready';

const when = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});
const fmt = (iso: string) => when.format(new Date(iso)).replace('.', '');

/**
 * One badge on /emblemas (2026-11-12): its art and story, the window, how many have it, and — while
 * it is open — the claim button (with the claim word field when the badge has one). Claiming makes
 * the card light up; a badge the viewer has shows "Na sua coleção".
 */
export function BadgeCard({
  badge: initial,
  viewer,
  signInHref,
}: {
  badge: BadgeView;
  viewer: BadgeViewer;
  signInHref: string | null;
}) {
  const id = useId();
  const [badge, setBadge] = useState(initial);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justClaimed, setJustClaimed] = useState(false);
  const mine = badge.claimedAt !== null;
  const left = badge.maxClaims === null ? null : Math.max(0, badge.maxClaims - badge.claims);

  async function claim() {
    setBusy(true);
    setError(null);
    const r = await adminFetch<{ badge: BadgeView }>(`/api/v1/badges/${badge.slug}/claim`, {
      method: 'POST',
      body: badge.needsCode ? { code } : {},
    });
    setBusy(false);
    if (r.ok) {
      setBadge(r.data.badge);
      setJustClaimed(true);
    } else setError(r.problem.errors?.[0]?.message ?? r.problem.detail);
  }

  return (
    <article
      className={`wf-badge-card wf-badge-card--${badge.state}${mine ? ' is-mine' : ''}${justClaimed ? ' is-new' : ''}`}
      aria-labelledby={`${id}-name`}
    >
      <div className="wf-badge-card__art">
        {badge.state === 'upcoming' ? (
          <span className="wf-badge-art wf-badge-art--mystery" aria-hidden="true">
            ?
          </span>
        ) : (
          <BadgeArt picture={badge.picture} still={badge.still} name={badge.name} size={160} />
        )}
      </div>
      <div className="wf-badge-card__body">
        <p className="wf-badge-card__state">
          {badge.state === 'open'
            ? `Disponível até ${fmt(badge.endsAt)}`
            : badge.state === 'upcoming'
              ? `Abre em ${fmt(badge.startsAt)}`
              : `Encerrado em ${fmt(badge.endsAt)}`}
        </p>
        <h3 id={`${id}-name`} className="wf-badge-card__name">
          {badge.name}
        </h3>
        {badge.description ? <p className="wf-badge-card__desc">{badge.description}</p> : null}
        <p className="wf-badge-card__count">
          {badge.claims === 1 ? '1 pessoa tem' : `${badge.claims} pessoas têm`}
          {left !== null && badge.state !== 'closed'
            ? ` · ${left === 0 ? 'esgotado' : `restam ${left}`}`
            : ''}
        </p>

        {mine ? (
          <p className="wf-badge-card__mine" role={justClaimed ? 'status' : undefined}>
            {justClaimed ? 'Resgatado! Está na sua coleção.' : 'Na sua coleção'}
          </p>
        ) : badge.state === 'open' ? (
          viewer === 'ready' ? (
            <form
              className="wf-badge-card__claim"
              onSubmit={(e) => {
                e.preventDefault();
                void claim();
              }}
            >
              {badge.needsCode ? (
                <label className="wf-field" htmlFor={`${id}-code`}>
                  Palavra do evento
                  <input
                    id={`${id}-code`}
                    className="wf-input"
                    value={code}
                    maxLength={60}
                    autoComplete="off"
                    placeholder="Dita na live"
                    onChange={(e) => setCode(e.target.value)}
                  />
                </label>
              ) : null}
              <button
                type="submit"
                className="wf-btn wf-btn--neon"
                disabled={busy || left === 0 || (badge.needsCode && !code.trim())}
              >
                {busy ? 'Resgatando…' : 'Resgatar emblema'}
              </button>
              {error ? (
                <p role="alert" className="wf-hint wf-hint--err">
                  {error}
                </p>
              ) : null}
            </form>
          ) : viewer === 'guest' ? (
            signInHref ? (
              <a className="wf-btn wf-btn--ghost" href={signInHref}>
                Entre para resgatar
              </a>
            ) : null
          ) : viewer === 'onboarding' ? (
            <a className="wf-btn wf-btn--ghost" href="/bem-vindo">
              Escolha seu nome de usuário para resgatar
            </a>
          ) : (
            <p className="wf-hint">Contas suspensas não resgatam emblemas.</p>
          )
        ) : null}
      </div>
    </article>
  );
}
