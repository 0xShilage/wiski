import 'server-only';
import { randomUUID } from 'node:crypto';
import { secondsFor } from '@/lib/subathon';
import { getEnv } from '../env';
import { logger } from '../log';
import { redis } from '../redis';
import { activityOf, GiftLedger, parseActivity, type SeActivity } from './se-activity';
import { applyEntry, openSubathon, ratesOf } from './timer';

/**
 * StreamElements → subathon timer (2026-11-03): one WebSocket from the worker to StreamElements'
 * real-time gateway, authenticated with the channel's JWT (STREAMELEMENTS_JWT, only in app.env),
 * subscribed to `channel.activities`. Tips, bits, subs, resubs, Prime and gift subs add time as
 * they happen; OBS doesn't need to be open. The JWT never leaves this process: it is not logged
 * and not sent to the browser.
 *
 * The connection state is kept in Redis (wf:subathon:se) for the dashboard. Events that happen
 * while the connection is down are not replayed; the dashboard shows the outage and the streamer
 * can add the time by hand.
 */
export const SE_GATEWAY = 'wss://astro.streamelements.com';
export const SE_STATUS_KEY = 'wf:subathon:se';

export type SeStatus = {
  state: 'disabled' | 'connecting' | 'connected' | 'error';
  since: string;
  lastEventAt: string | null;
  error: string | null;
};

type Frame = { type?: unknown; nonce?: unknown; error?: unknown; data?: Record<string, unknown> };

let status: SeStatus = {
  state: 'disabled',
  since: new Date().toISOString(),
  lastEventAt: null,
  error: null,
};

async function saveStatus(patch: Partial<SeStatus>): Promise<void> {
  const changed = patch.state !== undefined && patch.state !== status.state;
  status = { ...status, ...patch, ...(changed ? { since: new Date().toISOString() } : {}) };
  try {
    await redis().set(SE_STATUS_KEY, JSON.stringify(status), 'EX', 180);
  } catch {
    /* Redis down: the dashboard shows "unknown" */
  }
}

/** For the dashboard: the worker's last report (null when the worker hasn't reported lately). */
export async function readSeStatus(): Promise<SeStatus | null> {
  try {
    const raw = await redis().get(SE_STATUS_KEY);
    return raw ? (JSON.parse(raw) as SeStatus) : null;
  } catch {
    return null;
  }
}

const gifts = new GiftLedger();

/**
 * The channel id ("room") from the JWT's payload (`channel` claim), for the subscribe message.
 * Only read, never verified: StreamElements checks the token itself. null when absent.
 */
export function seChannelOf(token: string): string | null {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as {
      channel?: unknown;
    };
    return typeof payload.channel === 'string' && /^[\w-]{1,64}$/.test(payload.channel)
      ? payload.channel
      : null;
  } catch {
    return null;
  }
}

/** Credit one activity on the open subathon (exported for tests). */
export async function handleActivity(a: SeActivity, ledger = gifts, now = new Date()) {
  const s = await openSubathon();
  if (!s) return 'closed' as const;
  const parsed = parseActivity(a, ratesOf(s));
  if (!parsed) return 'ignored' as const;
  let { valueCents } = parsed.credit;
  if (parsed.gift) {
    const n = ledger.giftsToCredit(parsed.gift, now.getTime());
    if (!n) return 'ignored' as const;
    if (parsed.gift.role === 'purchase')
      valueCents = Math.round((valueCents * n) / parsed.gift.count);
  }
  const out = await applyEntry(
    {
      ...parsed.credit,
      valueCents,
      seconds: secondsFor(valueCents, s.secondsPerReal),
    },
    now,
    { subathonId: s.id },
  );
  return out.result;
}

/**
 * Start the connection (worker only). Returns a stop function. Without STREAMELEMENTS_JWT the
 * connector stays off and says so on the dashboard.
 */
