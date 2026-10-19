import 'server-only';
import type Redis from 'ioredis';
import { randomToken } from '../security/crypto';

/**
 * Sliding-window log rate limiter (Redis sorted set, one atomic Lua call per check).
 * Exact over the window; rejected attempts are not recorded, so a blocked client recovers as
 * soon as old attempts age out.
 */
const SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry = window
  if oldest[2] then retry = window - (now - tonumber(oldest[2])) end
  return {0, count, retry}
end
redis.call('ZADD', key, now, ARGV[4])
redis.call('PEXPIRE', key, window)
return {1, count + 1, 0}
`;

export type RateLimitResult = { allowed: boolean; count: number; retryAfterMs: number };

export async function hit(
  client: Redis,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): Promise<RateLimitResult> {
  const res = (await client.eval(
    SCRIPT,
    1,
    key,
    now,
    windowMs,
    limit,
    `${now}:${randomToken(6)}`,
  )) as [number, number, number];
  return { allowed: res[0] === 1, count: res[1], retryAfterMs: Math.max(0, res[2]) };
}
