import 'server-only';
import { z } from 'zod';
import type { Role } from '@/generated/prisma/enums';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { avatarKeySchema } from '@/lib/avatars';
import { USERNAME_PATTERN } from '@/lib/username';
import { db } from '../db';

/**
 * Append-only, hash-chained audit log (02 §4, 05 §13). The DB trigger assigns id, time and the
 * hash; the app can only INSERT. Metadata is allow-listed per action (no e-mail, IP, Pix payloads
 * or payment data) — an action without a schema here cannot be logged.
 */
const username = z.string().regex(USERNAME_PATTERN);
const itemKind = z.enum(['MOVIE', 'SERIES', 'FRANCHISE']);
const mediaRole = z.enum(['POSTER', 'BACKDROP', 'LOGO']);
const orderKind = z.enum(['MOVIE', 'CONTRIBUTION']);
const paymentStatus = z.enum([
  'PENDING',
  'APPROVED',
  'AUTHORIZED',
  'IN_PROCESS',
  'IN_MEDIATION',
  'REJECTED',
  'CANCELLED',
  'REFUNDED',
  'CHARGED_BACK',
]);
const orderStatus = z.enum([
  'PENDING_PAYMENT',
  'PAID',
  'SCHEDULED',
  'WATCHING',
  'COMPLETED',
  'EXPIRED',
  'CANCELLED',
  'NEEDS_ATTENTION',
  'REFUND_PENDING',
  'REFUNDED',
]);
const moderationStatus = z.enum(['VISIBLE', 'AUTO_HIDDEN', 'HIDDEN', 'REMOVED']);
const textDecision = z.enum(['APPROVED', 'REJECTED']);
const role = z.enum(['USER', 'MODERATOR', 'STREAMER']);
const overlayWidget = z.enum(['agora', 'fila', 'meta', 'meta-total', 'patrocinio']);
const goalMetric = z.enum(['SPONSORSHIP_COUNT', 'SPONSORSHIP_REVENUE_CENTS', 'WATCHED_MINUTES']);
const platform = z.enum(['TWITCH', 'YOUTUBE', 'KICK', 'TIKTOK', 'INSTAGRAM', 'X']);
/** Names of edited catalog fields (never their values). */
const catalogField = z.enum([
  'title',
  'originalTitle',
  'year',
  'runtimeMinutes',
  'ageRating',
  'genres',
  'synopsis',
  'director',
  'cast',
  'seasonsLabel',
  'seasonCount',
  'episodeCount',
  'trailerYoutubeId',
  'posterTitle',
  'manualPriceCents',
  'posterId',
  'backdropId',
  'logoId',
  'slot',
  'franchiseEntries',
]);

