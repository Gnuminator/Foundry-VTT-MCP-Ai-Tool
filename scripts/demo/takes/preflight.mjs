// Take: the Pre-flight check before a session: one click checks the bridge, the module,
// the write switches and the players' page for spoilers (I-095).
//
//   npm run demo:take -- preflight

import { humanClick } from '../lib/browser.mjs';
import { runPreflight, setGmActions } from '../lib/dashboard.mjs';
import { DEMO_USERS } from '../lib/env.mjs';
import { closeAllWindows, unpause } from '../lib/foundry.mjs';

export const meta = { title: 'Check the table is ready with Pre-flight' };

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
    const items = page.locator('#preflight-auto li.preflight-item');
    const count = await items.count();
    for (let i = 0; i < Math.min(count, 6); i++) {
      await items.nth(i).scrollIntoViewIfNeeded();
      await items.nth(i).hover();
      await t.pause(500);
    }
    const details = page.locator('#preflight-findings details.preflight-findings summary').first();
    if (await details.isVisible()) {
      await humanClick(details);
      await t.pause(2000);
    }
    await t.shot('Dashboard', 'preflight-findings');
  });

  await t.step('manual', 'Tick the things only the GM can check', async () => {
    const ticks = page.locator('#preflight-manual [data-tick]');
    const n = Math.min(await ticks.count(), 2);
    for (let i = 0; i < n; i++) {
      await humanClick(ticks.nth(i));
      await t.pause(600);
    }
    await t.pause(1500);
  });
}
