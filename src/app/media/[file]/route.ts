import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mediaDir } from '@/server/env';
import { Problems } from '@/server/http/problem';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

const NAME = /^[0-9a-f]{32}-\d{2,4}\.(avif|webp)$/;
const TYPES = { avif: 'image/avif', webp: 'image/webp' } as const;

/**
 * GET /media/[file] — DEVELOPMENT ONLY. In production nginx serves MEDIA_DIR at /media/ directly
 * (docker/nginx/snippets/media.conf) and this route answers 404: the app never serves user
 * images there. Same name allow-list and headers as nginx.
 */
export const GET = route<'public', undefined, undefined, { file: string }>(
  { methods: ['GET'], access: 'public', rateLimit: RL.catalogRead },
  async ({ params }) => {
    if (process.env.NODE_ENV === 'production') throw Problems.notFound();
    const m = NAME.exec(params.file ?? '');
    if (!m) throw Problems.notFound();
    let data: Buffer;
    try {
      data = await readFile(join(mediaDir(), m[0]));
    } catch {
      throw Problems.notFound();
    }
    return new Response(new Uint8Array(data), {
      headers: {
        'content-type': TYPES[m[1] as keyof typeof TYPES],
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; frame-ancestors 'none'; sandbox",
      },
    });
  },
);
