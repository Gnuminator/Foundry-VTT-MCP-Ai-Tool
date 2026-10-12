/**
 * The page driver of the module control sweep inside Foundry (scenario `foundry-controls`, table in
 * lib/foundry-controls.mjs). It keeps one result row per control and role, watches each Foundry page
 * for console errors while a row runs, times the row, and offers the small page helpers every area
 * needs (open a scene tool, wait for a window to load, answer a dialog, close what is open).
 *
 * A row fails when its check throws, or when the page logged a console error or a page error while
 * the row ran. A row skips when its check throws {@link Skip} (the reason becomes the note).
 */

const SETTLE_MS = 300;
const WAIT_MS = 10000;

/** @typedef {'gm' | 'player'} Who */
/** @typedef {{name: string, who: Who, status: 'pass' | 'fail' | 'skip', ms: number, note: string}} FoundryResult */

/** A row that cannot run in this world: the message is the reason. */
export class Skip extends Error {}

/**
 * Collect console errors and page errors of a page (a live array).
 * @param {import('playwright-core').Page} page
 * @returns {{errors: string[], stop: () => void}}
 */
export function watchErrors(page) {
  /** @type {string[]} */
  const errors = [];
  /** @param {import('playwright-core').ConsoleMessage} msg */
  const onConsole = msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  };
  /** @param {Error} err */
  const onPageError = err => errors.push(`page error: ${err?.message ?? err}`);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  return {
    errors,
    stop() {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
    },
  };
}

/** What a row's check may return: a note for the report and any timings worth recording. */
/** @typedef {string | {note?: string, timings?: Record<string, number>} | void} RowReturn */

export class Sweep {
  /**
   * @param {{gm: import('playwright-core').Page, player: import('playwright-core').Page}} pages
   */
  constructor(pages) {
    this.pages = pages;
    this.watch = { gm: watchErrors(pages.gm), player: watchErrors(pages.player) };
    /** @type {FoundryResult[]} */
    this.results = [];
    /** Timings that rows reported, by key (milliseconds). @type {Record<string, number>} */
    this.timings = {};
  }

  /** Stop listening. */
  stop() {
    this.watch.gm.stop();
    this.watch.player.stop();
  }

  /**
   * Run one row's check as a role and record the result. Never throws: a failure is a failed row.
   * @param {string} name   the control's name in the table
   * @param {Who} who
   * @param {() => Promise<RowReturn>} fn
   * @param {{expectErrors?: RegExp[]}} [opts]  console errors that belong to the row: Foundry logs every
   *   error notification (a form refused with a message) as a console error, so the row names those
   * @returns {Promise<FoundryResult>}
   */
  async row(name, who, fn, opts = {}) {
    const page = this.pages[who];
    const errors = this.watch[who].errors;
    const before = errors.length;
    const started = Date.now();
    /** @type {FoundryResult} */
    const result = { name, who, status: 'pass', ms: 0, note: '' };
    try {
      const out = await fn();
      if (typeof out === 'string') result.note = out;
      else if (out && typeof out === 'object') {
        result.note = out.note ?? '';
        for (const [key, ms] of Object.entries(out.timings ?? {})) this.timings[`${name}.${key}`] = ms;
      }
    } catch (err) {
      if (err instanceof Skip) {
        result.status = 'skip';
        result.note = err.message;
      } else {
        result.status = 'fail';
        result.note = err instanceof Error ? err.message : String(err);
      }
    }
    // A late error lands on the row that caused it.
    await page.waitForTimeout(SETTLE_MS).catch(() => {});
    const fresh = errors
      .slice(before)
      .filter(e => !(opts.expectErrors ?? []).some(re => re.test(e)));
    result.ms = Date.now() - started - SETTLE_MS;
    if (fresh.length && result.status !== 'skip') {
      result.status = 'fail';
      const first = fresh[0].replace(/\s+/g, ' ').slice(0, 300);
      result.note =
        `${result.note ? `${result.note}; ` : ''}console error: ${first}` +
        (fresh.length > 1 ? ` (+${fresh.length - 1} more)` : '');
    }
    this.results.push(result);
    return result;
  }

  /** Rows of an area's step that failed, as one readable line each. */
  failures(names) {
    return this.results
      .filter(r => r.status === 'fail' && (!names || names.includes(r.name)))
      .map(r => `${r.who} ${r.name}: ${r.note}`);
  }

  /** @param {string} status */
  count(status) {
    return this.results.filter(r => r.status === status).length;
  }
}

// --- Page helpers -------------------------------------------------------------------------------------

/**
 * Open the sidebar, which Foundry starts collapsed in a small headless window: a collapsed sidebar
 * leaves the chat and the settings buttons outside the viewport, where they cannot be clicked.
 * @param {import('playwright-core').Page} page
 */
export async function expandSidebar(page) {
  await page.evaluate(() => {
    // @ts-ignore
    ui.sidebar?.expand?.();
  });
}

/**
 * Close every window and dialog of the page (not the sidebar, the hotbar or the scene controls):
 * the windows the sweep opened, whatever state a failed row left them in.
 * @param {import('playwright-core').Page} page
 */
export async function closeWindows(page) {
  await page.evaluate(async () => {
    // @ts-ignore
    const apps = [...foundry.applications.instances.values()];
    for (const app of apps) {
      const el = app.element;
      if (!(el instanceof HTMLElement)) continue;
      if (!el.querySelector(':scope > .window-header')) continue;
      try {
        await app.close({ animate: false });
      } catch {
        /* already closing */
      }
    }
  });
}

/**
 * Put the scene controls back on the Token layer, which is where a table works.
 * @param {import('playwright-core').Page} page
 */
export async function resetControls(page) {
  const tokens = page.locator('#scene-controls-layers button[data-control="tokens"]');
  if (await tokens.count()) await tokens.click();
}

