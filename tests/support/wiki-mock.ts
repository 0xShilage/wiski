/**
 * A tiny stand-in for Wikidata and the Portuguese Wikipedia (2026-11-15), answering the three
 * requests the catalog lookups make, in the real APIs' JSON shapes, from fictional titles.
 * The app is pointed at it with WIKI_TEST_ORIGIN (loopback only). Used by the integration tests
 * and the browser stack (tests/e2e/support/stack.ts).
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

type Snak = { snaktype: 'value'; datavalue: { type: string; value: unknown } };
type Statement = { mainsnak: Snak; rank: string; qualifiers?: Record<string, Snak[]> };
type Entity = {
  id: string;
  labels: Record<string, { language: string; value: string }>;
  descriptions?: Record<string, { language: string; value: string }>;
  claims?: Record<string, Statement[]>;
  sitelinks?: Record<string, { site: string; title: string }>;
};

const snakItem = (id: string): Snak => ({
  snaktype: 'value',
  datavalue: { type: 'wikibase-entityid', value: { 'entity-type': 'item', id } },
});
const st = (mainsnak: Snak, extra: Partial<Statement> = {}): Statement => ({
  mainsnak,
  rank: 'normal',
  ...extra,
});
const items = (...ids: string[]) => ids.map((id) => st(snakItem(id)));
const time = (y: number, rank = 'normal') =>
  st(
    {
      snaktype: 'value',
      datavalue: {
        type: 'time',
        value: { time: `+${y}-05-10T00:00:00Z`, precision: 11, timezone: 0 },
      },
    },
    { rank },
  );
const qty = (amount: number, unit = 'Q7727') =>
  st({
    snaktype: 'value',
    datavalue: {
      type: 'quantity',
      value: { amount: `+${amount}`, unit: `http://www.wikidata.org/entity/${unit}` },
    },
  });
const str = (value: string, qualifiers?: Record<string, Snak[]>) =>
  st({ snaktype: 'value', datavalue: { type: 'string', value } }, qualifiers ? { qualifiers } : {});
const mono = (text: string, language: string) =>
  st({ snaktype: 'value', datavalue: { type: 'monolingualtext', value: { text, language } } });
const label = (pt: string, en?: string) => ({
  pt: { language: 'pt', value: pt },
  ...(en ? { en: { language: 'en', value: en } } : {}),
});
const desc = (pt: string) => ({ pt: { language: 'pt', value: pt } });

const people = [
  'Marina Duarte',
  'Caio Brandão',
  'Lia Moreira',
  'Tomás Ventura',
  'Helena Sá',
  'Rui Albuquerque',
  'Beatriz Lobo',
  'Otávio Pena',
  'Joana Prates',
];

export const WIKI_FIXTURES: Entity[] = [
  {
    id: 'Q900001',
    labels: label('A Lontra Astronauta', 'The Astronaut Otter'),
    descriptions: desc('filme de 2019 dirigido por Marina Duarte'),
    claims: {
      P31: items('Q11424'),
      P1476: [mono('The Astronaut Otter', 'en')],
      // a deprecated (wrong) date is ignored; the earliest real one wins
      P577: [time(2030, 'deprecated'), time(2019), time(2020)],
      P2047: [qty(112)],
      P57: items('Q900301'),
      P161: items(
        'Q900302',
        'Q900303',
        'Q900304',
        'Q900305',
        'Q900306',
        'Q900307',
        'Q900308',
        'Q900309',
      ),
      P136: items('Q900201', 'Q900202', 'Q900203'),
      P3216: items('Q900101'),
      P1651: [
        // the whole film: never used as the trailer
        str('wHoLeFiLm01', { P3831: [snakItem('Q11424')] }),
        str('enTrailer01', { P3831: [snakItem('Q622550')], P407: [snakItem('Q1860')] }),
        str('ptTrailer01', { P3831: [snakItem('Q622550')], P407: [snakItem('Q750553')] }),
      ],
    },
    sitelinks: { ptwiki: { site: 'ptwiki', title: 'A Lontra Astronauta' } },
  },
  {
    id: 'Q900002',
    labels: label('A Lontra Astronauta'),
    descriptions: desc('filme de 2024, nova versão'),
    claims: {
      P31: items('Q11424'),
      P577: [time(2024)],
      P2047: [qty(98)],
      P136: items('Q900202'),
    },
  },
  {
    id: 'Q900003',
    labels: label('Casa das Marés'),
    descriptions: desc('série de televisão de 2021'),
    claims: {
      P31: items('Q5398426'),
      P577: [time(2021)],
      P2047: [qty(45)],
      P2437: [qty(3, '1')],
      P1113: [qty(24, '1')],
      P136: items('Q900204'),
      P3216: items('Q900102'),
    },
  },
  {
    id: 'Q900004',
    labels: label('Saga do Farol'),
    descriptions: desc('série de filmes'),
    claims: {
      P31: items('Q24856'),
      P577: [time(2010)],
      P527: items('Q900006', 'Q900005', 'Q900007'),
      P136: items('Q900201'),
    },
  },
  {
    id: 'Q900005',
    labels: label('O Farol'),
    claims: { P31: items('Q11424'), P577: [time(2010)], P2047: [qty(2, 'Q25235')] },
  },
  {
    id: 'Q900006',
    labels: label('O Farol 2: A Volta'),
    claims: { P31: items('Q11424'), P577: [time(2013)], P2047: [qty(130)] },
  },
  {
    id: 'Q900007',
    labels: label('O Farol (livro)'),
    claims: { P31: items('Q7725634'), P577: [time(2005)] },
  },
  {
    id: 'Q900008',
    labels: label('O Esquilo Sem Dados'),
    descriptions: desc('filme'),
    claims: { P31: items('Q11424') },
  },
  // labels only
  { id: 'Q900101', labels: label('ClassInd 12') },
  { id: 'Q900102', labels: label('ClassInd 14') },
  { id: 'Q900201', labels: label('filme de ficção científica') },
  { id: 'Q900202', labels: label('filme de aventura') },
  { id: 'Q900203', labels: { en: { language: 'en', value: 'space western' } } },
  { id: 'Q900204', labels: label('drama') },
  ...people.map((name, i) => ({ id: `Q90030${i + 1}`, labels: label(name) })),
];

const SUMMARIES: Record<string, string> = {
  A_Lontra_Astronauta:
    'A Lontra Astronauta é um filme de ficção científica de 2019 sobre uma lontra que sonha em chegar à Lua e constrói um foguete com a ajuda dos amigos do rio.',
};

const fold = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export type WikiMock = {
  origin: string;
  /** answer every request with a 503 (Wikidata down) */
  setDown: (down: boolean) => void;
  /** how many requests arrived (and with which User-Agent) */
  requests: { path: string; userAgent: string | undefined }[];
  close: () => Promise<void>;
};