export const AUDIT_ACTIONS = {
  /** interactive login of a privileged user (MODERATOR/STREAMER) */
  'auth.login': z.object({ method: z.literal('google'), stepUp: z.boolean() }).strict(),
  'auth.logout': z.object({ scope: z.enum(['current']) }).strict(),
  'session.revoke': z
    .object({ sessionId: z.uuid().nullable(), scope: z.enum(['one', 'others']) })
    .strict(),
  'user.onboarding': z.object({ username, avatarKey: avatarKeySchema }).strict(),
  'user.username.change': z.object({ from: username, to: username }).strict(),
  'user.avatar.change': z.object({ avatarKey: avatarKeySchema }).strict(),

  // ── R1 ──
  'passkey.register': z
    .object({
      backedUp: z.boolean(),
      transports: z.array(
        z.enum(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']),
      ),
    })
    .strict(),
  'passkey.verify': z.object({}).strict(),
  'passkey.delete': z.object({}).strict(),
  // ── authenticator app (2026-10-31) ──
  'totp.enable': z.object({}).strict(),
  'totp.verify': z.object({ method: z.enum(['totp', 'recovery']) }).strict(),
  'totp.disable': z.object({}).strict(),
  'totp.recovery.regenerate': z.object({}).strict(),
  'mfa.remembered': z.object({}).strict(),
  'media.upload': z
    .object({
      role: mediaRole,
      width: z.int().positive(),
      height: z.int().positive(),
      bytes: z.int().nonnegative(),
      deduplicated: z.boolean(),
    })
    .strict(),
  'catalog.create': z.object({ kind: itemKind, version: z.int() }).strict(),
  'catalog.save': z
    .object({ kind: itemKind, version: z.int(), fields: z.array(catalogField).max(40) })
    .strict(),
  'catalog.publish': z.object({ kind: itemKind, slot: z.int(), version: z.int() }).strict(),
  'catalog.revert': z.object({ kind: itemKind, toVersion: z.int(), version: z.int() }).strict(),
  'catalog.slots': z.object({ kind: itemKind, moved: z.int().nonnegative() }).strict(),
  'catalog.replace': z
    .object({ kind: itemKind, slot: z.int(), replacementId: z.uuid().nullable() })
    .strict(),
  'catalog.watched': z.object({ kind: itemKind }).strict(),
  'catalog.delete': z.object({ kind: itemKind }).strict(),
  'campaign.open': z
    .object({
      goalCents: z.int().positive(),
      formulaGoalCents: z.int().positive(),
      deadlineAt: z.iso.datetime(),
    })
    .strict(),
  'campaign.extend': z
    .object({ deadlineAt: z.iso.datetime(), extensions: z.int().positive() })
    .strict(),
  'campaign.goal': z
    .object({ fromCents: z.int().positive(), toCents: z.int().positive(), funded: z.boolean() })
    .strict(),

  // ── Phase 2 (payments) — amounts and statuses only; never e-mail, IP, Pix payloads or tokens ──
  'order.create': z
    .object({
      kind: orderKind,
      totalCents: z.int().positive(),
      voucher: z.boolean(),
      queueJumpTier: z.string().max(24).nullable(),
      guest: z.boolean(),
    })
    .strict(),
  'order.cancel': z.object({ kind: orderKind, by: z.enum(['buyer', 'checkout-failure']) }).strict(),
  'order.expire': z.object({ kind: orderKind }).strict(),
  'order.claim': z.object({ kind: orderKind }).strict(),
  'payment.status': z
    .object({
      from: paymentStatus,
      to: paymentStatus,
      orderFrom: orderStatus,
      orderTo: orderStatus,
      reason: z.enum([
        'approved',
        'late-approval',
        'hold-lost',
        'verification-failed',
        'unknown-status',
        'rejected',
        'cancelled',
        'refunded',
        'charged-back',
        'in-mediation',
        'update',
      ]),
      funded: z.boolean().optional(),
    })
    .strict(),

  // ── Phase 3 (reviews) — statuses and counts only; never review text or report notes ──
  'review.autohide': z.object({ reports: z.int().positive() }).strict(),
  'moderation.review': z
    .object({
      action: z.enum(['HIDE', 'RESTORE', 'DISMISS', 'REMOVE']),
      from: moderationStatus,
      to: moderationStatus,
      reports: z.int().nonnegative(),
    })
    .strict(),

  // ── Phase 4 (operations) — ids, statuses, counts and field names only ──
  'session.create': z
    .object({ startsAt: z.iso.datetime(), capacityMinutes: z.int().positive() })
    .strict(),
  'session.update': z
    .object({ fields: z.array(z.enum(['startsAt', 'capacityMinutes', 'publicNote'])).max(3) })
    .strict(),
  'session.start': z.object({}).strict(),
  'session.end': z.object({ returnedToQueue: z.int().nonnegative() }).strict(),
  'session.cancel': z.object({ returnedToQueue: z.int().nonnegative() }).strict(),
  'schedule.add': z
    .object({
      sessionId: z.uuid(),
      kind: z.enum(['ORDER', 'CAMPAIGN']),
      runtimeMinutes: z.int().nonnegative(),
    })
    .strict(),
  'schedule.remove': z
    .object({ sessionId: z.uuid(), kind: z.enum(['ORDER', 'CAMPAIGN']) })
    .strict(),
  'schedule.now': z.object({ sessionId: z.uuid() }).strict(),
  'schedule.complete': z.object({ sessionId: z.uuid() }).strict(),
  'order.reschedule': z
    .object({ from: z.uuid(), to: z.uuid(), count: z.int().min(1).max(2) })
    .strict(),
  'order.texts': z
    .object({ message: textDecision.optional(), displayName: textDecision.optional() })
    .strict(),
  'order.accept': z.object({ kind: orderKind, totalCents: z.int().positive() }).strict(),
  'order.manual': z
    .object({
      kind: orderKind,
      totalCents: z.int().positive(),
      named: z.boolean(),
      message: z.boolean(),
    })
    .strict(),
  'legal.publish': z
    .object({
      version: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      refundVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      types: z.int().min(1).max(3),
    })
    .strict(),
  'order.manual-undo': z
    .object({ kind: orderKind, totalCents: z.int().positive(), from: orderStatus })
    .strict(),
  'refund.request': z
    .object({
      reason: z.enum(['DUPLICATE_PAYMENT', 'PROCESSING_ERROR', 'LEGAL_REQUIREMENT']),
      amountCents: z.int().positive(),
      from: orderStatus,
    })
    .strict(),
  'user.suspend': z
    .object({ until: z.iso.datetime().nullable(), days: z.int().positive().nullable() })
    .strict(),
  'user.unsuspend': z.object({}).strict(),
  'user.role': z.object({ from: role, to: role }).strict(),
  'user.vip': z.object({ vip: z.boolean() }).strict(),
  'user.erase': z
    .object({ reviews: z.int().nonnegative(), orders: z.int().nonnegative() })
    .strict(),
  'user.export': z.object({}).strict(),
  'overlay.key.create': z.object({ widgets: z.array(overlayWidget).min(1).max(5) }).strict(),
  'overlay.key.revoke': z.object({}).strict(),
  'goal.create': z.object({ metric: goalMetric, target: z.int().positive() }).strict(),
  'goal.update': z
    .object({
      fields: z
        .array(
          z.enum([
            'title',
            'target',
            'startsAt',
            'endsAt',
            'active',
            'showOnOverlay',
            'showOnMediaKit',
          ]),
        )
        .max(7),
    })
    .strict(),
  'goal.delete': z.object({}).strict(),
  'stats.update': z
    .object({
      platform: platform,
      metric: z.string().regex(/^[a-z0-9_]{2,32}$/),
      manual: z.boolean(),
    })
    .strict(),
  'contact.status': z.object({ to: z.enum(['NEW', 'READ', 'ARCHIVED', 'SPAM']) }).strict(),
  'contact.delete': z.object({}).strict(),
  'settings.update': z.object({ key: z.enum(['orders.open']), value: z.boolean() }).strict(),
  'voucher.create': z
    .object({ kind: z.enum(['PERCENT', 'FIXED']), maxRedemptions: z.int().positive().nullable() })
    .strict(),
  'voucher.update': z
    .object({ fields: z.array(z.enum(['active', 'endsAt', 'maxRedemptions'])).max(3) })
    .strict(),
  'audit.export': z.object({ rows: z.int().nonnegative() }).strict(),
  // ── Phase 6 ──
  'link.create': z.object({ visible: z.boolean() }).strict(),
  'link.update': z
    .object({ fields: z.array(z.enum(['label', 'note', 'url', 'visible'])).max(4) })
    .strict(),
  'link.delete': z.object({}).strict(),
  'link.reorder': z.object({ count: z.int().min(0).max(30) }).strict(),
  'release.create': z
    .object({ linked: z.boolean(), poster: z.boolean(), yearOnly: z.boolean() })
    .strict(),
  'release.update': z
    .object({
      fields: z
        .array(
          z.enum(['itemId', 'title', 'seasonLabel', 'releaseDate', 'yearOnly', 'note', 'posterId']),
        )
        .max(7),
    })
    .strict(),
  'release.delete': z.object({}).strict(),
  'suggestion.status': z
    .object({
      from: z.enum(['NEW', 'ACCEPTED', 'DISMISSED']),
      to: z.enum(['NEW', 'ACCEPTED', 'DISMISSED']),
    })
    .strict(),
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export type AuditEntry<A extends AuditAction> = {
  action: A;
  actor: { id: string; role: Role } | null;
  targetType: string;
  targetId?: string | null;
  metadata: z.input<(typeof AUDIT_ACTIONS)[A]>;
  requestId?: string | null;
};

type Tx = Prisma.TransactionClient | PrismaClient;

/** Insert one audit row (inside the caller's transaction when `tx` is given). */
export async function audit<A extends AuditAction>(
  entry: AuditEntry<A>,
  tx: Tx = db(),
): Promise<void> {
  const metadata = AUDIT_ACTIONS[entry.action].parse(entry.metadata) as Prisma.InputJsonValue;
  await tx.auditLog.create({
    data: {
      actorId: entry.actor?.id ?? null,
      actorRole: entry.actor?.role ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      metadata,
      requestId: entry.requestId ?? null,
    },
  });
}
