import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, open, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import sharp, { type Metadata } from 'sharp';
import type { MediaAsset } from '@/generated/prisma/client';
import type { MediaRole } from '@/generated/prisma/enums';
import { MEDIA_WIDTHS, type MediaVariant } from '@/lib/media';
import { db } from '../db';
import { PG, pgErrorCode } from '../db-errors';
import { mediaDir } from '../env';
import { HttpError, Problems } from '../http/problem';
import { logger } from '../log';
import { accentOf } from './accent';
import { type ImageFormat, SNIFF_BYTES, sniffImage } from './sniff';

/**
 * Image upload pipeline (11 §5, §9; 12 §2 step 5). An upload is untrusted until it has been
 * re-encoded:
 *
 *   stream to a private temp file (≤ 10 MB, counted) → sniff the bytes (JPEG/PNG/WebP/AVIF only)
 *   → sharp metadata with a 40 MP decompression limit → format must match the sniffed type, no
 *   animation, minimum size per role → auto-rotate, sRGB, crop to the role's aspect → AVIF + WebP
 *   at fixed widths (metadata is never copied: EXIF/GPS/ICC/XMP and trailing bytes are gone)
 *   → files named <content hash>-<width>.<ext> in MEDIA_DIR → MediaAsset row → temp file deleted.
 *
 * One job at a time with a timeout (inline: enough at this volume — Phase 2 deviation 10).
 *
 * Badges (2026-11-12) are the one role that may move: a GIF (or an animated WebP) stays animated
 * and comes out as an animated WebP, plus a still of its first frame for "reduce motion". A WebM
 * never reaches the server: the dashboard decodes it in the browser into a grid of frames (one
 * still image), and `sprite` tells this pipeline how to cut that grid back into an animation —
 * so the server only ever parses images.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_PIXELS = 40_000_000;
const JOB_TIMEOUT_SEC = 30;
const MAX_WAITING = 3;

type RoleRule = { minW: number; minH: number; aspect: number | null; widths: readonly number[] };
export const ROLE_RULES: Record<MediaRole, RoleRule> = {
  POSTER: { minW: 600, minH: 900, aspect: 2 / 3, widths: MEDIA_WIDTHS.POSTER },
  BACKDROP: { minW: 1920, minH: 1080, aspect: 16 / 9, widths: MEDIA_WIDTHS.BACKDROP },
  LOGO: { minW: 480, minH: 60, aspect: null, widths: MEDIA_WIDTHS.LOGO },
  /** Guia de Winden photos (2026-11-12): 3:4, cropped like posters */
  PORTRAIT: { minW: 300, minH: 400, aspect: 3 / 4, widths: MEDIA_WIDTHS.PORTRAIT },
  /** Emblemas (2026-11-12): square, animated allowed */
  BADGE: { minW: 128, minH: 128, aspect: 1, widths: MEDIA_WIDTHS.BADGE },
};

/** Animated badges: at most this many frames (≈ 10 s at 15 fps). */
export const MAX_FRAMES = 150;
/** A WebM turned into a grid of frames in the dashboard: frames, playback speed, grid columns. */
export type Sprite = { frames: number; fps: number; cols: number };

if (process.env.NODE_ENV === 'production') sharp.concurrency(2); // 2 GB server
sharp.cache(false);

export const MediaProblems = {
  unsupported: () =>
    new HttpError(415, 'UNSUPPORTED_IMAGE', 'Formato não aceito. Envie JPEG, PNG, WebP ou AVIF.'),
  tooManyFrames: () =>
    new HttpError(
      422,
      'IMAGE_TOO_MANY_FRAMES',
      `Animação longa demais (máximo de ${MAX_FRAMES} quadros, cerca de 10 segundos).`,
    ),
  badSprite: () =>
    new HttpError(
      422,
      'SPRITE_INVALID',
      'Os quadros do vídeo não chegaram inteiros. Tente de novo.',
    ),
  invalid: () =>
    new HttpError(
      422,
      'IMAGE_INVALID',
      'Não foi possível ler a imagem (arquivo corrompido ou animado).',
    ),
  tooManyPixels: () =>
    new HttpError(422, 'IMAGE_TOO_MANY_PIXELS', 'Imagem grande demais (máximo de 40 megapixels).'),
  tooSmall: (r: RoleRule) =>
    new HttpError(
      422,
      'IMAGE_TOO_SMALL',
      `A imagem precisa ter pelo menos ${r.minW}×${r.minH} px.`,
    ),
  logoAlpha: () =>
    new HttpError(
      422,
      'LOGO_NEEDS_TRANSPARENCY',
      'O logo do título precisa ter fundo transparente (PNG, WebP ou AVIF com transparência).',
    ),
  busy: () =>
    new HttpError(503, 'MEDIA_BUSY', 'Processando outras imagens. Tente de novo em instantes.', {
      headers: { 'retry-after': '10' },
    }),
};

