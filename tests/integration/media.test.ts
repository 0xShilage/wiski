/**
 * Upload fuzz corpus (11 §5, §9; 12 §2 step 5 "done when"): SVG, HTML renamed .jpg, JPEG/HTML
 * polyglots, a PNG decompression bomb, 11 MB bodies, EXIF-GPS (stripped), path-traversal names,
 * wrong roles, HEIC/GIF, animation, logos without transparency — each handled; outputs carry no
 * metadata and live only under content-hash names; the temp file never survives.
 */
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as media from '@/app/api/v1/admin/media/route';
import * as file from '@/app/media/[file]/route';
import { db } from '@/server/db';
import { resetEnvCache } from '@/server/env';
import { sniffImage } from '@/server/media/sniff';
import { makeUser } from '../support/db';
import { call, req, signedIn } from '../support/http';

let dir: string;
let auth: Awaited<ReturnType<typeof signedIn>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'wf-media-test-'));
  process.env.MEDIA_DIR = dir;
  resetEnvCache();
});
// A fresh moderator per test: the per-user upload limit (20 per 10 min) is real here too.
beforeEach(async () => {
  auth = await signedIn(await makeUser({ role: 'MODERATOR' }));
});
afterAll(() => {
  delete process.env.MEDIA_DIR;
  resetEnvCache();
});

function upload(
  body: Uint8Array | string,
  role = 'POSTER',
  extra: { headers?: Record<string, string>; query?: string; who?: typeof auth } = {},
) {
  const bytes = new Uint8Array(typeof body === 'string' ? Buffer.from(body) : body);
  const who = extra.who ?? auth;
  return call(
    media.POST,
    req('POST', `/api/v1/admin/media?role=${role}${extra.query ?? ''}`, {
      cookies: who.cookies,
      headers: {
        ...who.headers,
        'content-type': 'application/octet-stream',
        'content-length': String(bytes.length),
        ...extra.headers,
      },
      rawBody: bytes,
    }),
  );
}

async function image(
  w: number,
  h: number,
  format: 'jpeg' | 'png' | 'webp' | 'avif' = 'jpeg',
  opts: { alpha?: boolean; seed?: number } = {},
) {
  const channels = opts.alpha ? 4 : 3;
  const raw = Buffer.alloc(w * h * channels);
  let x = opts.seed ?? 7;
  for (let i = 0; i < raw.length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    raw[i] = opts.alpha && i % 4 === 3 ? (i % 8 === 3 ? 0 : 255) : x & 0xff;
  }
  return sharp(raw, { raw: { width: w, height: h, channels } })
    .toFormat(format, { quality: 80 })
    .toBuffer();
}

