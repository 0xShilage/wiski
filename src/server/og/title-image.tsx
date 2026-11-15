/* eslint-disable react/forbid-dom-props -- this JSX is drawn into a PNG by next/og (satori), never
   sent to a browser as HTML, so the CSP rule behind the ban doesn't apply; satori only reads
   `style`. */
import 'server-only';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import type { ItemKind } from '@/generated/prisma/client';
import { KIND_LABEL } from '@/lib/catalog/kinds';
import { formatBRL, formatRuntime } from '@/lib/catalog/pricing';
import type { Picture } from '@/lib/media';
import { getPublic } from '../catalog/read';
import { mediaDir } from '../env';
import { logger } from '../log';

/**
 * A designed share image for every title page (2026-11-14): 1200×630, the title's background
 * blurred and darkened, its poster glowing on the left, the kind, the title in the display face,
 * year · runtime · genres, a short line, and the Wiski wordmark. Fonts: TrueType subsets in
 * ./fonts (`npm run brand:fonts`); images: the title's own re-encoded WebPs from the media folder,
 * turned into PNG here (next/og reads PNG and JPEG). A title that isn't public gets the site's
 * card instead of an error.
 */
export const OG_SIZE = { width: 1200, height: 630 };

const FONT_DIR = join(process.cwd(), 'src/server/og/fonts');
const SAFE = /^[0-9a-f]{32}-\d{2,4}\.webp$/;

let fonts: Promise<{ name: string; data: Buffer; weight: 400 | 500 | 600; style: 'normal' }[]>;
function loadFonts() {
  fonts ??= Promise.all([
    readFile(join(FONT_DIR, 'poppins-500.ttf')).then((data) => ({
      name: 'Poppins',
      data,
      weight: 500 as const,
      style: 'normal' as const,
    })),
    readFile(join(FONT_DIR, 'poppins-600.ttf')).then((data) => ({
      name: 'Poppins',
      data,
      weight: 600 as const,
      style: 'normal' as const,
    })),
    readFile(join(FONT_DIR, 'escargoth.ttf')).then((data) => ({
      name: 'Escargoth',
      data,
      weight: 400 as const,
      style: 'normal' as const,
    })),
    readFile(join(FONT_DIR, 'black-rockie.ttf')).then((data) => ({
      name: 'Black Rockie',
      data,
      weight: 400 as const,
      style: 'normal' as const,
    })),
  ]);
  return fonts;
}

/** The picture's WebP closest to `width`, read from the media folder (never a path from outside). */
async function mediaFile(pic: Picture | null, width: number): Promise<Buffer | null> {
  if (!pic) return null;
  const options = pic.webp
    .split(',')
    .map((s) => s.trim().split(' '))
    .map(([path, w]) => ({ path: path ?? '', w: Number.parseInt(w ?? '0', 10) }))
    .filter((o) => SAFE.test(basename(o.path)))
    .sort((a, b) => Math.abs(a.w - width) - Math.abs(b.w - width));
  const best = options[0];
  if (!best) return null;
  try {
    return await readFile(join(mediaDir(), basename(best.path)));
  } catch {
    return null;
  }
}

