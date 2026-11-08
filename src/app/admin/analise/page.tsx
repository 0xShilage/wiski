import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { adminPage } from '@/components/admin/admin-page';
import { RankedBars, RevenueChart } from '@/components/admin/AnalyticsCharts';
import { ANALYTICS_PERIODS, changePercent, parseDays } from '@/lib/analytics';
import { KIND_LABEL } from '@/lib/catalog/kinds';
import { PRIZE_LABEL } from '@/lib/roleta';
import { formatClock } from '@/lib/subathon-time';
import { analytics } from '@/server/admin/analytics';

export const metadata: Metadata = { title: 'Análise' };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const num = new Intl.NumberFormat('pt-BR');
const date = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'America/Sao_Paulo',
});
const STATUS_PT: Record<string, string> = {
  READY: 'Preparado',
  RUNNING: 'Rodando',
  PAUSED: 'Pausado',
  ENDED: 'Encerrado',
};
const GRAIN_PT = { day: 'por dia', week: 'por semana', month: 'por mês' } as const;

function Delta({ change, period }: { change: number | null; period: string }) {
  if (change === null) return <p className="wf-stat__delta">Sem dados no período anterior</p>;
  const dir = change > 0 ? '▲' : change < 0 ? '▼' : '=';
  const word = change > 0 ? 'mais' : change < 0 ? 'menos' : 'igual';
  return (
    <p className="wf-stat__delta">
      <span aria-hidden="true">{dir}</span> {Math.abs(change)}%{' '}
      <span className="sr-only">{word} </span>vs. {period} anteriores
    </p>
  );
}

function Stat({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="wf-stat">
      <p className="wf-stat__label">{label}</p>
      <p className="wf-stat__value">{value}</p>
      {children}
    </div>
  );
}

