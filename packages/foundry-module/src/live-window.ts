/**
 * Live screen B (item live-screen-b-foundry): the dashboard's live strip in a Foundry window, next
 * to the map. The window is a frame around the dashboard page `/?strip=1`, the same component as
 * live screen A, so nothing here draws a strip of its own.
 *
 * - Off unless the GM turns on the world setting {@link LIVE_WINDOW_SETTING}; only then does the AI
 *   Tool group get its "Live" button and a small pinned button appear at the edge of the screen. The
 *   Combat, Party and Session windows are not touched.
 * - The frame address is {@link LIVE_WINDOW_URL_SETTING}; empty means this host on port 3100 (the
 *   test and PC default). Behind the Pi's login it is the dashboard's public address, which must
 *   allow this Foundry as its frame parent (the dashboard sets `frame-ancestors` from
 *   `DASHBOARD_FOUNDRY_URL`).
 * - The window remembers its place and whether it was open, so a reload brings it back.
 * - Controlling tokens on the map posts their ids to the frame ({@link LIVE_PICK_MESSAGE}); the
 *   strip picks the same creatures. The message carries ids only and goes to the frame's own origin.
 */
import { MODULE_ID } from './constants.js';
import { toGmMessage } from './gm-message.js';

export const LIVE_WINDOW_SETTING = 'liveWindow';
export const LIVE_WINDOW_URL_SETTING = 'liveWindowUrl';
/** The `type` of the message to the frame (the dashboard's lib/mapPick.ts reads the same string). */
export const LIVE_PICK_MESSAGE = 'fmb-live-pick';
/** The `type` of the no-data hello to the GM page (the dashboard's lib/mapPick.ts reads it too). */
export const LIVE_HELLO_MESSAGE = 'fmb-live-hello';
/** The `type` the strip page posts back once it listens (the first pick can come before that). */
export const LIVE_READY_MESSAGE = 'fmb-live-ready';
/** The `type` of the message that tells the frame Foundry's light or dark setting changed. */
export const LIVE_SCHEME_MESSAGE = 'fmb-live-scheme';
/** The dashboard's port on the machine that runs the bridge. */
export const DEFAULT_DASHBOARD_PORT = 3100;
/** Browser storage key for the window's place and open state (per browser, like the window). */
export const LIVE_WINDOW_STATE_KEY = `${MODULE_ID}.liveWindowState`;
const WINDOW_ID = 'fmb-live-window';
const PIN_ID = 'fmb-live-pin';
const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 320;

