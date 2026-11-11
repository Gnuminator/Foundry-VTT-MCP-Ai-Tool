/**
 * Tests for the live window (live screen B): the frame address, the off-by-default switch and the
 * toolbar button that only exists while the switch is on. The window itself is checked live.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import { MODULE_ID } from './constants.js';
import { AI_TOOL_CONTROL, addAiToolControls } from './ai-tool-controls.js';
import {
  LIVE_HELLO_MESSAGE,
  LIVE_PICK_MESSAGE,
  LIVE_READY_MESSAGE,
  LIVE_SCHEME_MESSAGE,
  pickScheme,
  postSchemeTo,
  postHelloToTargets,
  LIVE_WINDOW_SETTING,
  LIVE_WINDOW_URL_SETTING,
  canOpenLiveWindow,
  dashboardOrigins,
  liveWindowWhy,
  isReadyFromFrame,
  readyOriginFromTarget,
  liveFrameUrl,
  pickTargets,
  postPickToTargets,
  liveWindowEnabled,
  postPickTo,
  registerLiveWindowSettings,
} from './live-window.js';

const g = globalThis as any;
let world: TestWorld;
let restore: () => void;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  restore?.();
  vi.restoreAllMocks();
});

function install(isGM: boolean, on: boolean): void {
  world = createTestWorld({ foundryVersion: '14.368', currentUser: { isGM } });
  restore = world.install();
  if (on) world.settings.set(`${MODULE_ID}.${LIVE_WINDOW_SETTING}`, true);
}

describe('light or dark', () => {
  it('uses the message type the dashboard listens for', () => {
    expect(LIVE_SCHEME_MESSAGE).toBe('fmb-live-scheme');
  });

  it('follows the scheme chosen for windows, then the interface, then the browser', () => {
    expect(pickScheme({ colorScheme: { applications: 'light', interface: 'dark' } }, false)).toBe(
      'light'
    );
    expect(pickScheme({ colorScheme: { applications: '', interface: 'light' } }, false)).toBe(
      'light'
    );
    expect(pickScheme({ colorScheme: { applications: 'default' } }, true)).toBe('light');
    expect(pickScheme({ colorScheme: {} }, false)).toBe('dark');
    expect(pickScheme(null, false)).toBe('dark');
    expect(pickScheme(undefined, true)).toBe('light');
  });

  it('puts the scheme in the frame address and keeps the rest', () => {
    const here = { protocol: 'http:', hostname: 'localhost' };
    expect(liveFrameUrl('', here, 'light')).toBe('http://localhost:3100/?strip=1&scheme=light');
    expect(liveFrameUrl('https://d.example.com/x?a=1', here, 'dark')).toBe(
      'https://d.example.com/x?strip=1&scheme=dark'
    );
  });

  it('posts the scheme to the frame own origin only', () => {
    const postMessage = vi.fn();
    postSchemeTo(
      { src: 'http://localhost:3100/?strip=1', contentWindow: { postMessage } },
      'light'
    );
    expect(postMessage).toHaveBeenCalledWith(
      { type: LIVE_SCHEME_MESSAGE, scheme: 'light' },
      'http://localhost:3100'
    );
    postMessage.mockClear();
    postSchemeTo({ src: '', contentWindow: { postMessage } }, 'light');
    expect(postMessage).not.toHaveBeenCalled();
  });
});

describe('the live frame address', () => {
  const here = { protocol: 'http:', hostname: 'localhost' };

  it('is this host on the dashboard port when the setting is empty', () => {
    expect(liveFrameUrl('', here)).toBe('http://localhost:3100/?strip=1');
    expect(liveFrameUrl('   ', here)).toBe('http://localhost:3100/?strip=1');
  });

  it('uses the setting, always asking for the strip page', () => {
    expect(liveFrameUrl('https://dash.example.com', here)).toBe(
      'https://dash.example.com/?strip=1'
    );
    expect(liveFrameUrl('https://dash.example.com/x?a=1#b', here)).toBe(
      'https://dash.example.com/x?strip=1'
    );
  });

  it('refuses anything that is not an http or https address', () => {
    expect(liveFrameUrl('javascript:alert(1)', here)).toBeNull();
    expect(liveFrameUrl('data:text/html,hi', here)).toBeNull();
    expect(liveFrameUrl('not an address', here)).toBeNull();
  });

  it('shares the pick message name with the dashboard', () => {
    expect(LIVE_PICK_MESSAGE).toBe('fmb-live-pick');
  });
});

describe('the pick messages', () => {
  it('posts the ids to the frame origin only', () => {
    const postMessage = vi.fn();
    postPickTo({ src: 'https://dash.example.com/x?strip=1', contentWindow: { postMessage } }, [
      'a',
      'b',
    ]);
    expect(postMessage).toHaveBeenCalledWith(
      { type: LIVE_PICK_MESSAGE, tokenIds: ['a', 'b'] },
      'https://dash.example.com'
    );
  });

  it('posts nothing before the frame has a window', () => {
    expect(() =>
      postPickTo({ src: 'https://dash.example.com/', contentWindow: null }, ['a'])
    ).not.toThrow();
  });

  it('takes the ready message from this frame and its origin only', () => {
    const win = {};
    const frame = { src: 'https://dash.example.com/?strip=1', contentWindow: win };
    const ready = { type: LIVE_READY_MESSAGE };
    expect(
      isReadyFromFrame({ data: ready, source: win, origin: 'https://dash.example.com' }, frame)
    ).toBe(true);
    expect(
      isReadyFromFrame({ data: ready, source: {}, origin: 'https://dash.example.com' }, frame)
    ).toBe(false);
    expect(
      isReadyFromFrame({ data: ready, source: win, origin: 'https://evil.example' }, frame)
    ).toBe(false);
    expect(
      isReadyFromFrame(
        { data: { type: 'x' }, source: win, origin: 'https://dash.example.com' },
        frame
      )
    ).toBe(false);
  });
});

describe('the picks sent up to the GM page', () => {
  const origin = 'https://dash.example.com';

  it('targets the frame parent and the opener, never itself, none in a plain tab', () => {
    const parent = { postMessage: vi.fn() };
    const opener = { postMessage: vi.fn() };
    const self = {};
    expect(pickTargets({ parent, opener, self })).toEqual([parent, opener]);
    expect(pickTargets({ parent: self, opener: null, self })).toEqual([]);
    expect(pickTargets({ parent, opener: parent, self })).toEqual([parent]);
  });

  it('posts the ids to the dashboard origin only', () => {
    const a = { postMessage: vi.fn() };
    const b = { postMessage: vi.fn() };
    postPickToTargets([a, b], [origin], ['t1', 't2']);
    expect(a.postMessage).toHaveBeenCalledWith(
      { type: LIVE_PICK_MESSAGE, tokenIds: ['t1', 't2'] },
      origin
    );
    expect(b.postMessage).toHaveBeenCalledTimes(1);
  });

  it('says hello with no data to every target, to any origin, so the GM page can answer', () => {
    const a = { postMessage: vi.fn() };
    const b = {
      postMessage: vi.fn(() => {
        throw new Error('closed');
      }),
    };
    postHelloToTargets([b, a]);
    expect(a.postMessage).toHaveBeenCalledWith({ type: LIVE_HELLO_MESSAGE }, '*');
    expect(b.postMessage).toHaveBeenCalledTimes(1);
  });

  it('finds the GM page origin from the frame parent, not from the Live window address', () => {
    const own = 'http://foundry.local:30001';
    const page = 'https://dash.example.com';
    // The browser's own record of the parent wins; the setting is not asked.
    expect(
      dashboardOrigins(
        { location: { origin: own, ancestorOrigins: [page] }, document: { referrer: '' } },
        'http://localhost:3100'
      )
    ).toEqual([page]);
    // Without ancestorOrigins (Firefox): the referrer of the frame.
    expect(
      dashboardOrigins(
        { location: { origin: own }, document: { referrer: `${page}/gm` } },
        'http://localhost:3100'
      )
    ).toEqual([page]);
    // A referrer that is Foundry itself (it navigated the page) is not the GM page.
    expect(
      dashboardOrigins({ location: { origin: own }, document: { referrer: `${own}/join` } }, null)
    ).toEqual([]);
    // Only then the setting counts.
    expect(
      dashboardOrigins(
        { location: { origin: own }, document: { referrer: `${own}/join` } },
        'http://localhost:3100'
      )
    ).toEqual(['http://localhost:3100']);
    expect(
      dashboardOrigins({ location: { origin: own, ancestorOrigins: ['null'] } }, null)
    ).toEqual([]);
  });

  it('explains a blank frame with the address and the fixes', () => {
    const empty = liveWindowWhy('http://x:3100/?strip=1', false).join(' ');
    expect(empty).toContain('http://x:3100/?strip=1');
    expect(empty).toContain('DASHBOARD_FOUNDRY_URL');
    expect(empty).toContain('set "AI Tool: Live window address"');
    expect(liveWindowWhy('u', true).join(' ')).toContain('Check the address in the module setting');
  });

  it('answers a ready message from a target window and the dashboard origin only', () => {
    const parent = {};
    const ready = { type: LIVE_READY_MESSAGE };
    // The origin is read from the message itself: no setting is needed.
    expect(readyOriginFromTarget({ data: ready, source: parent, origin }, [parent])).toBe(origin);
    expect(readyOriginFromTarget({ data: ready, source: {}, origin }, [parent])).toBeNull();
    expect(readyOriginFromTarget({ data: ready, source: null, origin }, [parent])).toBeNull();
    expect(
      readyOriginFromTarget({ data: { type: 'x' }, source: parent, origin }, [parent])
    ).toBeNull();
    // Not a web origin, and not Foundry's own.
    expect(
      readyOriginFromTarget({ data: ready, source: parent, origin: 'null' }, [parent])
    ).toBeNull();
    expect(
      readyOriginFromTarget({ data: ready, source: parent, origin }, [parent], origin)
    ).toBeNull();
  });
});

describe('the live window switch', () => {
  it('registers world settings for the switch (off) and the address', () => {
    install(true, false);
    const register = vi.fn();
    g.game.settings.register = register;
    registerLiveWindowSettings();
    const byKey = Object.fromEntries(register.mock.calls.map(c => [c[1], c[2]]));
    expect(register.mock.calls.map(c => c[0])).toEqual([MODULE_ID, MODULE_ID]);
    expect(byKey[LIVE_WINDOW_SETTING]).toMatchObject({
      scope: 'world',
      config: true,
      default: false,
    });
    expect(byKey[LIVE_WINDOW_URL_SETTING]).toMatchObject({ scope: 'world', default: '' });
    expect(liveWindowEnabled()).toBe(false);
  });

  it('opens only for a GM with the switch on', () => {
    install(true, true);
    expect(canOpenLiveWindow()).toBe(true);
    restore();
    install(false, true);
    expect(canOpenLiveWindow()).toBe(false);
    restore();
    install(true, false);
    expect(canOpenLiveWindow()).toBe(false);
  });

  it('adds the Live button to the AI Tool group only while the switch is on', () => {
    install(true, false);
    const off: Record<string, any> = {};
    addAiToolControls(off);
    expect(Object.keys(off[AI_TOOL_CONTROL].tools)).not.toContain('live');
    restore();

    install(true, true);
    const on: Record<string, any> = {};
    addAiToolControls(on);
    expect(on[AI_TOOL_CONTROL].tools.live).toMatchObject({ title: 'Live', button: true });
  });
});

describe('the live window open state', () => {
  const STATE_KEY = `${MODULE_ID}.liveWindowState`;
  let store: Map<string, string>;
  let saved: { window: unknown; document: unknown };

  /** A stand-in for Foundry's ApplicationV2: render and close call the hooks the window defines. */
  class FakeApp {
    static DEFAULT_OPTIONS = {};
    rendered = false;
    element = { querySelector: (): null => null };
    position = { left: 5, top: 6, width: 400, height: 500 };
    async render(): Promise<void> {
      this.rendered = true;
      (this as any)._onRender();
    }
    async close(): Promise<void> {
      this.rendered = false;
      (this as any)._onClose();
    }
  }

  beforeEach(() => {
    store = new Map();
    saved = { window: g.window, document: g.document };
    g.window = {
      localStorage: {
        getItem: (k: string): string | null => store.get(k) ?? null,
        setItem: (k: string, v: string): void => void store.set(k, v),
      },
      location: { protocol: 'http:', hostname: 'localhost' },
      innerWidth: 1600,
      addEventListener: (): void => {},
      removeEventListener: (): void => {},
    };
    g.document = { getElementById: (): null => null };
  });

  afterEach(() => {
    g.window = saved.window;
    g.document = saved.document;
  });

  async function openWindow(): Promise<typeof import('./live-window.js')> {
    vi.resetModules();
    install(true, true);
    g.foundry.applications = { api: { ApplicationV2: FakeApp } };
    const mod = await import('./live-window.js');
    await mod.openLiveWindow();
    return mod;
  }

  const openFlag = (): boolean => JSON.parse(store.get(STATE_KEY) ?? '{}').open;

  it('remembers open while it is on screen', async () => {
    await openWindow();
    expect(openFlag()).toBe(true);
  });

  it('remembers closed when the GM closes it', async () => {
    const mod = await openWindow();
    await mod.toggleLiveWindow();
    expect(openFlag()).toBe(false);
  });

  it('keeps open as it was when the switch closes it, so a reload brings it back', async () => {
    const mod = await openWindow();
    mod.closeLiveWindow();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(openFlag()).toBe(true);
  });
});
