// Co-GM dashboard helpers for Playwright. Element ids come from
// packages/cogm-dashboard/public/index.html and app.js; keep them in step.

import { humanClick, humanType } from './browser.mjs';

/**
 * Click a header button. The Tool Runner and the drawer buttons live in the Advanced
 * menu (D2); open the menu first when the button is inside it and not on screen.
 */
export async function clickHeaderButton(page, selector, { human = false } = {}) {
  const click = human ? l => humanClick(l) : l => l.click();
  const btn = page.locator(selector);
  if (!(await btn.isVisible()) && (await page.locator('#btn-advanced').isVisible())) {
    await click(page.locator('#btn-advanced'));
    await btn.waitFor({ state: 'visible' });
  }
  await click(btn);
}

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
  if (await page.locator('#tools-drawer').isHidden()) {
    await clickHeaderButton(page, '#btn-tools', { human });
  }
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

// --- Drawers ------------------------------------------------------------------

/** Open a header drawer (Handouts, Prep, Pre-flight) and wait until it shows. */
async function openDrawer(page, button, drawer, { human = false } = {}) {
  // A drawer docked in the moment on screen (D2) is already visible.
  if (await page.locator(drawer).isVisible()) return;
  await clickHeaderButton(page, button, { human });
  await page.locator(drawer).waitFor({ state: 'visible' });
}

/** The Handouts drawer; resolves once the queue has loaded. */
export async function openHandouts(page, opts = {}) {
  await openDrawer(page, '#btn-handouts', '#handouts-drawer', opts);
  await page.waitForFunction(() => {
    const next = document.querySelector('#handouts-next');
    return next && !next.textContent.includes('…');
  });
}

/** "Reveal next" in the Handouts drawer (it opens the destructive confirm modal). */
export async function revealNextHandout(page, { human = false } = {}) {
  const next = page.locator('#handouts-next');
  await next.waitFor({ state: 'visible' });
  if (await next.isDisabled()) throw new Error('Handouts: the queue is empty.');
  if (human) await humanClick(next);
  else await next.click();
}

/** The Pre-flight drawer; resolves once its checks have run. Returns the summary text. */
export async function runPreflight(page, opts = {}) {
  await openDrawer(page, '#btn-preflight', '#preflight-drawer', opts);
  await page.locator('#preflight-summary').waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('#preflight-run')?.disabled, undefined, {
    timeout: 60000,
  });
  return (await page.locator('#preflight-summary').innerText()).trim();
}

/** The Prep drawer; resolves once the digest has loaded. */
export async function openPrep(page, opts = {}) {
  await openDrawer(page, '#btn-prep', '#prep-drawer', opts);
  await page.waitForFunction(() => {
    const last = document.querySelector('#prep-last');
    return last && last.textContent.trim() !== '' && !last.textContent.includes('Loading');
  });
}

// --- The dashboard's REST API (local mode: every caller is GM) ----------------

async function postJson(dashboardUrl, path, body) {
  const res = await fetch(`${dashboardUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(`${path} ${body.name ?? body.action}: ${data.error ?? res.status}`);
  }
  return data;
}

/** Turn GM Actions on or off without the UI (for setup outside the recording). */
export function setGmActionsApi(dashboardUrl, on) {
  return postJson(dashboardUrl, '/api/control', { action: 'set-gm-actions', value: on });
}

/**
 * Set the GM's screen choices for the world without the UI (D-092, I-107), for example
 * { combatButtons: true } before a take that uses the strip's Damage / Heal button, or
 * { duringLayout: 'layered', layoutPicked: true } to skip the layout trial card.
 */
export function setDashboardPrefsApi(dashboardUrl, change) {
  return postJson(dashboardUrl, '/api/control', { action: 'set-prefs', value: change });
}

/**
 * Run a bridge tool through the dashboard, confirmed (for setup outside the recording).
 * Writes need GM Actions on.
 */
export async function callToolApi(dashboardUrl, name, args = {}) {
  const data = await postJson(dashboardUrl, '/api/tool', {
    name,
    args,
    confirm: true,
    confirmDestructive: true,
  });
  return data.result;
}
