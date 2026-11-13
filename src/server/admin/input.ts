import 'server-only';
import { z } from 'zod';
import { contactEmailSchema } from '../checkout/buyer';
import { MANUAL_MAX_CENTS } from '../checkout/admin';
import { codePointLength, plainText } from '../text/sanitize';
import { METRICS } from '../mediakit/stats';
import { SUBATHON_MAX_SECONDS, SUBATHON_TITLE_MAX, subathonRatesSchema } from '@/lib/subathon';
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

// ── "Já pago" ──
const oneLine = (min: number, max: number, message: string) =>
  z
    .string()
    .max(max * 4)
    .transform((s) => plainText(s))
    .refine((s) => codePointLength(s) >= min && codePointLength(s) <= max, { message });

export const manualPaymentInput = z
  .object({
    itemId: z.uuid(),
    /** omitted = the movie's price / what is left to raise */
    amountCents: z.int().min(1).max(MANUAL_MAX_CENTS).optional(),
    sponsorName: oneLine(2, 24, 'Use de 2 a 24 caracteres.').optional(),
    message: oneLine(1, 140, 'Use até 140 caracteres.').optional(),
    /** the sponsor asked to be on the supporters wall (2026-11-09); needs a name */
    wall: z.boolean().optional(),
    /** a fresh UUID per form submit: a double click registers once */
    idempotencyKey: z.uuid(),
  })
  .strict();

const target = z
  .object({
    kind: z.enum(['ORDER', 'CAMPAIGN', 'SEGMENT']),
    id: z.uuid(),
    expectedVersion: version,
  })
  .strict();

const minutes = z.int().min(1).max(1440);
const segmentNote = oneLine(1, 140, 'Use até 140 caracteres.').nullable().optional();

export const scheduleInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), target, sessionId: z.uuid() }).strict(),
  z.object({ action: z.literal('remove'), target }).strict(),
  z.object({ action: z.literal('now'), target }).strict(),
  z
    .object({
      action: z.literal('complete'),
      target,
      /** a series/franchise part: this was the last one → the title is watched, reviews open */
      finish: z.boolean().optional(),
    })
    .strict(),
  // 2026-11-04: a few episodes of a funded series, or one film of a funded franchise
  z
    .object({
      action: z.literal('part'),
      campaignId: z.uuid(),
      sessionId: z.uuid(),
      season: z.int().min(1).max(99).optional(),
      episodeFrom: z.int().min(1).max(999).optional(),
      episodeTo: z.int().min(1).max(999).optional(),
      film: z.int().min(1).max(999).optional(),
      minutes,
      note: segmentNote,
      atStart: z.boolean().optional(),
    })
    .strict(),
  // 2026-11-04: a custom event, e.g. "Jogando com os Viewers"
  z
    .object({
      action: z.literal('event'),
      sessionId: z.uuid(),
      title: oneLine(2, 60, 'Use de 2 a 60 caracteres.'),
      minutes,
      note: segmentNote,
      atStart: z.boolean().optional(),
      /** 2026-11-09: a poster uploaded through /api/v1/admin/media?role=POSTER */
      posterId: z.uuid().nullable().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('event-poster'),
      target: z
        .object({ kind: z.literal('SEGMENT'), id: z.uuid(), expectedVersion: version })
        .strict(),
      posterId: z.uuid().nullable(),
    })
    .strict(),
]);

/** "Reorganizar" (2026-11-09): every entry of the session, in the new order. */
/** "Adiar" (2026-11-10): N days; `cascade` = this session and every planned one after it. */
export const sessionPostponeInput = z
  .object({
    expectedVersion: z.int().nonnegative(),
    days: z.int().min(1).max(14),
    cascade: z.boolean(),
  })
  .strict();

export const sessionOrderInput = z
  .object({
    expectedVersion: version,
    entries: z
      .array(z.string().regex(/^(ORDER|CAMPAIGN|SEGMENT):[0-9a-f-]{36}$/))
      .min(1)
      .max(300),
  })
  .strict();

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
    /** 2026-11-09: take the order off the supporters wall (never put it back) */
    wall: z.literal(false).optional(),
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
export const roleInput = z
  .object({ role: z.enum(['USER', 'MODERATOR', 'SUPER_MODERATOR']) })
  .strict();
export const vipInput = z.object({ vip: z.boolean() }).strict();
export const eraseInput = z.object({ confirmUsername: z.string().min(1).max(40) }).strict();

