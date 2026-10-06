import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VaultStore } from '../vault/store.js';

import { ObsidianAutoRender, obsidianAutoRenderSettings } from './auto-render.js';
import type { ExportResult, exportWorldToObsidian } from './export.js';

type ExportFn = typeof exportWorldToObsidian;
type ExportArgs = Parameters<ExportFn>[0];

function result(worldId: string, extra: Partial<ExportResult> = {}): ExportResult {
  return {
    worldId,
    root: `/vault/Campaigns/${worldId}`,
    written: [],
    unchanged: [],
    created: [],
    skipped: [],
    kept: [],
    trashed: [],
    errors: [],
    ...extra,
  };
}

interface Harness {
  render: ObsidianAutoRender;
  exportWorld: ReturnType<typeof vi.fn>;
  calls: ExportArgs[];
  logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
}

function setup(
  impl?: (args: ExportArgs) => Promise<ExportResult>,
  opts: { debounceMs?: number; maxWaitMs?: number } = {}
): Harness {
  const calls: ExportArgs[] = [];
  const exportWorld = vi.fn(async (args: ExportArgs) => {
    calls.push(args);
    return impl ? impl(args) : result(args.worldId);
  });
  const logger = { info: vi.fn(), warn: vi.fn() };
  const render = new ObsidianAutoRender({
    store: {} as VaultStore,
    audit: { list: () => Promise.resolve([]) },
    vaultDir: '/vault',
    logger,
    debounceMs: opts.debounceMs ?? 1000,
    maxWaitMs: opts.maxWaitMs ?? 5000,
    now: (): number => Date.now(),
    exportWorld: exportWorld as unknown as ExportFn,
  });
  return { render, exportWorld, calls, logger };
}

describe('obsidianAutoRenderSettings', () => {
  it('is off without FOUNDRY_AI_OBSIDIAN_DIR', () => {
    expect(obsidianAutoRenderSettings({}).vaultDir).toBeNull();
    expect(obsidianAutoRenderSettings({ FOUNDRY_AI_OBSIDIAN_DIR: '  ' }).vaultDir).toBeNull();
  });

  it('resolves the vault dir when set', () => {
    const dir = obsidianAutoRenderSettings({ FOUNDRY_AI_OBSIDIAN_DIR: ' ./my-vault ' }).vaultDir;
    expect(dir).toMatch(/my-vault$/);
  });
});

describe('ObsidianAutoRender', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces a burst of changes into one render', async () => {
    const { render, exportWorld, calls } = setup();
    render.schedule('w1');
    await vi.advanceTimersByTimeAsync(500);
    render.schedule('w1');
    await vi.advanceTimersByTimeAsync(500);
    render.schedule('w1');
    expect(exportWorld).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(exportWorld).toHaveBeenCalledTimes(1);
    expect(calls[0]).toMatchObject({ worldId: 'w1', vaultDir: '/vault' });
    expect(calls[0].cache).toBeDefined();
  });

  it('renders at the maximum wait during steady changes', async () => {
    const { render, exportWorld } = setup(undefined, { debounceMs: 1000, maxWaitMs: 3000 });
    for (let i = 0; i < 6; i++) {
      render.schedule('w1');
      await vi.advanceTimersByTimeAsync(600);
    }
    // 3.6 s of changes every 0.6 s: the quiet period never came, the max wait did.
    expect(exportWorld).toHaveBeenCalledTimes(1);
  });

  it('keeps one cache per world across renders', async () => {
    const { render, calls } = setup();
    render.schedule('w1');
    render.schedule('w2');
    await vi.advanceTimersByTimeAsync(1000);
    render.schedule('w1');
    await vi.advanceTimersByTimeAsync(1000);
    const w1 = calls.filter(c => c.worldId === 'w1');
    const w2 = calls.find(c => c.worldId === 'w2');
    expect(w1).toHaveLength(2);
    expect(w1[0].cache).toBe(w1[1].cache);
    expect(w2?.cache).not.toBe(w1[0].cache);
  });

  it('renders once more when a change arrives during a render', async () => {
    let release: () => void = () => {};
    let first = true;
    const { render, exportWorld } = setup(async args => {
      if (first) {
        first = false;
        await new Promise<void>(r => {
          release = r;
        });
      }
      return result(args.worldId);
    });
    render.schedule('w1');
    await vi.advanceTimersByTimeAsync(1000);
    expect(exportWorld).toHaveBeenCalledTimes(1);
    render.schedule('w1');
    await vi.advanceTimersByTimeAsync(1000);
    // Still busy with the first render: no second export yet.
    expect(exportWorld).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(exportWorld).toHaveBeenCalledTimes(2);
  });

  it('logs a failed render and keeps going', async () => {
    let fail = true;
    const { render, exportWorld, logger } = setup(args => {
      if (fail) {
        fail = false;
        return Promise.reject(new Error('disk full'));
      }
      return Promise.resolve(result(args.worldId));
    });
    render.schedule('w1');
    await vi.advanceTimersByTimeAsync(1000);
    expect(logger.warn).toHaveBeenCalledWith(
      'Obsidian render failed',
      expect.objectContaining({ worldId: 'w1', error: 'disk full' })
    );
    render.schedule('w1');
    await vi.advanceTimersByTimeAsync(1000);
    expect(exportWorld).toHaveBeenCalledTimes(2);
  });

  it('logs written notes, and a lasting skipped note only once', async () => {
    const { render, logger } = setup(args =>
      Promise.resolve(
        result(args.worldId, {
          written: ['AI Tool/Sessions/2026-10-03 S01.md'],
          skipped: [{ path: 'AI Tool/Changes/2026-10.md', reason: 'edited in Obsidian' }],
        })
      )
    );
    render.schedule('w1');
    await vi.advanceTimersByTimeAsync(1000);
    render.schedule('w1');
    await vi.advanceTimersByTimeAsync(1000);
    expect(logger.info).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][1]).toMatchObject({
      skipped: ['AI Tool/Changes/2026-10.md: edited in Obsidian'],
    });
  });

  it('flush renders pending worlds now; stop cancels them', async () => {
    const { render, exportWorld } = setup();
    render.schedule('w1');
    await render.flush();
    expect(exportWorld).toHaveBeenCalledTimes(1);
    render.schedule('w1');
    render.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    render.schedule('w1');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(exportWorld).toHaveBeenCalledTimes(1);
  });
});
