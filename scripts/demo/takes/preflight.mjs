// Take: before a session: Pre-flight checks the bridge, the module,
// the write switches and the players' page for spoilers (I-095); Turn on for tonight turns on
// what tonight needs in one click (PB-17); the guides say when to turn the rest on.
//
//   npm run demo:take -- preflight

import { humanClick } from '../lib/browser.mjs';
import { runPreflight, setGmActions } from '../lib/dashboard.mjs';
import { DEMO_USERS } from '../lib/env.mjs';
import { closeAllWindows, unpause } from '../lib/foundry.mjs';

export const meta = { title: 'Get ready for the session: Pre-flight, Ready, guides' };

/** Before recording: GM in Foundry (the checks read through it) and the dashboard. */
export async function setup(t) {
  const gm = await t.foundry('Foundry', { user: DEMO_USERS.gm });
  await closeAllWindows(gm.page);
  await unpause(gm.page);
  const dash = await t.dashboard();
  await setGmActions(dash.page, false);
}

/** The recorded part. */
export async function run(t) {
  const human = { human: true };
  const dash = await t.scene('Dashboard');
  const page = dash.page;

  await t.step('open', 'Open Pre-flight; it runs every check', async () => {
    await t.pause(1200);
    const summary = await runPreflight(page, human);
    console.log(`  Pre-flight: ${summary}`);
    await t.pause(2500);
    await t.shot('Dashboard', 'preflight');
  });

  await t.step('findings', 'Read what each check found', async () => {
    const items = page.locator('#preflight-drawer ul[aria-label="Checked by the tool"] li');
    const count = await items.count();
    for (let i = 0; i < Math.min(count, 6); i++) {
      await items.nth(i).scrollIntoViewIfNeeded();
      await items.nth(i).hover();
      await t.pause(500);
    }
    const details = page.locator('#preflight-drawer details.preflight-findings summary').first();
    if (await details.isVisible()) {
      await humanClick(details);
      await t.pause(2000);
    }
    await t.shot('Dashboard', 'preflight-findings');
  });

  await t.step('ready', 'Turn on for tonight: one click turns on what tonight needs', async () => {
    const ready = page.locator('#btn-ready');
    await ready.scrollIntoViewIfNeeded();
    await t.pause(1200);
    await humanClick(ready);
    await page.waitForFunction(
      () => document.querySelector('#btn-ready')?.disabled === true,
      undefined,
      {
        timeout: 20000,
      }
    );
    await t.pause(2500);
    await t.shot('Dashboard', 'preflight-ready');
  });

  await t.step('manual', 'Tick the things only the GM can check', async () => {
    const ticks = page.locator(
      '#preflight-drawer ul[aria-label="Check by hand"] input[type=checkbox]:not(:checked)'
    );
    const n = Math.min(await ticks.count(), 2);
    for (let i = 0; i < n; i++) {
      await humanClick(ticks.nth(i));
      await t.pause(600);
    }
    await t.pause(1500);
  });

  await t.step('guide', 'The guides: what is on, and when to turn the rest on', async () => {
    // The Pre-flight drawer covers the header: close it first.
    await page.keyboard.press('Escape');
    await page.locator('#preflight-drawer').waitFor({ state: 'hidden' });
    await humanClick(page.locator('#btn-advanced'));
    await humanClick(page.locator('#btn-guides'));
    await page.locator('#pane-help').waitFor({ state: 'visible' });
    await t.pause(3000);
    await t.shot('Dashboard', 'guides');
    await page.locator('#pane-help .overlay-close').click();
  });
}
