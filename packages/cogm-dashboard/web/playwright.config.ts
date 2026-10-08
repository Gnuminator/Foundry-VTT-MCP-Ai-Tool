// Browser tests for the React dashboard (D-109). They run the built dashboard (dist/server.js,
// so `npm run build` first) with no bridge on a closed control port, and fake the /api routes
// each test needs in the browser. Never the live ports (31414 to 31416) or the test dashboard
// (3100).
//
//   npm run test:e2e -w @gnuminator/cogm-dashboard
//
// The browser is Playwright's Chromium (`npx playwright install chromium`); set
// PLAYWRIGHT_CHANNEL=msedge to use the installed Edge instead.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

import { GM_TOKEN } from './e2e/support';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const PORT = 3197;
const channel = process.env.PLAYWRIGHT_CHANNEL;

export default defineConfig({
  testDir: './e2e',
  outputDir: path.join(packageDir, 'test-results'),
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [
        ['list'],
        ['html', { open: 'never', outputFolder: path.join(packageDir, 'playwright-report') }],
      ]
    : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    ...(channel ? { channel } : {}),
  },
  webServer: {
    command: 'node dist/server.js',
    cwd: packageDir,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      PORT: String(PORT),
      DASHBOARD_HOST: '127.0.0.1',
      // Nothing listens on port 9 (discard): the dashboard runs without a bridge.
      MCP_CONTROL_HOST: '127.0.0.1',
      MCP_CONTROL_PORT: '9',
      GM_DASHBOARD_TOKEN: GM_TOKEN,
      ANTHROPIC_API_KEY: '',
      COGM_STATE_DIR: path.join(os.tmpdir(), 'cogm-dashboard-e2e'),
      LOG_LEVEL: 'error',
    },
  },
});
