import { afterAll, inject } from 'vitest';
import { resetEnvCache } from '@/server/env';
import { disconnectDb } from '@/server/db';
import { disconnectRedis } from '@/server/redis';
import { closeRealtime } from '@/server/realtime/events';
import { testEnv } from '../../support/env';

// Every integration file starts from a known-good environment (wf_app DB role, local Redis).
Object.assign(
  process.env,
  testEnv({ DATABASE_URL: inject('databaseUrl'), REDIS_URL: inject('redisUrl') }),
);
resetEnvCache();

afterAll(async () => {
  await disconnectDb();
  await disconnectRedis();
  await closeRealtime();
});
