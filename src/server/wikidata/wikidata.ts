import 'server-only';
import type { ItemKindCode } from '@/lib/catalog/kinds';
import { getEnv } from '../env';
import { HttpError } from '../http/problem';
import { logger } from '../log';
import { codePointLength, plainText } from '../text/sanitize';
import {
  type Entity,
  type FillFields,
  fillFrom,
  itemIds,
  KIND_CLASSES,
  labelOf,
  PARTS_MAX,
  QID,
  referencedIds,
  yearInText,
} from './parse';

/**
 * "Preencher com o Wikidata" (2026-11-15). The dashboard looks a title up on Wikidata (the free,
 * public-domain database behind Wikipedia) and fills the editor: Portuguese title, original title,
 * year, runtime, ClassInd rating, genres, director, cast, trailer, seasons. The Portuguese
 * Wikipedia's summary comes along as a reference for writing the synopsis (it is CC BY-SA, so it
 * is shown, never copied in). Images are not looked up: Iara uploads her own.
 *
 * Only these two fixed hosts are ever called, from the server, with a timeout, a size cap and no
 * redirects; ids are validated (Q + digits) and every string is sanitised before it leaves.
 * Tests point both hosts at a local fixture server (WIKI_TEST_ORIGIN, loopback only).
 */
const WIKIDATA = 'https://www.wikidata.org';
const WIKIPEDIA_PT = 'https://pt.wikipedia.org';
const TIMEOUT_MS = 7_000;
const MAX_BYTES = 12_000_000;
const SEARCH_LIMIT = 8;

export const WikiProblems = {
  unavailable: () =>
    new HttpError(
      502,
      'WIKIDATA_UNAVAILABLE',
      'O Wikidata não respondeu agora. Tente de novo em instantes, ou preencha à mão.',
    ),
  notFound: () => new HttpError(404, 'NOT_FOUND', 'Este título não foi encontrado no Wikidata.'),
};

function origins() {
  const test = getEnv().WIKI_TEST_ORIGIN;
  return { wikidata: test ?? WIKIDATA, wikipedia: test ?? WIKIPEDIA_PT };
}

function userAgent() {
  // Wikimedia asks every client to name itself and a way to reach it.
  return `Wiskiflix/1.0 (${getEnv().APP_ORIGIN}; catalogo) node-fetch`;
}

async function getJson(url: URL): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'user-agent': userAgent(), accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : 'unknown', host: url.host },
      'wikidata request failed',
    );
    throw WikiProblems.unavailable();
  }
  if (!res.ok) {
    logger.warn({ status: res.status, host: url.host }, 'wikidata answered an error');
    throw WikiProblems.unavailable();
  }
  if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) throw WikiProblems.unavailable();
  const text = await res.text();
  if (text.length > MAX_BYTES) throw WikiProblems.unavailable();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw WikiProblems.unavailable();
  }
}

function api(params: Record<string, string>): URL {
  const url = new URL('/w/api.php', origins().wikidata);
  for (const [k, v] of Object.entries({ format: 'json', ...params })) url.searchParams.set(k, v);
  return url;
}

async function entities(ids: string[], props: string): Promise<Map<string, Entity>> {
  const out = new Map<string, Entity>();
  const valid = ids.filter((id) => QID.test(id));
  for (let i = 0; i < valid.length; i += 50) {
    const batch = valid.slice(i, i + 50);
    const json = (await getJson(
      api({
        action: 'wbgetentities',
        ids: batch.join('|'),
        props,
        languages: 'pt|pt-br|mul|en',
        ...(props.includes('sitelinks') ? { sitefilter: 'ptwiki' } : {}),
      }),
    )) as { entities?: Record<string, Entity> };
    for (const [id, e] of Object.entries(json.entities ?? {})) {
      if (QID.test(id) && !e.missing) out.set(id, e);
    }
  }
  return out;
}