export function startStreamElements(): () => void {
  const token = getEnv().STREAMELEMENTS_JWT;
  if (!token) {
    void saveStatus({ state: 'disabled', error: null });
    logger.info('streamelements connector off (no STREAMELEMENTS_JWT)');
    const t = setInterval(() => void saveStatus({}), 60_000);
    return () => clearInterval(t);
  }

  const room = seChannelOf(token);
  let ws: WebSocket | null = null;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let reconnectToken: string | null = null;
  let seen = 0; // shapes of the first activities are logged (field names only) to check parsing
  let chain: Promise<unknown> = Promise.resolve();
  const beat = setInterval(() => void saveStatus({}), 60_000);

  const schedule = (ms: number) => {
    if (stopped) return;
    if (retry) clearTimeout(retry);
    retry = setTimeout(connect, ms);
  };

  function connect() {
    if (stopped) return;
    void saveStatus({ state: 'connecting' });
    // a reconnect token restores the subscription on the new server; otherwise subscribe on open
    const resuming = reconnectToken !== null;
    const url = resuming
      ? `${SE_GATEWAY}/?reconnect_token=${encodeURIComponent(reconnectToken!)}`
      : SE_GATEWAY;
    reconnectToken = null;
    let unauthorized = false;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : 'unknown' },
        'streamelements connect failed',
      );
      schedule(Math.min(60_000, 2_000 * 2 ** Math.min(attempt++, 5)));
      return;
    }
    ws.onopen = () => {
      if (resuming) return;
      ws?.send(
        JSON.stringify({
          type: 'subscribe',
          nonce: randomUUID(),
          data: {
            topic: 'channel.activities',
            ...(room ? { room } : {}),
            token,
            token_type: 'jwt',
          },
        }),
      );
    };
    ws.onmessage = (ev) => {
      let f: Frame;
      try {
        f = JSON.parse(String(ev.data)) as Frame;
      } catch {
        return;
      }
      if (f.type === 'welcome') {
        if (resuming) {
          attempt = 0;
          void saveStatus({ state: 'connected', error: null });
        }
        return;
      }
      if (f.type === 'response') {
        const error =
          (typeof f.error === 'string' && f.error) ||
          (typeof f.data?.error === 'string' && f.data.error) ||
          null;
        if (error) {
          unauthorized = error === 'err_unauthorized';
          logger.warn({ error }, 'streamelements subscribe refused');
          void saveStatus({
            state: 'error',
            error: unauthorized
              ? 'Token do StreamElements recusado (confira o STREAMELEMENTS_JWT).'
              : `StreamElements recusou: ${error}`,
          });
          ws?.close();
        } else {
          attempt = 0;
          logger.info('streamelements subscribed to channel.activities');
          void saveStatus({ state: 'connected', error: null });
        }
        return;
      }
      if (f.type === 'reconnect') {
        const t = f.data?.reconnect_token;
        if (typeof t === 'string' && t.length < 2048) reconnectToken = t;
        return;
      }
      const a = activityOf(f);
      if (!a) return;
      if (seen < 20) {
        seen++;
        logger.info(
          { type: a.type, provider: a.provider, fields: Object.keys(a.data).slice(0, 30) },
          'streamelements activity shape',
        );
      }
      // one at a time, in arrival order (gift de-duplication depends on it)
      chain = chain
        .then(async () => {
          const result = await handleActivity(a);
          if (result === 'applied') await saveStatus({ lastEventAt: new Date().toISOString() });
          if (result !== 'ignored')
            logger.info({ type: a.type, result }, 'streamelements activity');
        })
        .catch((err: unknown) =>
          logger.error(
            { err: err instanceof Error ? err.message : 'unknown', type: a.type },
            'streamelements activity failed',
          ),
        );
    };
    ws.onerror = () => {
      /* onclose follows */
    };
    ws.onclose = () => {
      ws = null;
      if (stopped) return;
      if (!unauthorized)
        void saveStatus({ state: 'connecting', error: 'Conexão perdida; reconectando…' });
      // a refused token is retried slowly (the streamer has to fix app.env and restart anyway)
      schedule(
        unauthorized
          ? 5 * 60_000
          : reconnectToken
            ? 500
            : Math.min(60_000, 2_000 * 2 ** Math.min(attempt++, 5)),
      );
    };
  }

  connect();
  return () => {
    stopped = true;
    clearInterval(beat);
    if (retry) clearTimeout(retry);
    ws?.close();
  };
}
