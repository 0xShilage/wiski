import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import Link from 'next/link';
import { Avatar } from '@/components/Avatar';
import { AchievementBadges } from '@/components/community/AchievementBadges';
import { BadgeShelf } from '@/components/badges/BadgeShelf';
import { RabinhoViolet } from '@/components/brand/generated';
import { ReviewList } from '@/components/reviews/ReviewList';
import { card, heading } from '@/components/ui/styles';
import { formatMonthYear } from '@/lib/format';
import { getCurrentSession } from '@/server/auth/current';
import { badgesOf } from '@/server/badges/badges';
import { achievementsFor } from '@/server/community/achievements';
import { findProfile, userReviews } from '@/server/reviews/read';

type Props = { params: Promise<{ username: string }> };

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const profile = await findProfile(safeDecode((await params).username));
  return profile ? { title: `@${profile.username}` } : { title: 'Perfil não encontrado' };
}

/**
 * Public profile (03 §5.4): username, avatar, joined month, badges (2026-11-04) and event badges
 * (2026-11-12) — both unless the viewer turned them off — and visible reviews, never e-mail. Same
 * column as /perfil (`wf-page--narrow`, 2026-11-11): the page clears the floating header and lines
 * up with the rest of the site.
 */
export default async function PerfilPublicoPage({ params }: Props) {
  const raw = (await params).username;
  const profile = await findProfile(safeDecode(raw));
  if (!profile) notFound();
  if (raw !== profile.username) permanentRedirect(`/u/${profile.username}`);
  const ctx = await getCurrentSession();
  const [page, badges, emblems] = await Promise.all([
    userReviews(profile.id, undefined, ctx?.user.id),
    profile.showAchievements ? achievementsFor(profile) : Promise.resolve([]),
    profile.showAchievements ? badgesOf(profile.id) : Promise.resolve([]),
  ]);
  const earned = badges.filter((b) => b.earned);

  return (
    <div className="wf-page wf-page--narrow space-y-8">
      <section
        className={`${card} flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left`}
      >
        <Avatar avatarKey={profile.avatarKey} size={96} alt={`Avatar de @${profile.username}`} />
        <div>
          <h1 className="text-h1 font-semibold text-lilac">@{profile.username}</h1>
          <p className="text-fg-muted">
            Membro desde {formatMonthYear(profile.createdAt)} · {profile.reviewCount}{' '}
            {profile.reviewCount === 1 ? 'avaliação' : 'avaliações'}
          </p>
        </div>
      </section>
      {earned.length ? (
        <section aria-labelledby="conquistas">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="conquistas" className={heading.h2}>
              Conquistas
            </h2>
            <Link
              href="/ranking"
              className="text-sm text-lavender underline-offset-4 hover:underline"
            >
              Ver ranking
            </Link>
          </div>
          <AchievementBadges items={earned} labelledBy="conquistas" />
        </section>
      ) : null}
      {emblems.length ? (
        <section aria-labelledby="emblemas">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="emblemas" className={heading.h2}>
              Emblemas
            </h2>
            <Link
              href="/emblemas"
              className="text-sm text-lavender underline-offset-4 hover:underline"
            >
              Ver todos
            </Link>
          </div>
          <BadgeShelf items={emblems} labelledBy="emblemas" />
        </section>
      ) : null}
      <section aria-labelledby="avaliacoes">
        <h2 id="avaliacoes" className={`${heading.h2} mb-4 flex items-center gap-3`}>
          <RabinhoViolet aria-hidden className="h-8 w-auto" />
          Avaliações
        </h2>
        <ReviewList
          initial={page}
          source={{ kind: 'user', username: profile.username }}
          viewer={{
            signedIn: Boolean(ctx),
            loginHref: `/perfil?returnTo=${encodeURIComponent(`/u/${profile.username}`)}`,
          }}
          showItem
          showAuthor={false}
          empty="Nenhuma avaliação ainda."
        />
      </section>
    </div>
  );
}
