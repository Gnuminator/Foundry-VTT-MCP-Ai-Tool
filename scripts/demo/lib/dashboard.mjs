// Co-GM dashboard helpers for Playwright. Element ids come from
// packages/cogm-dashboard/public/index.html and app.js; keep them in step.

import { humanClick, humanType } from './browser.mjs';

/** Wait until the dashboard has loaded its tools and state. */
export async function waitForDashboard(page) {
  await page.locator('#btn-gm').waitFor();
  await page.waitForFunction(() => !document.querySelector('#btn-gm')?.textContent?.includes('…'));
}

/** Whether GM Actions are on, from the header button's label. */
export async function gmActionsOn(page) {
  const label = (await page.locator('#btn-gm').textContent()) ?? '';
  return /:\s*on/i.test(label);
}

/** Turn GM Actions on or off with the header button. */
export async function setGmActions(page, on, { human = false } = {}) {
  if ((await gmActionsOn(page)) === on) return;
  const btn = page.locator('#btn-gm');
  if (human) await humanClick(btn);
  else await btn.click();
  await page.waitForFunction(
    want => /:\s*on/i.test(document.querySelector('#btn-gm')?.textContent ?? '') === want,
    on
  );
}

/**
 * Open a tool in the Tool Runner and fill its form.
 * @param {import('playwright-core').Page} page
 * @param {string} tool  e.g. 'plan-token-change'
 * @param {Record<string, string | number | boolean | string[]>} fields
 */
export async function openToolForm(page, tool, fields = {}, { human = false } = {}) {
  const click = human ? l => humanClick(l) : l => l.click();
  const type = human ? (l, t) => humanType(l, t) : (l, t) => l.fill(t);
  if (await page.locator('#tools-drawer').isHidden()) await click(page.locator('#btn-tools'));
  const search = page.locator('#tool-search');
  if (await search.isVisible()) {
    await search.fill('');
    await type(search, tool);
  }
  await click(page.locator(`.tool-item[data-tool="${tool}"]`));
  for (const [key, value] of Object.entries(fields)) {
    const field = page.locator(`#tool-form .field[data-key="${key}"]`);
    const control = field.locator('select, input, textarea').first();
    const tag = await control.evaluate(el => el.tagName.toLowerCase() + ':' + (el.type || ''));
    if (tag.startsWith('select')) {
      if (human) await humanClick(control);
      await control.selectOption(String(value));
    } else if (tag === 'input:checkbox') {
      if ((await control.isChecked()) !== Boolean(value)) await click(control);
    } else {
      const text = Array.isArray(value) ? value.join('\n') : String(value);
      await control.fill('');
      if (human) await humanClick(control);
      await type(control, text);
    }
  }
}

/** Submit the open tool form (Run / Run…). */
export async function submitToolForm(page, { human = false } = {}) {
  const run = page.locator('#tool-form button[type="submit"]');
  if (human) await humanClick(run);
  else await run.click();
}

/** Wait for the confirm modal; returns its title and body text. */
export async function readConfirmModal(page) {
  const modal = page.locator('#modal-backdrop');
  await modal.waitFor({ state: 'visible' });
  return {
    title: (await page.locator('#modal-title').textContent())?.trim() ?? '',
    body: (await page.locator('#modal-body').innerText()).trim(),
  };
}

/** Confirm the open modal (ticking the destructive box when it shows). */
export async function confirmModal(page, { human = false } = {}) {
  const click = human ? l => humanClick(l) : l => l.click();
  const check = page.locator('#modal-destructive-check');
  if (await page.locator('#modal-destructive').isVisible()) {
    if (!(await check.isChecked())) await click(check);
  }
  await click(page.locator('#modal-confirm'));
  await page.locator('#modal-backdrop').waitFor({ state: 'hidden' });
}

/** Close the Tool Runner drawer. */
export async function closeTools(page, { human = false } = {}) {
  const close = page.locator('#drawer-close');
  if (await close.isVisible()) {
    if (human) await humanClick(close);
    else await close.click();
  }
}

/** The Undo button of the newest change in Recent Changes. */
export function newestUndoButton(page) {
  return page.locator('#changes-body [data-undo]').first();
}
