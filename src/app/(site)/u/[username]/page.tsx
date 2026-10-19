import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { Avatar } from '@/components/Avatar';
import { RabinhoViolet } from '@/components/brand/generated';
import { card, container, heading } from '@/components/ui/styles';
import { formatMonthYear } from '@/lib/format';
import { normalizeUsername, USERNAME_PATTERN } from '@/lib/username';
import { db } from '@/server/db';

type Props = { params: Promise<{ username: string }> };

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

async function findProfile(raw: string) {
  if (raw.length > 64) return null;
  const username = normalizeUsername(safeDecode(raw));
  if (!USERNAME_PATTERN.test(username)) return null;
  // Public fields only — never e-mail, Google id or role details.
  const user = await db().user.findUnique({
    where: { username },
    select: { username: true, avatarKey: true, createdAt: true, status: true },
  });
  return user && user.status !== 'DELETED' ? { ...user, canonical: username } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const profile = await findProfile((await params).username);
  return profile ? { title: `@${profile.username}` } : { title: 'Perfil não encontrado' };
}

export default async function PerfilPage({ params }: Props) {
  const raw = (await params).username;
  const profile = await findProfile(raw);
  if (!profile) notFound();
  if (raw !== profile.canonical) permanentRedirect(`/u/${profile.canonical}`);

  return (
    <div className={`${container} py-10 md:py-14`}>
      <section
        className={`${card} mx-auto flex max-w-3xl flex-col items-center gap-4 text-center sm:flex-row sm:text-left`}
      >
        <Avatar avatarKey={profile.avatarKey} size={96} alt={`Avatar de @${profile.username}`} />
        <div>
          <h1 className="text-h1 font-semibold text-lilac">@{profile.username}</h1>
          <p className="text-fg-muted">Membro desde {formatMonthYear(profile.createdAt)}</p>
        </div>
      </section>
      <section aria-labelledby="avaliacoes" className="mx-auto mt-8 max-w-3xl">
        <h2 id="avaliacoes" className={`${heading.h2} mb-4 flex items-center gap-3`}>
          <RabinhoViolet aria-hidden className="h-8 w-auto" />
          Avaliações
        </h2>
        <p className={`${card} text-fg-muted`}>Nenhuma avaliação ainda.</p>
      </section>
    </div>
  );
}
