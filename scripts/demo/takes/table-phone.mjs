// Table demo, beat 2 (vault Design/30-second table demo.md, script v2): the players' page
// on a phone. The turn order with HP as words, then a handout the GM reveals appears.
//
//   npm run demo:take -- table-phone
//
// The page is 430x932 CSS pixels at 2x (860x1864 device pixels) in the top-left corner of
// the recording; the edit cuts it out and puts it into the phone frame. Everything shown
// is invented: the hero's name and the Danish letter (no book text).

import { humanClick } from '../lib/browser.mjs';
import { callToolApi, setGmActionsApi } from '../lib/dashboard.mjs';
import { DEMO_USERS } from '../lib/env.mjs';
import { closeAllWindows, unpause } from '../lib/foundry.mjs';

export const meta = { title: 'The players’ page on a phone: turn order and a handout' };

const HERO = 'Brenna';
const PHONE = { css: { width: 430, height: 932 }, scale: 2 };
const LETTER = {
  journal: 'Breve',
  page: 'Et brev uden afsender',
  html:
    '<p>Til den, der finder dette,</p>' +
    '<p>Ulvene kommer ikke af sig selv. Nogen kalder på dem fra den gamle mølle, ' +
    'hver nat når månen står over åsen. Gå derhen ved midnat, og kom alene.</p>' +
    '<p>En ven</p>',
};

/** Before recording: GM in Foundry, a fight running, the letter queued, the phone page. */
export async function setup(t) {
  const gm = await t.foundry('Foundry', { user: DEMO_USERS.gm });
  await closeAllWindows(gm.page);
  await unpause(gm.page);
  const ids = await gm.page.evaluate(
    async ({ name, letter }) => {
      const g = globalThis.game;
      const s = globalThis.canvas.scene;
      const actor = g.actors.getName('Test Hero');
      await actor.update({ name, 'prototypeToken.name': name });
      const hero = s.tokens.find(t => t.actorId === actor.id);
      await hero.update({ name });
      // A fight: the hero and the three wolves; Wolf 2 is hurt ("Bloodied" on the page).
      const fighters = s.tokens.filter(t => t.id === hero.id || /^Wolf \d$/.test(t.name));
      const combat = await globalThis.Combat.create({ scene: s.id, active: true });
      await combat.createEmbeddedDocuments(
        'Combatant',
        fighters.map(t => ({ tokenId: t.id, sceneId: s.id, actorId: t.actorId }))
      );
      await combat.rollAll();
      await combat.startCombat();
      const wolf2 = s.tokens.find(t => t.name === 'Wolf 2');
      await wolf2.actor.update({ 'system.attributes.hp.value': 4 });
      // The handout: a GM-only journal; revealing it copies it to the players.
      const entry =
        g.journal.getName(letter.journal) ??
        (await globalThis.JournalEntry.create({
          name: letter.journal,
          ownership: { default: 0 },
          pages: [{ name: letter.page, type: 'text', text: { content: letter.html } }],
        }));
      return { pageUuid: entry.pages.getName(letter.page).uuid, sceneId: s.id };
    },
    { name: HERO, letter: LETTER }
  );
  await setGmActionsApi(t.env.dashboardUrl, true);
  await callToolApi(t.env.dashboardUrl, 'plan-page-reveal', { action: 'queue', ...ids });
  t.sceneId = ids.sceneId;

  await t.playerPage(PHONE);
}

/** The recorded part. */
export async function run(t) {
  const page = (await t.scene('Player page')).page;

  await t.step('turn-order', 'The turn order, HP as words', async () => {
    await t.pause(3500);
    await t.shot('Player page', 'phone-turn-order');
  });

  await t.step('handout', 'The GM reveals a handout; it appears on the phone', async () => {
    // The GM reveals it from the dashboard (off camera here; the handout-reveal take shows it).
    const plan = await callToolApi(t.env.dashboardUrl, 'plan-page-reveal', {
      action: 'reveal-next',
      sceneId: t.sceneId,
    });
    await callToolApi(t.env.dashboardUrl, 'apply-planned-change', { planId: plan.planId });
    const handout = page.locator('#handouts details.handout', { hasText: LETTER.page });
    await handout.waitFor({ timeout: 10000 });
    await handout.scrollIntoViewIfNeeded();
    await t.pause(1200);
    await humanClick(handout.locator('summary'));
    await t.pause(3500);
    await t.shot('Player page', 'phone-handout');
  });

  await setGmActionsApi(t.env.dashboardUrl, false);
}
