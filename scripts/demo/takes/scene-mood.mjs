// Take: change a scene's mood from the dashboard's Scene mood panel, then change it back (I-192
// home page loop). Two invented presets, no campaign content.
//
//   npm run demo:take -- scene-mood
//
// Setup (off camera) switches the feature on and saves the presets "Stormy night" and "Bright
// day" on the active scene through plan-scene-mood and apply-planned-change.

import { humanClick } from '../lib/browser.mjs';
import {
  callToolApi,
  confirmModal,
  readConfirmModal,
  setGmActions,
  setGmActionsApi,
} from '../lib/dashboard.mjs';
import { DEMO_USERS } from '../lib/env.mjs';
import { closeAllWindows, unpause } from '../lib/foundry.mjs';

export const meta = { title: 'Set the mood of a scene, then change it back' };

const PRESETS = [
  { preset: 'Stormy night', darkness: 0.85, globalLight: false, weather: 'rain' },
  { preset: 'Bright day', darkness: 0, globalLight: true, weather: 'none' },
];

/** Before recording: feature on, presets saved, dashboard on the During tab. */
export async function setup(t) {
  const gm = await t.foundry('Foundry', { user: DEMO_USERS.gm });
  await closeAllWindows(gm.page);
  await unpause(gm.page);
  await gm.page.addStyleTag({ content: '#notifications { display: none !important; }' });
  await gm.page.evaluate(async () => {
    await globalThis.game.settings.set('foundry-mcp-bridge', 'feature.scene-mood.enabled', true);
  });
  await setGmActionsApi(t.env.dashboardUrl, true);
  for (const p of PRESETS) {
    const plan = await callToolApi(t.env.dashboardUrl, 'plan-scene-mood', { action: 'save', ...p });
    const planId = plan?.planId ?? plan?.result?.planId;
    if (!planId) throw new Error(`No plan for preset ${p.preset}: ${JSON.stringify(plan)}`);
    await callToolApi(t.env.dashboardUrl, 'apply-planned-change', { planId });
  }
  // Start from the bright look.
  const plan = await callToolApi(t.env.dashboardUrl, 'plan-scene-mood', {
    action: 'apply',
    preset: 'Bright day',
  });
  if (!plan?.planId) throw new Error(`No plan for the starting mood: ${JSON.stringify(plan)}`);
  await callToolApi(t.env.dashboardUrl, 'apply-planned-change', { planId: plan.planId });
  await setGmActionsApi(t.env.dashboardUrl, false);

  const dash = await t.dashboard();
  await setGmActions(dash.page, false);
  await dash.page.locator('#tab-during').click();
  await dash.page.locator('#btn-during-scene-mood').waitFor({ timeout: 20000 });
}

async function applyMood(t, page, name) {
  const human = { human: true };
  await humanClick(page.locator(`#scene-mood-panel [data-preset="${name}"]`));
  await readConfirmModal(page);
  await t.pause(1200);
  await confirmModal(page, human);
}

/** The recorded part. */
export async function run(t) {
  const human = { human: true };
  const dash = await t.scene('Dashboard');
  const page = dash.page;
  await t.pause(800);
  await setGmActions(page, true, human);
  await t.pause(600);

  await t.step('open-panel', 'Open Scene mood on the During bar', async () => {
    await humanClick(page.locator('#btn-during-scene-mood'));
    await page.locator('#scene-mood-panel').waitFor({ state: 'visible' });
    await t.pause(1500);
    await t.shot('Dashboard', 'mood-panel');
  });

  await t.step('switch', 'One click, one confirm: the scene turns to a stormy night', async () => {
    await applyMood(t, page, 'Stormy night');
    await t.pause(800);
    await t.scene('Foundry');
    await t.pause(3500);
    await t.shot('Foundry', 'mood-stormy');
  });

  await t.step('restore', 'And back to a bright day', async () => {
    await t.scene('Dashboard');
    await t.pause(500);
    await applyMood(t, page, 'Bright day');
    await t.pause(500);
    await t.scene('Foundry');
    await t.pause(3000);
    await t.shot('Foundry', 'mood-bright');
  });

  await setGmActionsApi(t.env.dashboardUrl, false);
}
