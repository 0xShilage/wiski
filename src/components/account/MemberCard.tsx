import { Avatar } from '@/components/Avatar';
import { LogoWiskiLilac } from '@/components/brand/generated';
import { formatMonthYear } from '@/lib/format';
import {
  barcodeBars,
  barcodeWidth,
  type MemberStats,
  memberNumber,
  memberTier,
  nextMemberTier,
} from '@/lib/member-card';
import type { RoleName } from '@/lib/roles';

const num = new Intl.NumberFormat('pt-BR');

type Props = {
  user: {
    id: string;
    username: string;
    avatarKey: string | null;
    createdAt: Date;
    role: RoleName;
    isVip: boolean;
  };
  stats: MemberStats;
};

/**
 * Cinema membership card (2026-11-11): the top of /perfil as a loyalty card — avatar, "sócio
 * desde", the tier, four numbers, a member number and its (decorative) barcode. It tilts like the
 * posters and a foil sheen sweeps across it now and then (not with "reduce motion").
 */
export function MemberCard({ user, stats }: Props) {
  const tier = memberTier(stats, user.role);
  const next = nextMemberTier(stats, user.role);
  const number = memberNumber(user.id);
  const bars = barcodeBars(number);
  const width = barcodeWidth(bars);
  const items = [
    ['Filmes patrocinados', stats.sponsorships],
    ['Contribuições', stats.contributions],
    ['Minutos de live', stats.minutes],
    ['Avaliações', stats.reviews],
  ] as const;
  return (
    <div className="wf-member">
      <div className={`wf-member__card wf-member__card--${tier.id}`} data-tilt="5">
        <div className="wf-member__top">
          <LogoWiskiLilac className="wf-member__logo" aria-hidden="true" focusable="false" />
          <span className="wf-member__kind">Carteirinha de sócio</span>
        </div>
        <div className="wf-member__main">
          <span className="wf-member__ring">
            <Avatar avatarKey={user.avatarKey} size={64} />
          </span>
          <div className="wf-member__who">
            <p className="wf-member__name">@{user.username}</p>
            <p className="wf-member__since">Sócio desde {formatMonthYear(user.createdAt)}</p>
            <p className="wf-member__tiers">
              <span className="wf-member__tier">{tier.label}</span>
              {user.isVip ? <span className="wf-member__vip">VIP</span> : null}
            </p>
          </div>
          <span className="wf-member__chip" aria-hidden="true" />
        </div>
        <dl className="wf-member__stats">
          {items.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{num.format(value)}</dd>
            </div>
          ))}
        </dl>
        <div className="wf-member__foot">
          <p className="wf-member__no">
            <span className="sr-only">Número de sócio </span>Nº {number}
          </p>
          <svg
            className="wf-member__barcode"
            viewBox={`0 0 ${width} 24`}
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
          >
            {bars.map((b) => (
              <rect key={b.x} x={b.x} y="0" width={b.w} height="24" fill="currentColor" />
            ))}
          </svg>
        </div>
      </div>
      {next ? (
        <p className="wf-member__next">
          Faltam <strong>{next.remaining}</strong>{' '}
          {next.remaining === 1 ? 'patrocínio ou contribuição' : 'patrocínios ou contribuições'}{' '}
          para <strong>{next.label}</strong>.
        </p>
      ) : null}
    </div>
  );
}
