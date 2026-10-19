import 'server-only';
import Redis from 'ioredis';
import { getEnv } from './env';
import { logger } from './log';

const globalForRedis = globalThis as unknown as { __wfRedis?: Redis | undefined };

/**
 * Shared Redis connection. Commands issued while (re)connecting are queued, but every command
 * times out after 2 s, so an unreachable Redis surfaces quickly as an error: callers decide
 * whether that fails closed (rate limits on mutations) or open.
 */
export function redis(): Redis {
  if (!globalForRedis.__wfRedis) {
    const client = new Redis(getEnv().REDIS_URL, {
      lazyConnect: false,
      enableOfflineQueue: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      commandTimeout: 2_000,
      retryStrategy: (attempt) => Math.min(attempt * 200, 2_000),
    });
    client.on('error', (err) => logger.warn({ err: err.message }, 'redis error'));
    globalForRedis.__wfRedis = client;
  }
  return globalForRedis.__wfRedis;
}

export async function disconnectRedis(): Promise<void> {
  globalForRedis.__wfRedis?.disconnect();
  globalForRedis.__wfRedis = undefined;
}
