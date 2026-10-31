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

export const LIVE_WINDOW_SETTING = 'liveWindow';
export const LIVE_WINDOW_URL_SETTING = 'liveWindowUrl';
/** The `type` of the message to the frame (the dashboard's lib/mapPick.ts reads the same string). */
export const LIVE_PICK_MESSAGE = 'fmb-live-pick';
/** The `type` the strip page posts back once it listens (the first pick can come before that). */
export const LIVE_READY_MESSAGE = 'fmb-live-ready';
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
    hint: 'Adds a Live button to the AI Tool group (GM only) and a small pin at the edge of the screen. It opens the dashboard live strip in a window next to the map: the combat order, the party and the quick buttons. Picking tokens on the map picks them in the strip. The Combat, Party and Session windows stay as they are. Needs the dashboard to be running.',
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
  location: { protocol: string; hostname: string }
): string | null {
  const text = setting.trim();
  const base =
    text !== '' ? text : `${location.protocol}//${location.hostname}:${DEFAULT_DASHBOARD_PORT}`;
  try {
    const url = new URL(base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.search = '?strip=1';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function configuredUrl(): string | null {
  let setting = '';
  try {
    const value: unknown = game.settings.get(MODULE_ID, LIVE_WINDOW_URL_SETTING);
    setting = typeof value === 'string' ? value : '';
  } catch {
    // A setting that is not registered counts as empty.
  }
  return liveFrameUrl(setting, window.location);
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

function onFrameMessage(event: MessageEvent): void {
  const frame = frameOf();
  if (frame && isReadyFromFrame(event, frame)) postPick();
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
        ? `<iframe class="fmb-live-frame" title="Live strip" src="${escapeHtml(url)}" referrerpolicy="no-referrer-when-downgrade"></iframe>`
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
      content.querySelector('iframe.fmb-live-frame')?.addEventListener('load', () => postPick());
    }

    _onRender(): void {
      hookId ??= Hooks.on('controlToken', () => postPick());
      window.addEventListener('message', onFrameMessage);
      this.remember(true);
    }

    _onClose(): void {
      if (hookId !== null) Hooks.off('controlToken', hookId);
      hookId = null;
      window.removeEventListener('message', onFrameMessage);
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
  if (frame && url) frame.src = url;
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
      ui.notifications.error(
        `Could not open the live window: ${error instanceof Error ? error.message : String(error)}`
      );
    });
  });
  document.body.appendChild(pin);
}

/** On `ready`: draw the pin and bring the window back if it was open before the reload. */
export function restoreLiveWindow(): void {
  refreshLiveWindowButtons();
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
  document.getElementById(PIN_ID)?.remove();
}
