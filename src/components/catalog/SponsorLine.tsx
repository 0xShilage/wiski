import { PontoInk } from '@/components/brand/generated';
import { IconCheck } from '@/components/ui/icons';
import type { PublicItem } from '@/lib/catalog/types';
import {
  formatBRL,
  formatRuntime,
  MOVIE_BASE_UP_TO_MIN,
  MOVIE_PER_EXTRA_MIN_CENTS,
} from '@/lib/catalog/pricing';
import Link from 'next/link';

type MovieState = Pick<
  PublicItem,
  'slug' | 'state' | 'priceCents' | 'runtimeMinutes' | 'sponsorName' | 'manualPrice'
>;

/** "Patrocine agora" with its sold / reserved states (design §2, O8); the checkout form is on the detail page. */
export function SponsorCta({ item, className = '' }: { item: MovieState; className?: string }) {
  if (item.state === 'SPONSORED') {
    return (
      <span className={`wf-btn wf-btn--done ${className}`} aria-disabled="true">
        Patrocinado <IconCheck />
      </span>
    );
  }
  if (item.state === 'RESERVED') {
    return (
      <span className={`wf-btn wf-btn--done ${className}`} aria-disabled="true">
        Reservado
      </span>
    );
  }
  return (
    <Link href={`/filmes/${item.slug}#patrocinar`} className={`wf-btn wf-btn--neon ${className}`}>
      <PontoInk aria-hidden className="size-3" />
      Patrocine agora
    </Link>
  );
}

export function priceLine(item: MovieState): { lead: string; amount: string | null; rest: string } {
  if (item.state === 'SPONSORED') {
    return {
      lead: item.sponsorName ? `Patrocinado por ${item.sponsorName}` : 'Patrocinado',
      amount: null,
      rest: ' · entra numa das próximas sessões da live',
    };
  }
  if (item.state === 'RESERVED') {
    return {
      lead: 'Reservado: alguém está pagando o Pix deste filme.',
      amount: null,
      rest: ' Se não for concluído em até 35 minutos, ele volta a ficar disponível.',
    };
  }
  const extra = Math.max(0, item.runtimeMinutes - MOVIE_BASE_UP_TO_MIN);
  if (item.manualPrice) {
    return {
      lead: 'Patrocínio: ',
      amount: formatBRL(item.priceCents ?? 0),
      rest: ' · pago por uma pessoa',
    };
  }
  return {
    lead: 'Patrocínio: ',
    amount: formatBRL(item.priceCents ?? 0),
    rest:
      extra === 0
        ? ` · pago por uma pessoa · até ${formatRuntime(MOVIE_BASE_UP_TO_MIN)}`
        : ` · pago por uma pessoa · inclui ${extra} min além de ${formatRuntime(MOVIE_BASE_UP_TO_MIN)} (${formatBRL(MOVIE_PER_EXTRA_MIN_CENTS)}/min)`,
  };
}

export function PriceLine({ item, className }: { item: MovieState; className?: string }) {
  const p = priceLine(item);
  return (
    <p className={className}>
      {p.lead}
      {p.amount ? <b>{p.amount}</b> : null}
      {p.rest}
    </p>
  );
}
