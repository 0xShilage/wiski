import 'server-only';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';

/**
 * Environment validation (05 §12). Parsed once at boot (src/instrumentation.ts) and on first use.
 * The process refuses to start on a missing or malformed value. Error messages name the variable
 * and the rule — never the value — so secrets cannot leak into logs.
 */

/** Cloudflare's documented Turnstile test keys ("always passes"). Allowed outside production only. */
export const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';
export const TURNSTILE_TEST_SECRET_KEY = '1x0000000000000000000000000000000AA';

const PLACEHOLDER = /CHANGE_ME/i;

/** ≥ 256-bit secret, base64url (generate with `openssl rand -base64 32 | tr '+/' '-_' | tr -d =`). */
const secret256 = z
  .string()
  .regex(/^[\w-]{43,128}$/, 'must be ≥ 32 random bytes, base64url-encoded (43+ chars)');

/** Exactly 32 bytes (AES-256 key), base64url. */
const aesKey = z
  .string()
  .regex(/^[\w-]{43}$/, 'must be exactly 32 random bytes, base64url-encoded (43 chars)');

const digits = z.string().regex(/^\d{6,20}$/, 'must be the numeric id from Mercado Pago');

// Empty values (`KEY=`) are treated as unset before parsing (see parseEnv).
const optional = <T extends z.ZodType>(schema: T) => schema.optional();

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    APP_ORIGIN: z.url({ protocol: /^https?$/ }),
    DATABASE_URL: z.string().regex(/^postgres(?:ql)?:\/\/\S+$/, 'must be a postgresql:// URL'),
    REDIS_URL: z.string().regex(/^rediss?:\/\/\S+$/, 'must be a redis:// or rediss:// URL'),

    CSRF_SECRET: secret256,
    COOKIE_SEAL_KEY: aesKey,
    COOKIE_SEAL_KEY_PREVIOUS: optional(aesKey),
    IP_HASH_SECRET: secret256,
    /**
     * Encrypts the authenticator-app (TOTP) secrets at rest and keys the recovery-code HMAC.
     * Required in production; development/test derive one from CSRF_SECRET when it is unset.
     * Changing it means every moderator sets up the authenticator again.
     */
    TOTP_ENCRYPTION_KEY: optional(aesKey),
    /** Header carrying the real client IP. nginx sets X-Real-IP from CF-Connecting-IP (05 §9). */
    CLIENT_IP_HEADER: z.enum(['x-real-ip', 'none']).default('x-real-ip'),

    GOOGLE_CLIENT_ID: optional(
      z
        .string()
        .regex(/^[\w-]+\.apps\.googleusercontent\.com$/, 'must be a Google OAuth client id'),
    ),
    GOOGLE_CLIENT_SECRET: optional(z.string().min(16).max(256)),
    GOOGLE_ISSUER: z.url().default('https://accounts.google.com'),

    TURNSTILE_SITE_KEY: z.string().min(10).max(100).default(TURNSTILE_TEST_SITE_KEY),
    TURNSTILE_SECRET_KEY: z.string().min(10).max(100).default(TURNSTILE_TEST_SECRET_KEY),

    // Mercado Pago (Phase 2). IDs are not secret; tokens are. Test and production apps have
    // different ids — the access token must belong to MP_COLLECTOR_ID (checked below).
    MP_COLLECTOR_ID: optional(digits),
    MP_APPLICATION_ID: optional(digits),
    MP_ACCESS_TOKEN: optional(
      z.string().regex(/^(?:APP_USR|TEST)-[\w-]{20,200}$/, 'must be a Mercado Pago access token'),
    ),
    MP_WEBHOOK_SECRET: optional(z.string().min(16).max(256)),
    MP_WEBHOOK_SECRET_PREVIOUS: optional(z.string().min(16).max(256)),
    /** DEVELOPMENT ONLY: a Mercado Pago test buyer's e-mail sent as the Pix payer. With test
     *  credentials MP refuses any real payer e-mail ("Unauthorized use of live credentials"). */
    MP_TEST_PAYER_EMAIL: optional(z.email().max(254)),
    /** DEVELOPMENT ONLY ("1"): let `npm run dev` use PRODUCTION Mercado Pago credentials, for a
     *  real-money Pix test. Real charges; refund them from the dashboard. Refused elsewhere. */
    MP_ALLOW_LIVE_IN_DEV: optional(z.enum(['1'])),

    /** Processed images (11 §5). Production: the Docker volume /var/lib/wiski/media, served by
     *  nginx at /media/. Development/test default: <cwd>/.media (served by the app). */
    MEDIA_DIR: optional(
      z
        .string()
        .max(400)
        .refine((p) => isAbsolute(p), 'must be an absolute path')
        .refine((p) => !/[\0\n\r]/.test(p), 'must not contain control characters'),
    ),

    LOG_LEVEL: z
      .enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace'])
      .default('info'),
  })
  .superRefine((env, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    const prod = env.NODE_ENV === 'production';

    // Canonical origin: scheme + host (+ port), nothing else.
    const origin = new URL(env.APP_ORIGIN);
    if (origin.origin !== env.APP_ORIGIN) {
      issue(
        'APP_ORIGIN',
        'must be an origin only, e.g. https://wiski.fun (no path or trailing slash)',
      );
    }
    const isLocal = origin.hostname === 'localhost' || origin.hostname === '127.0.0.1';
    if (origin.protocol !== 'https:' && (prod || !isLocal)) {
      issue('APP_ORIGIN', 'must use https (http is allowed for localhost outside production only)');
    }

    if (new URL(env.GOOGLE_ISSUER).protocol !== 'https:' && env.NODE_ENV !== 'test') {
      issue('GOOGLE_ISSUER', 'must use https');
    }
    if ((env.GOOGLE_CLIENT_ID === undefined) !== (env.GOOGLE_CLIENT_SECRET === undefined)) {
      issue(
        'GOOGLE_CLIENT_SECRET',
        'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together',
      );
    }

    // Distinct keys: one leaked secret must not unlock another purpose.
    const keys = [env.CSRF_SECRET, env.COOKIE_SEAL_KEY, env.IP_HASH_SECRET];
    if (env.TOTP_ENCRYPTION_KEY) keys.push(env.TOTP_ENCRYPTION_KEY);
    if (new Set(keys).size !== keys.length) {
      issue(
        'CSRF_SECRET',
        'CSRF_SECRET, COOKIE_SEAL_KEY, IP_HASH_SECRET and TOTP_ENCRYPTION_KEY must all differ',
      );
    }

    for (const [key, value] of Object.entries(env)) {
      if (typeof value === 'string' && PLACEHOLDER.test(value)) {
        issue(key, 'still contains a placeholder from .env.example');
      }
    }

    if (
      env.MP_ACCESS_TOKEN &&
      env.MP_COLLECTOR_ID &&
      !env.MP_ACCESS_TOKEN.endsWith(`-${env.MP_COLLECTOR_ID}`)
    ) {
      issue(
        'MP_COLLECTOR_ID',
        'does not match the account of MP_ACCESS_TOKEN (test vs production ids?)',
      );
    }

    if (env.MP_ALLOW_LIVE_IN_DEV && env.NODE_ENV !== 'development') {
      issue('MP_ALLOW_LIVE_IN_DEV', 'is only for npm run dev; remove it');
    }
    if (env.MP_ALLOW_LIVE_IN_DEV && env.MP_TEST_PAYER_EMAIL) {
      issue(
        'MP_TEST_PAYER_EMAIL',
        'must be empty with MP_ALLOW_LIVE_IN_DEV (real payments, real payer)',
      );
    }

    if (prod && env.MP_TEST_PAYER_EMAIL) {
      issue('MP_TEST_PAYER_EMAIL', 'is for development only (test buyer); remove it in production');
    }

    if (prod) {
      if (!env.GOOGLE_CLIENT_ID) issue('GOOGLE_CLIENT_ID', 'is required in production');
      if (!env.TOTP_ENCRYPTION_KEY) issue('TOTP_ENCRYPTION_KEY', 'is required in production');
      if (env.GOOGLE_ISSUER !== 'https://accounts.google.com') {
        issue('GOOGLE_ISSUER', 'must be https://accounts.google.com in production');
      }
      if (
        env.TURNSTILE_SITE_KEY === TURNSTILE_TEST_SITE_KEY ||
        env.TURNSTILE_SECRET_KEY === TURNSTILE_TEST_SECRET_KEY ||
        env.TURNSTILE_SECRET_KEY.startsWith('1x') ||
        env.TURNSTILE_SECRET_KEY.startsWith('2x') ||
        env.TURNSTILE_SECRET_KEY.startsWith('3x')
      ) {
        issue('TURNSTILE_SECRET_KEY', 'Cloudflare test keys are not allowed in production');
      }
      if (!env.MEDIA_DIR)
        issue('MEDIA_DIR', 'is required in production (e.g. /var/lib/wiski/media)');
      if (env.MP_ACCESS_TOKEN) {
        if (!env.MP_ACCESS_TOKEN.startsWith('APP_USR-')) {
          issue('MP_ACCESS_TOKEN', 'production requires an APP_USR- access token');
        }
        if (!env.MP_COLLECTOR_ID) issue('MP_COLLECTOR_ID', 'is required with MP_ACCESS_TOKEN');
        if (!env.MP_WEBHOOK_SECRET) issue('MP_WEBHOOK_SECRET', 'is required with MP_ACCESS_TOKEN');
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid environment:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'EnvError';
  }
}

/** Parse an env-like object. Throws EnvError listing variable names and rules (never values). */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ''),
  );
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new EnvError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return Object.freeze(result.data);
}

let cached: Env | undefined;

/** Validated environment of this process (memoised). */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Test helper: forget the memoised env after changing process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}

/** Absolute media directory (MEDIA_DIR, or <cwd>/.media outside production). */
export function mediaDir(env: Env = getEnv()): string {
  return env.MEDIA_DIR ?? join(process.cwd(), '.media');
}

export function isGoogleLoginConfigured(env: Env = getEnv()): boolean {
  return env.GOOGLE_CLIENT_ID !== undefined && env.GOOGLE_CLIENT_SECRET !== undefined;
}
