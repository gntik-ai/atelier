import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const packageDir = fileURLToPath(new URL('.', import.meta.url))
const port = 4173
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/*.e2e.ts'],
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  outputDir: './test-results',
  expect: {
    timeout: 10_000
  },
  reporter: 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  },
  webServer: {
    cwd: packageDir,
    command: 'corepack pnpm build && corepack pnpm e2e:serve',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome']
      }
    }
  ]
})