// ── overlays ──
export const overlayKeyInput = z
  .object({
    label: z.string().min(1).max(120),
    widgets: z.array(z.enum(WIDGETS)).min(1).max(WIDGETS.length),
  })
  .strict();
export const overlaySessionInput = z.object({ key: z.string().min(10).max(80) }).strict();
export const overlayStreamQuery = z
  .object({
    widget: z.enum(WIDGETS),
    /** server time of the last thing this overlay received (2026-11-05): alerts missed since */
    since: z.iso.datetime().optional(),
  })
  .strict();

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

// ── Jogos (2026-11-09) ──
const gameFields = {
  title: oneLine(1, 120, 'Use de 1 a 120 caracteres.'),
  platform: oneLine(1, 40, 'Use até 40 caracteres.').nullable().optional(),
  year: z.int().min(1950).max(2100).nullable().optional(),
  status: z.enum(['PLAYING', 'FINISHED', 'DROPPED']),
  note: oneLine(1, 140, 'Use até 140 caracteres.').nullable().optional(),
  vodUrl: z.string().max(600).nullable().optional(),
  finishedOn: z.iso.date().nullable().optional(),
  coverId: z.uuid().nullable().optional(),
};
export const gameInput = z.object(gameFields).strict();
export const gameUpdateInput = z.object({ ...gameFields, expectedVersion: version }).strict();

// ── Phase 6: suggestions ──
const suggestionStatus = z.enum(['NEW', 'ACCEPTED', 'DISMISSED', 'WATCHED']);
export const suggestionInput = z
  .object({
    kind: z.enum(['MOVIE', 'SERIES', 'FRANCHISE', 'ANIME', 'GAME']),
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
const releaseYear = z.int().min(2000).max(2100);
export const releaseCreateInput = z
  .object({
    itemId: z.uuid().nullable().optional(),
    title: z.string().max(600).nullable().optional(),
    seasonLabel: z.string().max(200),
    releaseDate: calendarDay.optional(),
    releaseYear: releaseYear.optional(),
    note: z.string().max(400).nullable().optional(),
    posterId: z.uuid().nullable().optional(),
  })
  .strict();
export const releaseUpdateInput = z
  .object({
    itemId: z.uuid().nullable().optional(),
    title: z.string().max(600).nullable().optional(),
    seasonLabel: z.string().max(200).optional(),
    releaseDate: calendarDay.optional(),
    releaseYear: releaseYear.optional(),
    note: z.string().max(400).nullable().optional(),
    posterId: z.uuid().nullable().optional(),
  })
  .strict();

// ── subathon timer (2026-11-03) ──
const subathonSettings = {
  title: oneLine(1, SUBATHON_TITLE_MAX, 'De 1 a 60 caracteres.'),
  secondsPerReal: z.int().min(1).max(3600),
  capSeconds: z.int().min(60).max(SUBATHON_MAX_SECONDS).nullable(),
  rates: subathonRatesSchema,
};
export const subathonCreateInput = z
  .object({ ...subathonSettings, initialSeconds: z.int().min(0).max(SUBATHON_MAX_SECONDS) })
  .strict();
export const subathonUpdateInput = z
  .object({
    expectedVersion: version,
    title: subathonSettings.title.optional(),
    secondsPerReal: subathonSettings.secondsPerReal.optional(),
    capSeconds: subathonSettings.capSeconds.optional(),
    rates: subathonSettings.rates.optional(),
  })
  .strict();
export const subathonActionInput = z
  .object({ action: z.enum(['start', 'pause', 'resume', 'end']), expectedVersion: version })
  .strict();
export const subathonAdjustInput = z
  .object({
    seconds: z
      .int()
      .min(-SUBATHON_MAX_SECONDS)
      .max(SUBATHON_MAX_SECONDS)
      .refine((n) => n !== 0, 'Informe um tempo diferente de zero.'),
    idempotencyKey: z.uuid(),
  })
  .strict();

// ── Roleta (2026-11-04) ──
const roletaStatus = z.enum(['PENDING', 'DELIVERED', 'CANCELLED']);
export const roletaSpinInput = z.object({}).strict();
export const roletaTwitchInput = z.object({ twitchLogin: z.string().max(64) }).strict();
export const roletaQuery = z.object({ status: roletaStatus.optional(), before }).strict();
export const roletaStatusInput = z
  .object({ status: roletaStatus, expectedStatus: roletaStatus })
  .strict();
export const roletaOpenInput = z.object({ open: z.boolean() }).strict();
