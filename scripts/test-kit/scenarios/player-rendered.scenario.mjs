/**
 * What the player page shows once its own JavaScript has drawn it. player-no-spoilers reads the
 * projected state and the page's HTML; this one opens /player in a real browser, waits for the combat
 * to be drawn and reads the page as the DOM has it (HTML and visible text). A hidden monster token with
 * a canary name joins a combat with a visible monster and a hero: neither the canary nor the hidden
 * monster's true name may be anywhere on the drawn page, and the page must list two combatants, not
 * three.
 */
import { monsterOf, playerHero } from '../lib/helpers.mjs';

const CANARY = 'KIT-CANARY-RENDERED';

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'player-rendered',
  title: 'The drawn player page shows no hidden token, no true monster name and no canary',
  sizes: ['smoke', 'full'],
  tags: ['player', 'dashboard'],
  needs: ['heroes', 'monsters', 'scene'],
  tools: ['plan-token-change', 'apply-planned-change'],
  gmActions: ['placeToken', 'startCombat', 'endCombats'],
  timeoutMs: 120000,

  async run(t) {
    if (!t.browser) {
      await t.step('a real browser is needed', async () => t.skip('needs a real browser'));
    }
    const browser = t.browser;
    const hero = playerHero(t.kit);
    const visibleMonster = monsterOf(t.kit, 'beast');
    const secret = monsterOf(t.kit, 'flyer');
    const sceneId = t.kit.scene.sceneId;

    /** @type {{tokenId: string}} */
    let hidden;
    await t.step('place a hidden token with a canary name', async () => {
      hidden = await t.gm('placeToken', {
        sceneId,
        actorId: secret.actorId,
        x: t.kit.scene.width - 5,
        y: t.kit.scene.height - 7,
        hidden: true,
        name: CANARY,
      });
      // Runs last: the combat is over by then, so the token can go.
      t.cleanup(async () => {
        await t.guarded.planApply('plan-token-change', { action: 'delete', tokens: [CANARY] });
      });
    });

    /** @type {{combatId: string, combatantIds: string[]}} */
    let combat;
    await t.step('start a combat with the hero, a visible monster and the hidden one', async () => {
      combat = await t.gm('startCombat', {
        sceneId,
        tokenIds: [hero.tokenId, visibleMonster.tokenId, hidden.tokenId],
      });
      t.cleanup(async () => {
        await t.gm('endCombats');
      });
      t.equal(combat.combatantIds.length, 3, 'combatants');
    });

    /** @type {import('playwright-core').Page} */
    let page;
    await t.step('open /player and wait until it has drawn the combat', async () => {
      page = await browser.open('/player', { viewport: { width: 1440, height: 900 } });
      // The page keeps an event stream open, so the network is never idle: wait for what it draws.
      await page.waitForSelector('#world', { state: 'visible', timeout: 15000 });
      await page.waitForFunction(
        () => {
          const status = document.querySelector('#status')?.textContent ?? '';
          const rows = document.querySelectorAll('#combat .row').length;
          return !/connecting/i.test(status) && rows >= 2;
        },
        undefined,
        { timeout: 45000 }
      );
      await page.waitForTimeout(500);
    });

    await t.step('the drawn page names no canary and no true monster name', async () => {
      const html = await page.content();
      const text = await page.locator('body').innerText();
      const state = await page.evaluate(() => ({
        rows: Array.from(document.querySelectorAll('#combat .row .name')).map(
          el => el.textContent ?? ''
        ),
        hpNumbers: Array.from(document.querySelectorAll('#combat .row')).filter(row =>
          /\d+\s*\/\s*\d+/.test(row.textContent ?? '')
        ).length,
      }));
      for (const [label, haystack] of [
        ['the page HTML', html],
        ['the page text', text],
      ]) {
        t.check(!haystack.includes(CANARY), `${CANARY} is in ${label}`);
        t.check(!haystack.includes(secret.name), `${secret.name} (true name) is in ${label}`);
        t.check(
          !haystack.includes(visibleMonster.name),
          `${visibleMonster.name} (true name) is in ${label}`
        );
      }
      t.equal(state.rows.length, 2, 'combatants drawn on the player page');
      t.check(!state.rows.some(name => name.includes(CANARY)), 'a drawn row is the canary token');
      t.equal(state.hpNumbers, 0, 'rows that show hit points as numbers');
      t.attachFile('player-combat.png', await page.screenshot());
      t.check(
        browser.consoleErrors(page).length === 0,
        `the player page logged ${browser.consoleErrors(page).length} console error(s)`
      );
    });
  },
};
