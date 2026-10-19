import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

export default function globalSetup(): void {
  const root = join(import.meta.dirname, '../..');
  execFileSync(
    process.execPath,
    [join(root, 'node_modules/tsx/dist/cli.mjs'), 'tests/brand/render-components.tsx'],
    {
      cwd: root,
      stdio: 'inherit',
    },
  );
}
