import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { OnboardingForm } from '@/components/account/OnboardingForm';
import { card, container, heading } from '@/components/ui/styles';
import { getCurrentSession } from '@/server/auth/current';
import { safeReturnTo } from '@/server/security/return-to';

export const metadata: Metadata = { title: 'Bem-vindo', robots: { index: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function BemVindoPage({ searchParams }: Props) {
  const params = await searchParams;
  const next = safeReturnTo(typeof params.next === 'string' ? params.next : null);
  const ctx = await getCurrentSession();
  if (!ctx) redirect(`/perfil?returnTo=${encodeURIComponent('/bem-vindo')}`);
  if (ctx.user.username) redirect(next);

  return (
    <div className={`${container} py-10 md:py-16`}>
      <div className={`${card} mx-auto max-w-2xl space-y-6`}>
        <h1 className={heading.h1}>Bem-vindo!</h1>
        <p className="text-fg/90">
          Escolha como a comunidade vai ver você. O nome de usuário aparece nas suas avaliações; seu
          e-mail nunca é mostrado.
        </p>
        <OnboardingForm next={next === '/bem-vindo' ? '/perfil' : next} />
      </div>
    </div>
  );
}
