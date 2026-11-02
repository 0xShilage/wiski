import 'server-only';
import { z } from 'zod';
import type { CatalogItem, FranchiseEntry } from '@/generated/prisma/client';
import { AGE_RATINGS } from '@/lib/catalog/age-rating';

/**
 * CatalogSnapshot v1 — the full editable content of an item, stored in CatalogRevision.snapshot
 * on every save. Revert = apply a snapshot as a new save. Validated on write AND on read.
 * Status, slot and timestamps are not content and are never restored by a revert.
 */
export const snapshotSchema = z
  .object({
    v: z.literal(1),
    title: z.string().min(1).max(120),
    originalTitle: z.string().max(120).nullable(),
    year: z.int().nullable(),
    runtimeMinutes: z.int().min(1),
    ageRating: z.enum(AGE_RATINGS).nullable(),
    genres: z.array(z.string().max(32)).max(6),
    synopsis: z.string().max(600),
    director: z.string().max(160).nullable(),
    cast: z.array(z.string().max(60)).max(12),
    seasonsLabel: z.string().max(60).nullable(),
    seasonCount: z.int().nullable(),
    episodeCount: z.int().nullable(),
    trailerYoutubeId: z
      .string()
      .regex(/^[\w-]{11}$/)
      .nullable(),
    posterId: z.uuid().nullable(),
    backdropId: z.uuid().nullable(),
    logoId: z.uuid().nullable(),
    /** added 2026-10-31; older snapshots lack it and mean "show the title" */
    posterTitle: z.boolean().default(true),
    franchiseEntries: z
      .array(
        z
          .object({
            position: z.int().min(1),
            title: z.string().min(1).max(120),
            year: z.int().nullable(),
            runtimeMinutes: z.int().min(1),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();

export type CatalogSnapshot = z.infer<typeof snapshotSchema>;

export const CONTENT_FIELDS = [
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
  'posterTitle',
] as const satisfies readonly (keyof CatalogSnapshot & keyof CatalogItem)[];

export function snapshotOf(
  item: CatalogItem,
  entries: readonly Pick<FranchiseEntry, 'position' | 'title' | 'year' | 'runtimeMinutes'>[],
): CatalogSnapshot {
  return snapshotSchema.parse({
    v: 1,
    ...Object.fromEntries(CONTENT_FIELDS.map((f) => [f, item[f]])),
    franchiseEntries: [...entries]
      .sort((a, b) => a.position - b.position)
      .map(({ position, title, year, runtimeMinutes }) => ({
        position,
        title,
        year,
        runtimeMinutes,
      })),
  });
}

/** Names of the content fields that differ (for the audit log — names only, never values). */
export function changedFields(a: CatalogSnapshot, b: CatalogSnapshot): string[] {
  const out: string[] = CONTENT_FIELDS.filter((f) => JSON.stringify(a[f]) !== JSON.stringify(b[f]));
  if (JSON.stringify(a.franchiseEntries) !== JSON.stringify(b.franchiseEntries)) {
    out.push('franchiseEntries');
  }
  return out;
}
