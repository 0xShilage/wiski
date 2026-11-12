import type { Metadata } from 'next';
import { BadgeCard, type BadgeViewer } from '@/components/badges/BadgeCard';
import { getCurrentSession } from '@/server/auth/current';
import { publicBadges } from '@/server/badges/badges';
import { isGoogleLoginConfigured } from '@/server/env';

export const metadata: Metadata = {
  title: 'Emblemas',
  description:
    'Emblemas de edição limitada dos eventos da live: maratonas, sessões especiais. Resgate enquanto estão abertos.',
};

/**
 * /emblemas (2026-11-12): the time-limited badges. Open ones first (claim them while the window
 * is open, with the word said on stream when there is one), then the coming ones (art hidden until
 * they open), then the past ones.
 */
export default async function BadgesPage() {
  const ctx = await getCurrentSession();
  const viewer: BadgeViewer = !ctx
    ? 'guest'
    : !ctx.user.username
      ? 'onboarding'
      : ctx.user.status !== 'ACTIVE'
        ? 'suspended'
        : 'ready';
  const badges = await publicBadges(ctx?.user.id ?? null);
  const signInHref = isGoogleLoginConfigured()
    ? `/api/auth/google/start?returnTo=${encodeURIComponent('/emblemas')}`
    : null;
  const groups = [
    { state: 'open', title: 'Disponíveis agora' },
    { state: 'upcoming', title: 'Em breve' },
    { state: 'closed', title: 'Encerrados' },
  ] as const;
  const mine = badges.filter((b) => b.claimedAt).length;
  return (
    <div className="wf-page wf-badges-page">
      <h1 className="wf-h1">Emblemas</h1>
      <p className="wf-badges-page__intro">
        Emblemas de edição limitada para quem estava lá: maratonas, sessões especiais, datas da
        live. Cada um só pode ser resgatado enquanto o evento está aberto
        {ctx ? `. Você tem ${mine === 1 ? '1 emblema' : `${mine} emblemas`}.` : '.'}
      </p>
      {badges.length === 0 ? (
        <p className="wf-badges-page__empty">
          Nenhum emblema ainda. O primeiro aparece aqui no próximo evento da live.
        </p>
      ) : null}
      {groups.map((g) => {
        const list = badges.filter((b) => b.state === g.state);
        if (!list.length) return null;
        return (
          <section
            key={g.state}
            className="wf-badges-page__group"
            aria-labelledby={`emblemas-${g.state}`}
          >
            <h2 id={`emblemas-${g.state}`} className="wf-h2">
              {g.title}
            </h2>
            <div className="wf-badges-grid">
              {list.map((b) => (
                <BadgeCard key={b.id} badge={b} viewer={viewer} signInHref={signInHref} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
