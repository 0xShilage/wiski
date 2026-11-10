/** Reviews (Phase 3) — client-safe read models, limits and pt-BR labels. */

export const REVIEW_BODY_MAX = 2000;
export const REPORT_NOTE_MAX = 500;
export const REVIEW_PAGE_SIZE = 10;

export type ReviewSort = 'recent' | 'top';
export type ReviewStatus = 'VISIBLE' | 'AUTO_HIDDEN' | 'HIDDEN' | 'REMOVED';
export type HoldReason = 'LINKS' | 'REPORTS';

export type ReviewAuthor = { username: string; avatarKey: string };
export type ReviewItemRef = {
  kind: 'MOVIE' | 'SERIES' | 'FRANCHISE' | 'ANIME';
  slug: string;
  title: string;
};

/** A review as everyone sees it (only VISIBLE ones are listed publicly). */
export type PublicReview = {
  id: string;
  rating: number;
  body: string;
  containsSpoilers: boolean;
  likeCount: number;
  createdAt: string;
  editedAt: string | null;
  author: ReviewAuthor;
  item: ReviewItemRef;
  /** only when the viewer is signed in */
  likedByMe?: boolean;
  /** the viewer wrote it (no like/report buttons) */
  mine?: boolean;
};

/** The viewer's own review on an item, whatever its moderation state. */
export type OwnReview = PublicReview & { status: ReviewStatus; heldReason: HoldReason | null };

export type ReviewPage = { reviews: PublicReview[]; nextCursor: string | null };

export type RatingSummary = {
  count: number;
  /** average × 10, rounded (e.g. 43 = 4,3); null without reviews */
  average10: number | null;
  /** counts for 1..5 stars, index 0 = 1 star */
  distribution: [number, number, number, number, number];
};

/** Why the viewer can or can't write a review on an item. */
export type ReviewEligibility =
  'OK' | 'SIGNED_OUT' | 'ONBOARDING' | 'SUSPENDED' | 'NOT_WATCHED' | 'ALREADY_REVIEWED';

export const REPORT_REASONS = [
  'UNMARKED_SPOILER',
  'OFFENSIVE',
  'HARASSMENT',
  'HATE_SPEECH',
  'SPAM',
  'PERSONAL_DATA',
  'OFF_TOPIC',
  'OTHER',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  UNMARKED_SPOILER: 'Spoiler sem aviso',
  OFFENSIVE: 'Conteúdo ofensivo',
  HARASSMENT: 'Assédio ou ataque a alguém',
  HATE_SPEECH: 'Discurso de ódio',
  SPAM: 'Spam ou propaganda',
  PERSONAL_DATA: 'Dados pessoais expostos',
  OFF_TOPIC: 'Não fala do título',
  OTHER: 'Outro motivo',
};

export const STARS_LABEL = ['', 'Péssimo', 'Ruim', 'Ok', 'Bom', 'Ótimo'] as const;

/** "4,3" from average × 10. */
export function formatAverage(average10: number): string {
  return (average10 / 10).toFixed(1).replace('.', ',');
}

// ── Moderation (dashboard) ──

export type ModerationAction = 'HIDE' | 'RESTORE' | 'DISMISS' | 'REMOVE';

export type QueueReport = {
  id: string;
  reason: ReportReason;
  note: string | null;
  createdAt: string;
  reporter: { username: string | null; accountDays: number };
};

export type QueueEntry = {
  review: OwnReview & { authorAccountDays: number; authorReviewCount: number };
  openReports: QueueReport[];
};

export type Anomaly =
  | {
      kind: 'LIKE_BURST';
      reviewId: string;
      title: string;
      likes24h: number;
      fromNewAccounts: number;
    }
  | { kind: 'REPORT_BURST'; username: string | null; reports24h: number };

export type ModerationQueue = {
  /** AUTO_HIDDEN first, then visible reviews with open reports */
  entries: QueueEntry[];
  /** recently hidden by a moderator (can be restored) */
  hidden: QueueEntry[];
  anomalies: Anomaly[];
  /** everything waiting (the list is capped) */
  total: number;
};