const dataUri = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function titleOgImage(kind: ItemKind, slug: string): Promise<ImageResponse> {
  const item =
    SLUG.test(slug) && slug.length <= 80 ? await getPublic(kind, slug).catch(() => null) : null;
  let backdrop: string | null = null;
  let poster: string | null = null;
  if (item) {
    try {
      const [b, p] = await Promise.all([
        mediaFile(item.backdrop, 1440),
        mediaFile(item.poster, 480),
      ]);
      if (b) {
        backdrop = dataUri(
          await sharp(b)
            .resize(OG_SIZE.width, OG_SIZE.height, { fit: 'cover' })
            .blur(18)
            .modulate({ brightness: 0.5, saturation: 1.1 })
            .png()
            .toBuffer(),
        );
      }
      if (p) {
        poster = dataUri(
          await sharp(p).resize(320, 480, { fit: 'cover' }).png({ compressionLevel: 8 }).toBuffer(),
        );
      }
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : 'unknown', slug }, 'og images');
    }
  }

  const title = item?.title ?? 'Wiskiflix';
  const meta = item
    ? [
        item.year,
        item.kind === 'MOVIE' ? formatRuntime(item.runtimeMinutes) : item.seasonsLabel,
        item.genres.slice(0, 2).join(', '),
      ]
        .filter(Boolean)
        .join('  ·  ')
    : 'Filmes, séries e maratonas ao vivo com a Iara';
  const line = item
    ? item.kind === 'MOVIE' && item.state === 'ACTIVE' && item.priceCents
      ? `Patrocine na live por ${formatBRL(item.priceCents)}`
      : item.synopsis.length > 120
        ? `${item.synopsis.slice(0, 117).trimEnd()}…`
        : item.synopsis
    : '';
  const titleSize = title.length > 34 ? 60 : title.length > 22 ? 74 : 90;

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        backgroundColor: '#1b1225',
        fontFamily: 'Poppins',
        color: '#e5dded',
      }}
    >
      {backdrop ? (
        // eslint-disable-next-line @next/next/no-img-element -- drawn into a PNG, not a page
        <img
          src={backdrop}
          width={OG_SIZE.width}
          height={OG_SIZE.height}
          alt=""
          style={{ position: 'absolute', inset: 0 }}
        />
      ) : null}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          backgroundImage:
            'linear-gradient(90deg, rgba(27,18,37,0.92) 0%, rgba(27,18,37,0.7) 45%, rgba(27,18,37,0.35) 100%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 22,
          display: 'flex',
          border: '2px solid rgba(169,157,224,0.55)',
          borderRadius: 26,
        }}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 56,
          padding: '0 84px',
          width: '100%',
          height: '100%',
          position: 'relative',
        }}
      >
        {poster ? (
          // eslint-disable-next-line @next/next/no-img-element -- drawn into a PNG, not a page
          <img
            src={poster}
            width={300}
            height={450}
            alt=""
            style={{
              borderRadius: 18,
              border: '2px solid rgba(169,157,224,0.8)',
              boxShadow: '0 0 60px rgba(169,157,224,0.55)',
            }}
          />
        ) : null}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: 4,
              color: '#a99de0',
              textTransform: 'uppercase',
            }}
          >
            {item ? KIND_LABEL[item.kind].one : 'Wiskiflix'}
          </div>
          <div
            style={{
              display: 'flex',
              marginTop: 14,
              fontFamily: 'Escargoth',
              fontSize: titleSize,
              lineHeight: 0.98,
              textTransform: 'uppercase',
              color: '#f7f2fb',
              textShadow: '0 0 26px rgba(169,157,224,0.7)',
            }}
          >
            {title}
          </div>
          <div style={{ display: 'flex', marginTop: 22, fontSize: 24, fontWeight: 500 }}>
            {meta}
          </div>
          {line ? (
            <div
              style={{
                display: 'flex',
                marginTop: 18,
                fontSize: 24,
                fontWeight: 500,
                color: 'rgba(229,221,237,0.82)',
                maxWidth: 640,
              }}
            >
              {line}
            </div>
          ) : null}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          right: 64,
          bottom: 48,
          display: 'flex',
          alignItems: 'flex-end',
          gap: 14,
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: 22,
            fontWeight: 500,
            letterSpacing: 3,
            color: '#a99de0',
            marginBottom: 8,
          }}
        >
          WISKI.FUN
        </div>
        <div
          style={{
            display: 'flex',
            fontFamily: 'Black Rockie',
            fontSize: 64,
            color: '#f2ecf8',
            textShadow: '0 0 18px rgba(229,221,237,0.55)',
          }}
        >
          Wiski
        </div>
      </div>
    </div>,
    { ...OG_SIZE, fonts: await loadFonts() },
  );
}
