// Take: reveal a queued handout from the dashboard and watch it appear on the players'
// /player page. Foundry's own way is ownership dialogs per journal (I-095).
//
//   npm run demo:take -- handout-reveal
//
// The demo world has a GM-only journal "Letters" with "A Letter from the Mayor"
// (invented; see prepare-demo-world.mjs). Setup queues it off camera.

import { humanClick } from '../lib/browser.mjs';
import {
  callToolApi,
  confirmModal,
  openHandouts,
  readConfirmModal,
  revealNextHandout,
  setGmActions,
  setGmActionsApi,
} from '../lib/dashboard.mjs';
import { DEMO_USERS } from '../lib/env.mjs';
import { closeAllWindows, unpause } from '../lib/foundry.mjs';

export const meta = { title: 'Reveal a handout to the players' };

const LETTER = { journal: 'Letters', page: 'A Letter from the Mayor' };

/** Before recording: GM in Foundry (the bridge writes through it), the letter queued. */
export async function setup(t) {
  const gm = await t.foundry('Foundry', { user: DEMO_USERS.gm });
  await closeAllWindows(gm.page);
  await unpause(gm.page);
  const ids = await gm.page.evaluate(({ journal, page }) => {
    const entry = globalThis.game.journal.getName(journal);
    const p = entry?.pages.getName(page);
    return p ? { pageUuid: p.uuid, sceneId: globalThis.canvas.scene.id } : null;
  }, LETTER);
  if (!ids)
    throw new Error(`No page "${LETTER.page}" in "${LETTER.journal}"; run prepare-demo-world.mjs.`);
  // Queueing is not a guarded change, but the dashboard only runs tools with GM Actions on.
  await setGmActionsApi(t.env.dashboardUrl, true);
  await callToolApi(t.env.dashboardUrl, 'plan-page-reveal', { action: 'queue', ...ids });
  await setGmActionsApi(t.env.dashboardUrl, false);

  await t.playerPage();
  const dash = await t.dashboard();
  await setGmActions(dash.page, false);
}

/** The recorded part. */
export async function run(t) {
  const human = { human: true };
  const player = t.windows['Player page'].page;

  await t.step('player-before', 'The players see no handouts yet', async () => {
    await t.scene('Player page');
    await t.pause(2500);
    await t.shot('Player page', 'player-before');
  });

  const dash = await t.scene('Dashboard');
  const page = dash.page;
  await t.step('gm-actions', 'Turn on GM Actions', async () => {
    await t.pause(1000);
    await setGmActions(page, true, human);
    await t.pause(600);
  });

  await t.step('queue', 'The letter waits in the handout queue', async () => {
    await openHandouts(page, human);
    await t.pause(2000);
    await t.shot('Dashboard', 'handout-queue');
  });

  await t.step('reveal', 'Reveal it, after reading what changes', async () => {
    await revealNextHandout(page, human);
    const modal = await readConfirmModal(page);
    if (!modal.body.includes(LETTER.page)) {
      throw new Error(`Confirm dialog does not name the letter: ${modal.body}`);
    }
    await t.pause(3000);
    await t.shot('Dashboard', 'handout-confirm');
    await confirmModal(page, human);
    await t.pause(1500);
  });

  await t.step('player-after', 'It appears on the players’ page', async () => {
    await t.scene('Player page');
    const handout = player.locator('#handouts details.handout', { hasText: LETTER.page });
    await handout.waitFor({ timeout: 10000 });
    await t.pause(1000);
    await humanClick(handout.locator('summary'));
    await t.pause(3500);
    await t.shot('Player page', 'player-after');
  });

  // Clean-up outside the steps, without the UI: the Player page window is in front now.
  await setGmActionsApi(t.env.dashboardUrl, false);
}
