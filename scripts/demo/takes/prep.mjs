// Take: the Prep drawer gathers what the GM needs for the next session in one place: the
// last session, open quests, the "Next session" notes and what is ready (I-095).
//
//   npm run demo:take -- prep
//
// Its content is the invented prep from prepare-demo-world.mjs (a recorded session, a
// quest, a "Next session" journal).

import { humanClick } from '../lib/browser.mjs';
import { openPrep, setGmActions } from '../lib/dashboard.mjs';
import { DEMO_USERS } from '../lib/env.mjs';
import { closeAllWindows, unpause } from '../lib/foundry.mjs';

export const meta = { title: 'Prepare the next session with the Prep drawer' };

/** Before recording: GM in Foundry (the digest reads through it) and the dashboard. */
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

  await t.step('open', 'Open Prep', async () => {
    await t.pause(1200);
    await openPrep(page, human);
    await t.pause(2500);
    await t.shot('Dashboard', 'prep');
  });

  await t.step('sections', 'Last session, open quests, next session notes', async () => {
    for (const id of ['#prep-last', '#prep-threads', '#prep-notes', '#prep-ready']) {
      const section = page.locator(id);
      if (!(await section.isVisible())) continue;
      await section.scrollIntoViewIfNeeded();
      await section.hover();
      await t.pause(1500);
    }
    const beats = page.locator('#prep-last details.prep-beats summary').first();
    if (await beats.isVisible()) {
      await humanClick(beats);
      await t.pause(2000);
    }
    await t.shot('Dashboard', 'prep-sections');
  });

  await t.step('open-notes', 'Open the notes in Foundry', async () => {
    const open = page.locator('#prep-notes [data-prep-open]').first();
    if (!(await open.isVisible())) return;
    await humanClick(open);
    await t.pause(800);
    const gm = await t.scene('Foundry');
    await gm.page.waitForFunction(
      () =>
        [...(globalThis.foundry?.applications?.instances?.values() ?? [])].some(
          a => a.rendered && a.document?.name === 'Next session'
        ),
      undefined,
      { timeout: 10000 }
    );
    await t.pause(3000);
    await t.shot('Foundry', 'prep-notes-in-foundry');
  });
}
