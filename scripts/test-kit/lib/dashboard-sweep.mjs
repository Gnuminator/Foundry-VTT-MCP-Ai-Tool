/**
 * The dashboard control sweep's page driver (test kit slice 4). It walks the classification table of
 * lib/dashboard-controls.mjs on a real page: reaches each control, clicks it, checks what it must open
 * or close, puts the page back, and keeps one result row per control.
 *
 * It only ever clicks controls the table marks open, read or toggle; write, error and skip rows are
 * reported as skipped and never touched. A row fails when the control is missing, its `expect` never
 * shows (or its `gone` never goes), or the page logged a console error while the row ran.
 */
import { CONTROLS, groupOf } from './dashboard-controls.mjs';

const WAIT_MS = 8000;
const SLOW_MS = 60000;
const OPTIONAL_MS = 3000;
const SETTLE_MS = 250;

/** @typedef {import('./dashboard-controls.mjs').ControlRow} ControlRow */
/** @typedef {{name: string, group: string, how: string, status: 'pass' | 'fail' | 'skip', note: string}} ResultRow */

/** @type {Map<string, ControlRow>} */
const BY_NAME = new Map(CONTROLS.map(r => [r.name, r]));

/** The CSS selector of a row's control. */
export function selectorOf(row) {
  return row.selector ?? `[data-track="${row.name}"]`;
}

/** The file name of a row's screenshot: `dash.party.view` is `party-view.png`. */
export function shotName(row) {
  return `${row.name.replace(/^(dash|player)\./, '').replace(/\./g, '-')}.png`;
}

/** Whether a row's page is worth a screenshot: every view, and the moments and During layouts. */
export function wantsShot(row) {
  return (
    row.how === 'view' ||
    (row.how === 'toggle' && row.restore === false && /^dash\.(moment|during)\./.test(row.name))
  );
}

/** Rows a test may never click. */
export const NEVER_CLICK = ['write', 'error', 'skip'];

export class Skip extends Error {}

/**
 * @param {import('playwright-core').Page} page
 * @param {string} selector
 */
const visible = (page, selector) => page.locator(`${selector}:visible`);

/**
 * Close everything that is open: the confirm window, the layout trial, panels, drawers and the
 * Advanced menu. A docked drawer has no visible Close button and is left alone.
 * @param {import('playwright-core').Page} page
 */
export async function resetDashboard(page) {
  await page.evaluate(() => {
    const shown = /** @param {Element | null} el */ el =>
      !!el &&
      !!(
        /** @type {HTMLElement} */ (el.offsetWidth || /** @type {HTMLElement} */ (el).offsetHeight)
      ) &&
      getComputedStyle(el).visibility !== 'hidden';
    const press = /** @param {string} s */ s => {
      const el = document.querySelector(s);
      if (shown(el)) /** @type {HTMLElement} */ (el).click();
    };
    if (shown(document.querySelector('#modal-backdrop'))) press('#modal-cancel');
    // The undo window closes on a click on its backdrop (I-109); Recent Changes goes back to the AI tab.
    press('#undo-backdrop');
    if (document.querySelector('#changes-tab-everyone[aria-pressed="true"]'))
      press('#changes-tab-ai');
    press('#layout-tour-stop');
    // Opening a During card folds its side cards (wide screens), and the fold rows' restore click
    // does not reopen them: open Recent Changes again for the rows that read #changes-body.
    press('.fold-btn[data-fold="changes"][aria-expanded="false"]');
    // A selected combatant stays selected: clear it, so the next click selects instead of unselecting.
    press('#combat-actions .ca-btn.ghost');
    for (const pane of ['#pane-ai', '#pane-diagnostics', '#pane-links', '#pane-help'])
      press(`${pane} .overlay-close`);
    for (const close of [
      '#drawer-close',
      '#tarokka-close',
      '#prep-close',
      '#party-close',
      '#handouts-close',
      '#preflight-close',
    ])
      press(close);
    // A click on the page closes the Advanced menu.
    document.body.click();
  });
  await page.waitForTimeout(60);
}

/**
 * The player page keeps a stored name: forget it and reload, so the name picker shows again.
 * @param {import('playwright-core').Page} page
 */
