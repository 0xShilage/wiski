import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext } from '@playwright/test';
import pg from 'pg';

const ROOT = join(import.meta.dirname, '../../..');
export const stack = () =>
  JSON.parse(readFileSync(join(ROOT, 'test-results/e2e-stack.json'), 'utf8')) as {
    origin: string;
    adminDatabaseUrl: string;
    appEnv: Record<string, string>;
  };

export async function withDb<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: stack().adminDatabaseUrl });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Insert a user + a live session directly (no Google in browser tests) and return the token. */
export async function seedUser(
  opts: {
    username?: string | null;
    role?: 'USER' | 'MODERATOR' | 'STREAMER';
    avatarKey?: string;
    /** a registered passkey row + a session verified with it just now (admin second factor) */
    passkeyVerified?: boolean;
  } = {},
) {
  const id = randomUUID();
  const token = randomBytes(32).toString('base64url');
  const username =
    opts.username === undefined ? `e2e_${randomBytes(4).toString('hex')}` : opts.username;
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO "User"(id, "googleSub", email, "emailVerified", username, "avatarKey", role, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, true, $4, $5, $6, now(), now())`,
      [
        id,
        `e2e-${id}`,
        `${id}@example.com`,
        username,
        opts.avatarKey ?? 'mascote-4-lavender',
        opts.role ?? 'USER',
      ],
    );
    await c.query(
      `INSERT INTO "Session"(id, "tokenHash", "userId", "authTime", "mfaAt", "createdAt", "lastSeenAt", "idleExpiresAt", "expiresAt", "uaFamily")
       VALUES ($1, $2, $3, now(), ${opts.passkeyVerified ? 'now()' : 'NULL'}, now(), now(), now() + interval '8 hours', now() + interval '1 day', 'Chrome · Linux')`,
      [randomUUID(), createHash('sha256').update(token).digest(), id],
    );
    if (opts.passkeyVerified) {
      await c.query(
        `INSERT INTO "Passkey"(id, "userId", "credentialId", "publicKey", label) VALUES ($1, $2, $3, $4, 'e2e')`,
        [randomUUID(), id, randomBytes(32), randomBytes(77)],
      );
    }
  });
  return { id, token, username };
}

export async function signIn(context: BrowserContext, token: string) {
  await context.addCookies([
    {
      name: '__Host-wf_session',
      value: token,
      url: stack().origin,
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

/** Users for a PageCase `auth` value. */
export async function seedFor(
  auth: 'user' | 'newcomer' | 'moderator' | 'admin' | 'streamer' | undefined,
) {
  if (auth === 'newcomer') return seedUser({ username: null });
  if (auth === 'moderator') return seedUser({ role: 'MODERATOR' });
  if (auth === 'admin') return seedUser({ role: 'MODERATOR', passkeyVerified: true });
  if (auth === 'streamer') return seedUser({ role: 'STREAMER', passkeyVerified: true });
  return seedUser({ avatarKey: 'mascote-2-lilac' });
}
