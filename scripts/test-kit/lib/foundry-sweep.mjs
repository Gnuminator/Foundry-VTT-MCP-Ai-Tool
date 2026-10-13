/**
 * The page driver of the module control sweep inside Foundry (scenario `foundry-controls`, table in
 * lib/foundry-controls.mjs). It keeps one result row per control and role, watches each Foundry page
 * for console errors while a row runs, times the row, and offers the small page helpers every area
 * needs (open a scene tool, wait for a window to load, answer a dialog, close what is open).
 *
 * A row fails when its check throws, or when either page logged a console error or a page error while
 * the row ran (the player page counts during a GM row and the other way round). Errors that land
 * outside every row (setup between rows) are collected by {@link Sweep#strayErrors}. A row skips when
 * its check throws {@link Skip} (the reason becomes the note). After a failed row the dialogs it left
 * open are closed, so one failure does not become several.
 */
import { listOf } from './helpers.mjs';

const SETTLE_MS = 300;
const WAIT_MS = 10000;
/** How long after a row ended an error it announced (`expectErrors`) may still arrive. */
const GRACE_MS = 600;

/** @typedef {'gm' | 'player'} Who */
/** @typedef {{name: string, who: Who, status: 'pass' | 'fail' | 'skip', ms: number, note: string}} FoundryResult */

/** A row that cannot run in this world: the message is the reason. */
export class Skip extends Error {}

/**
 * Collect console errors and page errors of a page (live arrays; `times[i]` is when `errors[i]` came).
 * @param {import('playwright-core').Page} page
 * @returns {{errors: string[], times: number[], stop: () => void}}
 */
