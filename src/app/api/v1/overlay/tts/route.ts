import { z } from 'zod';
import { Problems } from '@/server/http/problem';
import { route } from '@/server/http/route';
import { voiceOf } from '@/server/overlay/alerts';
import { overlayAccess } from '@/server/overlay/keys';
import { RL } from '@/server/ratelimit/rules';

const query = z.object({ id: z.string().regex(/^\d{13}-[\w-]{6,16}$/) }).strict();

/**
 * GET /api/v1/overlay/tts?id=<alert id> — the spoken "Novo patrocínio" (MP3, 2026-11-09). Overlay
 * cookie with the "patrocinio" widget; kept 10 minutes after the alert.
 */
export const GET = route<'public', undefined, typeof query>(
  { methods: ['GET'], access: 'public', rateLimit: RL.overlayStream, query },
  async ({ req, query: q }) => {
    if (!(await overlayAccess(req, 'patrocinio'))) throw Problems.unauthenticated();
    const mp3 = await voiceOf(q.id);
    if (!mp3) throw Problems.notFound();
    return new Response(new Uint8Array(mp3), {
      headers: {
        'content-type': 'audio/mpeg',
        'content-length': String(mp3.length),
        'cache-control': 'private, max-age=600',
      },
    });
  },
);
