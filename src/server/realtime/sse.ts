import 'server-only';
import Redis from 'ioredis';
import { getEnv } from '../env';
import { logger } from '../log';

/**
 * Server-Sent Events over Redis pub/sub (01 §3.2, 03 §6). One subscriber connection per web
 * process fans messages out to the open streams. Streams send a heartbeat every 20 s (Cloudflare
 * closes idle connections at 100 s), tell the browser to retry after 3 s, and end after 15 min
 * (EventSource reconnects by itself). Pages also poll every 4 s when SSE isn't available.
 */
type Listener = (message: string) => void;

const g = globalThis as unknown as {
  __wfSub?: { redis: Redis; listeners: Map<string, Set<Listener>> } | undefined;
  __wfSseOpen?: Map<string, number> | undefined;
};

function hub() {
  if (!g.__wfSub) {
    const redis = new Redis(getEnv().REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
    const listeners = new Map<string, Set<Listener>>();
    redis.on('message', (ch: string, msg: string) => {
      for (const l of listeners.get(ch) ?? []) l(msg);
    });
    redis.on('error', (err) => logger.warn({ err: err.message }, 'sse subscriber error'));
    g.__wfSub = { redis, listeners };
  }
  return g.__wfSub;
}

function subscribe(channel: string, listener: Listener): () => void {
  const h = hub();
  let set = h.listeners.get(channel);
  if (!set) {
    set = new Set();
    h.listeners.set(channel, set);
    h.redis
      .subscribe(channel)
      .catch((err: unknown) =>
        logger.warn({ err: err instanceof Error ? err.message : 'unknown' }, 'subscribe failed'),
      );
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) {
      h.listeners.delete(channel);
      h.redis.unsubscribe(channel).catch(() => {});
    }
  };
}

const MAX_STREAMS_PER_IP = 6;
const HEARTBEAT_MS = 20_000;
const MAX_LIFETIME_MS = 15 * 60_000;

export function sseResponse(
  req: Request,
  opts: { channel: string; event: string; initial: unknown; ipKey: string },
): Response {
  g.__wfSseOpen ??= new Map();
  const open = g.__wfSseOpen;
  const current = open.get(opts.ipKey) ?? 0;
  if (current >= MAX_STREAMS_PER_IP) {
    return new Response(null, { status: 429, headers: { 'retry-after': '30' } });
  }
  open.set(opts.ipKey, current + 1);

  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          cleanup();
        }
      };
      send(`retry: 3000\n\n`);
      send(`event: ${opts.event}\ndata: ${JSON.stringify(opts.initial)}\n\n`);
      const unsub = subscribe(opts.channel, (msg) =>
        send(`event: ${opts.event}\ndata: ${msg}\n\n`),
      );
      const beat = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS);
      const end = setTimeout(() => cleanup(), MAX_LIFETIME_MS);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(beat);
        clearTimeout(end);
        unsub();
        const n = (open.get(opts.ipKey) ?? 1) - 1;
        if (n <= 0) open.delete(opts.ipKey);
        else open.set(opts.ipKey, n);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      req.signal.addEventListener('abort', () => cleanup(), { once: true });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      // nginx: don't buffer this response (05 §7; the SSE location also sets proxy_buffering off)
      'x-accel-buffering': 'no',
    },
  });
}
