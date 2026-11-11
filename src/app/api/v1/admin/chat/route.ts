import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { chatPanel, chatSayInput, sendChat } from '@/server/chat/say';

/**
 * GET /api/v1/admin/chat — Chat da live (2026-11-11): whether the bot is set up, the live state,
 * what the placeholders say now, the saved messages and the last messages sent.
 */
export const GET = route<'moderator'>(
  { methods: ['GET'], access: 'moderator', rateLimit: RL.admin },
  async () => chatPanel(),
);

/** POST /api/v1/admin/chat — send one message to the Twitch chat as the StreamElements bot. */
export const POST = route<'moderator', typeof chatSayInput>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.chatSay, body: chatSayInput },
  async ({ user, requestId, body }) =>
    Response.json({ sent: await sendChat({ actor: user, requestId }, body.text) }, { status: 201 }),
);
