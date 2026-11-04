import type { Metadata } from 'next';
import { RoletaGame, type RoletaViewer } from '@/components/roleta/RoletaGame';
import {
  nadaPercent,
  oddsText,
  PRIZE_LABEL,
  ROLETA_COUPON_DAYS,
  ROLETA_ODDS,
  ROLETA_SPINS_PER_DAY,
} from '@/lib/roleta';
import { getCurrentSession } from '@/server/auth/current';
import { isGoogleLoginConfigured } from '@/server/env';
import { myRoleta } from '@/server/roleta/roleta';

export const metadata: Metadata = {
  title: 'Roleta',
  description: 'Gire a roleta do Wiski todo dia: filmes grátis, VIP na Twitch e cupons.',
};

/**
 * /roleta (2026-11-04): the daily wheel of fortune. Anyone sees the wheel and the odds; a
 * signed-in viewer with a username spins (5 a day, renewed at 17:00 BRT, not cumulative).
 */
export default async function RoletaPage() {
  const ctx = await getCurrentSession();
  const viewer: RoletaViewer = !ctx
    ? 'guest'
    : !ctx.user.username
      ? 'onboarding'
      : ctx.user.status !== 'ACTIVE'
        ? 'suspended'
        : 'ready';
  const view = await myRoleta(viewer === 'ready' ? ctx!.user.id : null);
  const pct = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  return (
    <div className="wf-page wf-roleta-page">
      <h1 className="wf-h1">Roleta</h1>
      <p className="wf-roleta-page__intro">
        Gire a roleta e concorra a filmes grátis, VIP no canal da Twitch e cupons de desconto. São{' '}
        {ROLETA_SPINS_PER_DAY} giros por dia, renovados todo dia às 17h (horário de Brasília).
      </p>
      <RoletaGame
        initial={view}
        viewer={viewer}
        signInHref={
          isGoogleLoginConfigured()
            ? `/api/auth/google/start?returnTo=${encodeURIComponent('/roleta')}`
            : null
        }
      />
      <section className="wf-roleta-page__rules" aria-labelledby="roleta-odds">
        <h2 id="roleta-odds" className="wf-h2">
          Chances em cada giro
        </h2>
        <table className="wf-roleta-page__odds">
          <thead>
            <tr>
              <th scope="col">Prêmio</th>
              <th scope="col">Chance</th>
            </tr>
          </thead>
          <tbody>
            {ROLETA_ODDS.map((o) => (
              <tr key={o.prize}>
                <th scope="row">{PRIZE_LABEL[o.prize]}</th>
                <td>{oddsText(o.oneIn)}</td>
              </tr>
            ))}
            <tr>
              <th scope="row">Nada</th>
              <td>{pct(nadaPercent())}%</td>
            </tr>
          </tbody>
        </table>
        <ul className="wf-roleta-page__fine">
          <li>
            O sorteio acontece no servidor, a cada giro, com as chances acima. As fatias da roleta
            têm o mesmo tamanho só para ficar bonito: a chance de cada prêmio é a da tabela.
          </li>
          <li>
            {ROLETA_SPINS_PER_DAY} giros por conta por dia. Eles renovam às 17h e não acumulam:
            giros que você não usou não passam para o dia seguinte.
          </li>
          <li>
            Cupom de 30%: vale para um filme, por {ROLETA_COUPON_DAYS} dias. O código aparece em
            “Seus prêmios” na hora.
          </li>
          <li>
            Filme grátis, dois filmes grátis e VIP na Twitch: informe seu usuário da Twitch em “Seus
            prêmios” e o streamer entrega o prêmio.
          </li>
          <li>Uma conta por pessoa. Prêmios de contas duplicadas podem ser cancelados.</li>
        </ul>
      </section>
    </div>
  );
}
