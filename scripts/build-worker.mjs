/**
 * Production worker bundle (Phase 5): src/worker/main.ts → dist/worker.mjs, run by the same image
 * as the web server (`node --conditions=react-server dist/worker.mjs`). Everything is bundled
 * except the packages Next.js also keeps external (next.config.ts serverExternalPackages) and the
 * Prisma runtime: those are resolved from the standalone server's traced node_modules, which the
 * image ships anyway. `node scripts/build-worker.mjs --check <dir>` verifies they are there.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';

const EXTERNAL = ['pino', 'ioredis', 'pg', 'pg-native', '@prisma/client'];

const check = process.argv.indexOf('--check');
if (check !== -1) {
  const dir = process.argv[check + 1] ?? '.next/standalone';
  const missing = EXTERNAL.filter(
    (p) => p !== 'pg-native' && !existsSync(join(dir, 'node_modules', p, 'package.json')),
  );
  if (missing.length) {
    console.error(`worker: missing in ${dir}/node_modules: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log(`worker: external packages present in ${dir}/node_modules`);
  process.exit(0);
}

await build({
  entryPoints: ['src/worker/main.ts'],
  outfile: 'dist/worker.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  conditions: ['react-server'],
  // must exist in .next/standalone/node_modules (checked below)
  external: EXTERNAL,
  tsconfig: 'tsconfig.json',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
  banner: {
    // ESM output; a few dependencies still call require()
    js: "import { createRequire as __wfCreateRequire } from 'node:module'; const require = __wfCreateRequire(import.meta.url);",
  },
});
console.log('dist/worker.mjs built');
