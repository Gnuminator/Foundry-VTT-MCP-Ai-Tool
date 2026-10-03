// Table demo, beat 1 (vault Design/30-second table demo.md, script v2): a player rolls in
// Foundry as always, and the tool notes it. Logged in as Player, Test Hero attacks Wolf 2
// from his sheet; the GM applies the damage (off camera, as at the table); the dashboard's
// Live Feed has the line with the breakdown.
//
//   npm run demo:take -- table-player-attack
//
// The dice are seeded so every take is the same: d20 17 (+5 = 22 against AC 12, a hit),
// then d8 6 (+3 = 9 slashing). Foundry maps a random r to ceil((1 - r) * faces).

import { humanClick } from '../lib/browser.mjs';
import { callToolApi, setGmActions } from '../lib/dashboard.mjs';
import { DEMO_USERS } from '../lib/env.mjs';
import { closeAllWindows, unpause } from '../lib/foundry.mjs';

export const meta = { title: 'A player attacks in Foundry; the tool notes it' };

const D20_17 = 0.17;
const D8_6 = 0.3;
// An invented name for the video (the world calls him Test Hero).
const HERO = 'Brenna';

/** Before recording: the GM (the bridge reads through it), the dashboard, the player. */
export async function setup(t) {
  const gm = await t.foundry('Foundry', { user: DEMO_USERS.gm });
  await closeAllWindows(gm.page);
  await unpause(gm.page);
  // The hero (renamed for the video) next to Wolf 2, both HP bars shown, everything else
  // hidden so nothing overlaps; no token vision (the player sees the map). The reset
  // before the next take undoes all of it.
  await gm.page.evaluate(
    async ({ name }) => {
      const s = globalThis.canvas.scene;
      const actor = globalThis.game.actors.getName('Test Hero');
      await actor.update({ name, 'prototypeToken.name': name });
      const hero = s.tokens.find(t => t.actorId === actor.id);
      await hero.update({ name, x: 800, y: 700, displayBars: 50 }, { animate: false });
      for (const t of s.tokens) {
        if (t.id === hero.id) continue;
        await t.update(t.name === 'Wolf 2' ? { displayBars: 50 } : { hidden: true });
      }
      await s.update({ tokenVision: false });
    },
    { name: HERO }
  );
  // A session is running, as at the table.
  await callToolApi(t.env.dashboardUrl, 'mark-play-session', { action: 'start' });

  const dash = await t.dashboard();
  await setGmActions(dash.page, false);

  const player = await t.foundry('Foundry player', { user: DEMO_USERS.player });
  await closeAllWindows(player.page);
  // Layout (1920x1080 CSS), nothing overlapping: the sheet on the left (x 30 to 830), the
  // two tokens in the upper middle, the roll dialogs in the lower middle, the chat cards in
  // their corner at the bottom right; the top right stays free for the edit's overlays.
  await player.page.addStyleTag({
    content: '#tooltip, .locked-tooltip { display: none !important; }',
  });
  await player.page.evaluate(async name => {
    const wolf = globalThis.canvas.tokens.placeables.find(p => p.document.name === 'Wolf 2');
    wolf.setTarget(true, { releaseOthers: true });
    const sheet = globalThis.game.actors.getName(name).sheet;
    await sheet.render(true);
    await new Promise(r => setTimeout(r, 500));
    sheet.setPosition({ left: 30, top: 60 });
    // Hero at screen x about 1080, Wolf 2 at about 1200, both at y about 380.
    await globalThis.canvas.animatePan({ x: 750, y: 883, scale: 1.2, duration: 0 });
    globalThis.Hooks.on('renderApplicationV2', app => {
      if (app.element?.classList.contains('roll-configuration'))
        app.setPosition({ left: 870, top: 560 });
    });
    const orig = globalThis.CONFIG.Dice.randomUniform;
    globalThis.__demoSeed = values => {
      const queue = [...values];
      globalThis.CONFIG.Dice.randomUniform = () => (queue.length ? queue.shift() : orig());
    };
  }, HERO);
}

/** The recorded part. */
export async function run(t) {
  const human = { human: true };
  const gm = t.windows.Foundry.page;
  const page = (await t.scene('Foundry player')).page;

  await t.step('attack', `${HERO} attacks Wolf 2 from the character sheet`, async () => {
    await t.pause(1500);
    await humanClick(page.locator('[data-favorite-id]').filter({ hasText: 'Longsword' }).first());
    const dialog = page.locator('.application.roll-configuration');
    await dialog.waitFor();
    await t.pause(700);
    await page.evaluate(v => globalThis.__demoSeed([v]), D20_17);
    await humanClick(dialog.locator('button[data-action="normal"]'));
    await page.locator('#chat-notifications button[data-action="rollDamage"]').last().waitFor();
    await t.pause(2500);
    await t.shot('Foundry player', 'attack-card');
  });

  await t.step('damage', 'Damage', async () => {
    await humanClick(page.locator('#chat-notifications button[data-action="rollDamage"]').last());
    const dialog = page.locator('.application.roll-configuration');
    await dialog.waitFor();
    await t.pause(600);
    await page.evaluate(v => globalThis.__demoSeed([v]), D8_6);
    await humanClick(dialog.locator('button[data-action="normal"]'));
    await t.pause(1800);
  });

  let hp;
  await t.step('hp-drops', 'The GM applies it; the wolf is nearly down', async () => {
    hp = await gm.evaluate(async () => {
      const m = globalThis.game.messages.contents.at(-1);
      const total = m.rolls?.[0]?.total ?? 0;
      const w = globalThis.canvas.scene.tokens.find(t => t.name === 'Wolf 2');
      await w.actor.applyDamage(total);
      return { damage: total, hp: w.actor.system.attributes.hp.value };
    });
    await t.pause(2800);
    await t.shot('Foundry player', 'hp-dropped');
  });

  await t.step('live-feed', 'The dashboard noted the roll in its Live Feed', async () => {
    const dash = (await t.scene('Dashboard')).page;
    await dash.locator('#feed-body').filter({ hasText: 'Longsword' }).waitFor({ timeout: 10000 });
    await t.pause(4500);
    await t.shot('Dashboard', 'live-feed');
  });

  console.log(`  Wolf 2 took ${hp.damage}, HP now ${hp.hp}`);
}
