import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clientHeaderValue,
  compareVersions,
  installRestartNotice,
  installUpdateNotice,
  localInstallId,
  restartNotice,
  updateNotice,
} from './client-update.js';
import { DashboardClient, type HttpRequest } from './dashboard.js';

describe('client header', () => {
  it('is obsidian/<version>', () => {
    expect(clientHeaderValue('0.28.0')).toBe('obsidian/0.28.0');
  });

  it('goes on every request when the plugin version is known, and not otherwise', async () => {
    const calls: HttpRequest[] = [];
    const http = (req: HttpRequest): Promise<{ status: number; json: unknown }> => {
      calls.push(req);
      return Promise.resolve({ status: 200, json: { theme: 'default' } });
    };
    const withVersion = new DashboardClient(
      http,
      () => 'http://localhost:3000',
      () => null,
      () => null,
      () => '0.28.0'
    );
    await withVersion.theme().catch(() => undefined);
    await withVersion.clientVersions();
    expect(calls.map(c => c.headers['x-foundry-client'])).toEqual([
      'obsidian/0.28.0',
      'obsidian/0.28.0',
    ]);

    calls.length = 0;
    const bare = new DashboardClient(
      http,
      () => 'http://localhost:3000',
      () => null
    );
    await bare.clientVersions();
    expect(calls[0]?.headers['x-foundry-client']).toBeUndefined();
  });
});

describe('install id', () => {
  it('makes 12 random hex once and keeps it', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string): string | null => data.get(k) ?? null,
      setItem: (k: string, v: string): void => void data.set(k, v),
    };
    const first = localInstallId(storage);
    expect(first).toMatch(/^[0-9a-f]{12}$/);
    expect(localInstallId(storage)).toBe(first);
  });

  it('is null when storage is missing or throws', () => {
    expect(localInstallId(undefined)).toBeNull();
    const broken = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: (): void => undefined,
    };
    expect(localInstallId(broken)).toBeNull();
  });
});

describe('outdated decision', () => {
  it('compares numerically per segment', () => {
    expect(compareVersions('0.9.0', '0.28.0')).toBe(-1);
    expect(compareVersions('0.28.0', '0.28.0')).toBe(0);
    expect(compareVersions('1.0.0', '0.28.9')).toBe(1);
  });

  it('gives a notice only when older, with Danish then English hover text', () => {
    const link = 'https://example.org/foundry-ai-tool-obsidian.zip';
    const n = updateNotice('0.27.0', '0.28.0', link);
    expect(n?.text).toBe('Foundry AI Tool: opdatering 0.28.0');
    expect(n?.link).toBe(link);
    const [da, en] = (n?.title ?? '').split('\n');
    expect(da).toContain('Opdatering klar');
    expect(en).toContain('Update available');
    expect(updateNotice('0.28.0', '0.28.0', link)).toBeNull();
    expect(updateNotice('0.29.0', '0.28.0', link)).toBeNull();
  });

  it('stays silent on unusable answers and drops a non-http link', () => {
    expect(updateNotice('0.27.0', undefined, null)).toBeNull();
    expect(updateNotice('0.27.0', 'soon', null)).toBeNull();
    expect(updateNotice('0.27.0', '0.28.0', 'javascript:alert(1)')?.link).toBeNull();
  });

  it('clientVersions is null on a 404 or a failure', async () => {
    const notFound = new DashboardClient(
      () => Promise.resolve({ status: 404, json: null }),
      () => 'http://localhost:3000',
      () => null
    );
    expect(await notFound.clientVersions()).toBeNull();
    const down = new DashboardClient(
      () => Promise.reject(new Error('down')),
      () => 'http://localhost:3000',
      () => null
    );
    expect(await down.clientVersions()).toBeNull();
  });
});

type Answer = { current: unknown; obsidianLink: unknown } | null;

