// Sample take: plan a token move in the dashboard, apply it, watch it in Foundry,
// undo it in Recent Changes and watch the token go back.
//
//   npm run demo:take -- token-move-undo

import { humanClick } from '../lib/browser.mjs';
import {
  closeTools,
  confirmModal,
  newestUndoButton,
  openToolForm,
  readConfirmModal,
  setGmActions,
  submitToolForm,
} from '../lib/dashboard.mjs';
import { DEMO_USERS } from '../lib/env.mjs';
import {
  closeAllWindows,
  panToToken,
  tokenPosition,
  unpause,
  waitForTokenAt,
  waitForTokenMove,
} from '../lib/foundry.mjs';

export const meta = { title: 'Plan a token move, apply it, undo it' };

const TOKEN = 'Wolf 1';
let start;

/** Before recording: open and prepare every window the take shows. */
export async function setup(t) {
  const gm = await t.foundry('Foundry', { user: DEMO_USERS.gm });
  await closeAllWindows(gm.page);
  await unpause(gm.page);
  await panToToken(gm.page, TOKEN, 1.2);
  start = await tokenPosition(gm.page, TOKEN);
  if (!start) throw new Error(`No token "${TOKEN}" on the active scene.`);
  const dash = await t.dashboard();
  await setGmActions(dash.page, false);
}

/** The recorded part. */
export async function run(t) {
  const human = { human: true };
  const dash = await t.scene('Dashboard');
  const page = dash.page;

  await t.step('gm-actions', 'Turn on GM Actions', async () => {
    await t.pause(1200);
    await setGmActions(page, true, human);
    await t.pause(800);
  });

  await t.step('open-tool', 'Open plan-token-change in the Tool Runner', async () => {
    await openToolForm(
      page,
      'plan-token-change',
      { action: 'move', tokens: [TOKEN], dx: 2, dy: 1 },
      human
    );
    await t.pause(1000);
    await t.shot('Dashboard', 'tool-form');
  });

  await t.step('plan', 'Plan the move and read the change before it happens', async () => {
    await submitToolForm(page, human);
    const modal = await readConfirmModal(page);
    if (!modal.body.includes(TOKEN))
      throw new Error(`Confirm dialog does not name ${TOKEN}: ${modal.body}`);
    await t.pause(2500);
    await t.shot('Dashboard', 'confirm-diff');
  });

  await t.step('apply', 'Apply it', async () => {
    await confirmModal(page, human);
    await t.pause(1500);
    await t.shot('Dashboard', 'applied');
  });

  await t.step('watch-move', 'The token moves in Foundry', async () => {
    const gm = await t.scene('Foundry');
    await waitForTokenMove(gm.page, TOKEN, start);
    await t.pause(2500);
    await t.shot('Foundry', 'token-moved');
  });

  await t.step('undo', 'Undo it in Recent Changes', async () => {
    await t.scene('Dashboard');
    await closeTools(page, human);
    await t.pause(800);
    await humanClick(newestUndoButton(page));
    await readConfirmModal(page);
    await t.pause(1500);
    await t.shot('Dashboard', 'undo-confirm');
    await confirmModal(page, human);
    await t.pause(1200);
  });

  await t.step('watch-undo', 'The token is back where it was', async () => {
    const gm = await t.scene('Foundry');
    // The undo may already have landed while the dashboard was on screen.
    await waitForTokenAt(gm.page, TOKEN, start);
    await t.pause(2500);
    await t.shot('Foundry', 'token-back');
  });

  await setGmActions(page, false);
}
