import { bingoDay } from '@/lib/bingo';
import { db } from '@/server/db';
import { Problems } from '@/server/http/problem';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { acquireStreamSlot, channel, sseResponse } from '@/server/realtime/events';

/**
 * GET /api/v1/bingo/events — SSE (2026-11-18): a small event each time today's bingo changes (a
 * call, a bingo, the item texts), so /bingo re-reads it at once instead of waiting for its poll.
 * Public counts only; ≤ 5 streams per IP, shared with the other public streams.
 */
export const GET = route<'public'>(
  { methods: ['GET'], access: 'public', rateLimit: RL.events },
  async ({ req, ipKey }) => {
    const slot = await acquireStreamSlot(`ip:${ipKey}`, 5);
    if (!slot) throw Problems.rateLimited(30);
    const now = new Date();
    const day = bingoDay(now);
    const [called, winners] = await Promise.all([
      db().bingoCall.count({ where: { day } }),
      db().bingoWin.count({ where: { day } }),
    ]);
    return sseResponse(
      req,
      channel.bingo,
      {
        type: 'bingo',
        day: day.toISOString().slice(0, 10),
        called,
        winners,
        at: now.toISOString(),
      },
      { slot },
    );
  },
);
