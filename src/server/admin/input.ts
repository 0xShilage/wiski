import 'server-only';
import { z } from 'zod';
import { contactEmailSchema } from '../checkout/buyer';
import { METRICS } from '../mediakit/stats';
import { WIDGETS } from '../overlay/events';

/** Request schemas for the Phase 4 endpoints (all `.strict()`). */
const isoDate = z.iso.datetime({ offset: true }).transform((s) => new Date(s));
const version = z.int().min(0).max(1_000_000);
const before = z.iso.datetime().optional();

// ── live schedule ──
export const sessionCreateInput = z
  .object({
    startsAt: isoDate,
    capacityMinutes: z.int().min(15).max(1440),
    publicNote: z.string().max(400).nullable().optional(),
  })
  .strict();

export const sessionUpdateInput = z
  .object({
    expectedVersion: version,
    startsAt: isoDate.optional(),
    capacityMinutes: z.int().min(15).max(1440).optional(),
    publicNote: z.string().max(400).nullable().optional(),
  })
  .strict();

export const versionInput = z.object({ expectedVersion: version }).strict();

const target = z
  .object({ kind: z.enum(['ORDER', 'CAMPAIGN']), id: z.uuid(), expectedVersion: version })
  .strict();

export const scheduleInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), target, sessionId: z.uuid() }).strict(),
  z.object({ action: z.literal('remove'), target }).strict(),
  z.object({ action: z.literal('now'), target }).strict(),
  z.object({ action: z.literal('complete'), target }).strict(),
]);

export const rescheduleInput = z.object({ sessionId: z.uuid() }).strict();

// ── orders ──
const orderStatus = z.enum([
  'PAID',
  'SCHEDULED',
  'WATCHING',
  'COMPLETED',
  'EXPIRED',
  'CANCELLED',
  'NEEDS_ATTENTION',
  'REFUND_PENDING',
  'REFUNDED',
  'PENDING_PAYMENT',
]);
export const ordersQuery = z
  .object({
    status: orderStatus.optional(),
    texts: z.enum(['1']).optional(),
    code: z
      .string()
      .regex(/^WF-[0-9A-Z]{6}$/)
      .optional(),
    before,
  })
  .strict();

const decision = z.enum(['APPROVED', 'REJECTED']);
export const textsInput = z
  .object({
    expectedVersion: version,
    message: decision.optional(),
    displayName: decision.optional(),
  })
  .strict();

export const refundInput = z
  .object({
    expectedVersion: version,
    reason: z.enum(['DUPLICATE_PAYMENT', 'PROCESSING_ERROR', 'LEGAL_REQUIREMENT']),
  })
  .strict();

// ── users ──
export const usersQuery = z
  .object({
    q: z.string().max(40).optional(),
    filter: z.enum(['all', 'staff', 'vip', 'suspended']).optional(),
    after: before,
  })
  .strict();
export const suspendInput = z.object({ days: z.int().min(1).max(3650).nullable() }).strict();
export const roleInput = z.object({ role: z.enum(['USER', 'MODERATOR']) }).strict();
export const vipInput = z.object({ vip: z.boolean() }).strict();
export const eraseInput = z.object({ confirmUsername: z.string().min(1).max(40) }).strict();

// ── overlays ──
export const overlayKeyInput = z
  .object({ label: z.string().min(1).max(120), widgets: z.array(z.enum(WIDGETS)).min(1).max(4) })
  .strict();
export const overlaySessionInput = z.object({ key: z.string().min(10).max(80) }).strict();
export const overlayStreamQuery = z.object({ widget: z.enum(WIDGETS) }).strict();

// ── goals, stats, settings ──
const goalMetric = z.enum(['SPONSORSHIP_COUNT', 'SPONSORSHIP_REVENUE_CENTS', 'WATCHED_MINUTES']);
export const goalCreateInput = z
  .object({
    title: z.string().min(1).max(200),
    metric: goalMetric,
    target: z.int().min(1).max(1_000_000_000),
    startsAt: isoDate,
    endsAt: isoDate.nullable().optional(),
    active: z.boolean().optional(),
    showOnOverlay: z.boolean().optional(),
    showOnMediaKit: z.boolean().optional(),
  })
  .strict();
export const goalUpdateInput = goalCreateInput.omit({ metric: true }).partial().strict();

