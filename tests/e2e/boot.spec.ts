/** The production server refuses to start with a missing/invalid variable (10 §2 step 2). */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { stack } from './support/seed';

test('standalone server exits with a clear message when CSRF_SECRET is missing', async ({}, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'once is enough');
  const { CSRF_SECRET: _drop, ...env } = stack().appEnv;
  const child = spawn(process.execPath, [join(process.cwd(), '.next/standalone/server.js')], {
    env: { ...env, PORT: '3199' } as unknown as NodeJS.ProcessEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d: Buffer) => (output += d.toString()));
  child.stderr.on('data', (d: Buffer) => (output += d.toString()));
  const code = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(null);
    }, 30_000);
    child.on('exit', (c) => {
      clearTimeout(timer);
      resolve(c);
    });
  });
  expect(code).toBe(1);
  expect(output).toContain('refusing to start');
  expect(output).toContain('CSRF_SECRET');
  expect(output).not.toContain(stack().appEnv.COOKIE_SEAL_KEY);
});
