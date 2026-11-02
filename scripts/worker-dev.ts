/**
 * DEVELOPMENT ONLY — `npm run worker`: loads the local environment files the way `next dev`
 * does for the web process, defaults NODE_ENV to "development", then starts the real worker
 * (src/worker/main.ts). Production runs the bundled worker (dist/worker.mjs) with the
 * environment Docker Compose provides, and never goes through this file.
 *
 * The worker is imported only after the environment is in place (a static import would be
 * evaluated first).
 */
import { existsSync } from 'node:fs';

for (const file of ['.env.local', '.env']) {
  // loadEnvFile never overrides variables that are already set (shell wins, then .env.local)
  if (existsSync(file)) process.loadEnvFile(file);
}
(process.env as Record<string, string | undefined>).NODE_ENV ??= 'development';
if (process.env.NODE_ENV === 'production') {
  console.error('worker-dev: NODE_ENV=production — run the built worker (npm run start:worker)');
  process.exit(1);
}

await import('../src/worker/main');
