/**
 * The module control sweep inside Foundry (D-110 decision 5): every control the Foundry AI Tool
 * module adds to Foundry's own screens is opened, clicked or checked in the real client, as the GM
 * ("Kit GM") and as a player ("Kit Player"): the AI Tool group and its three tools in the scene
 * controls, the Changes, Handouts and Tarokka windows, the settings section and its three menus,
 * the join page look dialog, the journal status toggle and the roll request card. A control a player
 * must not have is checked to be absent from the player's screen.
 *
 * The table is lib/foundry-controls.mjs (a unit test keeps it in step with the usage catalog); the
 * rows are in lib/foundry-sweep-*.mjs. One guarded write is followed end to end: a damage change is
 * planned and applied, found in the Changes window, undone and redone there, and put back. Every row
 * puts back what it changed (a cleanup runs at the end of the scenario and tries every put-back, also
 * after a failed row), and a row fails when either page logs a console error while it runs; errors
 * between rows are judged by the last step.
 *
 * The report attaches `foundry-controls` (one row per control and role) and `foundry-timings`
 * (milliseconds for opening each window and for the guarded round trip: the I-098 numbers).
 * `KIT_FOUNDRY_AREAS=scene,changes` runs only those areas (a development filter; `settings` and
 * `join-page` share one driver, so either runs both, the creature index rebuild included).
 */
