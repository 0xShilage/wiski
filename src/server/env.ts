import 'server-only';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';

/**
 * Environment validation (05 §12). Parsed once at boot (src/instrumentation.ts) and on first use.
 * The process refuses to start on a missing or malformed value. Error messages name the variable
 * and the rule — never the value — so secrets cannot leak into logs.
 */

export const MP_API_DEFAULT = 'https://api.mercadopago.com';
export const RESEND_API_DEFAULT = 'https://api.resend.com';
export const TURNSTILE_VERIFY_DEFAULT = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

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
    /** Only for the local test stack (mock server); production must use the real API (below). */
    MP_API_BASE: z.url({ protocol: /^https?$/ }).default(MP_API_DEFAULT),
    /** Shown on the Pix page: "confira o nome do recebedor" (Q13). Not secret. */
    PIX_RECIPIENT_NAME: optional(z.string().min(3).max(80)),

    // Transactional e-mail (Phase 2, 08 §3): Resend over HTTPS. Without a key, e-mails are
    // written to the log in development and kept in memory in tests.
    RESEND_API_KEY: optional(z.string().regex(/^re_[\w-]{10,200}$/, 'must be a Resend API key')),
    RESEND_API_BASE: z.url({ protocol: /^https?$/ }).default(RESEND_API_DEFAULT),
    EMAIL_FROM: z.string().min(6).max(120).default('Wiski <nao-responda@mail.wiski.fun>'),

    /** Turnstile siteverify endpoint — overridable for the local test stack only (below). */
    TURNSTILE_VERIFY_URL: z.url({ protocol: /^https?$/ }).default(TURNSTILE_VERIFY_DEFAULT),

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
    if (new Set(keys).size !== keys.length) {
      issue('CSRF_SECRET', 'CSRF_SECRET, COOKIE_SEAL_KEY and IP_HASH_SECRET must all differ');
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

    if (prod) {
      if (!env.GOOGLE_CLIENT_ID) issue('GOOGLE_CLIENT_ID', 'is required in production');
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
      // Phase 2: production takes payments and sends receipts.
      if (!env.MP_ACCESS_TOKEN) issue('MP_ACCESS_TOKEN', 'is required in production');
      else if (!env.MP_ACCESS_TOKEN.startsWith('APP_USR-')) {
        issue('MP_ACCESS_TOKEN', 'production requires an APP_USR- access token');
      }
      if (!env.MP_COLLECTOR_ID) issue('MP_COLLECTOR_ID', 'is required in production');
      if (!env.MP_WEBHOOK_SECRET) issue('MP_WEBHOOK_SECRET', 'is required in production');
      if (!env.RESEND_API_KEY) issue('RESEND_API_KEY', 'is required in production');
      if (!env.PIX_RECIPIENT_NAME) issue('PIX_RECIPIENT_NAME', 'is required in production');
      // Service endpoints are fixed in production; overriding them is only for the local test
      // stack (the production build served on https://localhost).
      if (!isLocal) {
        if (env.MP_API_BASE !== MP_API_DEFAULT) issue('MP_API_BASE', `must be ${MP_API_DEFAULT}`);
        if (env.RESEND_API_BASE !== RESEND_API_DEFAULT) {
          issue('RESEND_API_BASE', `must be ${RESEND_API_DEFAULT}`);
        }
        if (env.TURNSTILE_VERIFY_URL !== TURNSTILE_VERIFY_DEFAULT) {
          issue('TURNSTILE_VERIFY_URL', `must be ${TURNSTILE_VERIFY_DEFAULT}`);
        }
      }
    }
    for (const [key, url] of [
      ['MP_API_BASE', env.MP_API_BASE],
      ['RESEND_API_BASE', env.RESEND_API_BASE],
      ['TURNSTILE_VERIFY_URL', env.TURNSTILE_VERIFY_URL],
    ] as const) {
      const u = new URL(url);
      const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      if (u.protocol !== 'https:' && !local) issue(key, 'must use https');
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

/** True when the app runs on localhost (development, or the production build in the test stack). */
export function isLocalOrigin(env: Env = getEnv()): boolean {
  const host = new URL(env.APP_ORIGIN).hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

export function isGoogleLoginConfigured(env: Env = getEnv()): boolean {
  return env.GOOGLE_CLIENT_ID !== undefined && env.GOOGLE_CLIENT_SECRET !== undefined;
}
