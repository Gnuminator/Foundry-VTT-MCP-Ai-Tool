// Visible browser windows for demo takes and live checks, driven by Playwright.
// Uses the Edge that ships with Windows (playwright-core, no browser download).
// Each window is its own browser with a fresh profile (no bookmarks, history or
// sign-ins on screen) and its own cookies, so a GM and a Player can be logged in
// side by side.

import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { testEnv } from './env.mjs';

// Keep windows drawing when they are covered: OBS captures covered windows, and
// Foundry's canvas is not ready in a window Chromium thinks is hidden.
const KEEP_DRAWING = [
  '--disable-features=CalculateNativeWinOcclusion,Translate',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
];

/**
 * Pin document.title, so OBS can find the window by its title whatever page it shows.
 * Also draws a cursor that follows Playwright's mouse: OBS shows the real cursor,
 * which Playwright never moves.
 */
function initScript({ title, cursor }) {
  const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'title');
  Object.defineProperty(Document.prototype, 'title', {
    configurable: true,
    get() {
      return desc.get.call(this);
    },
    set() {
      desc.set.call(this, title);
    },
  });
  // A <title> in the HTML bypasses the setter; pin it once the page is parsed.
  document.addEventListener('DOMContentLoaded', () => desc.set.call(document, title));
  if (!cursor) return;
  const install = () => {
    if (document.getElementById('demo-cursor')) return;
    const dot = document.createElement('div');
    dot.id = 'demo-cursor';
    dot.style.cssText =
      'position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;' +
      'background:rgba(255,214,0,.45);border:2px solid rgba(20,20,20,.85);pointer-events:none;' +
      'z-index:2147483647;transition:transform .12s ease;transform:translate(-100px,-100px)';
    document.documentElement.appendChild(dot);
    let pos = 'translate(-100px,-100px)';
    addEventListener(
      'mousemove',
      e => {
        pos = `translate(${e.clientX}px,${e.clientY}px)`;
        dot.style.transform = pos;
      },
      true
    );
    addEventListener('mousedown', () => (dot.style.transform = `${pos} scale(.7)`), true);
    addEventListener('mouseup', () => (dot.style.transform = pos), true);
  };
  if (document.documentElement) install();
  else document.addEventListener('DOMContentLoaded', install);
}

/**
 * Open one visible browser window (an app window: no tabs or address bar).
 *
 * Two layouts:
 * - default: the window is sized so the page is exactly css.width x css.height (for
 *   checks and the test kit; default 1440x900, a size Foundry's canvas is happy with);
 * - fullscreen: the window fills the screen (no title bar) and the page is laid out at
 *   css.width x css.height with `scale` device pixels per CSS pixel in its top-left
 *   corner. For recordings: OBS crops the capture to that corner (cropToPage), so the
 *   size does not depend on the screen (a 3840x2160 page on a 2160-pixel-tall screen).
 *
 * @param {object} o
 * @param {string} o.title   fixed window title (and profile folder name)
 * @param {string} o.url
 * @param {{width: number, height: number}} [o.css]  page size in CSS pixels
 * @param {number} [o.scale]  device pixels per CSS pixel (fullscreen only; 2 gives 3840x2160)
 * @param {boolean} [o.fullscreen]
 * @param {{x: number, y: number}} [o.position]  window position (default layout only)
 * @param {boolean} [o.cursor]  draw the demo cursor (default true)
 * @param {boolean} [o.keepProfile]  reuse the profile from the last run instead of a fresh one
 * @returns {Promise<{title: string, context: import('playwright-core').BrowserContext, page: import('playwright-core').Page, close: () => Promise<void>}>}
 */
