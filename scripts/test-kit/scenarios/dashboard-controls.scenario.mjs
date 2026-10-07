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
 */
import {
  CONTROLS,
  countByHow,
  groupedRows,
  moduleSkips,
  readUsageCatalog,
} from '../lib/dashboard-controls.mjs';
import { sweepGroups } from '../lib/dashboard-sweep.mjs';

const VIEWPORT = { width: 1440, height: 900 };

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'dashboard-controls',
  title: 'Every dashboard and player control is there, opens what it should and logs no console error',
  sizes: ['full', 'long'],
  tags: ['dashboard', 'player'],
  needs: [],
  tools: [],
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
          await page.locator('#btn-gm').click();
          await page.waitForFunction(
            () => /:\s*on/i.test(document.querySelector('#btn-gm')?.textContent ?? ''),
            undefined,
            { timeout: 10000 }
          );
        }
        return `${CONTROLS.length} controls in the table; GM Actions ${gmWasOn ? 'were on' : 'turned on (put back at the end)'}`;
      });

      await sweepGroups({ t, page, surface: 'dashboard', groups: groupedRows('dashboard'), results });

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
        results.push({ name: m.name, group: 'module', how: 'skip', status: 'skip', note: m.why ?? '' });
      }
      t.attach('controls', results);
      const count = (/** @type {string} */ s) => results.filter(r => r.status === s).length;
      t.log(
        `${results.length} controls: ${count('pass')} passed, ${count('fail')} failed, ${count('skip')} skipped`
      );
    }
  },
};
