import { z } from 'zod';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { type CommandAction, runCommand } from '@/server/subathon/command';

/**
 * GET /api/v1/subathon/command?a=pause|resume|status&k=<key> — the StreamElements chat command
 * (2026-11-04). Called by StreamElements' customapi (GET only, no headers): the key in the query
 * is the credential (hashed in the database; the query string is never logged). The answer is one
 * line of plain text that the chatbot posts in chat. A wrong or revoked key is 401.
 */
const ACTION: Record<string, CommandAction> = {
  pause: 'pause',
  pausar: 'pause',
  resume: 'resume',
  retomar: 'resume',
  status: 'status',
  tempo: 'status',
};

const query = z
  .object({
    a: z.enum(Object.keys(ACTION) as [string, ...string[]]),
    k: z.string().min(1).max(64),
  })
  .strict();

export const GET = route<'public', undefined, typeof query>(
  {
    methods: ['GET'],
    access: 'public',
    csrf: 'none',
    rateLimit: RL.subathonCommand,
    query,
  },
  async ({ query: q }) => {
    const text = await runCommand(q.k, ACTION[q.a]!);
    return new Response(text, {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  },
);
