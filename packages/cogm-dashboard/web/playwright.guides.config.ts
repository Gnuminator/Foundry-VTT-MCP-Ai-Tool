// The picture script for the dashboard guides (guides/guide-pictures.shots.ts, not a test, so CI's test-coverage rule leaves it out): the visual
// config's server and fixtures, one desktop project, no comparison. Run through
// `npm run docs:dashboard-pictures` at the repo root. It binds no live port (no bridge runs).
import { defineConfig } from '@playwright/test';

import base from './playwright.visual.config';

const servers = Array.isArray(base.webServer) ? base.webServer : [];

export default defineConfig({
  ...base,
  // Its own folder, so the visual config (testDir ./visual) and CI never run it.
  testDir: './guides',
  testMatch: /guide-pictures\.shots\.ts$/,
  reporter: 'list',
  projects: [{ name: 'guides', use: { viewport: { width: 1280, height: 900 } } }],
  // Only the dashboard server: the Storybook one is for the story shots.
  webServer: servers.slice(0, 1),
});
