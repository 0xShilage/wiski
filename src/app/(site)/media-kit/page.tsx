import type { Metadata } from 'next';
import { card } from '@/components/ui/styles';
import { mediaKitGoals } from '@/server/goals/goals';
import { listStats, METRIC_LABEL } from '@/server/mediakit/stats';

export const metadata: Metadata = {
  title: 'Media kit',
  description: 'Números da live do Wiski e formatos de parceria.',
};

const PLATFORM_PT = {
  TWITCH: 'Twitch',
  YOUTUBE: 'YouTube',
  KICK: 'Kick',
  TIKTOK: 'TikTok',
  INSTAGRAM: 'Instagram',
  X: 'X',
} as const;
const num = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const date = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

/**
 * /media-kit (Q18): the platform numbers the streamer keeps up to date in the dashboard and the
 * goals marked for the media kit. Revenue goals appear as a percentage only, never the amount.
 */
export default async function MediaKitPage() {
  const [stats, goals] = await Promise.all([listStats(), mediaKitGoals()]);
  const platforms = [...new Set(stats.map((s) => s.platform))];
  const updated = stats.length
    ? new Date(Math.max(...stats.map((s) => Date.parse(s.updatedAt))))
    : null;

  return (
    <div className="wf-page wf-page--narrow space-y-8">
      <section className={`${card} space-y-4 leading-relaxed`}>
        <h1 className="wf-h1">Media kit</h1>
        <p>
          A Wiskiflix é a live em que o público escolhe e patrocina o filme da noite e todo mundo
          assiste junto. Marcas podem aparecer nos overlays da live, em sessões temáticas e em ações
          com a comunidade.
        </p>
        <p>
          Quer conversar? Escreva pela{' '}
          <a className="underline" href="/contato">
            página de contato
          </a>
          .
        </p>
      </section>

      {platforms.map((p) => (
        <section key={p} className={card} aria-labelledby={`kit-${p}`}>
          <h2 id={`kit-${p}`} className="wf-h2">
            {PLATFORM_PT[p]}
          </h2>
          <div className="wf-kit">
            {stats
              .filter((s) => s.platform === p)
              .map((s) => (
                <div key={s.metric} className="wf-kit__stat">
                  <p className="wf-kit__num">{num.format(s.value)}</p>
                  <span className="text-sm text-fg-muted">{METRIC_LABEL[s.metric]}</span>
                </div>
              ))}
          </div>
        </section>
      ))}
      {platforms.length ? null : (
        <p className={card}>Os números da live serão publicados aqui em breve.</p>
      )}

      {goals.length ? (
        <section className={card} aria-labelledby="kit-metas">
          <h2 id="kit-metas" className="wf-h2">
            Metas da comunidade
          </h2>
          <ul className="mt-4 grid gap-4">
            {goals.map((g) => (
              <li key={g.id} className="grid gap-1">
                <span>{g.title}</span>
                <progress
                  className="wf-progress"
                  max={100}
                  value={g.percent}
                  aria-label={`${g.title}: ${g.percent}%`}
                />
                <span className="text-sm text-fg-muted">
                  {g.metric === 'SPONSORSHIP_REVENUE_CENTS'
                    ? `${g.percent}% da meta`
                    : `${g.current.toLocaleString('pt-BR')} de ${g.target.toLocaleString('pt-BR')} · ${g.percent}%`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {updated ? (
        <p className="text-xs text-fg-muted">Números atualizados em {date.format(updated)}.</p>
      ) : null}
    </div>
  );
}
