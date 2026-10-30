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
};

if (process.env.NODE_ENV === 'production') sharp.concurrency(2); // 2 GB server
sharp.cache(false);

export const MediaProblems = {
  unsupported: () =>
    new HttpError(415, 'UNSUPPORTED_IMAGE', 'Formato não aceito. Envie JPEG, PNG, WebP ou AVIF.'),
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

function render(file: string, rule: RoleRule, size: { w: number; h: number }) {
  return sharp(file, INPUT)
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
  outputs: { w: number; h: number; format: 'avif' | 'webp'; data: Buffer }[];
};

async function processImage(file: string, role: MediaRole): Promise<Processed> {
  const sniffed = sniffImage(await readHead(file));
  if (!sniffed) throw MediaProblems.unsupported();
  let meta: Metadata;
  try {
    meta = await sharp(file, INPUT).metadata();
  } catch (err) {
    if (err instanceof Error && /pixel limit/i.test(err.message))
      throw MediaProblems.tooManyPixels();
    throw MediaProblems.invalid();
  }
  if (!formatMatches(sniffed, meta)) throw MediaProblems.unsupported();
  if ((meta.pages ?? 1) > 1) throw MediaProblems.invalid();
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
    return { sha256: sha, width: largest.w, height: outputs.at(-1)!.h, outputs };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    logger.warn(
      { err: err instanceof Error ? err.message : 'unknown', role },
      'image processing failed',
    );
    throw MediaProblems.invalid();
  }
}

async function writeVariants(p: Processed): Promise<MediaVariant[]> {
  const dir = mediaDir();
  await mkdir(dir, { recursive: true, mode: 0o755 });
  const prefix = p.sha256.toString('hex').slice(0, 32);
  const variants: MediaVariant[] = [];
  for (const o of p.outputs) {
    const name = `${prefix}-${o.w}.${o.format}`;
    const tmp = join(dir, `.tmp-${randomBytes(8).toString('hex')}`);
    await writeFile(tmp, o.data, { flag: 'wx', mode: 0o644 });
    await rename(tmp, join(dir, name)); // atomic; identical content if it already existed
    variants.push({
      w: o.w,
      h: o.h,
      format: o.format,
      path: `/media/${name}`,
      bytes: o.data.length,
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
): Promise<IngestResult> {
  return enqueue(async () => {
    const processed = await processImage(file, role);
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
): Promise<IngestResult> {
  if (!body) throw MediaProblems.unsupported();
  const dir = await mkdtemp(join(tmpdir(), 'wf-upload-'));
  try {
    const file = join(dir, 'upload.bin'); // fixed name: the client's file name is never used
    const bytes = await streamToFile(body, file);
    return await ingestFile(file, role, uploadedById, bytes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