/**
 * Wait until the window with this id is drawn and has stopped saying "Loading".
 * @param {import('playwright-core').Page} page
 * @param {string} id
 * @param {number} [timeout]
 */
export async function waitLoaded(page, id, timeout = WAIT_MS) {
  await page.waitForFunction(
    windowId => {
      const w = document.getElementById(windowId);
      const content = w?.querySelector('.window-content');
      return !!content && !/Loading/i.test(content.textContent ?? '');
    },
    id,
    { timeout }
  );
}

/**
 * Click a tool of the "AI Tool" scene controls group and wait for its window to load.
 * @param {import('playwright-core').Page} page
 * @param {'aiChanges' | 'handouts' | 'tarokka'} tool
 * @param {string} windowId
 * @returns {Promise<number>} milliseconds from the click until the window had loaded
 */
export async function openTool(page, tool, windowId) {
  const toolButton = page.locator(`#scene-controls-tools button[data-tool="${tool}"]`);
  if (!(await toolButton.isVisible())) {
    await page.locator('#scene-controls-layers button[data-control="aiTool"]').click();
    await toolButton.waitFor({ state: 'visible', timeout: WAIT_MS });
  }
  const started = Date.now();
  await toolButton.click();
  await page.locator(`#${windowId}`).waitFor({ state: 'visible', timeout: WAIT_MS });
  await waitLoaded(page, windowId);
  return Date.now() - started;
}

/**
 * Close one window through its own Close button (the header's X), the way a person does.
 * @param {import('playwright-core').Page} page
 * @param {string} windowId
 */
export async function closeWindow(page, windowId) {
  const w = page.locator(`#${windowId}`);
  if (!(await w.count())) return;
  await w.locator('button[data-action="close"]').first().click();
  await w.waitFor({ state: 'detached', timeout: WAIT_MS });
}

/**
 * The DialogV2 that is open now: its title, button actions and text. Waits for one to appear.
 * @param {import('playwright-core').Page} page
 * @returns {Promise<{title: string, actions: string[], labels: string[], text: string}>}
 */
export async function readDialog(page) {
  const dialog = page.locator('.application.dialog').last();
  await dialog.waitFor({ state: 'visible', timeout: WAIT_MS });
  return dialog.evaluate(el => ({
    title: el.querySelector('.window-title')?.textContent?.trim() ?? '',
    actions: [...el.querySelectorAll('footer button, .form-footer button')]
      .map(b => /** @type {HTMLElement} */ (b).dataset.action ?? '')
      .filter(Boolean),
    labels: [...el.querySelectorAll('footer button, .form-footer button')].map(
      b => b.textContent?.trim() ?? ''
    ),
    text: (el.querySelector('.window-content')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
  }));
}

/**
 * Click a dialog button by its action and wait for the dialog to go.
 * @param {import('playwright-core').Page} page
 * @param {string} action
 */
export async function answerDialog(page, action) {
  const dialog = page.locator('.application.dialog').last();
  await dialog.waitFor({ state: 'visible', timeout: WAIT_MS });
  await dialog.locator(`button[data-action="${action}"]`).first().click();
  await dialog.waitFor({ state: 'detached', timeout: WAIT_MS });
}

/**
 * The text of the notifications on screen now.
 * @param {import('playwright-core').Page} page
 * @returns {Promise<string[]>}
 */
export async function notifications(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('#notifications .notification, li.notification')].map(n =>
      (n.textContent ?? '').trim()
    )
  );
}

/**
 * Wait until a notification contains the text.
 * @param {import('playwright-core').Page} page
 * @param {string | RegExp} match
 * @param {number} [timeout]
 */
export async function waitNotification(page, match, timeout = WAIT_MS) {
  const pattern = typeof match === 'string' ? match : match.source;
  const flags = typeof match === 'string' ? 'i' : match.flags;
  await page.waitForFunction(
    ([source, f]) => {
      const re = new RegExp(source, f);
      return [...document.querySelectorAll('#notifications .notification, li.notification')].some(
        n => re.test(n.textContent ?? '')
      );
    },
    [typeof match === 'string' ? escapeRegExp(pattern) : pattern, flags],
    { timeout }
  );
}

/** @param {string} s */
export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Wait for a short moment (for a debounce or an animation). @param {import('playwright-core').Page} page @param {number} ms */
export function pause(page, ms) {
  return page.waitForTimeout(ms);
}

/** Button actions that are not an answer to the question a dialog asks. */
const NOT_AN_ANSWER = ['cancel', 'no', 'close', 'toggleControls'];

/**
 * Click the dialog's yes: the `yes` action when there is one, else the first button that is not a
 * Cancel (the module's own dialogs name their buttons "Reveal", "Undo", "Redo").
 * @param {import('playwright-core').Page} page
 * @returns {Promise<string>} the action clicked
 */
export async function answerYes(page) {
  const dialog = await readDialog(page);
  const action = dialog.actions.includes('yes')
    ? 'yes'
    : dialog.actions.find(a => !NOT_AN_ANSWER.includes(a));
  if (!action) throw new Error(`dialog "${dialog.title}" has no yes button (${dialog.actions.join(', ')})`);
  await answerDialog(page, action);
  return action;
}

/**
 * Click the dialog's way out: its Cancel, or the No of a confirm dialog.
 * @param {import('playwright-core').Page} page
 * @returns {Promise<string>} the action clicked
 */
export async function answerNo(page) {
  const dialog = await readDialog(page);
  const action = ['cancel', 'no'].find(a => dialog.actions.includes(a));
  if (!action) throw new Error(`dialog "${dialog.title}" has no Cancel (${dialog.actions.join(', ')})`);
  await answerDialog(page, action);
  return action;
}