/** A PNG that claims 50 000 × 50 000 px (2.5 GP) in a few hundred bytes. */
function pngBomb(): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const v of b) c = crcTable[(c ^ v) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(50_000, 0);
  ihdr.writeUInt32BE(50_000, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const rows = deflateSync(Buffer.alloc(50_001 * 4)); // a few rows of zeros
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', rows),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outputs = () => readdirSync(dir).filter((f) => !f.startsWith('.'));
const leftoverTemp = () => readdirSync(tmpdir()).filter((f) => f.startsWith('wf-upload-'));

describe('accepted images are re-encoded', () => {
  it('poster JPEG with EXIF GPS → AVIF + WebP at 240/480/960, no metadata, hash names', async () => {
    const jpeg = await sharp(await image(900, 1350))
      .withExif({
        IFD0: { Copyright: 'segredo', Artist: 'Fulano' },
        IFD3: {
          GPSLatitudeRef: 'S',
          GPSLatitude: '23/1 33/1 0/1',
          GPSLongitudeRef: 'W',
          GPSLongitude: '46/1 38/1 0/1',
        },
      })
      .jpeg()
      .toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();
    const res = await upload(jpeg);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      width: number;
      height: number;
      picture: { avif: string; webp: string };
    };
    expect(body).toMatchObject({ width: 900, height: 1350 });
    expect(body.picture.avif).toMatch(/240w, .*480w, .*900w$/);
    const asset = await db().mediaAsset.findUniqueOrThrow({ where: { id: body.id } });
    const variants = asset.variants as { path: string; format: string; w: number }[];
    expect(variants.map((v) => `${v.format}:${v.w}`).sort()).toEqual([
      'avif:240',
      'avif:480',
      'avif:900',
      'webp:240',
      'webp:480',
      'webp:900',
    ]);
    for (const v of variants) {
      expect(v.path).toMatch(/^\/media\/[0-9a-f]{32}-\d{2,4}\.(avif|webp)$/);
      const file = readFileSync(join(dir, v.path.slice('/media/'.length)));
      const meta = await sharp(file).metadata();
      expect(meta.exif, v.path).toBeUndefined();
      expect(meta.xmp, v.path).toBeUndefined();
      expect(file.includes(Buffer.from('segredo'))).toBe(false);
      expect(file.includes(Buffer.from('Fulano'))).toBe(false);
    }
    expect(leftoverTemp()).toEqual([]);
  });

  it('a 700-px-wide poster is never upscaled; the same image again is deduplicated', async () => {
    const jpeg = await image(700, 1050, 'jpeg', { seed: 99 });
    const first = await upload(jpeg);
    expect(first.status).toBe(201);
    const a = (await first.json()) as { id: string; picture: { webp: string } };
    expect(a.picture.webp).not.toMatch(/960w/);
    const again = await upload(jpeg);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { id: string }).id).toBe(a.id);
  });

  it('backdrop: crops to 16:9, widths up to the source (no 2560 from a 2000 px source)', async () => {
    const res = await upload(await image(2000, 1200, 'png'), 'BACKDROP');
    expect(res.status).toBe(201);
    const body = (await res.json()) as { width: number; height: number; picture: { webp: string } };
    expect(body).toMatchObject({ width: 2000, height: 1125 });
    expect(body.picture.webp).toMatch(/960w, .*1440w, .*1920w, .*2000w$/);
  });

  it('WebP and AVIF inputs are accepted; transparent logo keeps its alpha', async () => {
    expect((await upload(await image(620, 930, 'webp', { seed: 3 }))).status).toBe(201);
    expect((await upload(await image(620, 930, 'avif', { seed: 4 }))).status).toBe(201);
    const logo = await upload(await image(800, 200, 'png', { alpha: true, seed: 5 }), 'LOGO');
    expect(logo.status).toBe(201);
    const { id } = (await logo.json()) as { id: string };
    const asset = await db().mediaAsset.findUniqueOrThrow({ where: { id } });
    const webp = (asset.variants as { path: string; format: string }[]).find(
      (v) => v.format === 'webp',
    )!;
    expect((await sharp(readFileSync(join(dir, webp.path.slice(7)))).metadata()).hasAlpha).toBe(
      true,
    );
  });

  it('JPEG/HTML polyglots are neutralised (trailing payload and COM segment are gone)', async () => {
    const jpeg = await image(640, 960, 'jpeg', { seed: 11 });
    const html = Buffer.from('<html><script>alert(document.cookie)</script></html>');
    const trailing = Buffer.concat([jpeg, html]);
    const len = Buffer.alloc(2);
    len.writeUInt16BE(html.length + 2);
    const comment = Buffer.concat([
      jpeg.subarray(0, 2),
      Buffer.from([0xff, 0xfe]),
      len,
      html,
      jpeg.subarray(2),
    ]);
    for (const poly of [trailing, comment]) {
      const res = await upload(poly);
      expect([200, 201]).toContain(res.status);
    }
    for (const f of outputs()) {
      expect(readFileSync(join(dir, f)).includes(Buffer.from('<script')), f).toBe(false);
    }
  });
});

