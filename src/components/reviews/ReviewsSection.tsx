import Link from 'next/link';
import { RabinhoViolet } from '@/components/brand/generated';
import type { PublicItem } from '@/lib/catalog/types';
import { KIND_PATH } from '@/lib/catalog/kinds';
import { getCurrentSession } from '@/server/auth/current';
import { getEnv } from '@/server/env';
import {
  eligibility,
  itemReviews,
  ownReview,
  ratingSummary,
  topReview,
} from '@/server/reviews/read';
import { OwnReview } from './OwnReview';
import { RatingSummary } from './RatingSummary';
import { ReviewClipping } from './ReviewClipping';
import { ReviewForm } from './ReviewForm';
import { ReviewList } from './ReviewList';

/**
 * Reviews on a watched title's page (11 §2.3, 03 §5.4): summary, the viewer's own review or the
 * form (or why they can't write one), and the community's reviews.
 */
export async function ReviewsSection({ item }: { item: PublicItem }) {
  const ctx = await getCurrentSession();
  const viewerId = ctx?.user.id ?? null;
  const [summary, page, own, top] = await Promise.all([
    ratingSummary(item.id),
    itemReviews(item.id, 'recent', undefined, viewerId),
    viewerId ? ownReview(item.id, viewerId) : Promise.resolve(null),
    topReview(item.id),
  ]);
  const can = await eligibility(item.id, ctx?.user ?? null, own);
  const path = `/${KIND_PATH[item.kind]}/${item.slug}`;
  const loginHref = `/perfil?returnTo=${encodeURIComponent(`${path}#avaliacoes`)}`;
  const siteKey = getEnv().TURNSTILE_SITE_KEY;
  // the viewer's own review is shown above, not twice
  const others = { ...page, reviews: page.reviews.filter((r) => !r.mine) };

  return (
    <section className="wf-page wf-reviews-section" id="avaliacoes" aria-labelledby="avaliacoes-h">
      <h2 className="wf-h2 flex items-center gap-3" id="avaliacoes-h">
        <RabinhoViolet aria-hidden className="h-8 w-auto" />
        Avaliações
      </h2>
      {top ? <ReviewClipping review={top} /> : null}
      <div className="wf-reviews-grid">
        <div className="wf-reviews-side">
          {summary.count ? (
            <RatingSummary summary={summary} />
          ) : (
            <p className="wf-muted">Ninguém avaliou ainda. Que tal ser a primeira pessoa?</p>
          )}
          {own ? (
            <OwnReview review={own} itemId={item.id} siteKey={siteKey} />
          ) : can === 'OK' ? (
            <div className="wf-panel">
              <h3 className="wf-reviews__h3">Avaliar {item.title}</h3>
              <ReviewForm itemId={item.id} siteKey={siteKey} />
            </div>
          ) : can === 'SIGNED_OUT' ? (
            <div className="wf-panel">
              <h3 className="wf-reviews__h3">Assistiu com a gente?</h3>
              <p className="wf-muted">Entre com o Google para dar sua nota e contar o que achou.</p>
              <Link href={loginHref} className="wf-btn wf-btn--neon">
                Entrar para avaliar
              </Link>
            </div>
          ) : can === 'ONBOARDING' ? (
            <div className="wf-panel">
              <p className="wf-muted">Escolha seu nome de usuário para avaliar.</p>
              <Link href="/bem-vindo" className="wf-btn wf-btn--neon">
                Escolher nome
              </Link>
            </div>
          ) : can === 'SUSPENDED' ? (
            <p className="wf-notice">Sua conta está suspensa: você pode ler, mas não avaliar.</p>
          ) : null}
        </div>
        <ReviewList
          initial={others}
          source={{ kind: 'item', itemId: item.id }}
          viewer={{ signedIn: Boolean(ctx), loginHref }}
          empty={own ? 'Ainda não há outras avaliações.' : 'Ainda não há avaliações.'}
        />
      </div>
    </section>
  );
}