import { readUsageCatalog } from '../lib/dashboard-controls.mjs';
import { FOUNDRY_CONTROLS, countHows, errorCounterRows, rowsOf } from '../lib/foundry-controls.mjs';
import { changesRows, sceneRows } from '../lib/foundry-sweep-changes.mjs';
import { handoutsRows, tarokkaRows } from '../lib/foundry-sweep-handouts.mjs';
import {
  chatRows,
  journalRows,
  playerHiddenRows,
  playerQueryRows,
} from '../lib/foundry-sweep-play.mjs';
import { settingsRows } from '../lib/foundry-sweep-settings.mjs';
import { Sweep, closeWindows, expandSidebar, resetControls } from '../lib/foundry-sweep.mjs';

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'foundry-controls',
  title:
    'Every control the module adds inside Foundry is there, works for the GM, is hidden from a player, and logs no console error',
  sizes: ['smoke', 'full', 'long'],
  tags: ['module', 'player'],
  needs: ['monsters', 'scene'],
  tools: [
    'plan-actor-change',
    'apply-planned-change',
    'undo-change',
    'list-recent-changes',
    'plan-page-reveal',
    'plan-tarokka-import',
    'get-tarokka-reading',
    'request-ability-check',
  ],
  gmActions: ['setFeatureSwitches'],
  // Foundry logs an error notification as a console error. The runner applies this list to the GM
  // page's module errors for the whole scenario; each row also names its own texts (`expectErrors`),
  // which is what counts for the page console errors of a row. Who owns which message:
  // - "Write the text the players will read first": row foundry.tarokka.reveal-form (an empty reveal
  //   text is refused with a notification);
  // - "also wrote to the AI Tool's own data": rows foundry.handouts.reveal and foundry.tarokka.reveal
  //   (the Changes window cannot undo a reveal, the sweep then uses undo-change);
  // - the 401: rows module.join-page.veil and module.join-page.default only (Foundry answers a saved
  //   world change on /setup with 401 and the data, join-page.ts). It stays here because the runner
  //   blames a module console error on the scenario; it is not needed by any other row.
  knownConsoleErrors: [
    'Write the text the players will read first',
    "also wrote to the AI Tool's own data",
    'status of 401 \\(Unauthorized\\)',
  ],
  timeoutMs: 15 * 60 * 1000,

  async run(t) {
    const gmPage = t.page;
    if (!gmPage || !t.joinFoundry) {
      await t.step('needs the real Foundry page', async () =>
        t.skip('needs a real browser: the Foundry page and a second Edge (none against the fake)')
      );
      return;
    }
    const only = (process.env.KIT_FOUNDRY_AREAS ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const wanted = (/** @type {string} */ area) => only.length === 0 || only.includes(area);

    /** @type {{page: import('playwright-core').Page}} */
    let player;
    await t.step('join the kit world as the kit player', async () => {
      player = await t.joinFoundry('Kit Player');
      const who = await player.page.evaluate(() => ({
        name: game.user.name,
        gm: game.user.isGM,
      }));
      t.check(!who.gm, `${who.name} is a game master; the sweep needs a player`);
      return `${who.name} joined`;
    });
    await expandSidebar(gmPage);
    await expandSidebar(player.page);
    const sweep = new Sweep({ gm: gmPage, player: player.page });
    sweep.attachShot = (name, data) => t.attachFile(name, data);
    t.cleanup(async () => {
      sweep.stop();
      await closeWindows(gmPage).catch(() => {});
      await resetControls(gmPage).catch(() => {});
    });
    const pages = { t, gm: gmPage, player: player.page };

    try {
      if (wanted('scene')) {
        await t.step('scene controls: the AI Tool group and its tools', async () => {
          await sceneRows(sweep, pages);
          return summary(sweep, rowsOf('scene'));
        });
      }
      if (wanted('changes')) {
        await t.step('Changes window, with a guarded write undone and redone', async () => {
          await changesRows(sweep, pages);
          return summary(sweep, rowsOf('changes'));
        });
      }
      if (wanted('handouts')) {
        await t.step('Handouts window, with a reveal undone', async () => {
          await handoutsRows(sweep, pages);
          return summary(sweep, rowsOf('handouts'));
        });
      }
      if (wanted('tarokka')) {
        await t.step('Tarokka window, with a reveal undone', async () => {
          await tarokkaRows(sweep, pages);
          return summary(sweep, rowsOf('tarokka'));
        });
      }
      if (wanted('settings') || wanted('join-page')) {
        await t.step('settings section, its three menus and the join page look', async () => {
          await settingsRows(sweep, pages);
          return summary(sweep, [...rowsOf('settings'), ...rowsOf('join-page')]);
        });
      }
      if (wanted('journal')) {
        await t.step('journal sheet: the campaign status toggle', async () => {
          await journalRows(sweep, pages);
          return summary(sweep, rowsOf('journal'));
        });
      }
      if (wanted('chat')) {
        await t.step('chat: the roll request card', async () => {
          await chatRows(sweep, pages);
          for (const control of rowsOf('chat').filter(r => r.how === 'skip')) {
            sweep.results.push({
              name: control.name,
              who: 'gm',
              status: 'skip',
              ms: 0,
              note: control.why ?? '',
            });
          }
          return summary(sweep, rowsOf('chat'));
        });
      }
      if (wanted('player')) {
        await t.step('what a player cannot call or see', async () => {
          await playerQueryRows(sweep, pages);
          await playerHiddenRows(sweep, pages, wanted);
          return summary(sweep, rowsOf('player'));
        });
      }
    } finally {
      const catalog = readUsageCatalog();
      const attached = [
        ...sweep.results,
        ...errorCounterRows(catalog).map(r => ({
          name: r.name,
          who: /** @type {const} */ ('gm'),
          status: /** @type {const} */ ('skip'),
          ms: 0,
          note: r.why ?? '',
        })),
      ];
      t.attach('foundry-controls', attached);
      t.attach('foundry-timings', sweep.timings);
      t.attach('foundry-control-classes', countHows(FOUNDRY_CONTROLS));
      t.log(
        `${sweep.results.length} checks: ${sweep.count('pass')} passed, ${sweep.count('fail')} failed, ${sweep.count('skip')} skipped`
      );
    }
    // Console errors outside every row (setup between rows, a late error) are judged here, once.
    const failed = [...sweep.failures(), ...sweep.strayErrors()];
    await t.step('no control failed', async () => {
      t.check(failed.length === 0, `${failed.length} control check(s) failed`, failed);
    });
  },
};

/**
 * One line for a step: how many checks of the area's rows passed, failed or skipped. It only returns
 * the line; a failed row is raised by the last step ("no control failed"), with the reasons.
 * @param {Sweep} sweep
 * @param {Array<{name: string}>} rows
 */
function summary(sweep, rows) {
  const names = new Set(rows.map(r => r.name));
  const mine = sweep.results.filter(r => names.has(r.name));
  const count = (/** @type {string} */ s) => mine.filter(r => r.status === s).length;
  return `${mine.length} checks: ${count('pass')} passed, ${count('fail')} failed, ${count('skip')} skipped`;
}
