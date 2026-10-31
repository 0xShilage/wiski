import 'server-only';
import { z } from 'zod';
import { codePointLength, plainText } from '../text/sanitize';

/**
 * Overlay payloads (03 §6, Q20, 05 §5 A7). Everything shown on stream is built here: strings go
 * through the review sanitiser (plain text, NFC, controls/bidi/zero-width removed), are cut to a
 * fixed length, and the whole event is checked against a strict schema before it's published.
 * The overlay page renders them as React text nodes only — no HTML, no URLs, no images.
 */
export const WIDGETS = ['agora', 'fila', 'meta', 'patrocinio'] as const;
export type Widget = (typeof WIDGETS)[number];
export const WIDGET_LABEL: Record<Widget, string> = {
  agora: 'Agora assistindo',
  fila: 'Próximos da fila',
  meta: 'Meta',
  patrocinio: 'Novo patrocínio',
};

export const LIMITS = { title: 80, sponsor: 30, message: 140, goal: 60 } as const;

/** Plain text, cut to `max` code points (with "…"); empty → null. */
export function overlayText(raw: string | null | undefined, max: number): string | null {
  if (!raw) return null;
  const s = plainText(raw);
  if (!s) return null;
  if (codePointLength(s) <= max) return s;
  return `${[...s].slice(0, max - 1).join('').trimEnd()}…`;
}

/** Re-checks the sanitiser's promise on the way out: the text is already a fixpoint of the
 *  single-line sanitiser (no controls, bidi, invisible characters or line breaks). */
const safe = (max: number) =>
  z
    .string()
    .min(1)
    .refine((s) => codePointLength(s) <= max, 'too long')
    .refine((s) => plainText(s) === s, 'unsafe characters');

const kind = z.enum(['MOVIE', 'SERIES', 'FRANCHISE']);

export const overlayEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('now-playing'),
      title: safe(LIMITS.title).nullable(),
      kind: kind.nullable(),
      sponsor: safe(LIMITS.sponsor).nullable(),
      message: safe(LIMITS.message).nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal('queue'),
      items: z
        .array(
          z
            .object({
              title: safe(LIMITS.title),
              sponsor: safe(LIMITS.sponsor).nullable(),
              jumped: z.boolean(),
            })
            .strict(),
        )
        .max(5),
    })
    .strict(),
  z
    .object({
      type: z.literal('goal'),
      title: safe(LIMITS.goal).nullable(),
      metric: z.enum(['SPONSORSHIP_COUNT', 'SPONSORSHIP_REVENUE_CENTS', 'WATCHED_MINUTES']).nullable(),
      /** null for revenue goals (shown as a percentage only, Q19) */
      current: z.int().nonnegative().nullable(),
      target: z.int().positive().nullable(),
      percent: z.int().min(0).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal('new-sponsorship'),
      title: safe(LIMITS.title),
      sponsor: safe(LIMITS.sponsor).nullable(),
    })
    .strict(),
]);
export type OverlayEvent = z.infer<typeof overlayEventSchema>;

/** Which event types each widget receives. */
export const WIDGET_EVENT: Record<Widget, OverlayEvent['type']> = {
  agora: 'now-playing',
  fila: 'queue',
  meta: 'goal',
  patrocinio: 'new-sponsorship',
};

// ── builders: raw database values in, publishable events out ──

export function nowPlayingEvent(
  input: {
    title: string;
    kind: 'MOVIE' | 'SERIES' | 'FRANCHISE';
    sponsor: string | null;
    message: string | null;
  } | null,
): OverlayEvent {
  return overlayEventSchema.parse(
    input
      ? {
          type: 'now-playing',
          title: overlayText(input.title, LIMITS.title),
          kind: input.kind,
          sponsor: overlayText(input.sponsor, LIMITS.sponsor),
          message: overlayText(input.message, LIMITS.message),
        }
      : { type: 'now-playing', title: null, kind: null, sponsor: null, message: null },
  );
}

export function queueEvent(
  items: { title: string; sponsor: string | null; jumped: boolean }[],
): OverlayEvent {
  return overlayEventSchema.parse({
    type: 'queue',
    items: items
      .map((i) => ({
        title: overlayText(i.title, LIMITS.title),
        sponsor: overlayText(i.sponsor, LIMITS.sponsor),
        jumped: i.jumped,
      }))
      .filter((i): i is { title: string; sponsor: string | null; jumped: boolean } => !!i.title)
      .slice(0, 5),
  });
}

export function goalEvent(
  g: {
    title: string;
    metric: 'SPONSORSHIP_COUNT' | 'SPONSORSHIP_REVENUE_CENTS' | 'WATCHED_MINUTES';
    current: number;
    target: number;
    percent: number;
  } | null,
): OverlayEvent {
  if (!g) {
    return overlayEventSchema.parse({
      type: 'goal',
      title: null,
      metric: null,
      current: null,
      target: null,
      percent: 0,
    });
  }
  const money = g.metric === 'SPONSORSHIP_REVENUE_CENTS';
  return overlayEventSchema.parse({
    type: 'goal',
    title: overlayText(g.title, LIMITS.goal),
    metric: g.metric,
    current: money ? null : g.current,
    target: money ? null : g.target,
    percent: Math.max(0, Math.min(100, Math.floor(g.percent))),
  });
}

export function sponsorshipEvent(title: string, sponsor: string | null): OverlayEvent | null {
  const t = overlayText(title, LIMITS.title);
  if (!t) return null;
  return overlayEventSchema.parse({
    type: 'new-sponsorship',
    title: t,
    sponsor: overlayText(sponsor, LIMITS.sponsor),
  });
}