interface SavedState {
  open: boolean;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

/** Register the two settings. Call from the module `init` hook. */
export function registerLiveWindowSettings(): void {
  game.settings.register(MODULE_ID, LIVE_WINDOW_SETTING, {
    name: 'AI Tool: Live window',
    hint: 'Adds a Live button (GM only) that opens the dashboard live strip in a window next to the map; needs the dashboard to be running.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
    onChange: () => {
      if (!liveWindowEnabled()) closeLiveWindow();
      refreshLiveWindowButtons();
    },
  });
  game.settings.register(MODULE_ID, LIVE_WINDOW_URL_SETTING, {
    name: 'AI Tool: Live window address',
    hint: `Where this browser reaches the dashboard, for example https://dashboard.example.com. Empty means this host on port ${DEFAULT_DASHBOARD_PORT}. The dashboard must know this Foundry's address (DASHBOARD_FOUNDRY_URL, exactly as this browser opens Foundry) so it lets this page frame it. Behind a login, sign in to the dashboard in a normal tab first: a login page does not show inside the window.`,
    scope: 'world',
    config: true,
    type: String,
    default: '',
    onChange: () => reloadLiveWindow(),
  });
}

/** Whether the GM turned the window on. A setting that is not registered counts as off. */
export function liveWindowEnabled(): boolean {
  try {
    return game.settings.get(MODULE_ID, LIVE_WINDOW_SETTING) === true;
  } catch {
    return false;
  }
}

/** Whether this client may open the window right now. */
export function canOpenLiveWindow(): boolean {
  return game.user?.isGM === true && liveWindowEnabled();
}

/**
 * The frame's address: the setting, else this host on the dashboard port. Only http and https
 * count; anything else (or a string that is no address) gives null and the window says so.
 * `?strip=1` is the live strip page.
 */
export function liveFrameUrl(
  setting: string,
  location: { protocol: string; hostname: string },
  scheme?: LiveScheme
): string | null {
  const text = setting.trim();
  const base =
    text !== '' ? text : `${location.protocol}//${location.hostname}:${DEFAULT_DASHBOARD_PORT}`;
  try {
    const url = new URL(base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.search = '?strip=1';
    if (scheme !== undefined) url.searchParams.set('scheme', scheme);
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export type LiveScheme = 'light' | 'dark';

/**
 * Light or dark as Foundry shows it: the colour scheme chosen for applications (windows), else
 * for the interface; "default" or nothing follows the browser's own setting.
 */
export function pickScheme(uiConfig: unknown, browserPrefersLight: boolean): LiveScheme {
  const cs = (uiConfig as { colorScheme?: { applications?: unknown; interface?: unknown } } | null)
    ?.colorScheme;
  for (const value of [cs?.applications, cs?.interface]) {
    if (value === 'light' || value === 'dark') return value;
  }
  return browserPrefersLight ? 'light' : 'dark';
}

/** Foundry's scheme right now. */
export function foundryScheme(): LiveScheme {
  let uiConfig: unknown = null;
  try {
    uiConfig = game.settings.get('core', 'uiConfig');
  } catch {
    // No such setting (an older core): follow the browser.
  }
  let light = false;
  try {
    light = window.matchMedia?.('(prefers-color-scheme: light)')?.matches === true;
  } catch {
    // No matchMedia: dark, the dashboard's own look.
  }
  return pickScheme(uiConfig, light);
}

function configuredUrl(): string | null {
  let setting = '';
  try {
    const value: unknown = game.settings.get(MODULE_ID, LIVE_WINDOW_URL_SETTING);
    setting = typeof value === 'string' ? value : '';
  } catch {
    // A setting that is not registered counts as empty.
  }
  return liveFrameUrl(setting, window.location, foundryScheme());
}

/** The ids of the tokens this GM controls on the map. */
export function controlledTokenIds(): string[] {
  const tokens = (canvas as unknown as { tokens?: { controlled?: Array<{ id?: unknown }> } })
    ?.tokens?.controlled;
  return (tokens ?? []).map(t => t.id).filter((id): id is string => typeof id === 'string');
}

function loadState(): SavedState {
  try {
    const raw = window.localStorage.getItem(LIVE_WINDOW_STATE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<SavedState>) : {};
    const num = (v: unknown): number | undefined =>
      typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    return {
      open: parsed.open === true,
      ...(num(parsed.left) !== undefined ? { left: num(parsed.left)! } : {}),
      ...(num(parsed.top) !== undefined ? { top: num(parsed.top)! } : {}),
      ...(num(parsed.width) !== undefined ? { width: num(parsed.width)! } : {}),
      ...(num(parsed.height) !== undefined ? { height: num(parsed.height)! } : {}),
    };
  } catch {
    return { open: false };
  }
}

function saveState(state: SavedState): void {
  try {
    window.localStorage.setItem(LIVE_WINDOW_STATE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be blocked; the window then opens in its default place.
  }
}

interface AppV2Instance {
  rendered?: boolean;
  element?: HTMLElement;
  position?: { left?: number; top?: number; width?: number; height?: number };
  render(options?: { force?: boolean }): Promise<unknown>;
  bringToFront?(): void;
  close?(options?: { animate?: boolean }): Promise<unknown>;
}
type AppV2Constructor = new (options?: Record<string, unknown>) => AppV2Instance;

let windowClass: (new () => AppV2Instance) | null = null;
let instance: AppV2Instance | null = null;
let hookId: number | null = null;
let closing = false;

/** The default place: left of the sidebar, full height, about 400 px wide. */
function defaultPosition(): { left: number; top: number; width: number; height: number } {
  const sidebar = document.getElementById('sidebar')?.getBoundingClientRect();
  const right = sidebar && sidebar.width > 0 ? sidebar.left : window.innerWidth;
  const width = Math.max(MIN_WIDTH, Math.min(DEFAULT_WIDTH, right));
  return {
    left: Math.max(0, right - width - 8),
    top: 8,
    width,
    height: Math.max(320, window.innerHeight - 16),
  };
}

function frameOf(): HTMLIFrameElement | null {
  return instance?.element?.querySelector<HTMLIFrameElement>('iframe.fmb-live-frame') ?? null;
}

/** Send a pick to a frame, to the frame's own origin only. */
export function postPickTo(
  frame: {
    src: string;
    contentWindow: { postMessage(data: unknown, origin: string): void } | null;
  },
  tokenIds: string[]
): void {
  if (!frame.contentWindow || !frame.src) return;
  try {
    frame.contentWindow.postMessage(
      { type: LIVE_PICK_MESSAGE, tokenIds },
      new URL(frame.src).origin
    );
  } catch (error) {
    console.warn(`[${MODULE_ID}] Could not send the token pick to the live window:`, error);
  }
}

/** Send the scheme to a frame, to the frame's own origin only. */
export function postSchemeTo(
  frame: {
    src: string;
    contentWindow: { postMessage(data: unknown, origin: string): void } | null;
  },
  scheme: LiveScheme
): void {
  if (!frame.contentWindow || !frame.src) return;
  try {
    frame.contentWindow.postMessage(
      { type: LIVE_SCHEME_MESSAGE, scheme },
      new URL(frame.src).origin
    );
  } catch (error) {
    console.warn(`[${MODULE_ID}] Could not send the colour scheme to the live window:`, error);
  }
}

let schemeWatch: { stop(): void } | null = null;
let lastScheme: LiveScheme | null = null;

/** Send the scheme when it differs from the last one sent (the address already carries the first). */
function syncScheme(force = false): void {
  const scheme = foundryScheme();
  if (!force && scheme === lastScheme) return;
  lastScheme = scheme;
  const frame = frameOf();
  if (frame) postSchemeTo(frame, scheme);
}

/**
 * Follow Foundry's light/dark setting while the window is open: Foundry puts a theme class on the
 * page when the setting changes, and the browser's own setting counts when Foundry says "default".
 */
function startSchemeWatch(): void {
  if (schemeWatch) return;
  lastScheme = foundryScheme();
  const observer =
    typeof MutationObserver === 'function' ? new MutationObserver(() => syncScheme()) : null;
  const options = { attributes: true, attributeFilter: ['class', 'data-theme'] };
  if (document.body) observer?.observe(document.body, options);
  if (document.documentElement) observer?.observe(document.documentElement, options);
  let media: MediaQueryList | null = null;
  const onMedia = (): void => syncScheme();
  try {
    media = window.matchMedia?.('(prefers-color-scheme: light)') ?? null;
    media?.addEventListener?.('change', onMedia);
  } catch {
    media = null;
  }
  schemeWatch = {
    stop: (): void => {
      observer?.disconnect();
      media?.removeEventListener?.('change', onMedia);
    },
  };
}

function stopSchemeWatch(): void {
  schemeWatch?.stop();
  schemeWatch = null;
  lastScheme = null;
}

/** Tell the frame which tokens the GM controls now. */
export function postPick(): void {
  const frame = frameOf();
  if (frame) postPickTo(frame, controlledTokenIds());
}

/** Whether a message is the strip page saying it listens: from this frame, from its own origin. */
export function isReadyFromFrame(
  event: { data: unknown; source: unknown; origin: string },
  frame: { src: string; contentWindow: unknown }
): boolean {
  const type = (event.data as { type?: unknown } | null)?.type;
  if (type !== LIVE_READY_MESSAGE || !frame.contentWindow || event.source !== frame.contentWindow) {
    return false;
  }
  try {
    return event.origin === new URL(frame.src).origin;
  } catch {
    return false;
  }
}

/** A window this page can post to: the page that frames Foundry, or the one that opened it. */
export interface PickTarget {
  postMessage(data: unknown, origin: string): void;
}

/**
 * The windows above this Foundry page (GM page, item gm-page-wrapper): the frame parent, and the
 * opener when Foundry was opened from the GM page's "open in its own tab" button. Empty for a
 * plain Foundry tab.
 */
export function pickTargets(win: {
  parent: unknown;
  opener?: unknown;
  self?: unknown;
}): PickTarget[] {
  const self = win.self ?? win;
  const targets: PickTarget[] = [];
  const add = (w: unknown): void => {
    if (w && w !== self && typeof (w as PickTarget).postMessage === 'function') {
      targets.push(w as PickTarget);
    }
  };
  add(win.parent);
  if (win.opener !== win.parent) add(win.opener);
  return targets;
}

/**
 * Say hello to each window above this page. It carries no data, so any origin may hear it; the
 * answer (a ready from the GM page) is what tells this module where the GM page lives.
 */
export function postHelloToTargets(targets: readonly PickTarget[]): void {
  for (const target of targets) {
    try {
      target.postMessage({ type: LIVE_HELLO_MESSAGE }, '*');
    } catch (error) {
      console.warn(`[${MODULE_ID}] Could not say hello to the GM page:`, error);
    }
  }
}

/** Post the pick to each target, to each of the dashboard's origins only. */
export function postPickToTargets(
  targets: readonly PickTarget[],
  origins: readonly string[],
  tokenIds: string[]
): void {
  for (const target of targets) {
    for (const origin of origins) {
      try {
        target.postMessage({ type: LIVE_PICK_MESSAGE, tokenIds }, origin);
      } catch (error) {
        console.warn(`[${MODULE_ID}] Could not send the token pick to the GM page:`, error);
      }
    }
  }
}

/**
 * The origin of a message that is the GM page saying it listens, or null. It counts only from a
 * window that frames this Foundry or opened it (`targets`) and from a web origin other than this
 * Foundry's own; the module then answers that origin, whatever the Live window address says.
 */
export function readyOriginFromTarget(
  event: { data: unknown; source: unknown; origin: string },
  targets: readonly unknown[],
  ownOrigin?: string
): string | null {
  const type = (event.data as { type?: unknown } | null)?.type;
  if (type !== LIVE_READY_MESSAGE || event.source === null || !targets.includes(event.source)) {
    return null;
  }
  const origin = originOf(event.origin);
  return origin !== null && origin !== ownOrigin ? origin : null;
}

function originOf(text: string | undefined): string | null {
  if (!text || text === 'null') return null;
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * The origins the GM page can have: the page that frames this Foundry (the browser's own record of
 * its parent, else the referrer of the frame), and only when neither is known the "Live window
 * address" setting. The GM page does not depend on that setting, which belongs to the Live window and is often empty. Picks and
 * answers only ever go to a window that already frames or opened this page.
 */
export function dashboardOrigins(
  win: {
    location?: { origin?: string; ancestorOrigins?: ArrayLike<string> };
    document?: { referrer?: string };
  },
  configured: string | null
): string[] {
  const own = win.location?.origin;
  const known = [originOf(win.location?.ancestorOrigins?.[0]), originOf(win.document?.referrer)];
  // The referrer of a page Foundry navigated itself is Foundry: that is not the GM page.
  const parents = known.filter((o): o is string => o !== null && o !== own);
  if (parents.length > 0) return [...new Set(parents)];
  const fallback = originOf(configured ?? undefined);
  return fallback !== null ? [fallback] : [];
}

function currentDashboardOrigins(): string[] {
  const url = configuredUrl();
  return dashboardOrigins(window, url);
}

let relayStarted = false;

/**
 * On `ready`, when this Foundry page sits in the GM page's frame (or was opened by it): tell the
 * GM page which tokens this GM controls, now and on every change, and answer its "ready" message.
 * Does nothing in a plain Foundry tab, and nothing for a player.
 */
export function startPickRelay(): void {
  if (relayStarted || game.user?.isGM !== true) return;
  const targets = pickTargets(window);
  if (targets.length === 0) return;
  // Known early (the frame parent, else the setting); the GM page's own first message adds its
  // origin, which is the one that counts when Foundry was opened in a tab or by a browser without
  // `ancestorOrigins`.
  const origins = currentDashboardOrigins();
  relayStarted = true;
  const send = (): void => postPickToTargets(targets, origins, controlledTokenIds());
  Hooks.on('controlToken', send);
  window.addEventListener('message', event => {
    const origin = readyOriginFromTarget(event, targets, window.location.origin);
    if (origin === null) return;
    // What the GM page itself said wins over the early guess.
    origins.splice(0, origins.length, origin);
    send();
  });
  // The GM page loads before this relay starts, so its own "ready" was missed (and a reloaded
  // Foundry tab missed it too): say hello, no data, and it answers with a ready from its origin.
  postHelloToTargets(targets);
  // The first message doubles as the hello: the GM page counts a pick as "Foundry is in the frame".
  send();
}

/** How long the strip page has to say it listens before the window explains the blank frame. */
export const FRAME_WAIT_MS = 8000;

/**
 * What to tell the GM when the strip page did not answer: the address tried, and the usual causes
 * with the fix for each, in plain words.
 */
export function liveWindowWhy(url: string, addressSet: boolean): string[] {
  return [
    `The live strip did not answer from ${url}.`,
    'Check that the dashboard is running (open that address in another tab).',
    addressSet
      ? 'Check the address in the module setting "AI Tool: Live window address": it must be the address your browser uses for the dashboard.'
      : 'If the dashboard is on another computer or behind a login, set "AI Tool: Live window address" in the module settings to its address.',
    'The dashboard must know this Foundry address (DASHBOARD_FOUNDRY_URL, exactly as this browser opens Foundry), or it refuses to show inside Foundry.',
    'Behind a login, sign in to the dashboard in a normal tab first.',
  ];
}

let whyTimer: number | null = null;

function whyPanel(): HTMLElement | null {
  return instance?.element?.querySelector<HTMLElement>('.fmb-live-why') ?? null;
}

function hideWhy(): void {
  if (whyTimer !== null) window.clearTimeout(whyTimer);
  whyTimer = null;
  const panel = whyPanel();
  if (panel) panel.hidden = true;
}

/** Start the wait for the strip page's "ready"; when it does not come, show the panel. */
function armWhy(): void {
  hideWhy();
  whyTimer = window.setTimeout(() => {
    whyTimer = null;
    const panel = whyPanel();
    const frame = frameOf();
    if (!panel || !frame) return;
    const lines = liveWindowWhy(frame.src, configuredSetting() !== '');
    // Show the live region first, then fill it in the next frame, so a screen reader announces
    // the text instead of a region that appeared with its text already in it.
    // A second "Try again" must not flash the first answer before the new text is filled in.
    panel.replaceChildren();
    panel.hidden = false;
    const paragraphs = lines.map(line => `<p>${escapeHtml(line)}</p>`).join('');
    window.requestAnimationFrame(() => {
      panel.innerHTML = `${paragraphs}<button type="button" class="fmb-live-retry">Try again</button>`;
      panel.querySelector('.fmb-live-retry')?.addEventListener('click', () => {
        const url = configuredUrl();
        if (url) frame.src = url;
        armWhy();
      });
    });
  }, FRAME_WAIT_MS);
}

function configuredSetting(): string {
  try {
    const value: unknown = game.settings.get(MODULE_ID, LIVE_WINDOW_URL_SETTING);
    return typeof value === 'string' ? value.trim() : '';
  } catch {
    return '';
  }
}

function onFrameMessage(event: MessageEvent): void {
  const frame = frameOf();
  if (frame && isReadyFromFrame(event, frame)) {
    hideWhy();
    postPick();
    syncScheme(true);
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
}

function define(): new () => AppV2Instance {
  const api = (foundry.applications as { api?: { ApplicationV2?: AppV2Constructor } }).api;
  const Base = api?.ApplicationV2;
  if (!Base) throw new Error('This Foundry version has no ApplicationV2');
  const place = defaultPosition();
  const saved = loadState();

  class LiveWindow extends Base {
    static DEFAULT_OPTIONS = {
      id: WINDOW_ID,
      classes: ['fmb-ai-window', 'fmb-live-window'],
      tag: 'div',
      window: { title: 'Live', icon: 'fa-solid fa-bolt', resizable: true },
      position: {
        width: saved.width ?? place.width,
        height: saved.height ?? place.height,
        left: saved.left ?? place.left,
        top: saved.top ?? place.top,
      },
    };

    _prepareContext(): Promise<{ html: string }> {
      if (!canOpenLiveWindow()) return Promise.resolve({ html: '' });
      const url = configuredUrl();
      const html = url
        ? `<iframe class="fmb-live-frame" title="Live strip" src="${escapeHtml(url)}" referrerpolicy="no-referrer-when-downgrade"></iframe><div class="fmb-live-why" role="status" hidden></div>`
        : '<p class="fmb-live-note">The live window address is not a web address. Set "AI Tool: Live window address" in the module settings.</p>';
      return Promise.resolve({ html });
    }

    _renderHTML(context: { html: string }): Promise<string> {
      return Promise.resolve(context.html);
    }

    _replaceHTML(html: string, content: HTMLElement): void {
      // One frame for the life of the window: a redraw must not reload the strip.
      if (content.querySelector('iframe.fmb-live-frame') && html.includes('<iframe')) return;
      content.innerHTML = html;
      armWhy();
      content.querySelector('iframe.fmb-live-frame')?.addEventListener('load', () => postPick());
    }

    _onRender(): void {
      hookId ??= Hooks.on('controlToken', () => postPick());
      window.addEventListener('message', onFrameMessage);
      startSchemeWatch();
      this.remember(true);
    }

    _onClose(): void {
      if (hookId !== null) Hooks.off('controlToken', hookId);
      hookId = null;
      window.removeEventListener('message', onFrameMessage);
      stopSchemeWatch();
      hideWhy();
      // A close from the switch or a reload is not the GM closing it: keep "open" as it was.
      this.remember(closing ? loadState().open : false);
    }

    private remember(open: boolean): void {
      const p = this.position ?? {};
      saveState({
        open,
        ...(p.left !== undefined ? { left: p.left } : {}),
        ...(p.top !== undefined ? { top: p.top } : {}),
        ...(p.width !== undefined ? { width: p.width } : {}),
        ...(p.height !== undefined ? { height: p.height } : {}),
      });
    }

    _onPosition(): void {
      if (this.rendered) this.remember(true);
    }
  }
  return LiveWindow;
}

/** Open (or bring to the front) the window; false when the switch is off or this is not a GM. */
export async function openLiveWindow(): Promise<boolean> {
  if (!canOpenLiveWindow()) {
    ui.notifications.warn(
      'The live window is off: turn on "AI Tool: Live window" in the module settings.'
    );
    return false;
  }
  windowClass ??= define();
  instance ??= new windowClass();
  await instance.render({ force: true });
  instance.bringToFront?.();
  return true;
}

/** Close the window because the switch went off (it stays "open" for a reload while on). */
export function closeLiveWindow(): void {
  closing = true;
  const open = instance;
  void Promise.resolve(open?.close?.({ animate: false }))
    .catch((e: unknown): void => console.warn(`${MODULE_ID} | live window close failed`, e))
    .finally(() => {
      closing = false;
    });
}

function reloadLiveWindow(): void {
  const frame = frameOf();
  const url = configuredUrl();
  if (frame && url) {
    frame.src = url;
    armWhy();
  }
}

/** Open or close the window from the toolbar and the pin. */
export async function toggleLiveWindow(): Promise<void> {
  if (instance?.rendered === true) {
    await instance.close?.({ animate: false });
    return;
  }
  await openLiveWindow();
}

/** The pinned button, and the scene controls rebuilt, for the current switch. */
export function refreshLiveWindowButtons(): void {
  try {
    const controls = (ui as unknown as { controls?: { render?(o: object): unknown } }).controls;
    void controls?.render?.({ reset: true });
  } catch (error) {
    console.warn(`[${MODULE_ID}] Could not redraw the scene controls:`, error);
  }
  document.getElementById(PIN_ID)?.remove();
  if (!canOpenLiveWindow()) return;
  const pin = document.createElement('button');
  pin.id = PIN_ID;
  pin.type = 'button';
  pin.className = 'fmb-live-pin';
  pin.title = 'Live window (AI Tool)';
  pin.setAttribute('aria-label', 'Open or close the live window');
  pin.innerHTML = '<i class="fa-solid fa-bolt" aria-hidden="true"></i>';
  pin.addEventListener('click', () => {
    void toggleLiveWindow().catch((error: unknown) => {
      console.error(`[${MODULE_ID}] Could not open the live window:`, error);
      ui.notifications.error(toGmMessage('open the live window', error));
    });
  });
  document.body.appendChild(pin);
}

/** On `ready`: draw the pin and bring the window back if it was open before the reload. */
export function restoreLiveWindow(): void {
  refreshLiveWindowButtons();
  try {
    startPickRelay();
  } catch (e) {
    console.warn('Foundry MCP Bridge: the live pick relay did not start', e);
  }
  if (canOpenLiveWindow() && loadState().open) {
    void openLiveWindow().catch((e: unknown): void =>
      console.warn(`${MODULE_ID} | live window restore failed`, e)
    );
  }
}

/** Forget the window (tests). */
export function resetLiveWindow(): void {
  windowClass = null;
  instance = null;
  hookId = null;
  closing = false;
  relayStarted = false;
  stopSchemeWatch();
  document.getElementById(PIN_ID)?.remove();
}