export async function startWikiMock(): Promise<WikiMock> {
  let down = false;
  const requests: WikiMock['requests'] = [];
  const byId = new Map(WIKI_FIXTURES.map((e) => [e.id, e]));
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    requests.push({ path: url.pathname + url.search, userAgent: req.headers['user-agent'] });
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    if (down) return json(503, { error: 'down' });
    if (url.pathname === '/w/api.php') {
      const p = url.searchParams;
      if (p.get('action') === 'query' && p.get('list') === 'search') {
        const raw = p.get('srsearch') ?? '';
        const [q = '', filter = ''] = raw.split(' haswbstatement:');
        const classes = new Set(filter.split('|').map((f) => f.replace('P31=', '')));
        const needle = fold(q);
        const hits = WIKI_FIXTURES.filter(
          (e) =>
            e.claims?.P31?.some((s) =>
              classes.has((s.mainsnak.datavalue.value as { id: string }).id),
            ) && Object.values(e.labels).some((l) => fold(l.value).includes(needle)),
        );
        return json(200, { query: { search: hits.map((e) => ({ ns: 0, title: e.id })) } });
      }
      if (p.get('action') === 'wbgetentities') {
        const props = (p.get('props') ?? '').split('|');
        const entities: Record<string, unknown> = {};
        for (const id of (p.get('ids') ?? '').split('|')) {
          const e = byId.get(id);
          if (!e) {
            entities[id] = { id, missing: '' };
            continue;
          }
          entities[id] = {
            id,
            type: 'item',
            ...(props.includes('labels') ? { labels: e.labels } : {}),
            ...(props.includes('descriptions') ? { descriptions: e.descriptions ?? {} } : {}),
            ...(props.includes('claims') ? { claims: e.claims ?? {} } : {}),
            ...(props.includes('sitelinks') ? { sitelinks: e.sitelinks ?? {} } : {}),
          };
        }
        return json(200, { entities, success: 1 });
      }
      return json(400, { error: 'unknown action' });
    }
    const summary = /^\/api\/rest_v1\/page\/summary\/(.+)$/.exec(url.pathname);
    if (summary) {
      const extract = SUMMARIES[decodeURIComponent(summary[1]!)];
      return extract ? json(200, { type: 'standard', extract }) : json(404, { type: 'not_found' });
    }
    return json(404, {});
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    setDown: (d) => {
      down = d;
    },
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
