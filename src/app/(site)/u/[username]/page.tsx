import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { Avatar } from '@/components/Avatar';
import { RabinhoViolet } from '@/components/brand/generated';
import { ReviewList } from '@/components/reviews/ReviewList';
import { card, container, heading } from '@/components/ui/styles';
import { formatMonthYear } from '@/lib/format';
import { getCurrentSession } from '@/server/auth/current';
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

/** Public profile (03 §5.4): username, avatar, joined month and visible reviews — never e-mail. */
export default async function PerfilPublicoPage({ params }: Props) {
  const raw = (await params).username;
  const profile = await findProfile(safeDecode(raw));
  if (!profile) notFound();
  if (raw !== profile.username) permanentRedirect(`/u/${profile.username}`);
  const ctx = await getCurrentSession();
  const page = await userReviews(profile.id, undefined, ctx?.user.id);

  return (
    <div className={`${container} py-10 md:py-14`}>
      <section
        className={`${card} mx-auto flex max-w-3xl flex-col items-center gap-4 text-center sm:flex-row sm:text-left`}
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
      <section aria-labelledby="avaliacoes" className="mx-auto mt-8 max-w-3xl">
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
