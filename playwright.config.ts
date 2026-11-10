import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_HTTPS_PORT ?? 8443);
const baseURL = `https://localhost:${PORT}`;
const chromium = process.env.PW_CHROMIUM_EXECUTABLE
  ? { executablePath: process.env.PW_CHROMIUM_EXECUTABLE }
  : {};

/**
 * Browser tests against the production build behind nginx (tests/e2e/support/stack.ts).
 * Prerequisite: `npm run build`.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [
        ['list'],
        ['github'],
        ['html', { open: 'never' }],
        ['json', { outputFile: 'test-results/e2e.json' }],
      ]
    : [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    // The neon logo flickers on a browser's first visit (2026-11-10); every test starts as a
    // returning visitor so screenshots and layout checks see the logo lit. design-batch.spec.ts
    // clears it to test the flicker.
    storageState: {
      cookies: [
        {
          name: '__Host-wf_neon',
          value: '1',
          domain: 'localhost',
          path: '/',
          expires: -1,
          httpOnly: false,
          secure: true,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    },
    trace: 'retain-on-failure',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  },
  projects: [
    {
      name: 'mobile-360',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 360, height: 780 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        launchOptions: chromium,
      },
    },
    {
      name: 'desktop-1280',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        launchOptions: chromium,
      },
    },
  ],
  webServer: {
    command: 'npx tsx tests/e2e/support/stack.ts',
    url: `${baseURL}/api/health`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 360_000, // includes the seed (media pipeline)
    stdout: 'pipe',
    stderr: 'pipe',
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
  },
});
