import { afterEach, describe, expect, it, vi } from 'vitest';

// auth.ts reads the token from the page's address and storage when it loads, so each case stubs
// those first and loads a fresh copy.

/** A localStorage over a Map; `refuse` makes every write throw, as a private window may. */
function storage(initial: Record<string, string> = {}, refuse = false): Map<string, string> {
  const items = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (key: string): string | null => items.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      if (refuse) throw new Error('QuotaExceededError');
      items.set(key, value);
    },
    removeItem: (key: string): void => {
      items.delete(key);
    },
  });
  return items;
}

async function load(href: string): Promise<typeof import('./auth')> {
  vi.stubGlobal('location', { href });
  vi.stubGlobal('history', { state: null, replaceState: vi.fn() });
  vi.resetModules();
  return import('./auth');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('playerPageUrl', () => {
  it('copies the token to the player page key and keeps it here', async () => {
    const items = storage();
    const auth = await load('http://127.0.0.1/?token=t1');
    expect(auth.playerPageUrl()).toBe('/player');
    expect(items.get('cogm_player_token')).toBe('t1');
    expect(items.get('cogm_token')).toBe('t1');
  });

  it('takes the token along in the address when storage is refused', async () => {
    storage({}, true);
    const auth = await load('http://127.0.0.1/next/?token=a%20b');
    expect(auth.playerPageUrl()).toBe('/player?token=a%20b');
  });

  it('is the bare player page without a token', async () => {
    const items = storage();
    const auth = await load('http://127.0.0.1/');
    expect(auth.playerPageUrl()).toBe('/player');
    expect(items.size).toBe(0);
  });
});

describe('onlyPlayerToken', () => {
  it('is true only without a token here and with one on the player page key', async () => {
    storage({ cogm_player_token: 'p1' });
    expect((await load('http://127.0.0.1/')).onlyPlayerToken()).toBe(true);
    storage({ cogm_player_token: 'p1', cogm_token: 'g1' });
    expect((await load('http://127.0.0.1/')).onlyPlayerToken()).toBe(false);
    storage();
    expect((await load('http://127.0.0.1/')).onlyPlayerToken()).toBe(false);
  });
});
