// Take: damage on several targets at once, with dnd5e working out a resistance, then
// Undo in Recent Changes. Something Foundry's own UI does one token at a time (I-095).
//
//   npm run demo:take -- damage-undo

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
  // Show HP bars to the viewer while the take runs (not saved: the world is reset next time).
  await gm.page.evaluate(names => {
    for (const t of globalThis.canvas.tokens.placeables) {
      if (names.includes(t.document.name)) t.document.update({ displayBars: 50 });
    }
  }, TARGETS);
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

  await t.step('open-tool', 'Open plan-actor-change and pick three targets', async () => {
    await openToolForm(
      page,
      'plan-actor-change',
      { action: 'damage', targets: TARGETS, amount: DAMAGE.amount, damageType: DAMAGE.damageType },
      human
    );
    await t.pause(1000);
    await t.shot('Dashboard', 'damage-form');
  });

  await t.step('plan', 'Read what each target will take, resistance included', async () => {
    await submitToolForm(page, human);
    const modal = await readConfirmModal(page);
    for (const name of TARGETS) {
      if (!modal.body.includes(name))
        throw new Error(`Confirm dialog does not name ${name}: ${modal.body}`);
    }
    await t.pause(3500);
    await t.shot('Dashboard', 'damage-confirm');
  });

  let after;
  await t.step('apply', 'Apply it to all three at once', async () => {
    await confirmModal(page, human);
    await t.pause(1500);
    await t.shot('Dashboard', 'damage-applied');
  });

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
