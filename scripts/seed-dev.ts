/**
 * Development seed (12 §2 step 10): FICTIONAL titles with brand placeholder art, in every state
 * the pages and the dashboard need (active, reserved, sponsored, watched, drafts, empty slots;
 * open / paused / funded campaigns). Everything goes through the real services and the real
 * media pipeline, so a seeded database looks exactly like one filled in the dashboard.
 *
 *   npm run db:seed            (refuses to run on a non-empty catalog)
 *   npm run db:seed -- --reset (deletes the catalog first — development databases only)
 *
 * Refuses NODE_ENV=production. Reads .env.local / .env like the app (DATABASE_URL, MEDIA_DIR, …).
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ArtSpec } from './seed-art';

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) process.loadEnvFile(file);
}
if (process.env.NODE_ENV === 'production') {
  console.error('seed-dev: refusing to run with NODE_ENV=production');
  process.exit(1);
}
(process.env as Record<string, string | undefined>).NODE_ENV ??= 'development';

const { db, disconnectDb } = await import('../src/server/db');
const { ingestFile } = await import('../src/server/media/pipeline');
const { createItem, publishMovie } = await import('../src/server/catalog/service');
const { openCampaign } = await import('../src/server/catalog/campaigns');
const { sha256Bytes } = await import('../src/server/security/crypto');
const { ensureActiveRuleSet } = await import('../src/server/pricing/rulesets');
const { buyerKeyForEmail, buyerKeyForUser, newPublicCode } =
  await import('../src/server/orders/identity');
const { mediaDir } = await import('../src/server/env');
const { PALETTES, renderArt, renderLogo } = await import('./seed-art');

const RESET = process.argv.includes('--reset');
const tmp = mkdtempSync(join(tmpdir(), 'wf-seed-'));
const t0 = Date.now();
const log = (...a: unknown[]) =>
  console.log(`[seed ${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// ── people (fictional; their Google `sub` can never log in) ──────────────────────
async function user(username: string, role: 'USER' | 'MODERATOR' | 'STREAMER', avatarKey: string) {
  return db().user.upsert({
    where: { googleSub: `seed:${username}` },
    update: {},
    create: {
      googleSub: `seed:${username}`,
      email: `${username}@seed.invalid`,
      emailVerified: true,
      username,
      avatarKey,
      role,
    },
  });
}

// ── art: a handful of variants, shared between items (the pipeline deduplicates) ─
const ART: ArtSpec[] = [
  {
    c1: PALETTES[0]![0],
    c2: PALETTES[0]![1],
    pattern: 'padrao-3',
    patternColour: 'plum',
    pose: 1,
    mascotColour: 'lilac',
  },
  {
    c1: PALETTES[1]![0],
    c2: PALETTES[1]![1],
    pattern: 'padrao-1',
    patternColour: 'violet',
    pose: 2,
    mascotColour: 'lilac',
  },
  {
    c1: PALETTES[2]![0],
    c2: PALETTES[2]![1],
    pattern: 'padrao-2',
    patternColour: 'plum',
    pose: 3,
    mascotColour: 'lilac',
    flip: true,
  },
  {
    c1: PALETTES[3]![0],
    c2: PALETTES[3]![1],
    pattern: 'padrao-2',
    patternColour: 'violet',
    pose: 4,
    mascotColour: 'ink',
  },
  {
    c1: PALETTES[4]![0],
    c2: PALETTES[4]![1],
    pattern: 'padrao-1',
    patternColour: 'lavender',
    pose: 1,
    mascotColour: 'lavender',
    flip: true,
  },
  {
    c1: PALETTES[5]![0],
    c2: PALETTES[5]![1],
    pattern: 'padrao-3',
    patternColour: 'violet',
    pose: 2,
    mascotColour: 'lavender',
  },
];

async function artAssets(uploaderId: string) {
  const out: { posterId: string; backdropId: string }[] = [];
  for (const [i, spec] of ART.entries()) {
    const p = join(tmp, `poster-${i}.png`);
    const b = join(tmp, `backdrop-${i}.png`);
    await renderArt(spec, 'poster', p);
    await renderArt(spec, 'backdrop', b);
    const poster = await ingestFile(p, 'POSTER', uploaderId);
    const backdrop = await ingestFile(b, 'BACKDROP', uploaderId);
    out.push({ posterId: poster.asset.id, backdropId: backdrop.asset.id });
    log(`art ${i + 1}/${ART.length}`);
  }
  return out;
}

// ── content ──────────────────────────────────────────────────────────────────
const SYNOPSES = [
  'Numa cidade onde as luzes nunca se apagam, um esquilo insone descobre que a lua está sendo roubada pedaço por pedaço — e só ele parece perceber.',
  'Uma moldura antiga aparece no sótão da família Ameixa. Toda noite, o retrato dentro dela muda um detalhe — e cada mudança antecipa o dia seguinte.',
  'Dois irmãos herdam um cinema de rua prestes a fechar e decidem exibir uma última sessão. O filme que encontram na cabine não deveria existir.',
  'No inverno mais longo do século, uma orquestra de bairro aceita tocar num baile do qual ninguém volta igual.',
  'Uma detetive aposentada é chamada para resolver o sumiço de todas as cores de uma vila — menos o lilás.',
  'Um desenhista de mapas descobre que as ruas que ele inventa passam a existir na manhã seguinte.',
  'Durante uma tempestade, os passageiros do último bonde da noite percebem que a linha não termina onde deveria.',
  'Uma confeiteira tenta recriar o bolo de casamento da avó e acaba reabrindo um segredo de três gerações.',
];
const GENRES = [
  ['Ficção científica', 'Aventura'],
  ['Suspense'],
  ['Drama'],
  ['Fantasia', 'Musical'],
  ['Mistério', 'Comédia'],
  ['Fantasia'],
  ['Terror'],
  ['Comédia', 'Romance'],
];
const RATINGS = ['A14', 'L', 'A12', 'A10', 'A16', 'L', 'A18', 'A12'] as const;
const TRAILERS = ['aqz-KE-bpKQ', 'eRsGyueVLvQ']; // Blender open movies (CC BY) as stand-in trailers

const MOVIE_TITLES = [
  'A Noite do Esquilo',
  'Moldura Escura',
  'Padrão Infinito',
  'O Último Rabinho',
  'Sombras de Ameixa',
  'Lilás em Chamas',
  'Ameixa Selvagem',
  'Lavanda Neon',
  'Diamante Violeta',
  'O Bonde da Meia-Noite',
  'Cartografia do Sonho',
  'Baile de Inverno',
  'A Vila sem Cores',
  'O Bolo da Avó',
  'Cinema Paraíso Lilás',
  'Rabo de Foguete',
  'Noz Moscada',
  'A Floresta Quadriculada',
  'Pequeno Ladrão de Luas',
  'O Sótão',
  'Telhados de Vidro',
  'A Última Sessão',
  'Ventania',
  'Olhos de Avelã',
  'Constelação Ameixa',
  'O Relojoeiro',
  'Neblina sobre o Lago',
  'Esquilo em Fuga',
  'Domingo de Neon',
  'Cidade Insone',
  'A Casa das Molduras',
  'Ponte Violeta',
  'O Mapa Invisível',
];
// 35 slots: 24 and 34 stay empty (shows the "+" on the board).
const MOVIE_SLOTS = Array.from({ length: 35 }, (_, i) => i + 1).filter((s) => s !== 24 && s !== 34);

const SERIES = [
  {
    title: 'Crônicas do Bosque',
    label: 'Temporadas 1–3',
    seasons: 3,
    eps: 24,
    raised: 18600,
    sup: 37,
    days: 18,
  },
  {
    title: 'Neblina Lilás',
    label: 'Temporada 1',
    seasons: 1,
    eps: 8,
    raised: 10000,
    sup: 21,
    days: 9,
    funded: true,
  },
  {
    title: 'O Esquilo Detetive',
    label: 'Temporadas 1–2',
    seasons: 2,
    eps: 16,
    raised: 7400,
    sup: 14,
    days: -3,
  },
  {
    title: 'Reino de Ameixa',
    label: 'Temporada 1',
    seasons: 1,
    eps: 10,
    raised: 2500,
    sup: 6,
    days: 27,
  },
  {
    title: 'Linhas Infinitas',
    label: 'Temporadas 1–4',
    seasons: 4,
    eps: 40,
    raised: 31200,
    sup: 58,
    days: 9,
  },
  {
    title: 'Casa de Vidro',
    label: 'Temporada 1',
    seasons: 1,
    eps: 6,
    raised: 900,
    sup: 2,
    days: 29,
  },
  {
    title: 'A Guilda dos Mapas',
    label: 'Temporadas 1–2',
    seasons: 2,
    eps: 20,
    raised: 11000,
    sup: 19,
    days: 14,
  },
  { title: 'Ponto Cego', label: 'Temporada 1', seasons: 1, eps: 8, raised: 4300, sup: 9, days: 21 },
  {
    title: 'Rádio Esquilo',
    label: 'Temporadas 1–3',
    seasons: 3,
    eps: 30,
    raised: 0,
    sup: 0,
    days: 30,
  },
];

const FRANCHISES = [
  {
    title: 'Saga Rabinho — 4 filmes',
    films: [
      ['O Rabinho', 1998, 101],
      ['O Rabinho Volta', 2001, 109],
      ['Rabinho: Ressurreição', 2005, 112],
      ['Rabinho Para Sempre', 2010, 124],
    ],
    raised: 21000,
    sup: 33,
    days: 12,
  },
  {
    title: 'Trilogia da Lua Roubada',
    films: [
      ['A Lua Roubada', 2012, 118],
      ['A Lua Escondida', 2014, 135],
      ['A Lua de Volta', 2017, 142],
    ],
    raised: 4100,
    sup: 8,
    days: 25,
  },
  {
    title: 'Coleção Moldura',
    films: [
      ['Moldura', 2003, 95],
      ['Moldura 2', 2006, 99],
    ],
    raised: 4000,
    sup: 11,
    days: 6,
    funded: true,
  },
  {
    title: 'Contos do Sótão — 3 filmes',
    films: [
      ['O Sótão', 1987, 88],
      ['De Volta ao Sótão', 1991, 94],
      ['O Último Sótão', 1996, 103],
    ],
    raised: 1500,
    sup: 3,
    days: 20,
  },
];

async function main() {
  const existing = await db().catalogItem.count();
  if (existing && !RESET) {
    console.error(
      `seed-dev: the catalog already has ${existing} items (use --reset on a development DB).`,
    );
    process.exit(1);
  }
  if (RESET) {
    await db().$transaction([
      db().watchEvent.deleteMany({}),
      db().review.deleteMany({}),
      db().refund.deleteMany({}),
      db().payment.deleteMany({}),
      db().legalAcceptance.deleteMany({ where: { orderId: { not: null } } }),
      db().emailOutbox.deleteMany({}),
      db().order.deleteMany({}),
      db().campaign.deleteMany({}),
      db().catalogRevision.deleteMany({}),
      db().franchiseEntry.deleteMany({}),
      db().catalogItem.deleteMany({}),
      db().mediaAsset.deleteMany({}),
    ]);
  }
  log(`media → ${mediaDir()}`);

  const mod = await user('mod_ana', 'MODERATOR', 'mascote-2-lavender');
  const streamer = await user('wiski', 'STREAMER', 'mascote-4-lilac');
  const sponsor = await user('luana_v', 'USER', 'mascote-1-lilac');
  const modCtx = { actor: { id: mod.id, role: mod.role }, requestId: 'seed' };
  const streamerCtx = { actor: { id: streamer.id, role: streamer.role }, requestId: 'seed' };

  const art = await artAssets(mod.id);
  const logoFile = join(tmp, 'logo.png');
  await renderLogo('A NOITE DO ESQUILO', logoFile);
  const logo = await ingestFile(logoFile, 'LOGO', mod.id);

  // ── movies ──
  const movieIds: string[] = [];
  for (const [i, title] of MOVIE_TITLES.entries()) {
    const k = i % SYNOPSES.length;
    const a = art[i % art.length]!;
    const item = await createItem(modCtx, {
      kind: 'MOVIE',
      title,
      runtimeMinutes: [115, 98, 131, 89, 142, 104, 126, 110][k]!,
      year: 1994 + ((i * 7) % 31),
      ageRating: RATINGS[k],
      genres: GENRES[k],
      synopsis: SYNOPSES[k],
      director: ['Ana Lavanda', 'Rui Ameixa', 'Lia Noite', 'Caio Violeta'][i % 4],
      cast: ['Rui Ameixa', 'Lia Noite', 'Bia Lilás'].slice(0, 2 + (i % 2)),
      trailer: i % 5 === 3 ? null : TRAILERS[i % TRAILERS.length]!,
      posterId: a.posterId,
      backdropId: a.backdropId,
      ...(i === 0 ? { logoId: logo.asset.id, originalTitle: "The Squirrel's Night" } : {}),
    });
    await publishMovie(modCtx, item.id, item.version, MOVIE_SLOTS[i]);
    movieIds.push(item.id);
  }
  log(`${movieIds.length} movies live`);

  // a draft planned for the empty slot 24
  await createItem(modCtx, {
    kind: 'MOVIE',
    title: 'Rascunho: Os Esquilos de Agosto',
    runtimeMinutes: 117,
    synopsis: 'Rascunho salvo no painel — ainda sem imagens.',
    slot: 24,
  });

  // states: slot 4 sponsored (paid by @luana_v), slot 6 reserved (Pix pending), slot 13 watched
  // Phase 2: the real rule set (04 §3) — the first checkout would create it anyway.
  const ruleSet = await ensureActiveRuleSet();
  const order = (itemId: string, status: 'PAID' | 'PENDING_PAYMENT', userId: string | null) =>
    db().order.create({
      data: {
        publicCode: newPublicCode(),
        kind: 'MOVIE',
        itemId,
        userId,
        contactEmail: userId ? 'luana_v@seed.invalid' : 'convidado@seed.invalid',
        buyerKey: userId ? buyerKeyForUser(userId) : buyerKeyForEmail('convidado@seed.invalid'),
        accessTokenHash: sha256Bytes(randomUUID()),
        runtimeMinutes: 89,
        ruleSetId: ruleSet.id,
        rescheduleCount: 0,
        breakdown: [{ label: 'Filme', cents: 2000 }],
        subtotalCents: 2000,
        totalCents: 2000,
        status,
        clientRequestId: randomUUID(),
        ...(status === 'PAID' ? { paidAt: new Date() } : {}),
        // demo orders: a local payment row without a Mercado Pago order behind it
        payment: {
          create: {
            idempotencyKey: randomUUID(),
            amountCents: 2000,
            status: status === 'PAID' ? 'APPROVED' : 'PENDING',
            expiresAt: new Date(Date.now() + 30 * 60_000),
            ...(status === 'PAID' ? { approvedAt: new Date() } : {}),
          },
        },
      },
    });
  const sponsored = movieIds[MOVIE_SLOTS.indexOf(4)]!;
  await order(sponsored, 'PAID', sponsor.id);
  await db().catalogItem.update({ where: { id: sponsored }, data: { status: 'SPONSORED' } });
  const reserved = movieIds[MOVIE_SLOTS.indexOf(6)]!;
  const pending = await order(reserved, 'PENDING_PAYMENT', null);
  await db().catalogItem.update({
    where: { id: reserved },
    data: { reservedUntil: new Date(Date.now() + 35 * 60_000), reservedOrderId: pending.id },
  });
  const watched = movieIds[MOVIE_SLOTS.indexOf(13)]!;
  await db().catalogItem.update({
    where: { id: watched },
    data: { status: 'WATCHED', watchedAt: new Date() },
  });
  await db().watchEvent.create({ data: { itemId: watched, watchedAt: new Date() } });

  // two titles watched earlier and already replaced (Avaliações → assistidos)
  for (const [j, title] of ['A Primeira Live', 'Esquilo de Natal'].entries()) {
    const a = art[(j + 2) % art.length]!;
    const done = await createItem(modCtx, {
      kind: 'MOVIE',
      title,
      runtimeMinutes: 100 + j * 12,
      year: 2015 + j,
      ageRating: 'L',
      genres: ['Comédia'],
      synopsis: SYNOPSES[(j + 4) % SYNOPSES.length],
      posterId: a.posterId,
      backdropId: a.backdropId,
    });
    const when = new Date(Date.now() - (j + 1) * 7 * 86_400_000);
    await db().catalogItem.update({
      where: { id: done.id },
      data: { status: 'ARCHIVED', publishedAt: when, watchedAt: when, archivedAt: when },
    });
    await db().watchEvent.create({ data: { itemId: done.id, watchedAt: when } });
  }

  // ── series (campaigns opened by the streamer; fictional amounts) ──
  for (const [i, s] of SERIES.entries()) {
    const a = art[(i + 1) % art.length]!;
    const item = await createItem(modCtx, {
      kind: 'SERIES',
      title: s.title,
      runtimeMinutes: s.eps * 45,
      seasonsLabel: s.label,
      seasonCount: s.seasons,
      episodeCount: s.eps,
      year: 2016 + (i % 8),
      ageRating: RATINGS[(i + 2) % RATINGS.length],
      genres: GENRES[(i + 3) % GENRES.length],
      synopsis: SYNOPSES[(i + 1) % SYNOPSES.length],
      trailer: TRAILERS[i % 2]!,
      posterId: a.posterId,
      backdropId: a.backdropId,
      slot: i + 1,
    });
    await seedCampaign(item.id, item.version, s.raised, s.sup, s.days, !!s.funded);
  }

  // ── franchises ──
  for (const [i, f] of FRANCHISES.entries()) {
    const a = art[(i + 3) % art.length]!;
    const item = await createItem(modCtx, {
      kind: 'FRANCHISE',
      title: f.title,
      runtimeMinutes: 1,
      franchiseEntries: f.films.map(([title, year, runtimeMinutes]) => ({
        title: title as string,
        year: year as number,
        runtimeMinutes: runtimeMinutes as number,
      })),
      year: f.films[0]![1] as number,
      ageRating: RATINGS[(i + 1) % RATINGS.length],
      genres: GENRES[(i + 5) % GENRES.length],
      synopsis: SYNOPSES[(i + 6) % SYNOPSES.length],
      trailer: TRAILERS[(i + 1) % 2]!,
      posterId: a.posterId,
      backdropId: a.backdropId,
      slot: i + 1,
    });
    await seedCampaign(item.id, item.version, f.raised, f.sup, f.days, !!f.funded);
  }
  log('campaigns open');

  async function seedCampaign(
    itemId: string,
    version: number,
    raised: number,
    supporters: number,
    days: number,
    funded: boolean,
  ) {
    const opened = new Date(Date.now() - 20 * 86_400_000);
    const c = await openCampaign(
      streamerCtx,
      itemId,
      { expectedVersion: version, days: 20 + days },
      opened,
    );
    const goal = funded ? raised : c.goalCents;
    const capped = Math.min(raised, goal);
    await db().campaign.update({
      where: { id: c.id },
      data: {
        goalCents: goal,
        raisedCents: capped,
        remainingCents: goal - capped,
        supporterCount: supporters,
        ...(funded ? { status: 'FUNDED', fundedAt: new Date() } : {}),
      },
    });
    if (funded)
      await db().catalogItem.update({ where: { id: itemId }, data: { status: 'FUNDED' } });
  }

  const counts = await db().catalogItem.groupBy({ by: ['kind', 'status'], _count: { _all: true } });
  log('done', counts.map((c) => `${c.kind}/${c.status}=${c._count._all}`).join(' '));
}

try {
  await main();
} finally {
  rmSync(tmp, { recursive: true, force: true });
  await disconnectDb();
}
