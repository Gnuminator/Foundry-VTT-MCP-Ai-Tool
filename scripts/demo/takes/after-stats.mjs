// Take: after the session, the After view: tonight's stats (rolls, most damage, the highest
// roll, who went down) from the tool's own play log, and the guide one click away.
//
//   npm run demo:take -- after-stats

import { humanClick } from '../lib/browser.mjs';
import { callToolApi, setGmActions } from '../lib/dashboard.mjs';
import { DEMO_USERS } from '../lib/env.mjs';
import { closeAllWindows, unpause } from '../lib/foundry.mjs';

export const meta = { title: "After the session: tonight's stats" };

const HERO = 'Test Hero';

/** Before recording: a short play session with a few real rolls, then the dashboard. */
export async function setup(t) {
  const gm = await t.foundry('Foundry', { user: DEMO_USERS.gm });
  await closeAllWindows(gm.page);
  await unpause(gm.page);
  await callToolApi(t.env.dashboardUrl, 'mark-play-session', { action: 'start' });
  await gm.page.evaluate(async hero => {
    const actor = globalThis.game.actors.getName(hero);
    if (!actor) throw new Error(`No actor "${hero}" in the demo world.`);
    for (const skill of ['ath', 'prc', 'ste', 'ins', 'sur']) {
      await actor.rollSkill({ skill }, { configure: false });
    }
    await actor.rollSavingThrow({ ability: 'con' }, { configure: false });
  }, HERO);
  // The bridge pulls the play log every few seconds.
  await gm.page.waitForTimeout(15000);
  await callToolApi(t.env.dashboardUrl, 'mark-play-session', { action: 'end' });
  const dash = await t.dashboard();
  await setGmActions(dash.page, false);
}

/** The recorded part. */
export async function run(t) {
  const dash = await t.scene('Dashboard');
  const page = dash.page;

  await t.step('after', "The After view opens with tonight's stats", async () => {
    await t.pause(1200);
    await humanClick(page.locator('#moments [data-moment="after"]'));
    await page
      .locator('#stat-cards .stat-card')
      .first()
      .waitFor({ state: 'visible', timeout: 20000 });
    await t.pause(3000);
    await t.shot('Dashboard', 'after-stats');
  });

  await t.step('cards', 'Rolls, most damage, the highest roll, who went down', async () => {
    const cards = page.locator('#stat-cards .stat-card');
    const n = await cards.count();
    for (let i = 0; i < n; i++) {
      await cards.nth(i).hover();
      await t.pause(900);
    }
    await t.pause(1000);
  });

  await t.step('help', 'The "?" opens the guide right there', async () => {
    await humanClick(page.locator('#after-stats .help-q'));
    await page.locator('#pane-help').waitFor({ state: 'visible' });
    await t.pause(3500);
    await t.shot('Dashboard', 'after-help');
    await page.locator('#pane-help .overlay-close').click();
    await t.pause(800);
  });
}