/** /admin/analise — money and community numbers for moderators and the streamer. */
export default async function AnalisePage({ searchParams }: Props) {
  const p = await adminPage('/admin/analise');
  if ('gate' in p) return p.gate;
  const days = parseDays((await searchParams).periodo);
  const a = await analytics(days);
  const label = ANALYTICS_PERIODS.find((x) => x.days === days)!.label;
  const r = a.revenue;
  return (
    <AdminShell
      active="analise"
      title="Análise"
      lead="Receita, pedidos e comunidade no período, comparados com o período anterior do mesmo tamanho. Receita = pedidos pagos que não foram reembolsados, pela data do pagamento."
      {...p.shell}
    >
      <nav className="wf-seg wf-analytics__periods" aria-label="Período">
        {ANALYTICS_PERIODS.map((x) => (
          <Link
            key={x.days}
            href={x.days === 30 ? '/admin/analise' : `/admin/analise?periodo=${x.days}`}
            className={x.days === days ? 'is-on' : ''}
            aria-current={x.days === days ? 'page' : undefined}
          >
            {x.label}
          </Link>
        ))}
      </nav>

      <section className="wf-analytics__hero" aria-labelledby="receita-titulo">
        <h2 id="receita-titulo" className="wf-stat__label">
          Receita · últimos {label}
        </h2>
        <p className="wf-analytics__hero-value">{brl.format(r.cents / 100)}</p>
        <Delta change={r.change} period={label} />
        <p className="wf-muted text-sm">
          Pix {brl.format(r.checkoutCents / 100)} · “Já pago” {brl.format(r.manualCents / 100)} ·{' '}
          {r.movies} {r.movies === 1 ? 'filme' : 'filmes'} · {r.contributions}{' '}
          {r.contributions === 1 ? 'contribuição' : 'contribuições'}
        </p>
      </section>

      <div className="wf-analytics__kpis">
        <Stat label="Pedidos pagos" value={num.format(r.orders)}>
          <Delta change={changePercent(r.orders, r.previousOrders)} period={label} />
        </Stat>
        <Stat label="Ticket médio" value={r.orders ? brl.format(r.averageCents / 100) : '—'} />
        <Stat
          label="Pix pagos / iniciados"
          value={a.conversion.percent === null ? '—' : `${a.conversion.percent}%`}
        >
          <p className="wf-stat__delta">
            {a.conversion.paid} de {a.conversion.created} pedidos do site
          </p>
        </Stat>
        <Stat label="Reembolsos" value={num.format(a.refunds.count)}>
          <p className="wf-stat__delta">{brl.format(a.refunds.cents / 100)}</p>
        </Stat>
        <Stat label="Novas contas" value={num.format(a.community.newAccounts)}>
          <Delta
            change={changePercent(a.community.newAccounts, a.community.previousNewAccounts)}
            period={label}
          />
        </Stat>
        <Stat label="Avaliações" value={num.format(a.community.reviews)} />
        <Stat label="Sugestões" value={num.format(a.community.suggestions)} />
      </div>

      <section className="wf-ops-card wf-analytics__card" aria-labelledby="serie-titulo">
        <h2 id="serie-titulo" className="wf-analytics__card-title">
          Receita {GRAIN_PT[a.granularity]}
        </h2>
        <RevenueChart
          series={a.series}
          caption={`Receita ${GRAIN_PT[a.granularity]}, últimos ${label}`}
        />
      </section>

      <section className="wf-ops-card wf-analytics__card" aria-labelledby="top-titulo">
        <h2 id="top-titulo" className="wf-analytics__card-title">
          Títulos que mais arrecadaram
        </h2>
        <RankedBars
          caption={`Títulos que mais arrecadaram, últimos ${label}`}
          rows={a.topTitles.map((t) => ({
            label: `${t.title} (${KIND_LABEL[t.kind].one})`,
            value: t.cents,
            text: `${brl.format(t.cents / 100)} · ${t.orders} ${t.orders === 1 ? 'pedido' : 'pedidos'}`,
          }))}
        />
      </section>

      <div className="wf-analytics__pair">
        <section className="wf-ops-card wf-analytics__card" aria-labelledby="roleta-titulo">
          <h2 id="roleta-titulo" className="wf-analytics__card-title">
            Roleta
          </h2>
          <div className="wf-analytics__kpis wf-analytics__kpis--compact">
            <Stat label="Giros" value={num.format(a.roleta.spins)} />
            <Stat label="Pessoas que giraram" value={num.format(a.roleta.players)} />
            <Stat label="Cupons usados" value={num.format(a.roleta.couponsUsed)} />
          </div>
          {a.roleta.prizes.length ? (
            <ul className="wf-analytics__list">
              {a.roleta.prizes.map((x) => (
                <li key={x.prize}>
                  <span>{PRIZE_LABEL[x.prize]}</span>
                  <b>{num.format(x.count)}</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="wf-muted text-sm">Nenhum prêmio neste período.</p>
          )}
        </section>

        <section className="wf-ops-card wf-analytics__card" aria-labelledby="subathon-titulo">
          <h2 id="subathon-titulo" className="wf-analytics__card-title">
            Subathons recentes
          </h2>
          {a.subathons.length ? (
            <table className="wf-analytics__table">
              <thead>
                <tr>
                  <th scope="col">Subathon</th>
                  <th scope="col">Início</th>
                  <th scope="col">Tempo somado</th>
                  <th scope="col">Entradas</th>
                </tr>
              </thead>
              <tbody>
                {a.subathons.map((s, i) => (
                  <tr key={`${s.title}-${i}`}>
                    <th scope="row">
                      {s.title}{' '}
                      <small className="wf-muted">{STATUS_PT[s.status] ?? s.status}</small>
                    </th>
                    <td>{s.startedAt ? date.format(new Date(s.startedAt)) : '—'}</td>
                    <td>{formatClock(Math.max(0, s.addedSeconds))}</td>
                    <td>{num.format(s.entries)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="wf-muted text-sm">Nenhum subathon ainda.</p>
          )}
        </section>
      </div>
    </AdminShell>
  );
}
