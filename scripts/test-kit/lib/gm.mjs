/**
 * The GM page: a headless Edge (playwright-core, `channel: 'msedge'`, a fresh temp profile)
 * joined to the kit world as the passwordless kit GM. Scenarios and the builder run code in
 * Foundry only through it: `call(action, args)` runs the matching function from gm-actions.mjs
 * with `page.evaluate`. Console errors and page errors are collected from the first request.
 *
 * Also exports the join helpers that world.mjs reuses for provisioning a fresh world.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import {
  GM_ACTIONS,
  KIT_FLAG_KEY,
  KIT_FLAG_SCOPE,
  KIT_GM_USER,
  KIT_WORLDS,
  LIVE_BRIDGE_PORTS,
} from './contract.mjs';
import { EnvError } from './errors.mjs';
import { GM_ACTION_FUNCTIONS } from './gm-actions.mjs';

/** The running world's id from /api/status ('' at the setup screen). */
export async function activeWorld(foundryUrl) {
  const res = await fetch(`${foundryUrl}/api/status`);
  if (!res.ok) throw new EnvError(`Foundry ${foundryUrl}: /api/status answered ${res.status}`);
  const status = await res.json();
  return typeof status.world === 'string' ? status.world : '';
}

/** Refuses live bridge ports and anything but a kit world; returns the running world check. */
export async function assertKitWorld(foundryUrl, world) {
  const port = Number(new URL(foundryUrl).port || 80);
  if (LIVE_BRIDGE_PORTS.includes(port))
    throw new EnvError(`REFUSED: port ${port} is the live bridge.`);
  if (!KIT_WORLDS.includes(world)) {
    throw new EnvError(`REFUSED: "${world}" is not a kit world (${KIT_WORLDS.join(', ')}).`);
  }
  const running = await activeWorld(foundryUrl);
  if (running !== world) {
    throw new EnvError(
      `Foundry runs world "${running || '(setup screen)'}", not "${world}"; not joining.`
    );
  }
}

/**
 * Launch a headless Edge with a throwaway profile.
 * @returns {Promise<{context: import('playwright-core').BrowserContext, page: import('playwright-core').Page, close: () => Promise<void>}>}
 */
export async function launchBrowser({ headless = true } = {}) {
  const profile = mkdtempSync(path.join(tmpdir(), 'kit-gm-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'msedge',
      headless,
      viewport: { width: 1440, height: 900 },
      chromiumSandbox: true,
      args: [
        '--no-first-run',
        '--no-default-browser-check',
        '--mute-audio',
        // A covered window must keep drawing, or Foundry's canvas never gets ready.
        '--disable-features=CalculateNativeWinOcclusion,Translate',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
      ],
    });
  } catch (err) {
    rmSync(profile, { recursive: true, force: true });
    throw new EnvError(`Could not start Edge: ${err instanceof Error ? err.message : err}`);
  }
  const page = context.pages()[0] ?? (await context.newPage());
  return {
    context,
    page,
    async close() {
      await context.close().catch(() => {});
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        // Edge may still hold the folder; the OS temp folder is cleaned up later.
      }
    },
  };
}

/**
 * Collect console errors and uncaught page errors with timestamps (a live array).
 * @param {import('playwright-core').Page} page
 * @returns {Array<{at: string, message: string, source: string}>}
 */
export function collectErrors(page) {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const loc = msg.location();
    errors.push({
      at: new Date().toISOString(),
      message: msg.text(),
      source: loc?.url ? `${loc.url}:${loc.lineNumber ?? 0}` : 'console',
    });
  });
  page.on('pageerror', err => {
    errors.push({
      at: new Date().toISOString(),
      message: String(err?.stack || err),
      source: 'pageerror',
    });
  });
  return errors;
}

/**
 * Join the running world as a passwordless user and wait for `game.ready`.
 * @param {import('playwright-core').Page} page
 */
export async function joinGame(
  page,
  { foundryUrl, user, password = '', joinTimeoutMs = 30000, gameTimeoutMs = 120000 }
) {
  await page.goto(`${foundryUrl}/join`, { waitUntil: 'domcontentloaded' });
  const name = page.locator('#join-username');
  await name.waitFor({ timeout: 30000 });
  await name.fill(user);
  await page.keyboard.press('Escape'); // closes the name autocomplete
  await page.locator('#join-password').fill(password);
  await page.locator('button[name="join"]').click();
  await page.waitForURL(/\/game$/, { timeout: joinTimeoutMs });
  await waitForGame(page, gameTimeoutMs);
}

/** Wait until `game.ready`. */
export async function waitForGame(page, timeoutMs = 120000) {
  await page.waitForFunction(() => globalThis.game?.ready === true, undefined, {
    timeout: timeoutMs,
    polling: 250,
  });
}