const platform = z.enum(['TWITCH', 'YOUTUBE', 'KICK', 'TIKTOK', 'INSTAGRAM', 'X']);
export const statInput = z
  .object({
    platform,
    metric: z.enum(METRICS),
    value: z.int().min(0).max(10_000_000_000).nullable(),
  })
  .strict();

export const settingsInput = z.object({ ordersOpen: z.boolean() }).strict();

// ── contact ──
export const contactInput = z
  .object({
    name: z.string().max(400),
    email: contactEmailSchema,
    company: z.string().max(400).optional(),
    subject: z.string().max(600),
    body: z.string().max(16_000),
    website: z.string().max(200), // honeypot: must stay empty
    formToken: z.string().min(20).max(400),
  })
  .strict();
export const contactQuery = z
  .object({ status: z.enum(['NEW', 'READ', 'ARCHIVED', 'SPAM']).optional(), before })
  .strict();
export const contactStatusInput = z
  .object({ status: z.enum(['NEW', 'READ', 'ARCHIVED', 'SPAM']) })
  .strict();

// ── audit ──
export const auditQuery = z
  .object({
    action: z
      .string()
      .regex(/^[a-z][a-z.]{0,40}$/)
      .optional(),
    actor: z.uuid().optional(),
    before: z
      .string()
      .regex(/^\d{1,19}$/)
      .optional(),
  })
  .strict();

// ── vouchers ──
const money = z.int().min(1).max(100_000_000);
export const voucherCreateInput = z
  .object({
    code: z.string().regex(/^[a-z0-9-]{8,32}$/i),
    kind: z.enum(['PERCENT', 'FIXED']),
    percentBps: z.int().min(1).max(10_000).nullable().optional(),
    amountCents: money.nullable().optional(),
    maxDiscountCents: money.nullable().optional(),
    minSubtotalCents: money.nullable().optional(),
    startsAt: isoDate.nullable().optional(),
    endsAt: isoDate.nullable().optional(),
    maxRedemptions: z.int().min(1).max(100_000).nullable().optional(),
    maxPerUser: z.int().min(1).max(100),
  })
  .strict();
export const voucherUpdateInput = z
  .object({
    active: z.boolean().optional(),
    endsAt: isoDate.nullable().optional(),
    maxRedemptions: z.int().min(1).max(100_000).nullable().optional(),
  })
  .strict();

// ── Phase 6: links page ──
const linkText = z.string().max(400);
export const linkCreateInput = z
  .object({
    label: linkText,
    note: linkText.nullable().optional(),
    url: z.string().max(600),
    visible: z.boolean().optional(),
  })
  .strict();
export const linkUpdateInput = z
  .object({
    label: linkText.optional(),
    note: linkText.nullable().optional(),
    url: z.string().max(600).optional(),
    visible: z.boolean().optional(),
  })
  .strict();
export const linkOrderInput = z.object({ ids: z.array(z.uuid()).max(30) }).strict();

// ── Phase 6: suggestions ──
const suggestionStatus = z.enum(['NEW', 'ACCEPTED', 'DISMISSED']);
export const suggestionInput = z
  .object({
    kind: z.enum(['MOVIE', 'SERIES', 'FRANCHISE']),
    title: z.string().max(600),
    year: z.int().min(1888).max(2100).nullable().optional(),
    note: z.string().max(1_400).nullable().optional(),
  })
  .strict();
export const suggestionQuery = z.object({ status: suggestionStatus.optional(), before }).strict();
export const suggestionStatusInput = z
  .object({ status: suggestionStatus, expectedStatus: suggestionStatus })
  .strict();

// ── "Próximas temporadas" (Admin › Estreias) ──
const calendarDay = z.iso.date();
export const releaseCreateInput = z
  .object({
    itemId: z.uuid().nullable().optional(),
    title: z.string().max(600).nullable().optional(),
    seasonLabel: z.string().max(200),
    releaseDate: calendarDay,
    note: z.string().max(400).nullable().optional(),
  })
  .strict();
export const releaseUpdateInput = z
  .object({
    itemId: z.uuid().nullable().optional(),
    title: z.string().max(600).nullable().optional(),
    seasonLabel: z.string().max(200).optional(),
    releaseDate: calendarDay.optional(),
    note: z.string().max(400).nullable().optional(),
  })
  .strict();
