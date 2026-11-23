// The picture script for the dashboard guides (visual/guide-pictures.spec.ts): the visual
// config's server and fixtures, one desktop project, no comparison. Run through
// `npm run docs:pictures` at the repo root. Never the live ports (31414 to 31416).
import { defineConfig } from '@playwright/test';

import base from './playwright.visual.config';

const servers = Array.isArray(base.webServer) ? base.webServer : [];

export default defineConfig({
  ...base,
  testMatch: /guide-pictures\.spec/,
  reporter: 'list',
  projects: [{ name: 'guides', use: { viewport: { width: 1280, height: 900 } } }],
  // Only the dashboard server: the Storybook one is for the story shots.
  webServer: servers.slice(0, 1),
});
