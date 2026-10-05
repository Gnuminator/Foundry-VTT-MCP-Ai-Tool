// Take: damage on several targets at once from the During view's turn-order strip, one click
// with dnd5e working out a resistance (D-086), then Undo in Recent Changes. Something Foundry's
// own UI does one token at a time (I-095).
//
//   npm run demo:take -- damage-undo

import { humanClick, humanType } from '../lib/browser.mjs';
import {
  closeTools,
  confirmModal,
  newestUndoButton,
  readConfirmModal,
  setDashboardPrefsApi,
  setGmActions,
} from '../lib/dashboard.mjs';
import { DEMO_USERS } from '../lib/env.mjs';
import { closeAllWindows, panToToken, unpause } from '../lib/foundry.mjs';

export const meta = { title: 'Damage three creatures at once, then undo it' };

// Vampire resists necrotic damage, so it takes half.
const TARGETS = ['Wolf 1', 'Wolf 2', 'Vampire'];
const DAMAGE = { amount: 14, damageType: 'necrotic' };
let before;

/** Token HP on the active scene, by token name. */
function tokenHp(page) {
  return page.evaluate(names => {
    const out = {};
    for (const name of names) {
      const doc = globalThis.canvas.scene.tokens.find(t => t.name === name);
      out[name] = doc?.actor?.system?.attributes?.hp?.value ?? null;
    }
    return out;
  }, TARGETS);
}

function waitForHp(page, want, timeoutMs = 15000) {
  return page.waitForFunction(
    want =>
      Object.entries(want).every(([name, hp]) => {
        const doc = globalThis.canvas.scene.tokens.find(t => t.name === name);
        return doc?.actor?.system?.attributes?.hp?.value === hp;
      }),
    want,
    { timeout: timeoutMs, polling: 200 }
  );
}

/** Before recording: open and prepare every window the take shows. */
export async function setup(t) {
  const gm = await t.foundry('Foundry', { user: DEMO_USERS.gm });
  await closeAllWindows(gm.page);
  await unpause(gm.page);
  await panToToken(gm.page, 'Wolf 2', 1);
  before = await tokenHp(gm.page);
  for (const [name, hp] of Object.entries(before)) {
    if (hp === null) throw new Error(`No token "${name}" with HP on the active scene.`);
  }
  // Show HP bars to the viewer and start a fight with the three (not saved: the world is reset
  // next time). The dashboard's turn-order strip shows a running combat only.
  await gm.page.evaluate(async names => {
    const scene = globalThis.canvas.scene;
    const tokens = scene.tokens.filter(t => names.includes(t.name));
    for (const t of tokens) await t.update({ displayBars: 50 });
    const combat = await globalThis.Combat.create({ scene: scene.id, active: true });
    await combat.createEmbeddedDocuments(
      'Combatant',
      tokens.map((t, i) => ({
        tokenId: t.id,
        sceneId: scene.id,
        actorId: t.actorId,
        initiative: 18 - i * 3,
      }))
    );
    await combat.update({ round: 1, turn: 0 });
  }, TARGETS);
  // The strip's combat buttons are off by default and switched on under Advanced (D-092).
  await setDashboardPrefsApi(t.env.dashboardUrl, { combatButtons: true });
  const dash = await t.dashboard();
  await setGmActions(dash.page, false);
  await dash.page.locator('#moments [data-moment="during"]').click();
  await dash.page
    .locator('#pane-combat .combatant[data-name="Wolf 1"]')
    .waitFor({ timeout: 20000 });
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

  await t.step('select', 'Pick the three creatures in the turn-order strip', async () => {
    for (const name of TARGETS) {
      await humanClick(page.locator(`#pane-combat .combatant[data-name="${name}"]`));
      await t.pause(400);
    }
    await page.locator('[data-sel="damage"]').waitFor({ state: 'visible' });
    await t.pause(800);
    await t.shot('Dashboard', 'damage-selected');
  });

  await t.step('open-form', 'Damage / Heal: enter the amount and the damage type', async () => {
    await humanClick(page.locator('[data-sel="damage"]'));
    const amount = page.locator('#tool-form .field[data-key="amount"] .field-control');
    await amount.waitFor({ state: 'visible' });
    await humanType(amount, String(DAMAGE.amount));
    await humanType(
      page.locator('#tool-form .field[data-key="damageType"] .field-control'),
      DAMAGE.damageType
    );
    await t.pause(1000);
    await t.shot('Dashboard', 'damage-form');
  });

  await t.step(
    'apply',
    'One click applies it to all three; dnd5e halves it for the Vampire',
    async () => {
      await humanClick(page.locator('#tool-form button[type=submit]'));
      await page.locator('.toast-undo').first().waitFor({ state: 'visible', timeout: 20000 });
      await t.pause(2500);
      await t.shot('Dashboard', 'damage-applied');
    }
  );

  let after;
  await t.step('watch-damage', 'HP drops on all three tokens in Foundry', async () => {
    const gm = await t.scene('Foundry');
    await gm.page.waitForFunction(
      before =>
        Object.entries(before).every(([name, hp]) => {
          const doc = globalThis.canvas.scene.tokens.find(t => t.name === name);
          return doc?.actor?.system?.attributes?.hp?.value < hp;
        }),
      before,
      { timeout: 15000, polling: 200 }
    );
    after = await tokenHp(gm.page);
    await t.pause(2500);
    await t.shot('Foundry', 'damage-tokens');
  });

  await t.step('undo', 'Undo it in Recent Changes', async () => {
    await t.scene('Dashboard');
    await closeTools(page, human);
    await t.pause(800);
    await humanClick(newestUndoButton(page));
    await readConfirmModal(page);
    await t.pause(1500);
    await t.shot('Dashboard', 'damage-undo-confirm');
    await confirmModal(page, human);
    await t.pause(1200);
  });

  await t.step('watch-undo', 'All three are back to full HP', async () => {
    const gm = await t.scene('Foundry');
    await waitForHp(gm.page, before);
    await t.pause(2500);
    await t.shot('Foundry', 'damage-undone');
  });

  await setGmActions(page, false);
  console.log(`  HP before ${JSON.stringify(before)}, after damage ${JSON.stringify(after)}`);
}
