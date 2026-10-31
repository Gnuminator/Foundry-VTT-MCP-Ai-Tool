/**
 * Tests for the live window (live screen B): the frame address, the off-by-default switch and the
 * toolbar button that only exists while the switch is on. The window itself is checked live.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import { MODULE_ID } from './constants.js';
import { AI_TOOL_CONTROL, addAiToolControls } from './ai-tool-controls.js';
import {
  LIVE_PICK_MESSAGE,
  LIVE_READY_MESSAGE,
  LIVE_WINDOW_SETTING,
  LIVE_WINDOW_URL_SETTING,
  canOpenLiveWindow,
  isReadyFromFrame,
  isReadyFromTarget,
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
    postPickToTargets([a, b], origin, ['t1', 't2']);
    expect(a.postMessage).toHaveBeenCalledWith(
      { type: LIVE_PICK_MESSAGE, tokenIds: ['t1', 't2'] },
      origin
    );
    expect(b.postMessage).toHaveBeenCalledTimes(1);
  });

  it('answers a ready message from a target window and the dashboard origin only', () => {
    const parent = {};
    const ready = { type: LIVE_READY_MESSAGE };
    expect(isReadyFromTarget({ data: ready, source: parent, origin }, [parent], origin)).toBe(true);
    expect(isReadyFromTarget({ data: ready, source: {}, origin }, [parent], origin)).toBe(false);
    expect(isReadyFromTarget({ data: ready, source: null, origin }, [parent], origin)).toBe(false);
    expect(
      isReadyFromTarget(
        { data: ready, source: parent, origin: 'https://evil.example' },
        [parent],
        origin
      )
    ).toBe(false);
    expect(
      isReadyFromTarget({ data: { type: 'x' }, source: parent, origin }, [parent], origin)
    ).toBe(false);
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
