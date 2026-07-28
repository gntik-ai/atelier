import { defineConfig } from '@playwright/test';

// E2E Playwright config.
// The flows suite requires longer timeouts because Temporal workflow scheduling and
// pod-kill/recovery scenarios can take up to 3 minutes.
export default defineConfig({
  testDir: './specs',
  // Default test timeout (non-flows). Flows specs override via test.setTimeout().
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  // Global worker concurrency: run specs in parallel but keep flows serial within each suite.
  workers: process.env.CI ? 1 : 2,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }], // consumed by /report-e2e-failures
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // actionTimeout for UI interactions; flows pages may load slowly during first run.
    actionTimeout: 15_000,
    ...(process.env.E2E_CHROME_BIN || process.env.GOOGLE_CHROME_BIN
      ? {
          launchOptions: {
            executablePath: (process.env.E2E_CHROME_BIN || process.env.GOOGLE_CHROME_BIN)!,
            args: ['--no-sandbox'],
          },
        }
      : {}),
  },
  projects: [
    {
      name: 'flows',
      testMatch: '**/specs/flows/**/*.spec.ts',
      // Flows tests involve long-running Temporal workflows (worker-kill = 3 min).
      timeout: 300_000,
      use: {
        baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        actionTimeout: 15_000,
        // On Ubuntu 26.04 the Playwright bundled Chromium headless-shell download is not
        // supported. Use the system Google Chrome installation instead (auto-detected).
        ...(process.env.E2E_CHROME_BIN || process.env.GOOGLE_CHROME_BIN
          ? { launchOptions: { executablePath: (process.env.E2E_CHROME_BIN || process.env.GOOGLE_CHROME_BIN)!, args: ['--no-sandbox'] } }
          : {}),
      },
    },
    {
      name: 'console',
      testMatch: '**/specs/console/**/*.spec.ts',
      // The console suite drives the real SPA in a browser. Playwright's bundled Chromium does not
      // support ubuntu 26.04; use the system Google Chrome (set E2E_CHROME_BIN / GOOGLE_CHROME_BIN).
      use: {
        baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        actionTimeout: 15_000,
        ...(process.env.E2E_CHROME_BIN || process.env.GOOGLE_CHROME_BIN
          ? { launchOptions: { executablePath: (process.env.E2E_CHROME_BIN || process.env.GOOGLE_CHROME_BIN)!, args: ['--no-sandbox'] } }
          : {}),
      },
    },
    {
      name: 'other',
      testIgnore: ['**/specs/flows/**', '**/specs/console/**'],
      timeout: 30_000,
    },
  ],
});
