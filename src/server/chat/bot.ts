import 'server-only';
import { getEnv } from '../env';
import { logger } from '../log';
import { redis } from '../redis';

/**
 * The StreamElements chat bot (2026-11-09, moved here 2026-11-11): one line posted to the Twitch
 * chat with `POST /kappa/v2/bot/{channel}/say`, authenticated with the channel's JWT
 * (STREAMELEMENTS_JWT, only in app.env; never logged, never sent to a browser). Used by the
 * sponsorship thank-you (overlay/alerts.ts) and the dashboard's "Chat da live" (chat/say.ts).
 * The bot has to be in the channel (StreamElements dashboard → Chatbot → "Join channel").
 */
const SE_API = 'https://api.streamelements.com/kappa/v2';
const CHANNEL_CACHE = 'wf:se:channel';

export type BotResult =
  | { ok: true }
  | { ok: false; reason: 'not-configured' | 'no-channel' | 'unreachable' }
  | { ok: false; reason: 'rejected'; status: number };

export function chatBotConfigured(): boolean {
  return !!getEnv().STREAMELEMENTS_JWT;
}

/** The StreamElements channel id: from the JWT's `channel` claim, else GET /channels/me. */
async function channelId(jwt: string): Promise<string | null> {
  try {
    const claim = JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString('utf8')) as {
      channel?: unknown;
    };
    if (typeof claim.channel === 'string' && /^[a-f0-9]{24}$/.test(claim.channel)) {
      return claim.channel;
    }
  } catch {
    /* not a readable JWT payload: ask the API */
  }
  const cached = await redis()
    .get(CHANNEL_CACHE)
    .catch(() => null);
  if (cached) return cached;
  const res = await fetch(`${SE_API}/channels/me`, {
    headers: { authorization: `Bearer ${jwt}`, accept: 'application/json' },
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) return null;
  const me = (await res.json()) as { _id?: unknown };
  if (typeof me._id !== 'string' || !/^[a-f0-9]{24}$/.test(me._id)) return null;
  await redis()
    .set(CHANNEL_CACHE, me._id, 'EX', 86_400)
    .catch(() => {});
  return me._id;
}

/** Posts one line as the bot. Never throws; the result says what happened. */
export async function botSay(line: string): Promise<BotResult> {
  const jwt = getEnv().STREAMELEMENTS_JWT;
  if (!jwt) return { ok: false, reason: 'not-configured' };
  try {
    const channel = await channelId(jwt);
    if (!channel) {
      logger.warn('chat bot: no StreamElements channel id');
      return { ok: false, reason: 'no-channel' };
    }
    const res = await fetch(`${SE_API}/bot/${channel}/say`, {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: line }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'chat bot: message refused');
      return { ok: false, reason: 'rejected', status: res.status };
    }
    return { ok: true };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.name : 'unknown' }, 'chat bot: unreachable');
    return { ok: false, reason: 'unreachable' };
  }
}
