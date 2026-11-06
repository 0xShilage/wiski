import { z } from 'zod';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { chatAnswer, type PopWidget, showOverlay } from '@/server/overlay/show';
import { type CommandAction, runCommand, verifyCommandKey } from '@/server/subathon/command';

/**
 * GET /api/v1/subathon/command?a=pause|resume|status&k=<key> — the StreamElements chat command
 * (2026-11-04). Called by StreamElements' customapi (GET only, no headers): the key in the query
 * is the credential (hashed in the database; the query string is never logged). The answer is one
 * line of plain text that the chatbot posts in chat. A wrong or revoked key is 401.
 * 2026-11-06: `a=agora` / `a=fila` (!agora, !fila) show that overlay for two minutes and answer
 * with what is playing / the next titles. Same key, so a copy of !tempo with another `a=` works.
 */
const SHOW: Record<string, PopWidget> = { agora: 'agora', fila: 'fila' };
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
    a: z.enum([...Object.keys(ACTION), ...Object.keys(SHOW)] as [string, ...string[]]),
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
    const widget = SHOW[q.a];
    let text: string;
    if (widget) {
      await verifyCommandKey(q.k);
      await showOverlay(widget);
      text = await chatAnswer(widget);
    } else text = await runCommand(q.k, ACTION[q.a]!);
    return new Response(text, {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  },
);