export type Candidate = {
  id: string;
  title: string;
  description: string | null;
  year: number | null;
};

const text = (raw: unknown, max: number) => {
  if (typeof raw !== 'string') return null;
  const s = plainText(raw, { multiline: false });
  if (!s) return null;
  return codePointLength(s) <= max
    ? s
    : `${Array.from(s)
        .slice(0, max - 1)
        .join('')}…`;
};

/**
 * Search (titles in any language, accents optional), limited to the kind's classes — a search
 * for a movie lists films, never the book or the soundtrack.
 */
export async function searchWikidata(query: string, kind: ItemKindCode): Promise<Candidate[]> {
  const q = plainText(query, { multiline: false })
    .replace(/[|"\\]/g, ' ')
    .trim()
    .slice(0, 120);
  if (!q) return [];
  const filter = KIND_CLASSES[kind].map((c) => `P31=${c}`).join('|');
  const found = (await getJson(
    api({
      action: 'query',
      list: 'search',
      srsearch: `${q} haswbstatement:${filter}`,
      srnamespace: '0',
      srlimit: String(SEARCH_LIMIT),
      srprop: '',
    }),
  )) as { query?: { search?: { title?: unknown }[] } };
  const ids = (found.query?.search ?? [])
    .map((r) => (typeof r.title === 'string' ? r.title : ''))
    .filter((id) => QID.test(id));
  if (!ids.length) return [];
  const byId = await entities(ids, 'labels|descriptions');
  return ids
    .map((id) => {
      const e = byId.get(id);
      const title = text(labelOf(e), 120);
      if (!title) return null;
      const description = text(labelOf({ labels: e?.descriptions ?? {} }), 160);
      return { id, title, description, year: yearInText(description) };
    })
    .filter((c): c is Candidate => c !== null);
}

export type WikidataFill = {
  id: string;
  url: string;
  fields: FillFields;
  /** the Portuguese Wikipedia's summary — a reference for the synopsis, never copied in */
  summary: { text: string; url: string } | null;
};

async function wikipediaSummary(title: string): Promise<WikidataFill['summary']> {
  const page = title.replace(/ /g, '_');
  try {
    const json = (await getJson(
      new URL(`/api/rest_v1/page/summary/${encodeURIComponent(page)}`, origins().wikipedia),
    )) as { extract?: unknown; type?: unknown };
    if (json.type === 'disambiguation') return null;
    const extract =
      typeof json.extract === 'string' ? plainText(json.extract, { multiline: true }) : '';
    if (!extract) return null;
    return {
      text:
        codePointLength(extract) <= 1200
          ? extract
          : `${Array.from(extract).slice(0, 1199).join('')}…`,
      url: `${WIKIPEDIA_PT}/wiki/${encodeURIComponent(page)}`,
    };
  } catch {
    return null; // the summary is a nicety: the fill goes on without it
  }
}

/** One title's details, ready for the editor. */
export async function wikidataFill(id: string, kind: ItemKindCode): Promise<WikidataFill> {
  if (!QID.test(id)) throw WikiProblems.notFound();
  const main = (await entities([id], 'labels|claims|sitelinks')).get(id);
  if (!main) throw WikiProblems.notFound();
  const labels = await entities(referencedIds(main, kind), 'labels');
  if (kind === 'FRANCHISE') {
    // the franchise's films: their year and runtime, too
    const parts = await entities(itemIds(main, 'P527', PARTS_MAX), 'labels|claims');
    for (const [k, v] of parts) labels.set(k, v);
  }
  const fields = fillFrom(main, kind, labels);
  if (!fields.title) throw WikiProblems.notFound();
  const pt = main.sitelinks?.ptwiki?.title;
  return {
    id,
    url: `${WIKIDATA}/wiki/${id}`,
    fields,
    summary: typeof pt === 'string' && pt.trim() ? await wikipediaSummary(pt.trim()) : null,
  };
}
