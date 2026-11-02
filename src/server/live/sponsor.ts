import 'server-only';
import type { Prisma } from '@/generated/prisma/client';

/**
 * What the public (pages, overlays) may say about who paid (Q10, Q16): the username of a signed-in
 * sponsor, a guest's display name only once a moderator APPROVED it, otherwise nothing ("Anônimo").
 * The sponsor message is shown only once APPROVED. Never an e-mail.
 */
export const sponsorSelect = {
  showSponsorName: true,
  guestDisplayName: true,
  displayNameStatus: true,
  sponsorMessage: true,
  messageStatus: true,
  user: { select: { username: true, status: true } },
} satisfies Prisma.OrderSelect;

type SponsorRow = Prisma.OrderGetPayload<{ select: typeof sponsorSelect }>;

export function publicSponsor(o: SponsorRow): string | null {
  if (!o.showSponsorName) return null;
  if (o.user) return o.user.status === 'DELETED' || !o.user.username ? null : `@${o.user.username}`;
  return o.guestDisplayName && o.displayNameStatus === 'APPROVED' ? o.guestDisplayName : null;
}

export function publicMessage(o: SponsorRow): string | null {
  return o.sponsorMessage && o.messageStatus === 'APPROVED' ? o.sponsorMessage : null;
}
