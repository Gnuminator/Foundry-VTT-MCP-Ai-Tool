import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RUN_MODE_CLASS,
  RUN_MODE_PILL_ID,
  applyRunMode,
  runModeEnabled,
  setRunMode,
  toggleRunMode,
} from './run-mode.js';

/** A tiny stand-in for the page: a body with a class list and the pill element. */
interface FakeEl {
  id: string;
  className: string;
  type: string;
  textContent: string;
  title: string;
  listeners: Array<() => void>;
  addEventListener(name: string, fn: () => void): void;
  remove(): void;
}

let stored = false;
let classes: Set<string>;
let pill: FakeEl | null;

beforeEach(() => {
  stored = false;
  classes = new Set();
  pill = null;
  const body = {
    classList: {
      toggle: (name: string, on: boolean): void => {
        if (on) classes.add(name);
        else classes.delete(name);
      },
      contains: (name: string): boolean => classes.has(name),
    },
    appendChild: (el: FakeEl): void => {
      pill = el;
    },
  };
  (globalThis as Record<string, unknown>).document = {
    body,
    getElementById: (id: string): FakeEl | null => (pill?.id === id ? pill : null),
    createElement: (): FakeEl => {
      const el: FakeEl = {
        id: '',
        className: '',
        type: '',
        textContent: '',
        title: '',
        listeners: [],
        addEventListener: (_n, fn): void => {
          el.listeners.push(fn);
        },
        remove: (): void => {
          pill = null;
        },
      };
      return el;
    },
  };
  (globalThis as Record<string, unknown>).game = {
    user: { isGM: true },
    settings: {
      get: vi.fn(() => stored),
      set: vi.fn(async (_ns: string, _key: string, value: boolean) => {
        stored = value;
      }),
    },
  };
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).game;
  delete (globalThis as Record<string, unknown>).document;
});

describe('Run mode', () => {
  it('is off by default: no class, no pill', () => {
    applyRunMode();
    expect(runModeEnabled()).toBe(false);
    expect(classes.has(RUN_MODE_CLASS)).toBe(false);
    expect(pill).toBeNull();
  });

  it('turns on with a body class and a show-all pill, and off again', async () => {
    await setRunMode(true);
    expect(classes.has(RUN_MODE_CLASS)).toBe(true);
    expect(pill?.id).toBe(RUN_MODE_PILL_ID);
    await setRunMode(false);
    expect(classes.has(RUN_MODE_CLASS)).toBe(false);
    expect(pill).toBeNull();
  });

  it('the pill brings everything back', async () => {
    await setRunMode(true);
    pill?.listeners.forEach(fn => fn());
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(classes.has(RUN_MODE_CLASS)).toBe(false);
    expect(stored).toBe(false);
  });

  it('toggle flips the mode', async () => {
    await toggleRunMode();
    expect(stored).toBe(true);
    await toggleRunMode();
    expect(stored).toBe(false);
  });

  it('does nothing for a player', () => {
    stored = true;
    (globalThis as Record<string, any>).game.user.isGM = false;
    applyRunMode();
    expect(classes.has(RUN_MODE_CLASS)).toBe(false);
  });
});
