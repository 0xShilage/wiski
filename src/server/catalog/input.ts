import 'server-only';
import { z } from 'zod';
import { AGE_RATINGS } from '@/lib/catalog/age-rating';
import { ITEM_KINDS } from '@/lib/catalog/kinds';
import { MOVIE_MAX_RUNTIME } from '@/lib/catalog/pricing';
import { parseYoutubeId } from '@/lib/catalog/youtube';
import { codePointLength, plainText } from '../text/sanitize';

/**
 * Dashboard input (11 §4): every text goes through the plain-text sanitiser and is length-checked
 * AFTER sanitising (code points, like the DB CHECKs). Schemas are .strict(): unknown keys → 422.
 */
const text = (max: number, opts: { min?: number; multiline?: boolean } = {}) =>
  z
    .string()
    .max(max * 4) // raw guard before the sanitiser runs
    .transform((s) => plainText(s, { multiline: opts.multiline ?? false }))
    .refine((s) => codePointLength(s) >= (opts.min ?? 0), {
      message: opts.min ? 'Campo obrigatório.' : 'Inválido.',
    })
    .refine((s) => codePointLength(s) <= max, { message: `Máximo de ${max} caracteres.` });

/** Optional text: empty after sanitising → null. */
const optionalText = (max: number) =>
  text(max)
    .nullable()
    .transform((s) => (s ? s : null));

const tagList = (maxItems: number, maxLen: number) =>
  z
    .array(text(maxLen, { min: 1 }))
    .max(maxItems, { message: `Máximo de ${maxItems} itens.` })
    .transform((list) => {
      // Case-insensitive de-duplication, keeping the first spelling.
      const seen = new Set<string>();
      return list.filter((v) => {
        const k = v.toLocaleLowerCase('pt-BR');
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    });

const year = z.int().min(1888).max(2100).nullable();
const mediaId = z.uuid().nullable();

export const franchiseEntryInput = z
  .object({
    title: text(120, { min: 1 }),
    year: year.optional(),
    runtimeMinutes: z.int().min(1).max(MOVIE_MAX_RUNTIME),
  })
  .strict();

/** Fields a moderator edits. All optional in a PATCH; completeness is checked at publish. */
export const itemFieldsInput = z
  .object({
    title: text(120, { min: 1 }),
    originalTitle: optionalText(120),
    year,
    runtimeMinutes: z.int().min(1).max(20000),
    ageRating: z.enum(AGE_RATINGS).nullable(),
    genres: tagList(6, 32),
    synopsis: text(600, { multiline: true }),
    director: optionalText(160),
    cast: tagList(12, 60),
    seasonsLabel: optionalText(60),
    seasonCount: z.int().min(1).max(100).nullable(),
    episodeCount: z.int().min(1).max(10000).nullable(),
    /** A YouTube link (or bare id) — only the 11-character id is stored (11 §6). */
    trailer: z
      .string()
      .max(300)
      .nullable()
      .transform((s, ctx) => {
        if (s === null || s.trim() === '') return null;
        const id = parseYoutubeId(s);
        if (!id) {
          ctx.addIssue({ code: 'custom', message: 'Link do YouTube inválido.' });
          return z.NEVER;
        }
        return id;
      }),
    posterId: mediaId,
    backdropId: mediaId,
    logoId: mediaId,
    /** MOVIE: title drawn over the poster in the carousel ("Adicionar texto?") */
    posterTitle: z.boolean(),
    /** MOVIE: price set by hand (cents, R$ 5–2.000); null = by runtime. */
    manualPriceCents: z.int().min(500).max(200_000).nullable(),
    franchiseEntries: z.array(franchiseEntryInput).max(30),
    /** Planned slot for a draft (the slot it will take when published). */
    slot: z.int().min(1).max(50).nullable(),
  })
  .partial()
  .strict();

export type ItemFieldsInput = z.output<typeof itemFieldsInput>;

export const createItemInput = itemFieldsInput
  .extend({
    kind: z.enum(ITEM_KINDS),
    title: text(120, { min: 1 }),
    runtimeMinutes: z.int().min(1).max(20000),
  })
  .strict();

export const saveItemInput = z
  .object({ expectedVersion: z.int().min(0), fields: itemFieldsInput })
  .strict();

export const versionInput = z.object({ expectedVersion: z.int().min(0) }).strict();

export const publishInput = z
  .object({ expectedVersion: z.int().min(0), slot: z.int().min(1).max(50).optional() })
  .strict();

export const revertInput = z
  .object({ expectedVersion: z.int().min(0), toVersion: z.int().min(1) })
  .strict();

export const replaceInput = z.object({ replacementId: z.uuid().nullable() }).strict();

export const slotsInput = z
  .object({
    kind: z.enum(ITEM_KINDS),
    slots: z
      .array(z.object({ id: z.uuid(), slot: z.int().min(1).max(50) }).strict())
      .min(1)
      .max(50),
  })
  .strict();

export const openCampaignInput = z
  .object({
    expectedVersion: z.int().min(0),
    /** null/absent = formula goal (11 §2.2). Whole reais. */
    goalCents: z.int().min(500).max(100_000_000).multipleOf(100).optional(),
    /** Days until the deadline (default 30). */
    days: z.int().min(1).max(365).optional(),
  })
  .strict();

export const extendCampaignInput = z.object({ days: z.int().min(1).max(365) }).strict();

export const goalInput = z
  .object({ goalCents: z.int().min(500).max(100_000_000).multipleOf(100) })
  .strict();
