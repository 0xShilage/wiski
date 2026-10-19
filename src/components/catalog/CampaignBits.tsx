import { PontoInk } from '@/components/brand/generated';
import { formatBRL, MIN_CONTRIBUTION_CENTS, percentFunded } from '@/lib/catalog/pricing';
import type { PublicCampaign, PublicItem } from '@/lib/catalog/types';
import Link from 'next/link';

const DAY = 86_400_000;
const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

export function daysLeft(c: PublicCampaign, now = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(c.deadlineAt) - now) / DAY));
}

/** <progress> + "R$ 186,00 de R$ 300,00 · 62%" (no inline widths — CSP). */
export function CampaignProgress({ c, size = 'lg' }: { c: PublicCampaign; size?: 'lg' | 'sm' }) {
  const pct = percentFunded(c.raisedCents, c.goalCents);
  return (
    <>
      <progress
        className={`wf-progress ${size === 'sm' ? 'wf-progress--sm' : ''}`}
        max={c.goalCents}
        value={Math.min(c.raisedCents, c.goalCents)}
        aria-label={`Arrecadado: ${formatBRL(c.raisedCents)} de ${formatBRL(c.goalCents)} (${pct}%)`}
      />
      <p className={`wf-nums ${size === 'sm' ? 'wf-nums--sm' : ''}`} aria-hidden="true">
        <span>
          <b>{formatBRL(c.raisedCents)}</b>{' '}
          <span className="wf-muted">de {formatBRL(c.goalCents)}</span>
        </span>
        <span>{pct}%</span>
      </p>
    </>
  );
}

/** Open: days left · supporters; funded / paused states (design §4, O3). */
export function CampaignStatus({ c }: { c: PublicCampaign }) {
  if (c.state === 'FUNDED' || c.state === 'SCHEDULED') {
    return <span className="wf-status wf-status--ok">Meta atingida ✓ · entra na live</span>;
  }
  if (c.state === 'WATCHED')
    return <span className="wf-status wf-status--ok">Assistido na live</span>;
  if (c.state === 'PAUSED') {
    return (
      <span className="wf-status wf-status--warn">Prazo encerrado — aguardando prorrogação</span>
    );
  }
  const d = daysLeft(c);
  return (
    <p className="wf-muted mt-2 text-sm">
      {d === 1 ? 'Falta 1 dia' : `Faltam ${d} dias`} · {c.supporterCount}{' '}
      {c.supporterCount === 1 ? 'apoiador' : 'apoiadores'}
      {c.extensions > 0 ? ` · prazo prorrogado até ${dateFmt.format(new Date(c.deadlineAt))}` : ''}
    </p>
  );
}

export function CampaignChips({ c }: { c: PublicCampaign }) {
  const d = daysLeft(c);
  return (
    <ul className="wf-chips mt-4 list-none p-0" aria-label="Detalhes da campanha">
      {c.state === 'OPEN' ? (
        <li className="wf-chip">{d === 1 ? 'Falta 1 dia' : `Faltam ${d} dias`}</li>
      ) : null}
      <li className="wf-chip">
        {c.supporterCount} {c.supporterCount === 1 ? 'apoiador' : 'apoiadores'}
      </li>
      <li className="wf-chip">Mínimo {formatBRL(MIN_CONTRIBUTION_CENTS).replace(',00', '')}</li>
      {c.extensions > 0 ? (
        <li className="wf-chip">Prazo prorrogado até {dateFmt.format(new Date(c.deadlineAt))}</li>
      ) : null}
    </ul>
  );
}

/** "Contribuir" — opens with Pix in Phase 2; links to the detail page's contribution box. */
export function ContributeCta({ item, kindPath }: { item: PublicItem; kindPath: string }) {
  const open = item.campaign?.state === 'OPEN';
  if (!open) {
    return (
      <span className="wf-btn wf-btn--done" aria-disabled="true">
        {item.campaign?.state === 'PAUSED' ? 'Contribuições pausadas' : 'Meta atingida'}
      </span>
    );
  }
  return (
    <Link href={`/${kindPath}/${item.slug}#contribuir`} className="wf-btn wf-btn--neon">
      <PontoInk aria-hidden className="size-3" />
      Contribuir
    </Link>
  );
}

export function campaignSubtitle(item: PublicItem): string {
  if (item.kind === 'SERIES') {
    return [item.seasonsLabel, item.episodeCount ? `${item.episodeCount} episódios` : null]
      .filter(Boolean)
      .join(' · ');
  }
  return `${item.films.length} ${item.films.length === 1 ? 'filme' : 'filmes'}`;
}
