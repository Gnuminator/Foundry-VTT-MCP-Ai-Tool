// Take: the During view's turn-order strip with hit points for everyone (I-192 home page loop).
// Invented creatures of the demo world only.
//
//   npm run demo:take -- during-play

import { humanClick, humanHover } from '../lib/browser.mjs';
import { DEMO_USERS } from '../lib/env.mjs';
import { closeAllWindows, panToToken, unpause } from '../lib/foundry.mjs';

export const meta = { title: 'The turn-order strip: whose turn it is, hit points for everyone' };

const FIGHT = ['Wolf 1', 'Wolf 2', 'Vampire'];

export async function setup(t) {
  const gm = await t.foundry('Foundry', { user: DEMO_USERS.gm });
  await closeAllWindows(gm.page);
  await unpause(gm.page);
  await panToToken(gm.page, 'Wolf 2', 1);
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
  }, FIGHT);
  // A few rolls for the Live Feed.
  await gm.page.evaluate(async () => {
    const speaker = globalThis.ChatMessage.getSpeaker({
      actor: globalThis.game.actors.getName('Test Hero'),
    });
    for (const f of ['1d20+5', '1d8+3', '1d20+2', '2d6']) {
      await new globalThis.Roll(f).toMessage({ speaker, flavor: 'Roll' });
    }
  });
  const dash = await t.dashboard();
  await dash.page.locator('#tab-during').click();
  await dash.page.locator('#pane-combat .combatant').first().waitFor({ timeout: 20000 });
}

export async function run(t) {
  const dash = await t.scene('Dashboard');
  const page = dash.page;
  await t.step('cards', 'Cards: the live feed next to the party and the strip', async () => {
    await t.pause(500);
    await humanClick(page.getByRole('button', { name: 'Cards', exact: true }));
    await t.pause(1500);
    const feed = page.locator('#pane-feed');
    await humanHover(feed.locator('.pane-head h2'), { steps: 24, pauseMs: 900 });
    await t.focus(feed);
    await t.pause(2500);
    await t.shot('Dashboard', 'cards-feed');
  });

  await t.step(
    'strip',
    'The turn-order strip: whose turn it is, hit points for everyone',
    async () => {
      await t.pause(1000);
      const rows = page.locator('#pane-combat .combatant');
      const n = Math.min(await rows.count(), 6);
      for (let i = 0; i < n; i++) {
        await humanHover(rows.nth(i), { steps: 24, pauseMs: 900 });
      }
      await t.focus(page.locator('#pane-combat'));
      await t.pause(1500);
      await t.shot('Dashboard', 'strip');
    }
  );

  // Leave the demo world as it was: setup started a combat, so end it here.
  const gm = await t.scene('Foundry');
  await gm.page.evaluate(async () => {
    for (const c of globalThis.game.combats.filter(c => c.active)) await c.delete();
  });
}