// ── one job at a time ───────────────────────────────────────────────────────────
let chain: Promise<unknown> = Promise.resolve();
let waiting = 0;
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  if (waiting >= MAX_WAITING) return Promise.reject(MediaProblems.busy());
  waiting++;
  const run = chain.then(job, job);
  chain = run
    .catch(() => undefined)
    .finally(() => {
      waiting--;
    });
  return run;
}

// ── streaming to a private temp file ────────────────────────────────────────────

/** Copy a request body to `file`, failing with 413 as soon as it exceeds `max` bytes. */
export async function streamToFile(
  body: ReadableStream<Uint8Array>,
  file: string,
  max = MAX_UPLOAD_BYTES,
): Promise<number> {
  let total = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      total += chunk.length;
      if (total > max) cb(Problems.tooLarge());
      else cb(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(body as WebReadableStream<Uint8Array>),
    counter,
    createWriteStream(file, { flags: 'wx', mode: 0o600 }),
  );
  return total;
}

async function readHead(file: string): Promise<Uint8Array> {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await fh.read(buf, 0, SNIFF_BYTES, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

// ── processing ──────────────────────────────────────────────────────────────────

const INPUT = {
  limitInputPixels: MAX_PIXELS,
  failOn: 'error',
  sequentialRead: true,
  animated: false,
} as const;

function formatMatches(sniffed: ImageFormat, meta: Metadata): boolean {
  if (sniffed === 'avif') return meta.format === 'heif' && meta.compression === 'av1';
  return meta.format === sniffed;
}

type Plan = { w: number; h: number }[];

function plan(rule: RoleRule, srcW: number, srcH: number): Plan {
  if (rule.aspect === null) {
    const widths = rule.widths.filter((w) => w <= srcW);
    const list = widths.length ? widths : [Math.min(srcW, rule.widths[0]!)];
    return list.map((w) => ({ w, h: Math.max(1, Math.round((w * srcH) / srcW)) }));
  }
  const croppedW = srcW / srcH > rule.aspect ? Math.floor(srcH * rule.aspect) : srcW;
  const widths: number[] = rule.widths.filter((w) => w <= croppedW);
  // Between two fixed widths: also keep the full source width (no upscaling, no wasted pixels).
  if (widths.length && croppedW > widths.at(-1)! && croppedW < rule.widths.at(-1)!) {
    widths.push(croppedW);
  }
  return widths.map((w) => ({ w, h: Math.round(w / rule.aspect!) }));
}

function render(
  file: string | Buffer,
  rule: RoleRule,
  size: { w: number; h: number },
  opts: { animated?: boolean; page?: number } = {},
) {
  const input = opts.animated
    ? { ...INPUT, animated: true }
    : opts.page !== undefined
      ? { ...INPUT, page: opts.page }
      : INPUT;
  return sharp(file, input)
    .timeout({ seconds: JOB_TIMEOUT_SEC })
    .autoOrient()
    .toColourspace('srgb')
    .resize(size.w, size.h, {
      fit: rule.aspect === null ? 'inside' : 'cover',
      position: 'centre',
      kernel: 'lanczos3',
    });
}

type Processed = {
  sha256: Buffer;
  width: number;
  height: number;
  outputs: {
    w: number;
    h: number;
    format: 'avif' | 'webp';
    data: Buffer;
    /** an animated WebP */
    animated?: true;
    /** the first frame of an animation, named after its own content hash */
    still?: Buffer;
  }[];
  /** POSTER: ambient glow colour (2026-11-11), from the smallest re-encoded WebP */
  accent: string | null;
};

async function processImage(
  file: string,
  role: MediaRole,
  sprite: Sprite | null = null,
): Promise<Processed> {
  const sniffed = sniffImage(await readHead(file));
  if (!sniffed) throw MediaProblems.unsupported();
  // GIF and animation are for badges only; a sprite is a badge made from a video
  if (sniffed === 'gif' && role !== 'BADGE') throw MediaProblems.unsupported();
  if (sprite && role !== 'BADGE') throw MediaProblems.badSprite();
  let meta: Metadata;
  try {
    meta = await sharp(file, INPUT).metadata();
  } catch (err) {
    if (err instanceof Error && /pixel limit/i.test(err.message))
      throw MediaProblems.tooManyPixels();
    throw MediaProblems.invalid();
  }
  if (!formatMatches(sniffed, meta)) throw MediaProblems.unsupported();
  const pages = meta.pages ?? 1;
  if (role === 'BADGE' && (pages > 1 || sprite))
    return processAnimated(file, meta, sprite, sniffed);
  if (pages > 1) throw MediaProblems.invalid();
  if (!meta.width || !meta.height) throw MediaProblems.invalid();
  if (meta.width * meta.height > MAX_PIXELS) throw MediaProblems.tooManyPixels();
  const rotated = (meta.orientation ?? 1) >= 5;
  const srcW = rotated ? meta.height : meta.width;
  const srcH = rotated ? meta.width : meta.height;
  const rule = ROLE_RULES[role];
  if (srcW < rule.minW || srcH < rule.minH) throw MediaProblems.tooSmall(rule);
  if (role === 'LOGO' && !meta.hasAlpha) throw MediaProblems.logoAlpha();
  const sizes = plan(rule, srcW, srcH);
  if (!sizes.length) throw MediaProblems.tooSmall(rule);

  try {
    // Content hash of the largest rendition's pixels: identical uploads → same asset.
    const largest = sizes[sizes.length - 1]!;
    const raw = await render(file, rule, largest).raw().toBuffer();
    const sha = createHash('sha256').update(role).update(raw).digest();
    const outputs: Processed['outputs'] = [];
    for (const size of sizes) {
      const avif = await render(file, rule, size)
        .avif({ quality: 55, effort: 3, chromaSubsampling: '4:2:0' })
        .toBuffer({ resolveWithObject: true });
      outputs.push({ ...size, h: avif.info.height, format: 'avif', data: avif.data });
      const webp = await render(file, rule, size)
        .webp({ quality: 80, effort: 4, smartSubsample: true, alphaQuality: 90 })
        .toBuffer({ resolveWithObject: true });
      outputs.push({ ...size, h: webp.info.height, format: 'webp', data: webp.data });
    }
    const smallestWebp = outputs.find((o) => o.format === 'webp')!;
    const accent = role === 'POSTER' ? await accentOf(smallestWebp.data) : null;
    return { sha256: sha, width: largest.w, height: outputs.at(-1)!.h, outputs, accent };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    logger.warn(
      { err: err instanceof Error ? err.message : 'unknown', role },
      'image processing failed',
    );
    throw MediaProblems.invalid();
  }
}

// ── animated badges ─────────────────────────────────────────────────────────────

/** Cuts a grid of frames (a WebM decoded in the dashboard) back into an animated WebP buffer. */
async function fromSprite(file: string, meta: Metadata, sprite: Sprite): Promise<Buffer> {
  const { frames, fps, cols } = sprite;
  if ((meta.pages ?? 1) > 1 || !meta.width || !meta.height) throw MediaProblems.badSprite();
  const rows = Math.ceil(frames / cols);
  const tile = meta.width / cols;
  if (!Number.isInteger(tile) || tile < 128 || tile > 512 || meta.height !== tile * rows)
    throw MediaProblems.badSprite();
  const parts: Buffer[] = [];
  for (let i = 0; i < frames; i++) {
    parts.push(
      await sharp(file, INPUT)
        .timeout({ seconds: JOB_TIMEOUT_SEC })
        .extract({
          left: (i % cols) * tile,
          top: Math.floor(i / cols) * tile,
          width: tile,
          height: tile,
        })
        .png({ compressionLevel: 1 })
        .toBuffer(),
    );
  }
  return sharp(parts, { join: { animated: true }, limitInputPixels: MAX_PIXELS })
    .webp({ lossless: true, loop: 0, delay: Array(frames).fill(Math.round(1000 / fps)) })
    .toBuffer();
}

/**
 * A badge that moves: an animated GIF or WebP as uploaded, or a sprite from a WebM. Out: animated
 * WebP at the badge widths (no AVIF: browsers don't animate it reliably) and a still of the first
 * frame, AVIF + WebP, under its own content hash.
 */
async function processAnimated(
  file: string,
  meta: Metadata,
  sprite: Sprite | null,
  sniffed: ImageFormat,
): Promise<Processed> {
  if (sprite && sniffed === 'gif') throw MediaProblems.badSprite();
  let source: string | Buffer = file;
  let frames = meta.pages ?? 1;
  let w = meta.width ?? 0;
  let h = meta.pageHeight ?? meta.height ?? 0;
  if (sprite) {
    if (sprite.frames < 2 || sprite.frames > MAX_FRAMES) throw MediaProblems.tooManyFrames();
    source = await fromSprite(file, meta, sprite);
    frames = sprite.frames;
    w = h = meta.width! / sprite.cols;
  }
  if (frames > MAX_FRAMES) throw MediaProblems.tooManyFrames();
  if (!w || !h) throw MediaProblems.invalid();
  if (w * h * frames > MAX_PIXELS) throw MediaProblems.tooManyPixels();
  const rule = ROLE_RULES.BADGE;
  if (w < rule.minW || h < rule.minH) throw MediaProblems.tooSmall(rule);
  const sizes = plan(rule, w, h);
  if (!sizes.length) throw MediaProblems.tooSmall(rule);
  try {
    const largest = sizes[sizes.length - 1]!;
    const raw = await render(source, rule, largest, { animated: true }).raw().toBuffer();
    const sha = createHash('sha256').update('BADGE:animated').update(raw).digest();
    const outputs: Processed['outputs'] = [];
    for (const size of sizes) {
      const webp = await render(source, rule, size, { animated: true })
        .webp({ quality: 80, effort: 4, alphaQuality: 90, loop: 0 })
        .toBuffer({ resolveWithObject: true });
      outputs.push({ ...size, h: size.h, format: 'webp', data: webp.data, animated: true });
    }
    // the first frame, for people who asked for less motion
    const firstRaw = await render(source, rule, largest, { page: 0 }).raw().toBuffer();
    const stillSha = createHash('sha256').update('BADGE:still').update(firstRaw).digest();
    for (const size of sizes) {
      const avif = await render(source, rule, size, { page: 0 })
        .avif({ quality: 60, effort: 3 })
        .toBuffer();
      outputs.push({ ...size, format: 'avif', data: avif, still: stillSha });
      const webp = await render(source, rule, size, { page: 0 })
        .webp({ quality: 85, effort: 4, alphaQuality: 90 })
        .toBuffer();
      outputs.push({ ...size, format: 'webp', data: webp, still: stillSha });
    }
    return { sha256: sha, width: largest.w, height: largest.h, outputs, accent: null };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    logger.warn(
      { err: err instanceof Error ? err.message : 'unknown', role: 'BADGE' },
      'animated image processing failed',
    );
    throw MediaProblems.invalid();
  }
}

async function writeVariants(p: Processed): Promise<MediaVariant[]> {
  const dir = mediaDir();
  await mkdir(dir, { recursive: true, mode: 0o755 });
  const variants: MediaVariant[] = [];
  for (const o of p.outputs) {
    const name = `${(o.still ?? p.sha256).toString('hex').slice(0, 32)}-${o.w}.${o.format}`;
    const tmp = join(dir, `.tmp-${randomBytes(8).toString('hex')}`);
    await writeFile(tmp, o.data, { flag: 'wx', mode: 0o644 });
    await rename(tmp, join(dir, name)); // atomic; identical content if it already existed
    variants.push({
      w: o.w,
      h: o.h,
      format: o.format,
      path: `/media/${name}`,
      bytes: o.data.length,
      ...(o.still ? { still: true as const } : {}),
      ...(o.animated ? { animated: true as const } : {}),
    });
  }
  return variants;
}

export type IngestResult = { asset: MediaAsset; deduplicated: boolean; bytes: number };

/** Process an image file already on disk (uploads and the dev seed). The file is not modified. */
export async function ingestFile(
  file: string,
  role: MediaRole,
  uploadedById: string,
  bytes = 0,
  sprite: Sprite | null = null,
): Promise<IngestResult> {
  return enqueue(async () => {
    const processed = await processImage(file, role, sprite);
    const existing = await db().mediaAsset.findUnique({
      where: { sha256: new Uint8Array(processed.sha256) },
    });
    if (existing) return { asset: existing, deduplicated: true, bytes };
    const variants = await writeVariants(processed);
    try {
      const asset = await db().mediaAsset.create({
        data: {
          sha256: new Uint8Array(processed.sha256),
          role,
          width: processed.width,
          height: processed.height,
          variants,
          accent: processed.accent,
          uploadedById,
        },
      });
      return { asset, deduplicated: false, bytes };
    } catch (err) {
      if (pgErrorCode(err) !== PG.uniqueViolation) throw err;
      const asset = await db().mediaAsset.findUniqueOrThrow({
        where: { sha256: new Uint8Array(processed.sha256) },
      });
      return { asset, deduplicated: true, bytes };
    }
  });
}

/** Upload entry point: stream → private temp dir → ingest → temp dir removed (always). */
export async function ingestUpload(
  body: ReadableStream<Uint8Array> | null,
  role: MediaRole,
  uploadedById: string,
  sprite: Sprite | null = null,
): Promise<IngestResult> {
  if (!body) throw MediaProblems.unsupported();
  const dir = await mkdtemp(join(tmpdir(), 'wf-upload-'));
  try {
    const file = join(dir, 'upload.bin'); // fixed name: the client's file name is never used
    const bytes = await streamToFile(body, file);
    return await ingestFile(file, role, uploadedById, bytes, sprite);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
