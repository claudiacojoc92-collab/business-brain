import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the Strategic Learning Record genuine-UI acceptance. The web dev server (vite, with its /api
 * proxy to the API on :3000) and the API are started out-of-band by the acceptance runner; this config only points the
 * browser at them. Local acceptance harness — not part of `npm test`.
 */
const PORT = Number(process.env['E2E_WEB_PORT'] ?? 5177);
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
