/**
 * Tests for the "AI changes" window (I-108): the controller (load, show more,
 * confirm and undo, conflicts) with fake deps, and the window class on a fake
 * `ApplicationV2` (escaped HTML in the content, singleton, live refresh).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import {
  AiChangesController,
  openAiChangesWindow,
  resetAiChangesWindowForTests,
  type AiChangesDeps,
} from './ai-changes-window.js';
import { announceAiChangesUpdated } from './ai-changes-signal.js';
import { setBridgeLink } from './bridge-link.js';

const g = globalThis as any;

function entry(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    changeId: id,
    feature: 'live-play',
    summary: `Change ${id}`,
    mode: 'apply',
    appliedAt: new Date(2026, 9, 6, 9, 5).toISOString(),
    risk: 'write',
    diff: ['a -> b'],
    canUndo: true,
    ...over,
  };
}

function makeDeps(over: Partial<AiChangesDeps> = {}): AiChangesDeps & {
  request: ReturnType<typeof vi.fn>;
  confirmUndo: ReturnType<typeof vi.fn>;
  notifyInfo: ReturnType<typeof vi.fn>;
  notifyError: ReturnType<typeof vi.fn>;
} {
  return {
    request: vi.fn().mockResolvedValue({ changes: [entry('c1'), entry('c2')] }),
    confirmUndo: vi.fn().mockResolvedValue(true),
    notifyInfo: vi.fn(),
    notifyError: vi.fn(),
    ...over,
  } as any;
}

describe('AiChangesController', () => {
  it('loads the newest 20 and shows them', async () => {
    const deps = makeDeps();
    const changed = vi.fn();
    const c = new AiChangesController(deps, changed);

    await c.load();

    expect(deps.request).toHaveBeenCalledWith('list-recent-changes', { limit: 20 });
    expect(c.view.status).toBe('ready');
    expect(c.view.rows.map(r => r.id)).toEqual(['c1', 'c2']);
    expect(changed).toHaveBeenCalledTimes(2); // loading, then ready
  });

  it('shows one line when the request fails, and recovers on the next load', async () => {
    const deps = makeDeps({
      request: vi.fn().mockRejectedValueOnce(new Error('The AI Tool bridge is not connected.')),
    });
    deps.request.mockResolvedValue({ changes: [entry('c1')] });
    const c = new AiChangesController(deps, () => {});

    await c.load();
    expect(c.view).toMatchObject({
      status: 'error',
      error: 'The AI Tool bridge is not connected.',
    });

    await c.load();
    expect(c.view.status).toBe('ready');
    expect(c.view.rows).toHaveLength(1);
  });

  it('"Show more" asks for 100', async () => {
    const deps = makeDeps();
    const c = new AiChangesController(deps, () => {});
    await c.showMore();
    expect(deps.request).toHaveBeenCalledWith('list-recent-changes', { limit: 100 });
    expect(c.view.limit).toBe(100);
  });

  it('a newer load wins over an older one that answers later', async () => {
    let finishFirst: (v: unknown) => void = () => {};
    const deps = makeDeps({
      request: vi
        .fn()
        .mockImplementationOnce(() => new Promise(resolve => (finishFirst = resolve)))
        .mockResolvedValueOnce({ changes: [entry('new')] }),
    });
    const c = new AiChangesController(deps, () => {});
    const first = c.load();
    await c.load();
    finishFirst({ changes: [entry('old')] });
    await first;
    expect(c.view.rows.map(r => r.id)).toEqual(['new']);
  });

  it('keeps the open diffs across a reload', async () => {
    const c = new AiChangesController(makeDeps(), () => {});
    await c.load();
    c.setOpen('c1', true);
    await c.load();
    expect(c.view.openIds.has('c1')).toBe(true);
    c.setOpen('c1', false);
    expect(c.view.openIds.has('c1')).toBe(false);
  });

  it('undo: confirms, calls undo-change with confirm true, notifies and reloads', async () => {
    const deps = makeDeps();
    const c = new AiChangesController(deps, () => {});
    await c.load();
    deps.request.mockClear();

    await c.undo('c1');

    expect(deps.confirmUndo).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
    expect(deps.request).toHaveBeenNthCalledWith(1, 'undo-change', {
      changeId: 'c1',
      confirm: true,
    });
    expect(deps.request).toHaveBeenNthCalledWith(2, 'list-recent-changes', { limit: 20 });
    expect(deps.notifyInfo).toHaveBeenCalledWith('Undone: Change c1');
    expect(deps.notifyError).not.toHaveBeenCalled();
    expect(c.view.busyId).toBeNull();
  });

  it('undo: does nothing when the GM cancels the confirm', async () => {
    const deps = makeDeps({ confirmUndo: vi.fn().mockResolvedValue(false) });
    const c = new AiChangesController(deps, () => {});
    await c.load();
    deps.request.mockClear();
    await c.undo('c1');
    expect(deps.request).not.toHaveBeenCalled();
    expect(deps.notifyInfo).not.toHaveBeenCalled();
  });

  it("undo: shows the backend's conflict message as it is, then reloads", async () => {
    const deps = makeDeps();
    const c = new AiChangesController(deps, () => {});
    await c.load();
    deps.request.mockImplementationOnce(() =>
      Promise.reject(new Error('Ireena was edited since the change; nothing was undone'))
    );

    await c.undo('c1');

    expect(deps.notifyError).toHaveBeenCalledWith(
      'Ireena was edited since the change; nothing was undone'
    );
    expect(deps.notifyInfo).not.toHaveBeenCalled();
    expect(deps.request).toHaveBeenLastCalledWith('list-recent-changes', { limit: 20 });
    expect(c.view.busyId).toBeNull();
  });

  it('undo: ignores an unknown id, a row that cannot be undone and a second click while busy', async () => {
    const deps = makeDeps({
      request: vi
        .fn()
        .mockResolvedValue({ changes: [entry('c1'), entry('c2', { canUndo: false })] }),
    });
    const c = new AiChangesController(deps, () => {});
    await c.load();
    deps.request.mockClear();

    await c.undo('nope');
    await c.undo('c2');
    expect(deps.confirmUndo).not.toHaveBeenCalled();

    let release: () => void = () => {};
    deps.request.mockImplementationOnce(() => new Promise<void>(resolve => (release = resolve)));
    const running = c.undo('c1');
    await Promise.resolve();
    await Promise.resolve();
    await c.undo('c1');
    expect(deps.confirmUndo).toHaveBeenCalledTimes(1);
    release();
    await running;
  });
});

describe('the window class on a fake ApplicationV2', () => {
  let world: TestWorld;
  let restore: () => void;
  let rendered: any[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    world = createTestWorld({ foundryVersion: '14.368' });
    restore = world.install();
    rendered = [];
    class FakeApplicationV2 {
      static DEFAULT_OPTIONS: Record<string, unknown> = {};
      content = { innerHTML: '', scrollTop: 0, querySelectorAll: (): unknown[] => [] };
      state = 'closed';
      constructor(public options: Record<string, unknown> = {}) {
        rendered.push(this);
      }
      async render(opts?: { force?: boolean }): Promise<void> {
        if (this.state === 'closed' && !opts?.force) return;
        this.state = 'open';
        const context = await (this as any)._prepareContext();
        const html = await (this as any)._renderHTML(context);
        (this as any)._replaceHTML(html, this.content);
        (this as any)._onRender();
      }
      bringToFront = vi.fn();
    }
    g.foundry = { ...g.foundry, applications: { api: { ApplicationV2: FakeApplicationV2 } } };
    // A link this client holds, so aiToolRequest goes straight over it.
    setBridgeLink({
      isConnected: () => true,
      request: vi.fn((tool: string) =>
        Promise.resolve(
          tool === 'list-recent-changes'
            ? {
                changes: [
                  entry('c1', { summary: '<script>alert(1)</script>', diff: ['<b>x</b>'] }),
                ],
              }
            : {}
        )
      ),
    });
    resetAiChangesWindowForTests();
  });

  afterEach(() => {
    for (const w of rendered) w._onClose(); // each test's window stops listening
    setBridgeLink(null);
    restore();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens one window, draws the fetched changes with every string escaped', async () => {
    await openAiChangesWindow();
    expect(rendered).toHaveLength(1);
    const html = rendered[0].content.innerHTML as string;
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('data-action="undo"');
  });

  it('opening again reuses the same window (a singleton per client)', async () => {
    await openAiChangesWindow();
    await openAiChangesWindow();
    expect(rendered).toHaveLength(1);
    expect(rendered[0].bringToFront).toHaveBeenCalledTimes(2);
  });

  it('re-fetches (debounced) when the change log signal arrives', async () => {
    await openAiChangesWindow();
    const link = (await import('./bridge-link.js')).getOpenBridgeLink() as any;
    link.request.mockClear();

    announceAiChangesUpdated();
    announceAiChangesUpdated();
    expect(link.request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(350);

    expect(link.request).toHaveBeenCalledTimes(1);
    expect(link.request).toHaveBeenCalledWith(
      'list-recent-changes',
      { limit: 20 },
      expect.any(Object),
      30_000
    );
  });

  it('starts at the first page again after "Show more" and a close (one window object per client)', async () => {
    await openAiChangesWindow();
    const link = (await import('./bridge-link.js')).getOpenBridgeLink() as any;
    await rendered[0].controller.showMore();
    expect(rendered[0].controller.view.limit).toBe(100);

    rendered[0]._onClose();
    link.request.mockClear();
    await openAiChangesWindow();

    expect(rendered).toHaveLength(1);
    expect(rendered[0].controller.view.limit).toBe(20);
    expect(link.request).toHaveBeenCalledWith(
      'list-recent-changes',
      { limit: 20 },
      expect.any(Object),
      30_000
    );
  });

  it('stops listening when closed', async () => {
    await openAiChangesWindow();
    const link = (await import('./bridge-link.js')).getOpenBridgeLink() as any;
    rendered[0]._onClose();
    link.request.mockClear();
    announceAiChangesUpdated();
    await vi.advanceTimersByTimeAsync(500);
    expect(link.request).not.toHaveBeenCalled();
  });
});
