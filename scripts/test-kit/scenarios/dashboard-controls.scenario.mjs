/**
 * The dashboard control sweep: every control the usage catalog names for the GM dashboard and the
 * player page is opened, clicked or checked in a real browser, so a control that went missing, opens
 * nothing or logs a console error shows up in the report. The classification table is
 * lib/dashboard-controls.mjs (a unit test keeps it in step with the catalog); the page driver is
 * lib/dashboard-sweep.mjs. Controls that change Foundry or the world (write rows) are never clicked
 * here, the Foundry-only module controls are listed as skipped.
 *
 * One screenshot per drawer, view, moment and During layout goes into the report for a person to
 * review (no pixel comparison).
 *
 * The combat strip's controls only show with a live combat: when the kit has its scene and a
 * legendary monster, the sweep runs during a combat of that boss and one hero, with Combat buttons
 * on (both put back at the end), and the six combat rows must then pass instead of being skipped.
 */
import {
  CONTROLS,
  countByHow,
  groupedRows,
  moduleSkips,
  readUsageCatalog,
} from '../lib/dashboard-controls.mjs';
import { sweepGroups } from '../lib/dashboard-sweep.mjs';
import { tokenHeroes, waitFor } from '../lib/helpers.mjs';

const VIEWPORT = { width: 1440, height: 900 };

/** The combat strip rows that need a combat with a boss; they must pass when the sweep seeds one. */
export const BOSS_COMBAT_ROWS = [
  'dash.combat.boss-prompts',
  'dash.combat.reaction',
  'dash.combat.select-combatant',
  'dash.combat.selection-clear',
  'dash.combat.selection-condition',
  'dash.combat.selection-damage',
];

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'dashboard-controls',
  title:
    'Every dashboard and player control is there, opens what it should and logs no console error',
  sizes: ['full', 'long'],
  tags: ['dashboard', 'player'],
  needs: [],
  tools: [],
  gmActions: ['startCombat', 'endCombats'],
  timeoutMs: 600000,

  async run(t) {
    if (!t.browser) {
      await t.step('a real browser is needed', async () => t.skip('needs a real browser'));
    }
    const browser = t.browser;

    /** @type {import('../lib/dashboard-sweep.mjs').ResultRow[]} */
    const results = [];
    const catalog = readUsageCatalog();
    t.attach('classes', countByHow(CONTROLS));

    try {
      /** @type {import('playwright-core').Page} */
      let page;
      await t.step('open the dashboard', async () => {
        page = await browser.open('/', { viewport: VIEWPORT });
        await page
          .waitForFunction(
            () => {
              const bridge = document.querySelector('#status-bridge')?.textContent ?? '';
              return bridge !== '' && !/connecting/i.test(bridge);
            },
            undefined,
            { timeout: 30000 }
          )
          .catch(() => {
            throw new Error('the dashboard never connected to its bridge');
          });
        await page.waitForTimeout(800);
        // GM Actions on for the run (the Everyone tab's Undo opens its window only then), put back
        // afterwards. The sweep never clicks a write row, so nothing else changes.
        const tools = await t.http('/api/tools');
        const gmWasOn = tools.status === 200 && tools.data?.gmActionsEnabled === true;
        if (!gmWasOn) {
          t.cleanup(async () => {
            await t.http('/api/control', {
              method: 'POST',
              body: { action: 'set-gm-actions', value: false },
            });
          });
          // Set, not toggled: a click would turn GM Actions off if they came on in between.
          await t.http('/api/control', {
            method: 'POST',
            body: { action: 'set-gm-actions', value: true },
          });
          await page.waitForFunction(
            () => /:\s*on/i.test(document.querySelector('#btn-gm')?.textContent ?? ''),
            undefined,
            { timeout: 10000 }
          );
        }
        return `${CONTROLS.length} controls in the table; GM Actions ${gmWasOn ? 'were on' : 'turned on (put back at the end)'}`;
      });

      /** @type {string | null} */
      let combatNote = null;
      await t.step('a combat with a boss for the combat strip', async () => {
        const boss = t.kit?.monsters?.find(m => m.cell === 'legendary' && m.tokenId);
        const hero = t.kit ? tokenHeroes(t.kit)[0] : undefined;
        const sceneId = t.kit?.scene?.sceneId;
        if (!boss || !hero || !sceneId || !t.page) {
          combatNote = t.page
            ? 'no kit scene with a legendary monster and a hero token'
            : 'no GM session in Foundry';
          return `${combatNote}: the combat rows are skipped`;
        }
        // Combat buttons are a per-world screen choice; read it from the page, set it, put it back.
        const buttonsWereOn = await page.evaluate(() =>
          /:\s*on/i.test(document.querySelector('#btn-combat-buttons')?.textContent ?? '')
        );
        if (!buttonsWereOn) {
          t.cleanup(async () => {
            await t.http('/api/control', {
              method: 'POST',
              body: { action: 'set-prefs', value: { combatButtons: false } },
            });
          });
          // The server answers 409 until it has read the world from the bridge (just after a
          // Foundry restart or a module sync), so the first tries may be refused.
          /** @type {any} */
          let set = null;
          await waitFor(
            async () => {
              set = await t.http('/api/control', {
                method: 'POST',
                body: { action: 'set-prefs', value: { combatButtons: true } },
              });
              return set.status !== 409;
            },
            { label: 'the dashboard to know the world (set-prefs answers 409 before)' }
          );
          t.check(set?.status === 200, 'Combat buttons turned on', set);
        }
        t.cleanup(async () => {
          await t.gm('endCombats');
        });
        await t.gm('startCombat', { sceneId, tokenIds: [boss.tokenId, hero.tokenId] });
        await page
          .waitForFunction(
            () => {
              const toggle = document.querySelector('#boss-toggle');
              return !!toggle && !(/** @type {HTMLElement} */ (toggle).hidden);
            },
            undefined,
            { timeout: 20000 }
          )
          .catch(() => {
            throw new Error(`the dashboard shows no Boss prompts toggle for ${boss.name}`);
          });
        return `${boss.name} (legendary) and ${hero.name} in combat; Combat buttons ${buttonsWereOn ? 'were on' : 'turned on (put back at the end)'}`;
      });

      await sweepGroups({
        t,
        page,
        surface: 'dashboard',
        groups: groupedRows('dashboard'),
        results,
      });

      if (!combatNote) {
        await t.step('the combat strip rows ran during the boss combat', async () => {
          for (const name of BOSS_COMBAT_ROWS) {
            const row = results.find(r => r.name === name);
            t.check(row?.status === 'pass', `${name} passed`, row ?? 'not in the results');
          }
        });
      }

      /** @type {import('playwright-core').Page} */
      let playerPage;
      await t.step('open the player page', async () => {
        playerPage = await browser.open('/player', { viewport: VIEWPORT });
        await playerPage.waitForSelector('#combat', { timeout: 15000 });
        await playerPage.waitForTimeout(800);
      });

      await sweepGroups({
        t,
        page: playerPage,
        surface: 'player',
        groups: groupedRows('player'),
        results,
      });
    } finally {
      for (const m of moduleSkips(catalog)) {
        results.push({
          name: m.name,
          group: 'module',
          how: 'skip',
          status: 'skip',
          note: m.why ?? '',
        });
      }
      t.attach('controls', results);
      const count = (/** @type {string} */ s) => results.filter(r => r.status === s).length;
      t.log(
        `${results.length} controls: ${count('pass')} passed, ${count('fail')} failed, ${count('skip')} skipped`
      );
    }
  },
};