export function watchErrors(page) {
  /** @type {string[]} */
  const errors = [];
  /** @type {number[]} */
  const times = [];
  /** @param {string} text */
  const add = text => {
    errors.push(text);
    times.push(Date.now());
  };
  /** @param {import('playwright-core').ConsoleMessage} msg */
  const onConsole = msg => {
    if (msg.type() === 'error') add(msg.text());
  };
  /** @param {Error} err */
  const onPageError = err => add(`page error: ${err?.message ?? err}`);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  return {
    errors,
    times,
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
    /** Set by the scenario: stores a screenshot in the report. @type {((name: string, data: Buffer) => unknown) | null} */
    this.attachShot = null;
    /** The error index ranges [from, to) that rows judged, by page. @type {Record<Who, Array<[number, number]>>} */
    this.judged = { gm: [], player: [] };
    /**
     * The time window of each row that named `expectErrors`: such an error is excused outside any row only
     * when it came inside that window (the row's run plus its settle time), not anywhere in the run.
     * @type {Array<{patterns: RegExp[], from: number, to: number}>}
     */
    this.expectedWindows = [];
  }

  /**
   * A screenshot of a page for the report (a person looks at it; no pixel comparison).
   * @param {Who} who
   * @param {string} name  file name, for example `changes-window.png`
   */
  async shot(who, name) {
    if (!this.attachShot) return;
    try {
      this.attachShot(name, await this.pages[who].screenshot());
    } catch {
      // a screenshot is never a reason to fail a row
    }
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
    const expect = opts.expectErrors ?? [];
    const before = {
      gm: this.watch.gm.errors.length,
      player: this.watch.player.errors.length,
    };
    const started = Date.now();
    /** @type {FoundryResult} */
    const result = { name, who, status: 'pass', ms: 0, note: '' };
    try {
      const out = await fn();
      if (typeof out === 'string') result.note = out;
      else if (out && typeof out === 'object') {
        result.note = out.note ?? '';
        for (const [key, ms] of Object.entries(out.timings ?? {}))
          this.timings[`${name}.${key}`] = ms;
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
    result.ms = Date.now() - started - SETTLE_MS;
    /** @type {Array<{who: Who, text: string}>} */
    const fresh = [];
    if (expect.length)
      this.expectedWindows.push({ patterns: expect, from: started, to: Date.now() + GRACE_MS });
    for (const w of /** @type {Who[]} */ (['gm', 'player'])) {
      const errors = this.watch[w].errors;
      for (const text of errors.slice(before[w])) {
        if (!expect.some(re => re.test(text))) fresh.push({ who: w, text });
      }
      // A skipped row did not look at its errors: they stay for strayErrors() to report.
      if (!(result.status === 'skip' && fresh.some(f => f.who === w)))
        this.judged[w].push([before[w], errors.length]);
    }
    if (fresh.length && result.status !== 'skip') {
      result.status = 'fail';
      const first = fresh[0].text.replace(/\s+/g, ' ').slice(0, 300);
      const onPage = fresh[0].who === who ? '' : ` on the ${fresh[0].who} page`;
      result.note =
        `${result.note ? `${result.note}; ` : ''}console error${onPage}: ${first}` +
        (fresh.length > 1 ? ` (+${fresh.length - 1} more)` : '');
    }
    if (result.status === 'fail') {
      // A failed row may leave a dialog open; every later row would read that one.
      for (const p of Object.values(this.pages)) await closeDialogs(p).catch(() => {});
    }
    this.results.push(result);
    return result;
  }

  /**
   * Console errors and page errors that no row looked at (setup between rows, or a late error after a
   * row's settle time), minus the texts some row announced it would provoke. Run once at the end.
   * @returns {string[]} one line each
   */
  strayErrors() {
    /** @type {string[]} */
    const out = [];
    for (const w of /** @type {Who[]} */ (['gm', 'player'])) {
      this.watch[w].errors.forEach((text, i) => {
        if (this.judged[w].some(([from, to]) => i >= from && i < to)) return;
        const at = this.watch[w].times[i];
        if (
          this.expectedWindows.some(
            win => at >= win.from && at <= win.to && win.patterns.some(re => re.test(text))
          )
        )
          return;
        out.push(`${w} page, outside a row: ${text.replace(/\s+/g, ' ').slice(0, 300)}`);
      });
    }
    return out;
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
 * Close the dialogs of the page (a confirm left open by a failed row), and nothing else: the tool
 * windows the next rows work in stay open. A closed dialog counts as its Cancel.
 * @param {import('playwright-core').Page} page
 */
export async function closeDialogs(page) {
  await page.evaluate(async () => {
    // @ts-ignore
    for (const app of [...foundry.applications.instances.values()]) {
      const el = app.element;
      if (!(el instanceof HTMLElement) || !el.classList.contains('dialog')) continue;
      try {
        await app.close({ animate: false });
      } catch {
        /* already closing */
      }
    }
  });
}

/**
 * Run every put-back step even when an earlier one fails, and throw one error that lists all the
 * failures (a cleanup that stops at its first failure leaves the later things changed).
 * @param {Array<[string, () => Promise<unknown>]>} steps  label and action
 */
export async function runAll(steps) {
  /** @type {string[]} */
  const errors = [];
  for (const [label, fn] of steps) {
    try {
      await fn();
    } catch (err) {
      errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (errors.length) throw new Error(errors.join(' | '));
}

/**
 * Undo a change unless it is undone already (read from the change list), so the put-back of a change
 * that a row has undone or redone does not fail on the refusal.
 * @param {any} t  the scenario's test object
 * @param {string} changeId
 * @returns {Promise<string>} what happened
 */
export async function undoIfOpen(t, changeId) {
  const changes = listOf(await t.tool('list-recent-changes', { limit: 200 }), 'changes');
  const found = changes.find(c => c.changeId === changeId);
  if (found && found.canUndo === false) return 'already undone';
  await t.guarded.undo(changeId);
  return 'undone';
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
 * @returns {Promise<{title: string, buttons: Array<{action: string, label: string}>, actions: string[], labels: string[], text: string}>}
 */
export async function readDialog(page) {
  const dialog = page.locator('.application.dialog').last();
  await dialog.waitFor({ state: 'visible', timeout: WAIT_MS });
  return dialog.evaluate(el => ({
    title: el.querySelector('.window-title')?.textContent?.trim() ?? '',
    buttons: [...el.querySelectorAll('footer button, .form-footer button')].map(b => ({
      action: /** @type {HTMLElement} */ (b).dataset.action ?? '',
      label: b.textContent?.trim() ?? '',
    })),
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
  // g and y keep a lastIndex between tests, which breaks the `some` over several notifications.
  const flags = typeof match === 'string' ? 'i' : match.flags.replace(/[gy]/g, '');
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

/**
 * Poll until a function returns something truthy.
 * @template T
 * @param {() => Promise<T>} fn
 * @param {string} what
 * @param {number} [timeout]
 * @returns {Promise<T>}
 */
export async function until(fn, what, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 250));
  }
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

/** The one destructive control of the Changes window: the sweep never answers it. */
const NEVER_ANSWER = /Rewind the whole table/i;

/**
 * Click the dialog's yes: the `yes` action, or else the button whose label is the one the caller
 * expects (the module's own dialogs name their buttons "Reveal", "Undo", "Redo"). Any other dialog
 * is not answered: the call throws. A dialog titled "Rewind the whole table" is never answered.
 * @param {import('playwright-core').Page} page
 * @param {string} [label]  the expected label of the affirmative button, compared without case
 * @returns {Promise<string>} the action clicked
 */
export async function answerYes(page, label) {
  const dialog = await readDialog(page);
  if (NEVER_ANSWER.test(dialog.title))
    throw new Error(`the sweep does not answer the dialog "${dialog.title}"`);
  const wanted = label?.toLowerCase();
  const button =
    dialog.buttons.find(b => b.action === 'yes') ??
    (wanted
      ? dialog.buttons.find(
          b => !NOT_AN_ANSWER.includes(b.action) && b.label.toLowerCase().includes(wanted)
        )
      : undefined);
  if (!button?.action) {
    throw new Error(
      `dialog "${dialog.title}" has no yes button${label ? ` or button "${label}"` : ''} ` +
        `(${dialog.labels.join(' / ')})`
    );
  }
  await answerDialog(page, button.action);
  return button.action;
}

/**
 * Click the dialog's way out: its Cancel, or the No of a confirm dialog.
 * @param {import('playwright-core').Page} page
 * @returns {Promise<string>} the action clicked
 */
export async function answerNo(page) {
  const dialog = await readDialog(page);
  const action = ['cancel', 'no'].find(a => dialog.actions.includes(a));
  if (!action)
    throw new Error(`dialog "${dialog.title}" has no Cancel (${dialog.actions.join(', ')})`);
  await answerDialog(page, action);
  return action;
}
