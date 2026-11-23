// The pictures in the dashboard guides (docs/gm/dashboard*.md and docs/player/player-page.md),
// taken from the same fixtures as the page shots, so every name is made up. Not part of CI: run
// `npm run docs:pictures` (headless Chromium; build the dashboard first, the script does).
// The files land in docs/images/dashboard/.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Locator, type Page } from '@playwright/test';

import { PLAYER_SCREENS, showPlayerScreen } from '../visual/player-screens';
import { SCREENS, showScreen } from '../visual/screens';

const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'docs',
  'images',
  'dashboard'
);

async function shootPage(page: Page, name: string, fullPage: boolean): Promise<void> {
  // The version label changes with every release and the player status pill reads "Reconnecting"
  // once the faked stream ends: keep both out of the pictures so they do not go stale.
  await page.evaluate(() => {
    for (const id of ['app-version', 'status']) {
      const el = document.getElementById(id);
      if (el) el.style.visibility = 'hidden';
    }
  });
  await page.screenshot({
    path: path.join(OUT, name),
    animations: 'disabled',
    caret: 'hide',
    fullPage,
  });
}

async function shootPart(part: Locator, name: string): Promise<void> {
  await part.screenshot({
    path: path.join(OUT, name),
    animations: 'disabled',
    caret: 'hide',
  });
}

const gm = (name: string): (typeof SCREENS)[number] => {
  const screen = SCREENS.find(s => s.name === name);
  if (!screen) throw new Error(`no screen ${name}`);
  return screen;
};

const player = (name: string): (typeof PLAYER_SCREENS)[number] => {
  const screen = PLAYER_SCREENS.find(s => s.name === name);
  if (!screen) throw new Error(`no player screen ${name}`);
  return screen;
};

test('header and Before', async ({ page }) => {
  await showScreen(page, gm('before'), 'neutral');
  await shootPart(page.locator('header.topbar'), 'dashboard-header.png');
  await shootPage(page, 'dashboard-before.png', true);
});

test('During with the strip', async ({ page }) => {
  // The live screen: a fight on the strip, Party, Handouts, and Recent Changes with Undo.
  await showScreen(page, gm('live'), 'neutral');
  await shootPage(page, 'dashboard-during.png', true);
});

test('During as cards', async ({ page }) => {
  await showScreen(page, gm('during'), 'neutral');
  await shootPage(page, 'dashboard-during-cards.png', true);
});

test('Recent Changes and the strip', async ({ page }) => {
  await showScreen(page, gm('live'), 'neutral');
  await expect(page.locator('#pane-changes')).toBeVisible();
  await shootPart(page.locator('#pane-changes'), 'dashboard-recent-changes.png');
  await shootPart(page.locator('#live-strip'), 'dashboard-strip.png');
});

test('Tool Runner', async ({ page }) => {
  await showScreen(page, gm('tools'), 'neutral');
  await shootPage(page, 'dashboard-tool-runner.png', false);
});

test('Player links', async ({ page }) => {
  await showScreen(page, gm('player-links'), 'neutral');
  await shootPage(page, 'dashboard-player-links.png', false);
});

test('Player page', async ({ page }) => {
  await showPlayerScreen(page, player('player-key'));
  await shootPage(page, 'player-page.png', true);
});

test('My character', async ({ page }) => {
  await showPlayerScreen(page, player('me'));
  await shootPage(page, 'my-character.png', true);
});