export async function openWindow({
  title,
  url,
  css = { width: 1440, height: 900 },
  scale = 1,
  fullscreen = false,
  position = { x: 0, y: 0 },
  cursor = true,
  keepProfile = false,
}) {
  const profile = profileDir(title, keepProfile);
  mkdirSync(profile, { recursive: true });
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'msedge',
    headless: false,
    ...(fullscreen ? { viewport: css, deviceScaleFactor: scale } : { viewport: null }),
    // Keep Edge's sandbox on: with --no-sandbox Edge shows a warning bar over the page.
    chromiumSandbox: true,
    // No "controlled by automated test software" bar; and no default about:blank tab,
    // which would open a normal window (tabs, address bar) instead of the --app window.
    ignoreDefaultArgs: ['--enable-automation', 'about:blank'],
    args: [
      `--app=data:text/html,<title>${encodeURIComponent(title)}</title>`,
      `--window-position=${position.x},${position.y}`,
      `--window-size=${css.width},${css.height}`,
      // The emulated scale only sharpens the page if the window draws at that scale too.
      ...(fullscreen ? [`--force-device-scale-factor=${scale}`] : []),
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-crash-restore-bubble',
      ...KEEP_DRAWING,
    ],
  });
  await context.addInitScript(initScript, { title, cursor });
  const page = context.pages()[0] ?? (await context.newPage());
  if (fullscreen) await setWindowState(context, page, 'fullscreen');
  else await fitWindow(context, page, css, position);
  await page.goto(url);
  return { title, context, page, close: () => context.close() };
}

/**
 * The profile folder for a window: the same one with keepProfile, else a new one per run
 * (an Edge that is still closing can hold the old one). Old run folders are removed when
 * nothing holds them any more.
 */
function profileDir(title, keepProfile) {
  const root = testEnv().profilesDir;
  const slug = title.replace(/[^A-Za-z0-9-]+/g, '-');
  if (keepProfile) return join(root, slug);
  if (existsSync(root)) {
    for (const old of readdirSync(root).filter(d => d.startsWith(`${slug}-run-`))) {
      try {
        rmSync(join(root, old), { recursive: true, force: true });
      } catch {
        // Still in use; a later run removes it.
      }
    }
  }
  return join(root, `${slug}-run-${Date.now()}`);
}

async function setWindowState(context, page, windowState) {
  const cdp = await context.newCDPSession(page);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState } });
  await page.waitForTimeout(400);
  await cdp.detach();
}

/** Size the window so the page is exactly css.width x css.height CSS pixels. */
async function fitWindow(context, page, css, position) {
  const cdp = await context.newCDPSession(page);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  for (let i = 0; i < 4; i++) {
    const inner = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    if (inner.w === css.width && inner.h === css.height) break;
    const { bounds } = await cdp.send('Browser.getWindowBounds', { windowId });
    await cdp.send('Browser.setWindowBounds', {
      windowId,
      bounds: {
        left: position.x,
        top: position.y,
        width: bounds.width + css.width - inner.w,
        height: bounds.height + css.height - inner.h,
      },
    });
    await page.waitForTimeout(150);
  }
  await cdp.detach();
}

/** Page size in CSS and device pixels, to check a window before recording. */
export function measure(page) {
  return page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio,
  }));
}

/**
 * Move the visible cursor to an element in steps, then click it, so a viewer can follow.
 * @param {import('playwright-core').Locator} locator
 */
export async function humanClick(locator, { steps = 20, pauseMs = 250 } = {}) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`Not visible: ${locator}`);
  const page = locator.page();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps });
  await page.waitForTimeout(pauseMs);
  await locator.click();
}

/** Type like a person, one character at a time. */
export async function humanType(locator, text, { delay = 55 } = {}) {
  await locator.pressSequentially(text, { delay });
}

/**
 * Collect console errors and uncaught page errors (a live array).
 * @param {import('playwright-core').Page} page
 */
export function collectConsoleErrors(page) {
  /** @type {{type: string, text: string, at: string}[]} */
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error')
      errors.push({ type: 'console', text: msg.text(), at: new Date().toISOString() });
  });
  page.on('pageerror', err => {
    errors.push({
      type: 'pageerror',
      text: String(err.stack || err),
      at: new Date().toISOString(),
    });
  });
  return errors;
}
