import type { Metadata } from 'next';
import Link from 'next/link';
import { Avatar } from '@/components/Avatar';
import { rankings, type RankingRow } from '@/server/community/rankings';

export const metadata: Metadata = {
  title: 'Ranking',
  description: 'Quem mais patrocinou filmes, escreveu avaliações e recebeu curtidas na Wiski.',
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const PERIOD_LABEL = { mes: 'Este mês', geral: 'Desde sempre' } as const;

function Board({
  id,
  title,
  lead,
  rows,
  unit,
}: {
  id: string;
  title: string;
  lead: string;
  rows: RankingRow[];
  unit: [string, string];
}) {
  return (
    <section className="wf-rank" aria-labelledby={id}>
      <h2 id={id} className="wf-rank__title">
        {title}
      </h2>
      <p className="wf-rank__lead">{lead}</p>
      {rows.length ? (
        <ol className="wf-rank__list">
          {rows.map((r) => (
            <li key={r.username} className={r.position <= 3 ? `is-top is-top-${r.position}` : ''}>
              <span className="wf-rank__pos">
                {r.position}
                <span className="sr-only">º lugar</span>
              </span>
              <Avatar avatarKey={r.avatarKey} size={40} alt="" />
              <Link href={`/u/${r.username}`} className="wf-rank__name" prefetch={false}>
                @{r.username}
              </Link>
              <span className="wf-rank__value">
                {r.value} {r.value === 1 ? unit[0] : unit[1]}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="wf-muted text-sm">Ninguém por aqui ainda. Que tal ser a primeira pessoa?</p>
      )}
    </section>
  );
}

/**
 * /ranking (2026-11-04): counts only, never amounts; sponsorships only when the sponsor's name is
 * shown; accounts that turned the ranking off (in /perfil) and the streamer are not listed.
 */
export default async function RankingPage({ searchParams }: Props) {
  const raw = (await searchParams).periodo;
  const period = raw === 'geral' ? 'geral' : 'mes';
  const r = await rankings();
  return (
    <div className="wf-page wf-rank-page">
      <h1 className="wf-h1">Ranking</h1>
      <p className="wf-rank-page__intro">
        Quem mais movimenta a Wiski. Contam patrocínios com o nome visível, avaliações e curtidas.
        Valores nunca aparecem, e você pode sair do ranking quando quiser em{' '}
        <Link href="/perfil#minhas-conquistas" className="underline underline-offset-4">
          Perfil
        </Link>
        .
      </p>
      <nav className="wf-seg" aria-label="Período">
        {(['mes', 'geral'] as const).map((p) => (
          <Link
            key={p}
            href={p === 'mes' ? '/ranking' : '/ranking?periodo=geral'}
            className={period === p ? 'is-on' : ''}
            aria-current={period === p ? 'page' : undefined}
          >
            {PERIOD_LABEL[p]}
          </Link>
        ))}
      </nav>
      <div className="wf-rank-grid">
        <Board
          id="rank-patrocinadores"
          title="Patrocinadores"
          lead={`Filmes patrocinados · ${PERIOD_LABEL[period].toLowerCase()}`}
          rows={r.patrocinadores[period]}
          unit={['filme', 'filmes']}
        />
        <Board
          id="rank-criticos"
          title="Críticos"
          lead={`Avaliações publicadas · ${PERIOD_LABEL[period].toLowerCase()}`}
          rows={r.criticos[period]}
          unit={['avaliação', 'avaliações']}
        />
        <Board
          id="rank-curtidas"
          title="Mais curtidos"
          lead="Curtidas recebidas nas avaliações · desde sempre"
          rows={r.curtidas.geral}
          unit={['curtida', 'curtidas']}
        />
      </div>
    </div>
  );
}
