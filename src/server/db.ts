import 'server-only';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { getEnv } from './env';

const globalForPrisma = globalThis as unknown as { __wfPrisma?: PrismaClient | undefined };

/** Prisma 7 client over the pg driver adapter (one pool per process). */
export function db(): PrismaClient {
  globalForPrisma.__wfPrisma ??= new PrismaClient({
    adapter: new PrismaPg({
      connectionString: getEnv().DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      // Guard rails: a stuck query must not pin a connection forever.
      statement_timeout: 10_000,
      idle_in_transaction_session_timeout: 15_000,
      application_name: 'wiskiflix-web',
      // REQUIRED: @prisma/adapter-pg reads timestamptz values by discarding the offset (it
      // assumes the session runs in UTC). Pin the session TimeZone so a server/cluster
      // configured with another zone can't shift every expiry and auth time by hours.
      options: '-c TimeZone=UTC',
    }),
    log: [
      { level: 'warn', emit: 'stdout' },
      { level: 'error', emit: 'stdout' },
    ],
  });
  return globalForPrisma.__wfPrisma;
}

/** Test helper: close and forget the client (e.g. after switching DATABASE_URL). */
export async function disconnectDb(): Promise<void> {
  await globalForPrisma.__wfPrisma?.$disconnect();
  globalForPrisma.__wfPrisma = undefined;
}