/**
 * Turn off the chat card pop-ups of the GM page. The kit makes chat cards (an item use, a spell
 * cast) and deletes them again within moments. Foundry 14 shows each new card as a notification
 * and animates it for about 100 ms (ChatLog#postNotification); when the card is deleted in that
 * time, the notification is gone and `element.hidden = false` throws "Cannot set properties of
 * null (setting 'hidden')" as a page error, hundreds of times in a full run. Nobody looks at the
 * pop-ups on this page, so it behaves as if the setting "Chat notifications: pip" were chosen (the
 * same `_shouldShowNotifications` answer, without writing a setting or redrawing the canvas).
 * @param {import('playwright-core').Page} page
 * @returns {Promise<boolean>} whether the chat log was found and changed
 */
export async function quietChatNotifications(page) {
  return page.evaluate(() => {
    const chat = globalThis.ui?.chat;
    if (!chat || typeof chat._shouldShowNotifications !== 'function') return false;
    chat._shouldShowNotifications = () => false;
    chat._toggleNotifications?.(); // moves the chat input to where the pip mode keeps it
    return true;
  });
}

/**
 * Keep the chat card pop-ups off after the page reloads. Actor Studio setup, a failed Studio build
 * and the module enabling in the kit world all reload the page, and a reload makes a new chat log
 * with the pop-ups back on (a live full run logged thousands of the page error after the first
 * reload). The script runs in every new document, waits for the chat log to exist, and applies the
 * same change as `quietChatNotifications`.
 * @param {import('playwright-core').Page} page
 * @returns {Promise<void>}
 */
export async function keepChatNotificationsQuiet(page) {
  await page.addInitScript(() => {
    const timer = setInterval(() => {
      const chat = globalThis.ui?.chat;
      if (!chat || typeof chat._shouldShowNotifications !== 'function') return;
      clearInterval(timer);
      chat._shouldShowNotifications = () => false;
      try {
        chat._toggleNotifications?.();
      } catch {
        // not drawn yet: the pip mode is applied on its first draw
      }
    }, 100);
  });
}

/**
 * A Foundry page of another user (a player), in its own throwaway Edge.
 * @typedef {{page: import('playwright-core').Page, consoleErrors: () => Array<{at: string, message: string, source: string}>, close: () => Promise<void>}} FoundryJoin
 */

/**
 * Join the kit world as another passwordless user in a separate headless Edge (no shared cookies
 * with the GM page). The caller closes it.
 * @param {{foundryUrl: string, world: string, user: string, headless?: boolean}} o
 * @returns {Promise<FoundryJoin>}
 */
export async function joinAs({ foundryUrl, world, user, headless = true }) {
  await assertKitWorld(foundryUrl, world);
  const browser = await launchBrowser({ headless });
  const errors = collectErrors(browser.page);
  try {
    await keepChatNotificationsQuiet(browser.page);
    await joinGame(browser.page, { foundryUrl, user });
  } catch (err) {
    await browser.close();
    throw err;
  }
  return { page: browser.page, consoleErrors: () => [...errors], close: () => browser.close() };
}

/**
 * Open a GM session in the kit world.
 * @param {{foundryUrl: string, world: string, user?: string, headless?: boolean, log?: (m: string) => void}} o
 * @returns {Promise<{call: (action: string, args?: object) => Promise<any>, close: () => Promise<void>, page: import('playwright-core').Page,
 *   joinAs: (user: string) => Promise<FoundryJoin>}>}
 */
export async function openGmSession({
  foundryUrl,
  world,
  user = KIT_GM_USER,
  headless = true,
  log = () => {},
}) {
  await assertKitWorld(foundryUrl, world);
  const browser = await launchBrowser({ headless });
  const errors = collectErrors(browser.page);
  try {
    await keepChatNotificationsQuiet(browser.page);
    log(`joining ${world} as ${user}`);
    await joinGame(browser.page, { foundryUrl, user });
    const who = await browser.page.evaluate(() => ({ isGM: game.user.isGM, name: game.user.name }));
    if (!who.isGM) throw new EnvError(`${user} joined but is not a GM.`);
    await browser.page.evaluate(() => {
      if (globalThis.game.paused) globalThis.game.togglePause(false, { broadcast: true });
    });
    if (!(await quietChatNotifications(browser.page))) {
      log(
        'the chat log was not found; chat card pop-ups stay on (page errors from them may follow)'
      );
    }
  } catch (err) {
    await browser.close();
    throw err;
  }
  return {
    page: browser.page,
    close: () => browser.close(),
    joinAs: user => joinAs({ foundryUrl, world, user, headless }),
    async call(action, args = {}) {
      if (!(action in GM_ACTIONS)) throw new Error(`Unknown GM action "${action}".`);
      if (action === GM_ACTIONS.consoleErrors) {
        // The runner passes epoch milliseconds; an ISO string works too.
        const raw = args?.since;
        const since = typeof raw === 'number' ? raw : raw ? Date.parse(raw) : 0;
        return { errors: errors.filter(e => Date.parse(e.at) >= since) };
      }
      const fn = GM_ACTION_FUNCTIONS[action];
      if (!fn) throw new Error(`GM action "${action}" has no implementation.`);
      return browser.page.evaluate(fn, {
        ...args,
        _kit: { flagScope: KIT_FLAG_SCOPE, flagKey: KIT_FLAG_KEY },
      });
    },
  };
}
