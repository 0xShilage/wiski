import type { ItemKind } from '@/generated/prisma/enums';
import type { Picture } from '@/lib/media';
import type { AgeRatingCode } from './age-rating';

/** Public read model of a catalog item (src/server/catalog/read.ts) — client-safe types. */
export type PublicState = 'ACTIVE' | 'RESERVED' | 'SPONSORED' | 'FUNDED' | 'PAUSED' | 'WATCHED';

export type PublicCampaign = {
  id: string;
  goalCents: number;
  raisedCents: number;
  remainingCents: number;
  supporterCount: number;
  deadlineAt: string;
  extensions: number;
  state: 'OPEN' | 'PAUSED' | 'FUNDED' | 'SCHEDULED' | 'WATCHED';
};

export type PublicItem = {
  id: string;
  kind: ItemKind;
  slug: string;
  slot: number | null;
  title: string;
  originalTitle: string | null;
  year: number | null;
  runtimeMinutes: number;
  ageRating: AgeRatingCode | null;
  genres: string[];
  synopsis: string;
  director: string | null;
  cast: string[];
  seasonsLabel: string | null;
  seasonCount: number | null;
  episodeCount: number | null;
  trailerYoutubeId: string | null;
  poster: Picture | null;
  backdrop: Picture | null;
  logo: Picture | null;
  state: PublicState;
  /** MOVIE: full sponsorship price */
  priceCents: number | null;
  /** SPONSORED: "@user" | display name | null (anonymous) */
  sponsorName: string | null;
  campaign: PublicCampaign | null;
  films: { position: number; title: string; year: number | null; runtimeMinutes: number }[];
};
