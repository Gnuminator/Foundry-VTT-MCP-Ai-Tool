/**
 * Small helpers for driving the GM dashboard page (packages/cogm-dashboard/public/index.html and app.js)
 * with Playwright: the Advanced menu, the During screen's cards, the tool runner form, the confirm
 * window, the toasts with their Undo. Used by the write flow scenario (slice 4). Element ids come from
 * index.html and app.js; keep them in step. These helpers only click and read; they never call the
 * dashboard's API themselves.
 */

/** The dashboard answered a click with a refusal toast (a feature switched off, GM Actions off, an error). */
export class Refused extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'Refused';
  }
}

/**
 * Whether a refusal says a switch is off (the world lacks something): the flow is skipped, not failed.
 * @param {string} message
 */
export function isSwitchedOff(message) {
  return /switched off|switch\b[^.]*\bon\b|is off|disabled|not enabled|turned off/i.test(message);
}

/** Collapses white space. @param {string | null | undefined} text */
export const squash = text => String(text ?? '').replace(/\s+/g, ' ').trim();

/**
 * Waits until the page is connected to the dashboard's stream (and so to the bridge) and has its
 * GM Actions label.
 * @param {import('playwright-core').Page} page
 */
export async function waitReady(page) {
  await page.locator('#btn-gm').waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForFunction(
    () => /Bridge: connected/.test(document.querySelector('#status-bridge')?.textContent ?? ''),
    undefined,
    { timeout: 30000 }
  );
}

/**
 * Whether the header button says GM Actions are on.
 * @param {import('playwright-core').Page} page
 */
export async function gmActionsLabelOn(page) {
  return /:\s*on/i.test((await page.locator('#btn-gm').textContent()) ?? '');
}

/**
 * Clicks a header button; the ones inside the Advanced menu open the menu first.
 * @param {import('playwright-core').Page} page
 * @param {string} selector
 */
export async function menuClick(page, selector) {
  const button = page.locator(selector);
  if (!(await button.isVisible())) {
    await page.locator('#btn-advanced').click();
    await button.waitFor({ state: 'visible', timeout: 10000 });
  }
  await button.click();
}

/**
 * Shows the During screen (it carries Recent Changes, Handouts and the Party card).
 * @param {import('playwright-core').Page} page
 */
export async function showDuring(page) {
  await page.locator('[data-moment="during"]').click();
  await page.locator('#moment-during').waitFor({ state: 'visible', timeout: 10000 });
}

const CARDS = {
  changes: '#pane-changes',
  handouts: '#handouts-drawer',
  party: '#party-drawer',
  feed: '#pane-feed',
};

/**
 * Opens a folded During card with its fold button (opening one side card folds the others).
 * @param {import('playwright-core').Page} page
 * @param {'changes' | 'handouts' | 'party' | 'feed'} name
 */
export async function openCard(page, name) {
  const card = page.locator(CARDS[name]);
  await card.waitFor({ state: 'attached', timeout: 10000 });
  const folded = await card.evaluate(el => el.classList.contains('is-folded'));
  if (folded) await card.locator('.fold-btn').first().click();
}

/**
 * Marks every toast now on screen as seen, so the next wait only looks at new ones.
 * @param {import('playwright-core').Page} page
 */
export function markToasts(page) {
  return page.evaluate(() =>
    document.querySelectorAll('#toast-stack .toast').forEach(el => el.setAttribute('data-seen', '1'))
  );
}

/**
 * Waits for a new toast. `want` 'undo' needs a toast with an Undo button (a guarded change was applied);
 * 'ok' takes any success toast. A new warning or error toast throws a {@link Refused} with its text.
 * @param {import('playwright-core').Page} page
 * @param {'undo' | 'ok'} want
 * @param {number} [timeout]
 * @returns {Promise<string>} the toast's text
 */
export async function waitToast(page, want, timeout = 30000) {
  const handle = await page.waitForFunction(
    kind => {
      for (const el of document.querySelectorAll('#toast-stack .toast:not([data-seen])')) {
        const cls = el.className;
        const text = el.textContent || '';
        if (/\b(err|warn)\b/.test(cls)) return { refused: true, text };
        if (kind === 'undo' ? cls.includes('toast-undo') : cls.includes('ok')) {
          return { refused: false, text };
        }
      }
      return false;
    },
    want,
    { timeout }
  );
  const found = /** @type {{refused: boolean, text: string}} */ (await handle.jsonValue());
  if (found.refused) throw new Refused(squash(found.text));
  return squash(found.text);
}

/**
 * Clicks Undo on the newest toast that has one, and waits for the success toast of the undo.
 * @param {import('playwright-core').Page} page
 * @returns {Promise<string>} the text of the undo's toast
 */