function setupNotice(initial: Answer): {
  state: { shown: boolean; text: string; title: string };
  calls: { open: string[]; intervals: number };
  check: () => Promise<void>;
  setAnswer: (a: Answer) => void;
  click: () => void;
} {
  const calls = { open: [] as string[], intervals: 0 };
  vi.stubGlobal('window', {
    open: (url: string) => calls.open.push(url),
    setInterval: () => {
      calls.intervals += 1;
      return 1;
    },
  });
  const state = { shown: false, text: '', title: '' };
  let click: (() => void) | undefined;
  let layoutReady: (() => void) | undefined;
  const el = Object.assign(new EventTarget(), {
    addClass: () => undefined,
    hide: () => {
      state.shown = false;
    },
    show: () => {
      state.shown = true;
    },
    setText: (t: string) => {
      state.text = t;
    },
    setAttribute: (name: string, value: string) => {
      if (name === 'title') state.title = value;
    },
  });
  const host = {
    manifest: { version: '0.27.0' },
    addStatusBarItem: (): typeof el => el,
    registerInterval: (id: number): number => id,
    registerDomEvent: (_el: EventTarget, _type: 'click', cb: () => void): void => {
      click = cb;
    },
    app: {
      workspace: {
        onLayoutReady: (cb: () => void): void => {
          layoutReady = cb;
        },
      },
    },
  };
  let answer = initial;
  installUpdateNotice(host, { clientVersions: () => Promise.resolve(answer) });
  return {
    state,
    calls,
    check: async (): Promise<void> => {
      layoutReady?.();
      await new Promise(resolve => setTimeout(resolve, 0));
    },
    setAnswer: (a: Answer): void => {
      answer = a;
    },
    click: (): void => click?.(),
  };
}

describe('installUpdateNotice', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is hidden at first, shows when behind, and a click opens the link', async () => {
    const link = 'https://example.org/foundry-ai-tool-obsidian.zip';
    const t = setupNotice({ current: '0.28.0', obsidianLink: link });
    expect(t.state.shown).toBe(false);
    expect(t.calls.intervals).toBe(1);
    await t.check();
    expect(t.state.shown).toBe(true);
    expect(t.state.text).toBe('Foundry AI Tool: opdatering 0.28.0');
    expect(t.state.title).toContain('Update available');
    t.click();
    expect(t.calls.open).toEqual([link]);
  });

  it('hides again when current or the answer is gone, and a click then does nothing', async () => {
    const t = setupNotice({ current: '0.28.0', obsidianLink: 'https://example.org/x.zip' });
    await t.check();
    expect(t.state.shown).toBe(true);
    t.setAnswer({ current: '0.27.0', obsidianLink: null });
    await t.check();
    expect(t.state.shown).toBe(false);
    t.click();
    expect(t.calls.open).toEqual([]);
    t.setAnswer(null);
    await t.check();
    expect(t.state.shown).toBe(false);
  });
});

describe('restartNotice', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks for a restart only when the plugin on disk is newer', () => {
    expect(restartNotice('0.30.0', '0.31.0')?.text).toBe('Restart Obsidian');
    expect(restartNotice('0.31.0', '0.31.0')).toBeNull();
    expect(restartNotice('0.31.0', '0.30.0')).toBeNull();
    expect(restartNotice('0.31.0', undefined)).toBeNull();
    expect(restartNotice('0.31.0', 'junk')).toBeNull();
  });

  it('shows and hides the status bar item from the manifest on disk', async () => {
    vi.stubGlobal('window', { setInterval: (): number => 1 });
    let onDisk = '0.31.0';
    let shown = false;
    let text = '';
    let layoutReady: (() => void) | undefined;
    const reads: string[] = [];
    installRestartNotice({
      manifest: { version: '0.30.0', dir: '.obsidian/plugins/foundry-ai-tool' },
      addStatusBarItem: () => ({
        addClass: (): void => undefined,
        hide: (): void => {
          shown = false;
        },
        show: (): void => {
          shown = true;
        },
        setText: (t: string): void => {
          text = t;
        },
        setAttribute: (): void => undefined,
      }),
      registerInterval: (id: number): number => id,
      app: {
        vault: {
          adapter: {
            read: (p: string): Promise<string> => {
              reads.push(p);
              return Promise.resolve(JSON.stringify({ version: onDisk }));
            },
          },
        },
        workspace: {
          onLayoutReady: (cb: () => void): void => {
            layoutReady = cb;
          },
        },
      },
    });
    layoutReady?.();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(reads).toEqual(['.obsidian/plugins/foundry-ai-tool/manifest.json']);
    expect(shown).toBe(true);
    expect(text).toBe('Restart Obsidian');
    onDisk = '0.30.0';
    layoutReady?.();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(shown).toBe(false);
  });
});
