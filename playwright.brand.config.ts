import { defineConfig, devices } from '@playwright/test';

/** Brand asset checks (no web server): SVG pixel diffs, logo vs live font. `npm run test:brand` */
export default defineConfig({
  testDir: 'tests/brand',
  globalSetup: './tests/brand/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    deviceScaleFactor: 2,
    launchOptions: process.env.PW_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PW_CHROMIUM_EXECUTABLE }
      : {},
  },
});
