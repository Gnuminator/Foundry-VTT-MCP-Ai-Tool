// Screenshot tests for the React dashboard (UI-01). Same server as playwright.config.ts (the built
// dashboard, no bridge, /api faked in the browser), on its own port and state folder so the two
// suites can run side by side. Never the live ports (31414 to 31416) or the test dashboard (3100).
//
// The baselines are Linux-only: fonts and anti-aliasing differ per OS, so they are made and
// checked in the Playwright Docker image (mcr.microsoft.com/playwright:v<version>-noble), never on
// Windows or macOS directly.
//
//   npm run build -w @gnuminator/cogm-dashboard     once, on the host
//   npm run test:visual -w @gnuminator/cogm-dashboard           check, in Docker
//   npm run test:visual:update -w @gnuminator/cogm-dashboard    new baselines, in Docker
//   npm run test:visual:ci -w @gnuminator/cogm-dashboard        what runs inside the container (CI)
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

import { GM_TOKEN } from './e2e/support';
import { STORYBOOK_PORT } from './visual/stories';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const PORT = 3198;

export default defineConfig({
  testDir: './visual',
  outputDir: path.join(packageDir, 'test-results', 'visual'),
  // One folder per width; no platform suffix, because there is only one platform.
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  // A missing baseline is a failure, not a quiet first write: `test:visual:update` makes them.
  updateSnapshots: 'none',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI
    ? [
        ['list'],
        [
          'html',
          { open: 'never', outputFolder: path.join(packageDir, 'playwright-report', 'visual') },
        ],
      ]
    : 'list',
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      // Same pixels in the same image: any difference is a change. threshold is the per-pixel
      // colour tolerance: Playwright's default 0.2 lets a nudged grey pass. 0 flickered on the
      // rounded edge of one pill (Player links header) between identical runs, so 0.02.
      threshold: 0.02,
      maxDiffPixels: 0,
    },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    deviceScaleFactor: 1,
    // The times on the page follow the browser's locale and zone.
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
  },
  projects: [
    // The axe check (axe.spec.ts) runs once, at 1440; the screenshots run at every width.
    {
      name: 'desktop-1440',
      testIgnore: /stories\.spec/,
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'laptop-1080',
      testIgnore: [/axe\.spec/, /stories\.spec/],
      use: { viewport: { width: 1080, height: 800 } },
    },
    {
      name: 'phone-390',
      testIgnore: [/axe\.spec/, /stories\.spec/],
      use: { viewport: { width: 390, height: 844 } },
    },
    // The story shots and their axe check (stories.spec.ts, UI-03): the built Storybook, served
    // from storybook-static/. A story sets its own size (a `phone` tag), so this project has none.
    {
      name: 'stories',
      testMatch: /stories\.spec/,
      use: { baseURL: `http://127.0.0.1:${STORYBOOK_PORT}` },
    },
  ],
  webServer: [
    {
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
        COGM_STATE_DIR: path.join(os.tmpdir(), 'cogm-dashboard-visual'),
        LOG_LEVEL: 'error',
      },
    },
    {
      // The built Storybook: plain files, so a tiny static server is enough.
      command: `node scripts/serve-static.mjs storybook-static ${STORYBOOK_PORT}`,
      cwd: packageDir,
      url: `http://127.0.0.1:${STORYBOOK_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
  ],
});
