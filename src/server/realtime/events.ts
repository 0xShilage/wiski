import 'server-only';
import { EventEmitter } from 'node:events';
import Redis from 'ioredis';
import { z } from 'zod';
import { getEnv } from '../env';
import { logger } from '../log';
import { redis } from '../redis';
import { randomToken } from '../security/crypto';

/**
 * Realtime fan-out (01 §2, 03 §6): the worker and the web process PUBLISH small JSON events on
 * Redis; each web process keeps ONE subscriber connection and fans messages out to its SSE
 * streams in memory. Payloads are schema-checked before publishing and carry no personal data.
 */
const orderStatus = z.enum([
  'PENDING_PAYMENT',
  'PAID',
  'SCHEDULED',
  'WATCHING',
  'COMPLETED',
  'EXPIRED',
  'CANCELLED',
  'NEEDS_ATTENTION',
  'REFUND_PENDING',
  'REFUNDED',
]);

export const orderEventSchema = z
  .object({
    type: z.literal('status'),
    code: z.string().regex(/^WF-[0-9A-Z]{6}$/),
    status: orderStatus,
    at: z.iso.datetime(),
  })
  .strict();

export const campaignEventSchema = z
  .object({
    type: z.literal('progress'),
    raisedCents: z.int().nonnegative(),
    remainingCents: z.int().nonnegative(),
    supporterCount: z.int().nonnegative(),
    state: z.enum(['OPEN', 'PAUSED', 'FUNDED', 'SCHEDULED', 'WATCHED']),
    at: z.iso.datetime(),
  })
  .strict();

export type OrderEvent = z.infer<typeof orderEventSchema>;
export type CampaignEvent = z.infer<typeof campaignEventSchema>;

export const channel = {
  order: (orderId: string) => `wf:order:${orderId}`,
  campaign: (campaignId: string) => `wf:campaign:${campaignId}`,
};

/** Best effort: a lost event only delays the page until its next poll. */
export async function publishOrder(orderId: string, event: OrderEvent): Promise<void> {
  await publish(channel.order(orderId), orderEventSchema.parse(event));
}
export async function publishCampaign(campaignId: string, event: CampaignEvent): Promise<void> {
  await publish(channel.campaign(campaignId), campaignEventSchema.parse(event));
}

async function publish(name: string, payload: unknown): Promise<void> {
  try {
    await redis().publish(name, JSON.stringify(payload));
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : 'unknown' }, 'realtime publish failed');
  }
}

// ── subscriber side (web process) ─────────────────────────────────────────────

const g = globalThis as unknown as {
  __wfSub?: { conn: Redis; bus: EventEmitter; counts: Map<string, number> } | undefined;
};

function hub() {
  if (!g.__wfSub) {
    const conn = new Redis(getEnv().REDIS_URL, {
      lazyConnect: false,
      maxRetriesPerRequest: null,
      retryStrategy: (n) => Math.min(n * 200, 2_000),
    });
    const bus = new EventEmitter();
    bus.setMaxListeners(0);
    conn.on('message', (ch: string, msg: string) => bus.emit(ch, msg));
    conn.on('error', (err) => logger.warn({ err: err.message }, 'realtime subscriber error'));
    g.__wfSub = { conn, bus, counts: new Map() };
  }
  return g.__wfSub;
}

export function subscribe(name: string, listener: (raw: string) => void): () => void {
  const h = hub();
  const n = h.counts.get(name) ?? 0;
  if (n === 0) void h.conn.subscribe(name).catch(() => {});
  h.counts.set(name, n + 1);
  h.bus.on(name, listener);
  return () => {
    h.bus.off(name, listener);
    const left = (h.counts.get(name) ?? 1) - 1;
    if (left <= 0) {
      h.counts.delete(name);
      void h.conn.unsubscribe(name).catch(() => {});
    } else h.counts.set(name, left);
  };
}

export async function closeRealtime(): Promise<void> {
  g.__wfSub?.conn.disconnect();
  g.__wfSub = undefined;
}

