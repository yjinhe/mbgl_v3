import { defineConfig, devices } from '@playwright/test';

const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  expect: { timeout: 5000 },
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(chromiumExecutablePath ? { launchOptions: { executablePath: chromiumExecutablePath } } : {})
      }
    }
  ],
  webServer: [
    {
      command: 'pnpm --filter @tangji/api dev',
      url: 'http://127.0.0.1:3001/health',
      reuseExistingServer: true,
      timeout: 120000
    },
    {
      command: 'pnpm --filter @tangji/web dev',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: true,
      timeout: 120000
    },
    {
      command: 'pnpm --filter @tangji/console dev',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: true,
      timeout: 120000
    }
  ]
});
