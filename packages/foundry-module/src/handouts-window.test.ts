/* eslint-disable @typescript-eslint/require-await -- fakes that mimic async calls */
/**
 * Tests for the "Handouts" window (I-108 part 2): the controller (load, Remove,
 * Reveal next with the plan, the confirm and the apply) with fake deps, and the
 * window class on a fake `ApplicationV2` (escaped HTML, singleton, live refresh,
 * the "Show it now" box read per click, real deps for the names and the confirm).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import {
  HandoutsController,
  openHandoutsWindow,
  resetHandoutsWindowForTests,
  type HandoutsDeps,
} from './handouts-window.js';
import { announceAiChangesUpdated } from './ai-changes-signal.js';
import { setBridgeLink } from './bridge-link.js';

const g = globalThis as any;

function queued(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    entryId: `e-${id}`,
    uuid: `JournalEntry.AAAAAAAAAAAAAAAA.JournalEntryPage.${id}`,
    title: `Page ${id}`,
    exists: true,
    sceneId: null,
    addedAt: '2026-10-06T08:00:00.000Z',
    ...over,
  };
}

const plan = {
  planId: 'plan-1',
  summary: 'Reveal page "Page a" to all players',
  risk: 'destructive',
  diff: [{ text: 'allowlist the page' }],
};

function makeDeps(over: Partial<HandoutsDeps> = {}): HandoutsDeps & {
  request: ReturnType<typeof vi.fn>;
  confirmReveal: ReturnType<typeof vi.fn>;
  notifyInfo: ReturnType<typeof vi.fn>;
  notifyError: ReturnType<typeof vi.fn>;
} {
  return {
    request: vi.fn(async (tool: string) => {
      if (tool === 'list-revealed-pages') return { queue: [queued('a'), queued('b')], pages: [] };
      if (tool === 'plan-page-reveal') return plan;
      return { changeId: 'chg-1' };
    }),
    context: () => ({
      activeSceneId: 's1',
      sceneName: () => null,
      playerName: () => null,
      playerIds: [],
    }),
    confirmReveal: vi.fn().mockResolvedValue(true),
    notifyInfo: vi.fn(),
    notifyError: vi.fn(),
    ...over,
  } as any;
}

describe('HandoutsController', () => {
  it('loads the queue and the revealed pages and finds the next page', async () => {
    const deps = makeDeps();
    const changed = vi.fn();
    const c = new HandoutsController(deps, changed);

    await c.load();

    expect(deps.request).toHaveBeenCalledWith('list-revealed-pages', {});
    expect(c.view.status).toBe('ready');
    expect(c.view.queue.map(q => q.title)).toEqual(['Page a', 'Page b']);
    expect(c.view.nextTitle).toBe('Page a');
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('shows one line when loading fails and recovers on the next load', async () => {
    const deps = makeDeps();
    deps.request.mockRejectedValueOnce(new Error('The AI Tool bridge is not connected.'));
    const c = new HandoutsController(deps, () => {});
    await c.load();
    expect(c.view).toMatchObject({
      status: 'error',
      error: 'The AI Tool bridge is not connected.',
    });
    await c.load();
    expect(c.view.status).toBe('ready');
  });

  it('a newer load wins over an older one that answers later', async () => {
    let finishFirst: (v: unknown) => void = () => {};
    const deps = makeDeps();
    deps.request
      .mockImplementationOnce(() => new Promise(resolve => (finishFirst = resolve)))
      .mockResolvedValueOnce({ queue: [queued('new')] });
    const c = new HandoutsController(deps, () => {});
    const first = c.load();
    await c.load();
    finishFirst({ queue: [queued('old')] });
    await first;
    expect(c.view.queue.map(q => q.title)).toEqual(['Page new']);
  });

  it('Remove: unqueues at once (no plan, no confirm), tells the GM and reloads', async () => {
    const deps = makeDeps();
    deps.request.mockImplementation(async (tool: string) =>
      tool === 'plan-page-reveal' ? { queued: false, note: 'Removed Page a' } : { queue: [] }
    );
    const c = new HandoutsController(deps, () => {});
    await c.remove('JournalEntry.X.JournalEntryPage.a');

    expect(deps.request).toHaveBeenNthCalledWith(1, 'plan-page-reveal', {
      action: 'unqueue',
      pageUuid: 'JournalEntry.X.JournalEntryPage.a',
    });
    expect(deps.request).toHaveBeenNthCalledWith(2, 'list-revealed-pages', {});
    expect(deps.confirmReveal).not.toHaveBeenCalled();
    expect(deps.notifyInfo).toHaveBeenCalledWith('Removed Page a');
    expect(c.view.busy).toBe(false);
  });

  it('Remove: shows a failure in the window and as a notification, then reloads', async () => {
    const deps = makeDeps();
    await new HandoutsController(deps, () => {}).load();
    deps.request.mockRejectedValueOnce(new Error('Handouts are switched off'));
    const c = new HandoutsController(deps, () => {});
    await c.remove('u');
    expect(c.view.actionError).toBe('Handouts are switched off');
    expect(deps.notifyError).toHaveBeenCalledWith('Handouts are switched off');
    expect(deps.request).toHaveBeenLastCalledWith('list-revealed-pages', {});
  });

  it('Reveal next: plans for the active scene, confirms, applies with both confirmations, reloads', async () => {
    const deps = makeDeps();
    const c = new HandoutsController(deps, () => {});
    await c.load();
    deps.request.mockClear();

    await c.revealNext();

    expect(deps.request).toHaveBeenNthCalledWith(1, 'plan-page-reveal', {
      action: 'reveal-next',
      sceneId: 's1',
    });
    expect(deps.confirmReveal).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: 'plan-1',
        summary: plan.summary,
        diff: ['allowlist the page'],
      })
    );
    expect(deps.request).toHaveBeenNthCalledWith(2, 'apply-planned-change', {
      planId: 'plan-1',
      confirm: true,
      confirmDestructive: true,
    });
    expect(deps.request).toHaveBeenNthCalledWith(3, 'list-revealed-pages', {});
    expect(deps.notifyInfo).toHaveBeenCalledWith(`Revealed: ${plan.summary}`);
    expect(c.view.busy).toBe(false);
  });

  it('Reveal next: "Show it now" goes to the plan only when ticked; no scene id without an active scene', async () => {
    const deps = makeDeps({
      context: () => ({
        activeSceneId: null,
        sceneName: (): null => null,
        playerName: (): null => null,
        playerIds: [],
      }),
    });
    const c = new HandoutsController(deps, () => {});
    await c.load();
    deps.request.mockClear();
    c.setShowNow(true);
    await c.revealNext();
    expect(deps.request).toHaveBeenNthCalledWith(1, 'plan-page-reveal', {
      action: 'reveal-next',
      showNow: true,
    });
    const applyArgs = deps.request.mock.calls.find(call => call[0] === 'apply-planned-change')?.[1];
    expect(applyArgs).not.toHaveProperty('showNow');
  });

  it('Reveal next: a cancel applies nothing and says nothing', async () => {
    const deps = makeDeps({ confirmReveal: vi.fn().mockResolvedValue(false) });
    const c = new HandoutsController(deps, () => {});
    await c.load();
    deps.request.mockClear();
    await c.revealNext();
    expect(deps.request.mock.calls.map(call => call[0])).toEqual([
      'plan-page-reveal',
      'list-revealed-pages',
    ]);
    expect(deps.notifyInfo).not.toHaveBeenCalled();
    expect(deps.notifyError).not.toHaveBeenCalled();
  });

  it('Reveal next: a planning or apply failure is shown, never thrown', async () => {
    const deps = makeDeps();
    const c = new HandoutsController(deps, () => {});
    await c.load();
    deps.request.mockRejectedValueOnce(new Error('No page is queued for this scene'));
    await expect(c.revealNext()).resolves.toBeUndefined();
    expect(c.view.actionError).toBe('No page is queued for this scene');

    deps.request.mockImplementationOnce(async () => plan);
    deps.request.mockRejectedValueOnce(new Error('The page was edited since the plan'));
    await c.revealNext();
    expect(deps.notifyError).toHaveBeenLastCalledWith('The page was edited since the plan');
    expect(c.view.busy).toBe(false);
  });

  it('Reveal next: a result without a plan is an error', async () => {
    const deps = makeDeps();
    const c = new HandoutsController(deps, () => {});
    await c.load();
    deps.request.mockResolvedValueOnce({ note: 'nothing' });
    await c.revealNext();
    expect(c.view.actionError).toMatch(/no plan/);
    expect(deps.confirmReveal).not.toHaveBeenCalled();
  });

  it('Reveal next: says so when the page was revealed but could not be shown on screens', async () => {
    const deps = makeDeps();
    const c = new HandoutsController(deps, () => {});
    await c.load();
    deps.request.mockResolvedValueOnce(plan);
    deps.request.mockResolvedValueOnce({ shown: { ok: false, error: 'nobody is online' } });
    c.setShowNow(true);
    await c.revealNext();
    expect(deps.notifyInfo).toHaveBeenCalled();
    expect(c.view.actionError).toMatch(/could not be shown.*nobody is online/);
  });

  it('Reveal next: does nothing with nothing queued, and ignores a second click while busy', async () => {
    const deps = makeDeps();
    deps.request.mockResolvedValue({ queue: [] });
    const c = new HandoutsController(deps, () => {});
    await c.load();
    deps.request.mockClear();
    await c.revealNext();
    expect(deps.request).not.toHaveBeenCalled();

    deps.request.mockImplementation(async (tool: string) =>
      tool === 'list-revealed-pages' ? { queue: [queued('a')] } : plan
    );
    await c.load();
    let release: (v: boolean) => void = () => {};
    deps.confirmReveal.mockImplementationOnce(
      () => new Promise<boolean>(resolve => (release = resolve))
    );
    const running = c.revealNext();
    await vi.waitFor(() => expect(deps.confirmReveal).toHaveBeenCalled());
    await c.revealNext();
    await c.remove('u');
    expect(deps.confirmReveal).toHaveBeenCalledTimes(1);
    release(false);
    await running;
  });
});

describe('the window class on a fake ApplicationV2', () => {
  let world: TestWorld;
  let restore: () => void;
  let rendered: any[];
  let link: { request: ReturnType<typeof vi.fn> };
  let confirm: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    world = createTestWorld({ foundryVersion: '14.368' });
    world.addUser({ id: 'u1', name: 'Danni', isGM: false });
    world.addUser({ id: 'u2', name: 'Chris', isGM: false });
    world.addScene({ id: 's1', name: 'Village', active: true });
    restore = world.install();
    rendered = [];
    class FakeApplicationV2 {
      static DEFAULT_OPTIONS: Record<string, unknown> = {};
      content = {
        innerHTML: '',
        scrollTop: 0,
        listeners: {} as Record<string, Array<(event: unknown) => void>>,
        addEventListener(type: string, listener: (event: unknown) => void): void {
          (this.listeners[type] ??= []).push(listener);
        },
      };
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
    confirm = vi.fn().mockResolvedValue(true);
    g.foundry = {
      ...g.foundry,
      applications: { api: { ApplicationV2: FakeApplicationV2, DialogV2: { confirm } } },
    };
    link = {
      request: vi.fn((tool: string) =>
        Promise.resolve(
          tool === 'list-revealed-pages'
            ? {
                queue: [
                  queued('a', {
                    title: '<script>alert(1)</script>',
                    sceneId: 's1',
                    players: ['u1'],
                  }),
                ],
                pages: [
                  {
                    uuid: 'JournalEntry.A.JournalEntryPage.p',
                    title: 'Letter',
                    exists: true,
                    observable: true,
                    feature: 'handouts',
                    seenBy: [{ userId: 'u1', at: new Date(2026, 9, 6, 21, 0).toISOString() }],
                  },
                ],
              }
            : tool === 'plan-page-reveal'
              ? { ...plan, summary: 'Reveal <b>x</b>' }
              : { changeId: 'c' }
        )
      ),
    };
    setBridgeLink({ isConnected: () => true, request: link.request });
    resetHandoutsWindowForTests();
  });

  afterEach(() => {
    for (const w of rendered) w._onClose();
    setBridgeLink(null);
    restore();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Click an action the way ApplicationV2 does: `this` is the window, the target holds the data. */
  function click(action: string, data: Record<string, string> = {}): Promise<void> {
    const handler = rendered[0].constructor.DEFAULT_OPTIONS.actions[action] as (
      this: unknown,
      event: Event,
      target: unknown
    ) => void;
    handler.call(rendered[0], {} as Event, { dataset: data });
    return vi.advanceTimersByTimeAsync(0);
  }

  /** The GM ticks or unticks "Show it now": the browser fires a change event that bubbles to the content. */
  function tickShowNow(checked: boolean): void {
    const event = { target: { dataset: { field: 'showNow' }, type: 'checkbox', checked } };
    for (const listener of rendered[0].content.listeners.change ?? []) listener(event);
  }

  it('opens one window and draws the lists with names from the world, every string escaped', async () => {
    await openHandoutsWindow();
    expect(rendered).toHaveLength(1);
    const html = rendered[0].content.innerHTML as string;
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Village'); // the scene's name, from game.scenes
    expect(html).toContain('for Danni'); // the player's name, from game.users
    expect(html).toContain('Reveal next: ');
    expect(html).toContain('fmb-ho-seen');
    expect(html).toContain('Chris');
    expect(html).not.toMatch(/checked/);
    expect(link.request).toHaveBeenCalledWith(
      'list-revealed-pages',
      {},
      expect.any(Object),
      30_000
    );
  });

  it('opening again reuses the same window (a singleton per client)', async () => {
    await openHandoutsWindow();
    await openHandoutsWindow();
    expect(rendered).toHaveLength(1);
    expect(rendered[0].bringToFront).toHaveBeenCalledTimes(2);
  });

  it('Reveal next: asks for the active scene, confirms in a dialog with the escaped plan, then applies', async () => {
    await openHandoutsWindow();
    link.request.mockClear();

    tickShowNow(true);
    await click('reveal');

    expect(link.request).toHaveBeenNthCalledWith(
      1,
      'plan-page-reveal',
      { action: 'reveal-next', sceneId: 's1', showNow: true },
      expect.any(Object),
      30_000
    );
    const dialog = confirm.mock.calls[0][0];
    expect(dialog.content).toContain('Reveal &lt;b&gt;x&lt;/b&gt;');
    expect(dialog.content).toContain('allowlist the page');
    expect(dialog.rejectClose).toBe(false);
    expect(link.request).toHaveBeenNthCalledWith(
      2,
      'apply-planned-change',
      { planId: 'plan-1', confirm: true, confirmDestructive: true },
      expect.any(Object),
      120_000 // an apply writes in Foundry first
    );
    expect(g.ui.notifications).toBeDefined();
  });

  it('Reveal next: a cancelled dialog applies nothing (the plan expires by itself)', async () => {
    confirm.mockResolvedValue(null);
    await openHandoutsWindow();
    link.request.mockClear();
    await click('reveal');
    expect(link.request.mock.calls.map(call => call[0])).not.toContain('apply-planned-change');
    expect(link.request.mock.calls[0]?.[1]).not.toHaveProperty('showNow');
  });

  it('Show it now survives a redraw while the window stays open', async () => {
    await openHandoutsWindow();
    expect(rendered[0].content.innerHTML).not.toMatch(/checked/);
    tickShowNow(true);
    await click('refresh');
    expect(rendered[0].content.innerHTML).toContain('data-field="showNow" checked');
    announceAiChangesUpdated();
    await vi.advanceTimersByTimeAsync(350);
    expect(rendered[0].content.innerHTML).toContain('data-field="showNow" checked');
    await openHandoutsWindow(); // the toolbar button again: the same window, the same tick
    expect(rendered[0].content.innerHTML).toContain('data-field="showNow" checked');
    tickShowNow(false);
    await click('refresh');
    expect(rendered[0].content.innerHTML).not.toMatch(/checked/);
  });

  it('Show it now goes back to unticked after a reveal, a cancelled reveal and a failed one', async () => {
    await openHandoutsWindow();
    tickShowNow(true);
    await click('reveal');
    expect(rendered[0].content.innerHTML).not.toMatch(/checked/);

    tickShowNow(true);
    confirm.mockResolvedValue(null);
    await click('reveal');
    expect(rendered[0].content.innerHTML).not.toMatch(/checked/);

    tickShowNow(true);
    link.request.mockRejectedValueOnce(new Error('boom'));
    await click('reveal');
    expect(rendered[0].content.innerHTML).not.toMatch(/checked/);
  });

  it('Show it now is unticked when the window is opened again after a close', async () => {
    await openHandoutsWindow();
    tickShowNow(true);
    rendered[0]._onClose();
    rendered[0].state = 'closed';
    await openHandoutsWindow();
    expect(rendered[0].content.innerHTML).not.toMatch(/checked/);
  });

  it('Remove: unqueues the page named on the button', async () => {
    await openHandoutsWindow();
    link.request.mockClear();
    await click('remove', { pageUuid: 'JournalEntry.A.JournalEntryPage.a' });
    expect(link.request).toHaveBeenCalledWith(
      'plan-page-reveal',
      { action: 'unqueue', pageUuid: 'JournalEntry.A.JournalEntryPage.a' },
      expect.any(Object),
      30_000
    );
  });

  it('Refresh and the change-log signal fetch again (the signal debounced)', async () => {
    await openHandoutsWindow();
    link.request.mockClear();
    await click('refresh');
    expect(link.request).toHaveBeenCalledTimes(1);

    link.request.mockClear();
    announceAiChangesUpdated();
    announceAiChangesUpdated();
    expect(link.request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(350);
    expect(link.request).toHaveBeenCalledTimes(1);
  });

  it('stops listening when closed', async () => {
    await openHandoutsWindow();
    rendered[0]._onClose();
    link.request.mockClear();
    announceAiChangesUpdated();
    await vi.advanceTimersByTimeAsync(500);
    expect(link.request).not.toHaveBeenCalled();
  });
});
