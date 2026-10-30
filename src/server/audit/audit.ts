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