export async function resetPlayer(page) {
  await page.evaluate(() => {
    try {
      localStorage.removeItem('cogm_player_who');
    } catch {
      /* no storage */
    }
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(400);
}

/**
 * Open a tool whose form has a "Pick..." button (the Tool Runner drawer must be open).
 * @param {import('playwright-core').Page} page
 * @returns {Promise<string | null>} the tool's name, or null when no tool has a picker
 */
async function openPickerTool(page) {
  const items = visible(page, '#tool-list .tool-item');
  await items.first().waitFor({ state: 'visible', timeout: WAIT_MS });
  const count = Math.min(await items.count(), 60);
  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    const name = await item.getAttribute('data-tool');
    await item.click();
    await visible(page, '#tool-detail').first().waitFor({ state: 'visible', timeout: WAIT_MS });
    if ((await visible(page, '#tool-form .ref-open').count()) > 0) return name;
    await visible(page, '#tool-back').first().click();
    await visible(page, '#tool-list').first().waitFor({ state: 'visible', timeout: WAIT_MS });
  }
  return null;
}

/** A string that changes when the element's label, class, pressed state or value changes. */
function stateScript() {
  return /** @param {Element | null} el */ el => {
    if (!el) return 'missing';
    const e = /** @type {HTMLInputElement} */ (el);
    return [
      (el.textContent || '').trim(),
      el.className,
      el.getAttribute('aria-pressed'),
      e.checked ?? '',
      e.value ?? '',
    ].join('|');
  };
}

/**
 * @param {import('playwright-core').Page} page
 * @param {string} selector
 * @param {number} timeout
 */
async function waitVisible(page, selector, timeout) {
  await visible(page, selector)
    .first()
    .waitFor({ state: 'visible', timeout })
    .catch(() => {
      throw new Error(`${selector} did not show`);
    });
}

/**
 * @param {import('playwright-core').Page} page
 * @param {string} selector
 * @param {number} timeout
 */
async function waitGone(page, selector, timeout) {
  try {
    await page.waitForFunction(
      sel =>
        !Array.from(document.querySelectorAll(sel)).some(
          el =>
            /** @type {HTMLElement} */ (el).offsetWidth ||
            /** @type {HTMLElement} */ (el).offsetHeight
        ),
      selector,
      { timeout }
    );
  } catch {
    throw new Error(`${selector} did not go away`);
  }
}

/**
 * True once the control is enabled. A tab that loads on open disables its own
 * button until the load ends (Prep refresh, Preflight run), so wait for it.
 * @param {import('playwright-core').Locator} control
 * @param {number} timeout
 */
async function waitEnabled(control, timeout) {
  const end = Date.now() + timeout;
  for (;;) {
    if (await control.isEnabled()) return true;
    if (Date.now() >= end) return false;
    await new Promise(resolve => setTimeout(resolve, SETTLE_MS));
  }
}

/**
 * Click the reach chain of a row in order.
 * @param {import('playwright-core').Page} page
 * @param {ControlRow} row
 */
export async function walkReach(page, row) {
  let pickerDone = false;
  const ensurePicker = async () => {
    if (row.needs !== 'picker-tool' || pickerDone) return;
    pickerDone = true;
    const tool = await openPickerTool(page);
    if (tool) return;
    // A required row (pick-open) fails: the runner always has tools with a Pick button.
    if (row.optional) throw new Skip('no tool in the runner has a Pick button');
    throw new Error('no tool in the runner has a Pick button');
  };
  for (const name of row.reach ?? []) {
    if (name === 'dash.tools.pick-open') await ensurePicker();
    const step = BY_NAME.get(name);
    if (!step) throw new Error(`reach names "${name}", which is not in the table`);
    const control = visible(page, selectorOf(step)).first();
    if (step.optional) {
      const found = await control
        .waitFor({ state: 'visible', timeout: OPTIONAL_MS })
        .then(() => true)
        .catch(() => false);
      if (!found) throw new Skip(`needs "${name}", which is not on the screen`);
    }
    try {
      await control.click({ timeout: WAIT_MS });
    } catch {
      throw new Error(`could not click "${name}" on the way`);
    }
    await page.waitForTimeout(80);
    // A slow step loads from the bridge (the undo window plans first): wait for what it opens.
    if (step.slow && step.expect) await waitVisible(page, step.expect, SLOW_MS);
  }
  await ensurePicker();
}

/**
 * Switch the theme select, returning the way back.
 * @param {import('playwright-core').Page} page
 * @param {string} theme
 * @returns {Promise<() => Promise<void>>}
 */
async function withTheme(page, theme) {
  const select = visible(page, '[data-track="dash.header.theme"]').first();
  const current = await select.inputValue();
  if (current === theme) return async () => {};
  await select.selectOption(theme);
  await page.waitForFunction(t => document.documentElement.dataset.theme === t, theme, {
    timeout: WAIT_MS,
  });
  return async () => {
    await select.selectOption(current);
    await page.waitForTimeout(SETTLE_MS);
  };
}

/**
 * Run one open, read or toggle row once its control is found.
 * @param {import('playwright-core').Page} page
 * @param {ControlRow} row
 * @param {import('playwright-core').Locator} control
 * @returns {Promise<string>}  a note
 */
async function actOn(page, row, control) {
  const wait = row.slow ? SLOW_MS : WAIT_MS;
  const tag = await control.evaluate(
    el => `${el.tagName}:${/** @type {HTMLInputElement} */ (el).type || ''}`
  );
  const watch = typeof row.changes === 'string' ? visible(page, row.changes).first() : control;
  const read = () =>
    watch.evaluate(stateScript(), undefined, { timeout: 1500 }).catch(() => 'gone');

  if (tag.startsWith('SELECT')) {
    const options = await control.evaluate(el =>
      Array.from(/** @type {HTMLSelectElement} */ (el).options).map(o => o.value)
    );
    const before = await control.inputValue();
    const other = options.find(v => v !== before);
    if (!other) throw new Skip('the select has only one option');
    await control.selectOption(other);
    await page.waitForTimeout(SETTLE_MS);
    if ((await control.inputValue()) !== other)
      throw new Error(`the select did not take "${other}"`);
    if (row.name === 'dash.header.theme') {
      await page.waitForFunction(t => document.documentElement.dataset.theme === t, other, {
        timeout: WAIT_MS,
      });
    }
    if (row.expect) await waitVisible(page, row.expect, wait);
    await control.selectOption(before);
    await page.waitForTimeout(SETTLE_MS);
    return `${before} to ${other} and back`;
  }

  if (tag === 'INPUT:checkbox') {
    const before = await control.isChecked();
    await control.click();
    if ((await control.isChecked()) === before) throw new Error('the box did not change');
    if (row.expect) await waitVisible(page, row.expect, wait);
    if (row.restore !== false) await control.click();
    return 'ticked and put back';
  }

  if (row.fill !== undefined) {
    await control.fill(row.fill);
    if (row.expect) await waitVisible(page, row.expect, wait);
    await control.fill('');
    return `typed "${row.fill}"`;
  }

  const before = row.changes ? await read() : '';
  if (row.at) await control.click({ position: row.at, timeout: wait });
  else await control.click({ timeout: wait });
  await page.waitForTimeout(80);

  if (row.expect) await waitVisible(page, row.expect, wait);
  if (row.gone) await waitGone(page, row.gone, wait);
  if (row.changes) {
    const until = Date.now() + WAIT_MS;
    while ((await read()) === before) {
      if (Date.now() > until) throw new Error('nothing on the control changed');
      await page.waitForTimeout(100);
    }
  }
  if (!row.expect && !row.gone && !row.changes) await page.waitForTimeout(SETTLE_MS);

  if (row.how === 'toggle' && row.restore !== false) {
    // The click may have closed the menu the control sits in; open it again first.
    if (!(await control.isVisible())) await walkReach(page, row);
    await control.click({ timeout: wait });
    await page.waitForTimeout(SETTLE_MS);
    return 'clicked and put back';
  }
  return row.how === 'read' ? 'clicked, the panel loaded' : 'clicked';
}

/**
 * Run one row.
 * @param {{page: import('playwright-core').Page, t: import('./contract.mjs').ScenarioContext,
 *   reset: () => Promise<void>, surface: 'dashboard' | 'player'}} ctx
 * @param {ControlRow} row
 * @returns {Promise<ResultRow>}
 */
export async function runRow(ctx, row) {
  const { page, t } = ctx;
  const base = { name: row.name, group: groupOf(row.name), how: row.how };
  if (NEVER_CLICK.includes(row.how)) {
    return { ...base, status: 'skip', note: row.why ?? row.how };
  }
  const errorsBefore = t.browser ? t.browser.consoleErrors(page).length : 0;
  /** @type {() => Promise<void>} */
  let undoTheme = async () => {};
  /** @type {ResultRow} */
  let result;
  try {
    await ctx.reset();
    if (row.theme) undoTheme = await withTheme(page, row.theme);
    await walkReach(page, row);
    let note = '';
    const wait = row.slow ? SLOW_MS : WAIT_MS;
    if (row.idle) await waitVisible(page, row.idle, SLOW_MS);
    if (row.how === 'view') {
      if (row.expect) await waitVisible(page, row.expect, wait);
      note = 'drawn';
    } else if (row.how === 'shortcut') {
      await page.keyboard.press(row.key ?? 'Escape');
      if (row.expect) await waitVisible(page, row.expect, wait);
      if (row.gone) await waitGone(page, row.gone, wait);
      note = `${row.key} pressed`;
    } else {
      const control = visible(page, selectorOf(row)).first();
      const found = await control
        .waitFor({ state: 'visible', timeout: row.optional ? OPTIONAL_MS : WAIT_MS })
        .then(() => true)
        .catch(() => false);
      if (!found) {
        if (row.optional) throw new Skip(`not on the screen: ${row.why ?? 'depends on the data'}`);
        throw new Error(`control ${selectorOf(row)} is not on the screen`);
      }
      if (!(await waitEnabled(control, row.optional ? OPTIONAL_MS : wait))) {
        if (row.optional) throw new Skip(`disabled: ${row.why ?? 'depends on the data'}`);
        throw new Error('the control is disabled');
      }
      if (row.how === 'external') {
        const href = await control.getAttribute('href');
        const isLink = (await control.evaluate(el => el.tagName)) === 'A';
        if (isLink && (!href || href === '#')) throw new Error('the link has no address');
        if (row.expect) await waitVisible(page, row.expect, wait);
        note = isLink
          ? `present, enabled, links to ${href.slice(0, 40)}`
          : 'present, enabled (not clicked)';
      } else if (row.how === 'ai') {
        if (row.expect) await waitVisible(page, row.expect, wait);
        note = 'present (not used)';
      } else {
        note = await actOn(page, row, control);
      }
    }
    result = { ...base, status: 'pass', note };
    if (wantsShot(row)) {
      await page.waitForTimeout(350); // a drawer slides in
      const png = await page.screenshot().catch(() => null);
      if (png) t.attachFile(shotName(row), png);
    }
  } catch (e) {
    result =
      e instanceof Skip
        ? { ...base, status: 'skip', note: e.message }
        : {
            ...base,
            status: 'fail',
            note: String(/** @type {any} */ (e)?.message || e).split('\n')[0],
          };
  } finally {
    await undoTheme().catch(() => {});
  }
  // Let a late console error (a request the row's click started) land on this row, not the next one.
  if (t.browser) await page.waitForTimeout(SETTLE_MS).catch(() => {});
  const grown = t.browser ? t.browser.consoleErrors(page).slice(errorsBefore) : [];
  if (grown.length) {
    // A console error fails the row whatever else happened, also a skipped one (the page erred
    // while the row looked for its control).
    const also = result.status === 'pass' ? '' : ` (and ${result.status}: ${result.note})`;
    result = {
      ...result,
      status: 'fail',
      note: `console error: ${grown[0].message.replace(/\s+/g, ' ').slice(0, 160)}${also}`,
    };
  }
  return result;
}

/**
 * Run a surface's groups, one report step per group.
 * @param {{
 *   t: import('./contract.mjs').ScenarioContext,
 *   page: import('playwright-core').Page,
 *   surface: 'dashboard' | 'player',
 *   groups: Array<{group: string, rows: ControlRow[]}>,
 *   results: ResultRow[]
 * }} p
 */
export async function sweepGroups({ t, page, surface, groups, results }) {
  const reset = () => (surface === 'player' ? resetPlayer(page) : resetDashboard(page));
  const ctx = { page, t, reset, surface };
  for (const { group, rows } of groups) {
    await t.step(
      `${surface} controls: ${group}`,
      async () => {
        /** @type {string | null} */
        let layout = null;
        if (surface === 'dashboard' && group === 'during') {
          layout = await page.getAttribute('#moment-during', 'data-layout').catch(() => null);
        }
        /** @type {ResultRow[]} */
        const mine = [];
        for (const row of rows) {
          const r = await runRow(ctx, row);
          mine.push(r);
          results.push(r);
        }
        if (layout) {
          // Put the layout back (the trial's "kept" flag stays set: there is no way back in the screen).
          await resetDashboard(page);
          await visible(page, '[data-track="dash.moment.during"]')
            .first()
            .click()
            .catch(() => {});
          await visible(page, `[data-layout-pick="${layout}"]`)
            .first()
            .click()
            .catch(() => {});
        }
        const failed = mine.filter(r => r.status === 'fail');
        const passed = mine.filter(r => r.status === 'pass').length;
        const skipped = mine.filter(r => r.status === 'skip').length;
        t.check(
          failed.length === 0,
          `${failed.length} of ${mine.length} control(s) failed: ${failed
            .map(r => `${r.name} (${r.note})`)
            .join('; ')}`
        );
        return `${passed} passed, ${skipped} skipped`;
      },
      { continueOnFail: true }
    );
  }
}
