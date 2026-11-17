import type { Metadata } from 'next';
import { BingoGame, type BingoViewer } from '@/components/bingo/BingoGame';
import { BINGO_RESET_HOUR } from '@/lib/bingo';
import { getCurrentSession } from '@/server/auth/current';
import { myBingo } from '@/server/bingo/bingo';
import { isGoogleLoginConfigured } from '@/server/env';

export const metadata: Metadata = {
  title: 'Bingo',
  description: 'O bingo da live da Wiski: uma cartela por dia com o que pode acontecer no chat.',
};

/**
 * /bingo (2026-11-16): a signed-in viewer with a username takes one card a day (renewed at 16:00
 * BRT); the team marks what happens in the chat and on stream; a full line is a bingo. Anyone
 * sees what was called and who won today.
 */
export default async function BingoPage() {
  const ctx = await getCurrentSession();
  const viewer: BingoViewer = !ctx
    ? 'guest'
    : !ctx.user.username
      ? 'onboarding'
      : ctx.user.status !== 'ACTIVE'
        ? 'suspended'
        : 'ready';
  const view = await myBingo(viewer === 'ready' ? ctx!.user.id : null);
  return (
    <div className="wf-page wf-bingo-page">
      <h1 className="wf-h1">Bingo da live</h1>
      <p className="wf-bingo-page__intro">
        Todo dia você recebe uma cartela com 9 coisas que podem acontecer no chat e na live. A
        equipe marca cada uma quando acontece. Completou uma linha, coluna ou diagonal? Bingo! Seu
        nome aparece na live e no ranking.
      </p>
      <BingoGame
        initial={view}
        viewer={viewer}
        signInHref={
          isGoogleLoginConfigured()
            ? `/api/auth/google/start?returnTo=${encodeURIComponent('/bingo')}`
            : null
        }
      />
      <section className="wf-bingo-page__rules" aria-labelledby="bingo-rules">
        <h2 id="bingo-rules" className="wf-h2">
          Como funciona
        </h2>
        <ul className="wf-bingo-page__fine">
          <li>
            Uma cartela por conta por dia, sorteada pelo site: 9 dos 18 itens do bingo. As cartelas
            e os itens marcados recomeçam todo dia às {BINGO_RESET_HOUR}h (horário de Brasília).
          </li>
          <li>
            Só a equipe marca os itens, quando eles acontecem de verdade no chat ou na live. Você
            não precisa fazer nada: sua cartela se marca sozinha.
          </li>
          <li>
            Uma linha completa (horizontal, vertical ou diagonal) é um bingo. Vale um bingo por dia:
            quem completa primeiro fica em 1º, depois 2º, e assim por diante.
          </li>
          <li>
            Cada bingo aparece na live e no chat, conta no ranking de Bingo e nas conquistas do seu
            perfil.
          </li>
        </ul>
      </section>
    </div>
  );
}
