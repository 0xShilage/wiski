import 'server-only';
import { isIP } from 'node:net';
import { getEnv } from '../env';
import { hmacSha256 } from './crypto';

/**
 * Client IP (05 §9). nginx sets X-Real-IP from CF-Connecting-IP, trusting it only from
 * Cloudflare ranges (real_ip module). The app trusts exactly that one header and nothing the
 * client could append to (never the left-most X-Forwarded-For).
 */
export function clientIp(headers: Headers): string | null {
  const { CLIENT_IP_HEADER } = getEnv();
  if (CLIENT_IP_HEADER === 'none') return null;
  const value = headers.get(CLIENT_IP_HEADER)?.trim();
  if (!value || value.length > 45 || isIP(value) === 0) return null;
  return value;
}

/** Rate-limit bucket: IPv4 as-is, IPv6 by /64 (one customer usually owns a whole /64). */
export function ipBucket(ip: string): string {
  if (isIP(ip) !== 6) return ip;
  const [head = '', tail] = ip.split('::');
  const left = head.split(':').filter(Boolean);
  const right = tail === undefined ? [] : tail.split(':').filter(Boolean);
  const full = [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right];
  return `${full
    .slice(0, 4)
    .map((h) => h.padStart(4, '0').toLowerCase())
    .join(':')}::/64`;
}

/** Keyed HMAC of the IP bucket: used in Redis keys and logs, never the raw address (LGPD). */
export function ipKey(ip: string | null): string {
  if (!ip) return 'unknown';
  return hmacSha256(getEnv().IP_HASH_SECRET, `ip:${ipBucket(ip)}`)
    .subarray(0, 12)
    .toString('base64url');
}
