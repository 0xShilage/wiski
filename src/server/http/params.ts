import 'server-only';
import { z } from 'zod';
import type { ITEM_KINDS } from '@/lib/catalog/kinds';
import { Problems } from './problem';

const uuid = z.uuid();

/** A path id that isn't a UUID can't exist → 404 (never 422: no oracle on id formats). */
export function uuidParam(value: unknown): string {
  const r = uuid.safeParse(value);
  if (!r.success) throw Problems.notFound();
  return r.data;
}

const API_KIND = { movies: 'MOVIE', series: 'SERIES', franchises: 'FRANCHISE' } as const;

export function apiKindParam(value: unknown): (typeof ITEM_KINDS)[number] {
  if (typeof value === 'string' && Object.hasOwn(API_KIND, value)) {
    return API_KIND[value as keyof typeof API_KIND];
  }
  throw Problems.notFound();
}

export function slugParam(value: unknown): string {
  if (typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 80) {
    return value;
  }
  throw Problems.notFound();
}
