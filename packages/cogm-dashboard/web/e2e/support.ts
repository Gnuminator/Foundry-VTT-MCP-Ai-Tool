// Shared bits of the browser tests: the GM token the test server runs with, and fakes for the
// routes every page load calls.
import { expect, type Locator, type Page } from '@playwright/test';

import type { ApiBodies } from '../../src/api-bodies';
import type { SessionSwitch } from '../../src/session-switches';

/**
 * A faked 200 answer of a dashboard route, typed as the real route answers (src/api-bodies.ts).
 * Every faked answer of these routes goes through here, so a field the real route adds or renames
 * is a type error in the spec instead of a page that only breaks live. An error answer (a status
 * other than 200) has its own small shape and stays inline.
 */
export function apiBody<K extends keyof ApiBodies>(_path: K, body: ApiBodies[K]): ApiBodies[K] {
  return body;
}

export const GM_TOKEN = 'e2e-gm-token';

type PreflightBody = ApiBodies['/api/preflight'];

/** The pre-flight answer with the bridge's version fields the real route always carries. */
export function preflightBody(
  checks: PreflightBody['checks'] = [],
  ready = true,
  scan: PreflightBody['scan'] = null
): PreflightBody {
  return apiBody('/api/preflight', {
    ready,
    checks,
    scan,
    bridgeVersion: '0.0.0-test',
    moduleVersion: null,
  });
}

/** Pre-flight with nothing to report: ready, no checks. */
export const PREFLIGHT_OK = preflightBody();

/** /api/space when there is no disk reading. */
export const SPACE_UNAVAILABLE = apiBody('/api/space', {
  available: false,
  reason: 'No disk reading in the test',
});

/** /api/player/names with nobody known yet. */
export const NO_PLAYERS = apiBody('/api/player/names', []);

/** The ids of the themes the dashboard offers (THEMES in src/theme.ts). */
export const THEME_IDS = ['neutral', 'veil'] as const;

/** The theme answer for one theme. */
export const themeBody = (theme: string): ApiBodies['/api/theme'] =>
  apiBody('/api/theme', { theme, themes: THEME_IDS });

/**
 * A GET /api/session/switches answer: the module's list (null when it cannot report, with the
 * `error` it gives) and whether GM Actions is on.
 */
export function switchesBody(
  gmActionsEnabled: boolean,
  list: SessionSwitch[] | null = [],
  error: string | null = null
): ApiBodies['/api/session/switches'] {
  return apiBody('/api/session/switches', {
    switches: list === null ? null : { switches: list, ready: null, changed: [], failed: [] },
    gmActionsEnabled,
    error,
  });
}

/**
 * Lets what the page has already started finish, for a check that something did NOT happen:
 * two animation frames (React has rendered and run its effects) and one answered request to the
 * server. It does not wait for requests the page sent to a faked route in the test process; where
 * that matters, wait on the fake itself. A condition, not a fixed pause.
 */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
    await fetch('/api/health', { cache: 'no-store' }).catch(() => undefined);
  });
}

/**
 * The theme the real test server sends on its stream when there is no world (themes.get(undefined)).
 * A spec that fakes /api/theme but rides the real stream (no `fakeStream`) gets this theme event
 * right after the faked answer, so the fake must say the same or the page flips to it.
 */
export const SERVER_THEME = 'neutral';

/**
 * The world's theme and the usage log, so a page load never depends on a bridge. Pass another
 * `theme` only together with a `fakeStream` that sends the same theme.
 */
export async function fakeCommonRoutes(page: Page, theme = SERVER_THEME): Promise<void> {
  await page.route('**/api/theme', route => route.fulfill({ json: themeBody(theme) }));
  await page.route('**/api/usage', route => route.fulfill({ status: 204 }));
  await fakeSwitchesRead(page);
}

/**
 * Answers /api/stream with these events once. The long retry keeps EventSource from reconnecting
 * (and replaying them) during the test.
 */
export async function fakeStream(
  page: Page,
  events: { event: string; data: unknown }[]
): Promise<void> {
  const lines = events.map(e => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
  const body = `retry: 600000\n\n${lines.join('')}`;
  await page.route('**/api/stream**', route =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body })
  );
}

/**
 * The module's switches read as on (none needed) unless a spec answers its own: without a bridge
 * the real route says it cannot read them, and the live controls stay disabled for that.
 */
export async function fakeSwitchesRead(page: Page): Promise<void> {
  await page.route('**/api/session/switches', route =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: switchesBody(true) })
      : route.fallback()
  );
}

/**
 * A toast in the stack. Radix also repeats each toast's text in a screen-reader live region
 * outside the stack, so a page-wide getByText can match twice.
 */
export const toast = (page: Page, text: string | RegExp, options?: { exact?: boolean }): Locator =>
  page.locator('.toast-stack').getByText(text, options);

/** One POST /api/tool body: the tool, its args and the confirm flags of a write. */
export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  confirm?: boolean;
  confirmDestructive?: boolean;
}

/**
 * Leaves get-play-session unanswered (other tool calls go on to the routes registered before).
 * The moment views then never pick a moment and no panel docks in the page, so a panel's own
 * spec sees its drawer open over the page. views.spec.ts tests the moments and the docking.
 * fakeTools does this by itself; a test with its own /api/tool route calls it after that route.
 */
export async function holdPlaySession(page: Page): Promise<void> {
  await page.route('**/api/tool', route => {
    const call = route.request().postDataJSON() as ToolCall;
    // Never answered: the read stays in flight until the page closes.
    if (call.name === 'get-play-session') return;
    return route.fallback();
  });
}

/**
 * Answers POST /api/tool by tool name and records each call. get-play-session is held, as
 * holdPlaySession does, unless `playSession` is set: then `answer` gets it too.
 */
export async function fakeTools(
  page: Page,
  answer: (call: ToolCall) => { status?: number; json: unknown },
  { playSession = false }: { playSession?: boolean } = {}
): Promise<ToolCall[]> {
  const calls: ToolCall[] = [];
  await page.route('**/api/tool', route => {
    const call = route.request().postDataJSON() as ToolCall;
    if (call.name === 'get-play-session' && !playSession) return;
    calls.push(call);
    const { status = 200, json } = answer(call);
    return route.fulfill({ status, json });
  });
  return calls;
}

/** A tool's answer when it worked. */
export const ok = (result: unknown): { json: unknown } => ({ json: { ok: true, result } });

/**
 * Picks an entry of the Advanced ▾ menu (by its element id): a click on the menu, then on the
 * entry; or from the keyboard, which also works while a drawer's backdrop covers the header.
 */
export async function fromMenu(page: Page, id: string, keyboard = false): Promise<void> {
  // The menu is a lazy chunk with a stand-in button until it arrives (AdvancedMenu.tsx): wait for
  // the real one, as a person using the page does, so focus follows the usual path.
  await expect(page.locator('#btn-advanced')).toHaveAttribute('aria-haspopup', 'menu');
  if (keyboard) {
    await page.locator('#btn-advanced').press('Enter');
    await page.locator(`#advanced-menu #${id}`).press('Enter');
  } else {
    await page.locator('#btn-advanced').click();
    await page.locator(`#advanced-menu #${id}`).click();
  }
}