export async function undoFromToast(page) {
  const button = await page
    .locator('#toast-stack .toast-undo:not([data-seen]) .toast-action')
    .last()
    .elementHandle();
  if (!button) throw new Error('no toast with an Undo button is on screen');
  await markToasts(page);
  await button.click();
  return waitToast(page, 'ok');
}

/**
 * The confirm window: waits for it and reads it.
 * @param {import('playwright-core').Page} page
 * @returns {Promise<{title: string, body: string, destructive: boolean}>}
 */
export async function readModal(page) {
  await page.locator('#modal-backdrop').waitFor({ state: 'visible', timeout: 15000 });
  return {
    title: squash(await page.locator('#modal-title').textContent()),
    body: squash(await page.locator('#modal-body').innerText()),
    destructive: await page.locator('#modal-destructive').isVisible(),
  };
}

/**
 * Confirms the open window, ticking the destructive box when it shows.
 * @param {import('playwright-core').Page} page
 */
export async function confirmModal(page) {
  if (await page.locator('#modal-destructive').isVisible()) {
    await page.locator('#modal-destructive-check').check();
  }
  await page.locator('#modal-confirm').click();
  await page.locator('#modal-backdrop').waitFor({ state: 'hidden', timeout: 15000 });
}

/**
 * After a click that writes: waits for the confirm window or a new toast. A window is read and
 * confirmed (`confirm` false leaves it open for the caller). Returns what happened.
 * @param {import('playwright-core').Page} page
 * @param {{confirm?: boolean}} [opts]
 * @returns {Promise<{modal: {title: string, body: string, destructive: boolean} | null}>}
 */
export async function settleWrite(page, { confirm = true } = {}) {
  await page.waitForFunction(
    () =>
      !document.querySelector('#modal-backdrop')?.hasAttribute('hidden') ||
      document.querySelector('#toast-stack .toast:not([data-seen])'),
    undefined,
    { timeout: 30000 }
  );
  if (!(await page.locator('#modal-backdrop').isVisible())) {
    const refusal = await page.evaluate(() =>
      [...document.querySelectorAll('#toast-stack .toast.err:not([data-seen]), #toast-stack .toast.warn:not([data-seen])')]
        .map(el => el.textContent || '')
        .join(' | ')
    );
    if (refusal.trim()) throw new Refused(squash(refusal));
    return { modal: null };
  }
  const modal = await readModal(page);
  if (confirm) await confirmModal(page);
  return { modal };
}

/**
 * Opens a tool in the Tool Runner and fills its form (it does not submit).
 * @param {import('playwright-core').Page} page
 * @param {string} tool
 * @param {Record<string, string | number>} fields  by parameter name; a list goes in as one value per line
 */
export async function openToolForm(page, tool, fields) {
  if (await page.locator('#tools-drawer').isHidden()) await menuClick(page, '#btn-tools');
  if (await page.locator('#tool-detail').isVisible()) await page.locator('#tool-back').click();
  const search = page.locator('#tool-search');
  await search.waitFor({ state: 'visible', timeout: 10000 });
  await search.fill(tool);
  await page.locator(`.tool-item[data-tool="${tool}"]`).click();
  await page.locator('#tool-detail-name').filter({ hasText: tool }).waitFor({ timeout: 10000 });
  for (const [key, value] of Object.entries(fields)) {
    const control = page
      .locator(`#tool-form .field[data-key="${key}"]`)
      .locator('select, input, textarea')
      .first();
    const tag = await control.evaluate(el => el.tagName.toLowerCase());
    if (tag === 'select') await control.selectOption(String(value));
    else await control.fill(String(value));
  }
}

/** Submits the open tool form (Run, or Run...). @param {import('playwright-core').Page} page */
export function submitToolForm(page) {
  return page.locator('#tool-form button[type="submit"]').click();
}

/** Closes the Tool Runner drawer when it is open. @param {import('playwright-core').Page} page */
export async function closeTools(page) {
  const close = page.locator('#drawer-close');
  if (await close.isVisible()) await close.click();
}

/**
 * Puts the page back in a plain state after a flow, even a failed one: no confirm window, no drawer
 * over the page, no panel, no toast. Best effort; it never throws.
 * @param {import('playwright-core').Page} page
 */
export async function resetUi(page) {
  try {
    if (await page.locator('#modal-backdrop').isVisible()) await page.locator('#modal-cancel').click();
    for (const selector of ['#drawer-close', '#tarokka-close']) {
      if (await page.locator(selector).isVisible()) await page.locator(selector).click();
    }
    for (const pane of ['#pane-links', '#pane-help']) {
      const close = page.locator(`${pane} .overlay-close`);
      if (await close.isVisible()) await close.click();
    }
    await page.evaluate(() =>
      document.querySelectorAll('#toast-stack .toast').forEach(el => el.remove())
    );
  } catch {
    /* the page is gone or busy; the next flow reports it */
  }
}