// ── SSE ────────────────────────────────────────────────────────────────────────

export const HEARTBEAT_MS = 20_000; // Cloudflare's idle timeout is 100 s
const MAX_STREAM_MS = 10 * 60_000; // the browser's EventSource reconnects by itself

export type SseOptions = {
  /** the stream's concurrency slot: renewed on every heartbeat, released once at the end */
  slot?: StreamSlot;
  /** frames sent right after `initial` (e.g. alerts replayed after a reconnect) */
  replay?: string[];
};

/**
 * An SSE response that sends `initial`, then every message on `name`, a heartbeat every 20 s,
 * and closes after 10 minutes (EventSource reconnects with `retry: 3000`). The heartbeat is a
 * named `ping` event carrying the server time (2026-11-05): a client can see it — an overlay
 * reconnects when pings stop, which catches a connection that died without closing — while
 * clients that don't listen for `ping` never notice it. The slot is released exactly once.
 */
export function sseResponse(
  req: Request,
  name: string,
  initial: unknown,
  opts: SseOptions = {},
): Response {
  const release = () => opts.slot?.release();
  const enc = new TextEncoder();
  let cleanup: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const timers: {
        hb?: ReturnType<typeof setInterval>;
        limit?: ReturnType<typeof setTimeout>;
      } = {};
      let unsubscribe: () => void = () => {};
      const send = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(text));
        } catch {
          end();
        }
      };
      const end = () => {
        if (closed) return;
        closed = true;
        clearInterval(timers.hb);
        clearTimeout(timers.limit);
        unsubscribe();
        req.signal.removeEventListener('abort', end);
        release();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      cleanup = end;
      const ping = () =>
        send(`event: ping\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
      send(`retry: 3000\n\n`);
      send(`data: ${JSON.stringify(initial)}\n\n`);
      for (const frame of opts.replay ?? []) send(frame);
      ping();
      if (closed) return;
      unsubscribe = subscribe(name, (raw) => send(`data: ${raw}\n\n`));
      timers.hb = setInterval(() => {
        ping();
        opts.slot?.renew();
      }, HEARTBEAT_MS);
      timers.limit = setTimeout(end, MAX_STREAM_MS);
      if (req.signal.aborted) end();
      else req.signal.addEventListener('abort', end);
    },
    cancel() {
      cleanup?.();
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  });
}

/**
 * Concurrent streams per key (05 §9). 2026-11-05: a lease per stream instead of a counter. Each
 * stream is a member of a sorted set scored by its last heartbeat; members older than LEASE_MS
 * are dropped before counting. Before, a counter went up on connect and down on close — a deploy
 * or crash never ran the "down", every reconnect refreshed the key's expiry, and the leaked count
 * kept OBS overlays refused ("busy") until nobody had tried for 15 minutes.
 */
export const LEASE_MS = 3 * HEARTBEAT_MS;
export type StreamSlot = { release(): void; renew(): void };
const NO_SLOT: StreamSlot = { release() {}, renew() {} };

const ACQUIRE = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local lease = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - lease)
if redis.call('ZCARD', key) >= max then return 0 end
redis.call('ZADD', key, now, ARGV[4])
redis.call('PEXPIRE', key, lease * 2)
return 1
`;

export async function acquireStreamSlot(
  key: string,
  max: number,
  now = () => Date.now(),
): Promise<StreamSlot | null> {
  const k = `sse:${key}`;
  const id = randomToken(9);
  try {
    const ok = await redis().eval(ACQUIRE, 1, k, now(), LEASE_MS, max, id);
    if (ok !== 1) return null;
  } catch {
    return NO_SLOT; // Redis down: streams can't work anyway; let polling take over
  }
  let done = false;
  return {
    release() {
      if (done) return;
      done = true;
      void redis()
        .zrem(k, id)
        .catch(() => {});
    },
    renew() {
      if (done) return;
      void redis()
        .zadd(k, 'XX', now(), id)
        .then(() => redis().pexpire(k, LEASE_MS * 2))
        .catch(() => {});
    },
  };
}
