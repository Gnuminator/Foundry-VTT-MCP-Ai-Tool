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
  LIVE_WINDOW_SETTING,
  LIVE_WINDOW_URL_SETTING,
  canOpenLiveWindow,
  liveFrameUrl,
  liveWindowEnabled,
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
