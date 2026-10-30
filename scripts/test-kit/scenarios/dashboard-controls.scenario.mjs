/**
 * The dashboard control sweep: every control the usage catalog names for the GM dashboard and the
 * player page is opened, clicked or checked in a real browser, so a control that went missing, opens
 * nothing or logs a console error shows up in the report. The classification table is
 * lib/dashboard-controls.mjs (a unit test keeps it in step with the catalog); the page driver is
 * lib/dashboard-sweep.mjs. Controls that change Foundry or the world (write rows) are never clicked
 * here. The module controls inside Foundry are listed as skipped; the foundry-controls scenario
 * sweeps them in the Foundry client.
 *
 * One screenshot per drawer, view, moment and During layout goes into the report for a person to
 * review (no pixel comparison).
 *
 * The combat strip's controls only show with a live combat: when the kit has its scene and a
 * legendary monster, the sweep runs during a combat of that boss and one hero
 * (put back at the end), and the six combat rows must then pass instead of being skipped.
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
  'dash.combat.end',
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
  gmActions: ['startCombat', 'endCombats', 'spendLegendary', 'restoreLegendary'],
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
        // The old page (D-126): these steps use its controls; React is at / (D-126).
        page = await browser.open('/legacy/', { viewport: VIEWPORT });
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
            () => {
              const t = document.querySelector('#btn-gm')?.textContent ?? '';
              return t.trim() !== '' && !/GM Actions/i.test(t);
            },
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
        let started = false;
        t.cleanup(async () => {
          const ended = await t.gm('endCombats');
          if (started && !(ended?.ended >= 1)) {
            throw new Error(
              `endCombats ended ${ended?.ended ?? 'no'} combats, expected the boss's`
            );
          }
        });
        await t.gm('startCombat', { sceneId, tokenIds: [boss.tokenId, hero.tokenId] });
        started = true;
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
        return `${boss.name} (legendary) and ${hero.name} in combat`;
      });

      if (!combatNote) {
        await t.step('a legendary action spent in Foundry moves the boss pips', async () => {
          const boss = t.kit?.monsters?.find(m => m.cell === 'legendary' && m.tokenId);
          const sceneId = t.kit?.scene?.sceneId;
          if (!boss || !sceneId) throw new Error('the boss combat step ran without a boss');
          const token = { sceneId, tokenId: boss.tokenId };
          const readPips = () =>
            page.evaluate(() => {
              const text = document.querySelector('.boss-line')?.textContent ?? '';
              const m = /Legendary\s+[◆◇]*\s*(\d+)\/(\d+)/.exec(text);
              return m ? { remaining: Number(m[1]), max: Number(m[2]) } : null;
            });
          const pipsAre = (/** @type {number} */ remaining) =>
            page.waitForFunction(
              want => {
                const text = document.querySelector('.boss-line')?.textContent ?? '';
                const m = /Legendary\s+[◆◇]*\s*(\d+)\/\d+/.exec(text);
                return m !== null && Number(m[1]) === want;
              },
              remaining,
              { timeout: 20000 }
            );
          // Boss prompts is a per-browser switch; the control sweep expects it as it found it.
          const switchText = () =>
            page.evaluate(() => document.querySelector('#boss-toggle')?.textContent ?? '');
          const wasOn = /:\s*on/i.test(await switchText());
          // The page may not show the During view yet (the sweep switches to it itself), so the
          // switch is pressed by script, not by a click that waits for it to be visible.
          const pressSwitch = () =>
            page.evaluate(() =>
              /** @type {HTMLElement | null} */ (document.querySelector('#boss-toggle'))?.click()
            );
          if (!wasOn) await pressSwitch();
          /** @type {any} */
          let spent = null;
          // Cleared only once the pool is back, so a failed restore is tried again in the finally.
          const putBack = async () => {
            if (!spent) return null;
            const restored = await t.gm('restoreLegendary', {
              ...token,
              spent: spent.before.spent,
              messageId: spent.messageId,
            });
            spent = null;
            return restored;
          };
          try {
            const shown = await waitFor(readPips, {
              label: 'the boss line with its legendary pips',
            });
            // A failed spend puts the pool back itself (the action knows what it started from).
            spent = await t.gm('spendLegendary', token);
            const { before, after } = spent;
            t.check(
              after.spent > before.spent,
              `${spent.name}: ${spent.item} spent ${after.spent - before.spent} legendary action(s) in Foundry`,
              spent
            );
            t.check(
              shown.remaining === before.max - before.spent,
              'the pips matched the pool before the spend',
              { shown, before }
            );
            const began = Date.now();
            try {
              await pipsAre(after.max - after.spent);
            } catch {
              throw new Error(
                `the dashboard still shows ${JSON.stringify(await readPips())} 20 s after a legendary action was spent in Foundry (${after.max - after.spent} left)`
              );
            }
            const seconds = Math.round((Date.now() - began) / 100) / 10;
            const name = spent.name;
            const restored = await putBack();
            t.check(restored?.spent === before.spent, 'the legendary pool was put back', restored);
            await pipsAre(before.max - before.spent);
            return `${name} spent a legendary action in Foundry: the pips went ${shown.remaining}/${shown.max} to ${after.max - after.spent}/${after.max} within ${seconds} s, and back once it was put back`;
          } finally {
            try {
              await putBack();
            } finally {
              if (!wasOn && /:\s*on/i.test(await switchText())) await pressSwitch();
            }
          }
        });
      }

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