describe('rejected uploads', () => {
  it('SVG, HTML renamed .jpg, GIF, HEIC, PDF and empty bodies → 415', async () => {
    const heic = Buffer.alloc(64);
    heic.writeUInt32BE(24, 0);
    heic.write('ftypheic', 4);
    heic.write('mif1heic', 16);
    for (const body of [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1500"/>',
      '<!doctype html><html><body><script>alert(1)</script></body></html>',
      'GIF89a\u0001\u0000\u0001\u0000\u0000\u0000\u0000;' + ' '.repeat(32),
      heic,
      '%PDF-1.7\n' + ' '.repeat(64),
    ]) {
      const res = await upload(body);
      expect(res.status, String(body).slice(0, 20)).toBe(415);
      expect(await res.json()).toMatchObject({ code: 'UNSUPPORTED_IMAGE' });
    }
    // A Content-Type the browser would use for SVG is refused before reading the body.
    const svgType = await upload('<svg/>', 'POSTER', {
      headers: { 'content-type': 'image/svg+xml' },
    });
    expect(svgType.status).toBe(415);
  });

  it('a PNG decompression bomb is refused without decoding it', async () => {
    const bomb = pngBomb();
    expect(bomb.length).toBeLessThan(10_000);
    expect(sniffImage(bomb)).toBe('png');
    const res = await upload(bomb);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'IMAGE_TOO_MANY_PIXELS' });
  });

  it('11 MB → 413 from the header; a lying Content-Length → 413 while streaming', async () => {
    const big = Buffer.alloc(11 * 1024 * 1024, 0xff);
    expect((await upload(big)).status).toBe(413);
    const lying = await call(
      media.POST,
      req('POST', '/api/v1/admin/media?role=POSTER', {
        cookies: auth.cookies,
        headers: {
          ...auth.headers,
          'content-type': 'application/octet-stream',
          'content-length': String(1024),
        },
        rawBody: big,
      }),
    );
    expect(lying.status).toBe(413);
    expect(leftoverTemp()).toEqual([]);
    // No Content-Length at all → 411.
    const noLen = await call(
      media.POST,
      req('POST', '/api/v1/admin/media?role=POSTER', {
        cookies: auth.cookies,
        headers: {
          ...auth.headers,
          'content-type': 'application/octet-stream',
          'content-length': null,
        },
        rawBody: Buffer.from('x'),
      }),
    );
    expect([411, 413]).toContain(noLen.status);
  });

  it('path-traversal names are never used: unknown query keys → 422, Content-Disposition ignored', async () => {
    const before = outputs();
    const jpeg = await image(650, 975, 'jpeg', { seed: 21 });
    const withName = await upload(jpeg, 'POSTER', { query: '&name=../../etc/passwd' });
    expect(withName.status).toBe(422);
    const res = await upload(jpeg, 'POSTER', {
      headers: { 'content-disposition': 'attachment; filename="../../../../tmp/evil.jpg"' },
    });
    expect(res.status).toBe(201);
    const added = outputs().filter((f) => !before.includes(f));
    expect(added.length).toBeGreaterThan(0);
    for (const f of added) expect(f).toMatch(/^[0-9a-f]{32}-\d{2,4}\.(avif|webp)$/);
    expect(readdirSync(tmpdir()).includes('evil.jpg')).toBe(false);
  });

  it('wrong role, too small, logo without transparency, truncated and animated files → 422', async () => {
    expect((await upload(await image(700, 1050), 'BANNER')).status).toBe(422);
    const small = await upload(await image(500, 750, 'jpeg', { seed: 31 }));
    expect(await small.json()).toMatchObject({ code: 'IMAGE_TOO_SMALL' });
    const posterAsBackdrop = await upload(await image(700, 1050, 'jpeg', { seed: 32 }), 'BACKDROP');
    expect(await posterAsBackdrop.json()).toMatchObject({ code: 'IMAGE_TOO_SMALL' });
    const opaqueLogo = await upload(await image(800, 200, 'jpeg', { seed: 33 }), 'LOGO');
    expect(await opaqueLogo.json()).toMatchObject({ code: 'LOGO_NEEDS_TRANSPARENCY' });
    const jpeg = await image(700, 1050, 'jpeg', { seed: 34 });
    const truncated = await upload(jpeg.subarray(0, Math.floor(jpeg.length / 3)));
    expect(truncated.status).toBe(422);
    const f1 = await image(700, 1050, 'png', { seed: 35 });
    const f2 = await image(700, 1050, 'png', { seed: 36 }); // identical frames would be merged
    const animated = await sharp([f1, f2], { join: { animated: true } })
      .webp()
      .toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(2);
    expect((await upload(animated)).status).toBe(422);
  });

  it('viewers cannot upload (404 before the body is read)', async () => {
    const viewer = await signedIn(await makeUser());
    const res = await upload(await image(700, 1050), 'POSTER', { who: viewer });
    expect(res.status).toBe(404);
  });
});

describe('development image route /media/[file]', () => {
  const get = (name: string) => call(file.GET, req('GET', `/media/${name}`), { file: name });

  it('serves pipeline outputs with the same headers nginx sets', async () => {
    // A unique image: the DB outlives this run's MEDIA_DIR, and a duplicate would not be re-written.
    const res = await upload(await image(700, 1050, 'jpeg', { seed: Date.now() % 1e9 }));
    expect(res.status).toBe(201);
    const { picture } = (await res.json()) as { picture: { fallback: string } };
    const name = picture.fallback.slice('/media/'.length);
    const served = await get(name);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/webp');
    expect(served.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect(served.headers.get('content-security-policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'; sandbox",
    );
    expect(Buffer.from(await served.arrayBuffer())).toEqual(readFileSync(join(dir, name)));
  });

  it.each([
    'x.webp',
    '../../etc/passwd',
    '..%2f..%2fetc%2fpasswd',
    `${'a'.repeat(32)}-240.png`,
    `${'A'.repeat(32)}-240.webp`,
    `${'a'.repeat(32)}-240.webp/..`,
    `${'a'.repeat(32)}-240.webp`, // well-formed, absent
  ])('404 for %s', async (name) => {
    expect((await get(name)).status).toBe(404);
  });

  it('answers 404 in production (nginx owns /media/ there)', async () => {
    const res = await upload(await image(700, 1050, 'jpeg', { seed: (Date.now() % 1e9) + 1 }));
    const { picture } = (await res.json()) as { picture: { fallback: string } };
    vi.stubEnv('NODE_ENV', 'production');
    try {
      expect((await get(picture.fallback.slice('/media/'.length))).status).toBe(404);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
