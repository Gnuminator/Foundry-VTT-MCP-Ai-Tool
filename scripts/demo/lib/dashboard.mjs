// Co-GM dashboard helpers for Playwright. Element ids come from
// packages/cogm-dashboard/web/src (the React dashboard at /); keep them in step.

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

/**
 * Hide, on the recording, everything on the page that points to the old dashboard: the header's
 * "Old dashboard" button, the note under it and the "not on this page yet" cards. Call after every
 * load or reload (a reload drops the style; the observer keeps later redraws hidden).
 */
export async function hideOldDashboardLinks(page) {
  await page.addStyleTag({
    content: '.link-banner[role="note"], section.not-here-yet { display: none !important; }',
  });
  await page.evaluate(() => {
    const hide = () => {
      for (const el of document.querySelectorAll('button, a')) {
        if (/^\s*Old dashboard\s*$/i.test(el.textContent ?? ''))
          el.style.setProperty('display', 'none', 'important');
      }
    };
    hide();
    if (!globalThis.__hideOldDash) {
      globalThis.__hideOldDash = new MutationObserver(hide);
      globalThis.__hideOldDash.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
  });
}

/** Wait until the dashboard has loaded its tools and state. */
export async function waitForDashboard(page) {
  await page.locator('#btn-gm').waitFor();
  await page.waitForFunction(() => !document.querySelector('#btn-gm')?.textContent?.includes('…'));
}

/**
 * Whether GM Actions are on, from the header live play line: it names GM Actions only while they
 * are off ("GM Actions is off: Turn on"); "Live play on: all set" or another switch's name is on.
 */
export async function gmActionsOn(page) {
  const label = (await page.locator('#btn-gm').textContent()) ?? '';
  return label.trim() !== '' && !/GM Actions/i.test(label);
}

/**
 * Turn GM Actions on or off. On is the header line's Turn on (the same click as Start session's;
 * it turns on every live play switch); off goes through the dashboard API, since the page has no
 * off switch outside End session.
 */
export async function setGmActions(page, on, { human = false } = {}) {
  if ((await gmActionsOn(page)) === on) return;
  if (on) {
    const click = human ? l => humanClick(l) : l => l.click();
    await click(page.locator('#btn-gm'));
    // The popover's own button: the header and the During view hold Turn on notes with the same
    // data-track (hidden, or below the fold when no fight runs).
    await click(
      page
        .locator('[role="dialog"][aria-label="Live play switches"] [data-track="dash.live.turn-on"]')
        .first()
    );
  } else {
    await setGmActionsApi(new URL(page.url()).origin, false);
  }
  await page.waitForFunction(want => {
    const t = document.querySelector('#btn-gm')?.textContent ?? '';
    return (t.trim() !== '' && !/GM Actions/i.test(t)) === want;
  }, on);
  // The "Turned on" toast sits bottom right and stays up while the window is hovered or blurred:
  // a demo cursor sent to a control behind it would wait for ever. It stays visible but lets
  // clicks through.
  await page.addStyleTag({
    content: '.toast-stack, .toast-stack * { pointer-events: none !important; }',
  });
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
    title: (await page.locator('#modal h3').textContent())?.trim() ?? '',
    body: (await page.locator('#modal .modal-body').innerText()).trim(),
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
  return page.locator('#pane-changes-body button[aria-label^="Undo:"]').first();
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
  const summary = page.locator('#preflight-drawer .preflight-summary').first();
  await summary.waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForFunction(
    () =>
      !document.querySelector('#preflight-drawer button[data-track="dash.preflight.run"]')
        ?.disabled,
    undefined,
    { timeout: 60000 }
  );
  return (await summary.innerText()).trim();
}

/** The Prep drawer; resolves once the digest has loaded. */
export async function openPrep(page, opts = {}) {
  await openDrawer(page, '#btn-prep', '#prep-drawer', opts);
  // The "Last session" heading shows while loading too; its list shows once the digest is in.
  await page.locator('#prep-drawer ul[aria-label="Last session"]').waitFor();
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
