/**
 * Tests for the "Changes" window (I-108, I-109 part 4): the controller (load, filter, fallback
 * to an older bridge, the undo, choice, rewind and redo flows) with fake deps, and the window
 * class on a fake `ApplicationV2` (escaped HTML in the content, singleton, live refresh).
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
import { BRIDGE_TOO_OLD_MESSAGE } from './constants.js';
import type { DialogSpec } from './ai-changes-dialogs.js';

const g = globalThis as any;

const at = new Date(2026, 9, 6, 9, 5).toISOString();

/** A `list-changes` item. */
function item(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'ai',
    id,
    at,
    by: 'AI',
    summary: `Change ${id}`,
    lines: ['a -> b'],
    mode: 'apply',
    feature: 'live-play',
    canUndo: true,
    undone: false,
    ...over,
  };
}

/** A `list-recent-changes` entry (older bridge). */
function legacyEntry(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    changeId: id,
    feature: 'live-play',
    summary: `Change ${id}`,
    mode: 'apply',
    appliedAt: at,
    risk: 'write',
    diff: ['a -> b'],
    canUndo: true,
    ...over,
  };
}

/** A `plan-undo-changes` answer. */
function planView(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    planId: 'plan-1',
    summary: 'Undo: Change c1',
    scope: 'just-this',
    count: 1,
    diff: [{ kind: 'update', text: 'Actor "Ireena": HP 5 -> 10' }],
    later: [],
    requires: { confirm: true, confirmDestructive: false },
    ...over,
  };
}

type Deps = AiChangesDeps & {
  request: ReturnType<typeof vi.fn>;
  ask: ReturnType<typeof vi.fn>;
  notifyInfo: ReturnType<typeof vi.fn>;
  notifyError: ReturnType<typeof vi.fn>;
};

/**
 * `answers` are the buttons the GM clicks, in order (a dialog with no answer left is cancelled).
 * `routes` answer a tool by name.
 */
function makeDeps(
  answers: string[] = [],
  routes: Record<string, (args: Record<string, unknown>) => unknown> = {}
): Deps {
  const queue = [...answers];
  const defaults: Record<string, (args: Record<string, unknown>) => unknown> = {
    'list-changes': () => ({ changes: [item('c1'), item('c2')] }),
    'plan-undo-changes': () => planView(),
    'apply-planned-change': () => ({ changeId: 'new' }),
    'undo-change': () => ({ mode: 'undo' }),
  };
  const all = { ...defaults, ...routes };
  return {
    request: vi.fn((tool: string, args: Record<string, unknown>) => {
      const route = all[tool];
      if (!route) return Promise.reject(new Error(`unexpected ${tool}`));
      try {
        return Promise.resolve(route(args));
      } catch (error) {
        return Promise.reject(error);
      }
    }),
    users: () => [
      { id: 'u1', name: 'Danni' },
      { id: 'u2', name: 'Ireena' },
    ],
    ask: vi.fn((_spec: DialogSpec) => Promise.resolve(queue.shift() ?? 'cancel')),
    notifyInfo: vi.fn(),
    notifyError: vi.fn(),
  } as Deps;
}

function names(deps: Deps): string[] {
  return deps.request.mock.calls.map(c => c[0] as string);
}

describe('AiChangesController: loading', () => {
  it('loads the newest 20 with list-changes and shows them', async () => {
    const deps = makeDeps();
    const changed = vi.fn();
    const c = new AiChangesController(deps, changed);

    await c.load();

    expect(deps.request).toHaveBeenCalledWith('list-changes', { limit: 20 });
    expect(c.view).toMatchObject({ status: 'ready', legacy: false, filter: 'all' });
    expect(c.view.rows.map(r => r.id)).toEqual(['c1', 'c2']);
    expect(c.view.users.map(u => u.name)).toEqual(['Danni', 'Ireena']);
    expect(changed).toHaveBeenCalledTimes(2); // loading, then ready
  });

  it('shows one line when the request fails, and recovers on the next load', async () => {
    const deps = makeDeps();
    deps.request.mockRejectedValueOnce(new Error('The AI Tool bridge is not connected.'));
    const c = new AiChangesController(deps, () => {});

    await c.load();
    expect(c.view).toMatchObject({
      status: 'error',
      error: 'The AI Tool bridge is not connected.',
    });

    await c.load();
    expect(c.view.status).toBe('ready');
    expect(c.view.rows).toHaveLength(2);
  });

  it('"Show more" asks for 100', async () => {
    const deps = makeDeps();
    const c = new AiChangesController(deps, () => {});
    await c.showMore();
    expect(deps.request).toHaveBeenCalledWith('list-changes', { limit: 100 });
    expect(c.view.limit).toBe(100);
  });

  it('a newer load wins over an older one that answers later', async () => {
    let finishFirst: (v: unknown) => void = () => {};
    const deps = makeDeps();
    deps.request
      .mockImplementationOnce(() => new Promise(resolve => (finishFirst = resolve)))
      .mockResolvedValueOnce({ changes: [item('new')] });
    const c = new AiChangesController(deps, () => {});
    const first = c.load();
    await c.load();
    finishFirst({ changes: [item('old')] });
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

  it('the filter asks for AI only or one person, from the first page, and keeps the choice on reload', async () => {
    const deps = makeDeps();
    const c = new AiChangesController(deps, () => {});
    await c.load();
    await c.showMore();

    await c.setFilter('ai');
    expect(deps.request).toHaveBeenLastCalledWith('list-changes', { limit: 20, source: 'ai' });
    expect(c.view.limit).toBe(20);

    await c.setFilter('user:u1');
    expect(deps.request).toHaveBeenLastCalledWith('list-changes', { limit: 20, person: 'Danni' });
    await c.load();
    expect(deps.request).toHaveBeenLastCalledWith('list-changes', { limit: 20, person: 'Danni' });

    await c.setFilter('all');
    expect(deps.request).toHaveBeenLastCalledWith('list-changes', { limit: 20 });
  });

  it('falls back to the AI-only list of an older bridge, without the filter or redo', async () => {
    const deps = makeDeps([], {
      'list-changes': () => {
        throw new Error(BRIDGE_TOO_OLD_MESSAGE);
      },
      'list-recent-changes': () => ({ changes: [legacyEntry('c1')] }),
    });
    const c = new AiChangesController(deps, () => {});
    await c.setFilter('ai'); // no users yet: stays on All
    expect(names(deps)).toEqual(['list-changes', 'list-recent-changes']);
    expect(deps.request).toHaveBeenLastCalledWith('list-recent-changes', { limit: 20 });
    expect(c.view).toMatchObject({ status: 'ready', legacy: true, filter: 'all' });
    expect(c.view.rows.map(r => r.id)).toEqual(['c1']);
  });

  it('also falls back when the message comes relayed from another GM client', async () => {
    const deps = makeDeps([], {
      'list-changes': () => {
        throw new Error(`Error: ${BRIDGE_TOO_OLD_MESSAGE}`);
      },
      'list-recent-changes': () => ({ changes: [] }),
    });
    const c = new AiChangesController(deps, () => {});
    await c.load();
    expect(c.view.legacy).toBe(true);
  });

  it('tries list-changes again on the next load (the bridge may have been updated)', async () => {
    let old = true;
    const deps = makeDeps([], {
      'list-changes': () => {
        if (old) throw new Error(BRIDGE_TOO_OLD_MESSAGE);
        return { changes: [item('c1')] };
      },
      'list-recent-changes': () => ({ changes: [legacyEntry('c1')] }),
    });
    const c = new AiChangesController(deps, () => {});
    await c.load();
    expect(c.view.legacy).toBe(true);
    old = false;
    await c.load();
    expect(c.view.legacy).toBe(false);
  });

  it('shows another error from list-changes as it is, without falling back', async () => {
    const deps = makeDeps([], {
      'list-changes': () => {
        throw new Error('The AI Tool bridge is not connected.');
      },
    });
    const c = new AiChangesController(deps, () => {});
    await c.load();
    expect(c.view).toMatchObject({
      status: 'error',
      error: 'The AI Tool bridge is not connected.',
    });
    expect(names(deps)).toEqual(['list-changes']);
  });
});

describe('AiChangesController: undo', () => {
  async function loaded(deps: Deps): Promise<AiChangesController> {
    const c = new AiChangesController(deps, () => {});
    await c.load();
    deps.request.mockClear();
    return c;
  }

  it('nothing later: plans just-this, one confirm, applies with confirm, notifies and reloads', async () => {
    const deps = makeDeps(['yes']);
    const c = await loaded(deps);

    await c.undo('c1');

    expect(names(deps)).toEqual(['plan-undo-changes', 'apply-planned-change', 'list-changes']);
    expect(deps.request).toHaveBeenNthCalledWith(1, 'plan-undo-changes', {
      id: 'c1',
      scope: 'just-this',
    });
    expect(deps.request).toHaveBeenNthCalledWith(2, 'apply-planned-change', {
      planId: 'plan-1',
      confirm: true,
      confirmDestructive: false,
    });
    expect(deps.ask).toHaveBeenCalledTimes(1);
    const spec = deps.ask.mock.calls[0]?.[0] as DialogSpec;
    expect(spec.content).toContain('HP 5 -&gt; 10');
    expect(deps.notifyInfo).toHaveBeenCalledWith('Undone: Change c1');
    expect(deps.notifyError).not.toHaveBeenCalled();
    expect(c.view.busyId).toBeNull();
  });

  it("passes the plan's own destructive flag on to the apply", async () => {
    const deps = makeDeps(['yes'], {
      'plan-undo-changes': () =>
        planView({ requires: { confirm: true, confirmDestructive: true } }),
    });
    const c = await loaded(deps);
    await c.undo('c1');
    expect(deps.request).toHaveBeenNthCalledWith(
      2,
      'apply-planned-change',
      expect.objectContaining({ confirmDestructive: true })
    );
  });

  it('does nothing when the GM cancels the confirm', async () => {
    const deps = makeDeps(['cancel']);
    const c = await loaded(deps);
    await c.undo('c1');
    expect(names(deps)).toEqual(['plan-undo-changes']);
    expect(deps.notifyInfo).not.toHaveBeenCalled();
    expect(c.view.busyId).toBeNull();
  });

  it("shows the backend's conflict message as it is, then reloads", async () => {
    const deps = makeDeps(['yes'], {
      'apply-planned-change': () => {
        throw new Error('Ireena was edited since the plan; nothing was changed');
      },
    });
    const c = await loaded(deps);

    await c.undo('c1');

    expect(deps.notifyError).toHaveBeenCalledWith(
      'Ireena was edited since the plan; nothing was changed'
    );
    expect(deps.notifyInfo).not.toHaveBeenCalled();
    expect(deps.request).toHaveBeenLastCalledWith('list-changes', { limit: 20 });
    expect(c.view.busyId).toBeNull();
  });

  it('shows a refused plan (nothing to undo, switched off) and asks nothing', async () => {
    const deps = makeDeps([], {
      'plan-undo-changes': () => {
        throw new Error('There is nothing to undo: everything is already as it was before.');
      },
    });
    const c = await loaded(deps);
    await c.undo('c1');
    expect(deps.ask).not.toHaveBeenCalled();
    expect(deps.notifyError).toHaveBeenCalledWith(
      'There is nothing to undo: everything is already as it was before.'
    );
  });

  it('later changes: "Just this" shows the just-this diff, confirms, and applies that plan', async () => {
    const later = [{ id: 'act:z', at, by: 'Danni', summary: 'Ireena: HP 5 -> 3' }];
    const deps = makeDeps(['just-this', 'yes'], {
      'plan-undo-changes': () => planView({ later }),
    });
    const c = await loaded(deps);

    await c.undo('c1');

    const first = deps.ask.mock.calls[0]?.[0] as DialogSpec;
    expect(first.content).toContain('This is not the latest change');
    expect(first.content).toContain('Danni: Ireena: HP 5 -&gt; 3');
    expect(first.buttons.map(b => b.label)).toEqual(['Just this', 'Everything since', 'Cancel']);
    expect(first.content).toContain('data-choice="rewind"');
    expect((deps.ask.mock.calls[1]?.[0] as DialogSpec).content).toContain('HP 5 -&gt; 10');
    expect(names(deps)).toEqual(['plan-undo-changes', 'apply-planned-change', 'list-changes']);
    expect(deps.notifyInfo).toHaveBeenCalledWith('Undone: Change c1');
  });

  it('later changes: "Everything since" plans that scope, lists everything, confirms and applies it', async () => {
    const later = [{ id: 'act:z', at, by: 'Danni', summary: 'x' }];
    const deps = makeDeps(['everything-since', 'yes'], {
      'plan-undo-changes': args =>
        args.scope === 'everything-since'
          ? planView({
              planId: 'plan-2',
              count: 2,
              diff: [
                { kind: 'update', text: 'line one' },
                { kind: 'update', text: 'line two' },
              ],
              later: [],
            })
          : planView({ later }),
    });
    const c = await loaded(deps);

    await c.undo('c1');

    expect(deps.request).toHaveBeenNthCalledWith(2, 'plan-undo-changes', {
      id: 'c1',
      scope: 'everything-since',
    });
    const second = deps.ask.mock.calls[1]?.[0] as DialogSpec;
    expect(second.content).toContain('line one');
    expect(second.content).toContain('line two');
    expect(deps.request).toHaveBeenNthCalledWith(
      3,
      'apply-planned-change',
      expect.objectContaining({ planId: 'plan-2', confirm: true })
    );
    expect(deps.notifyInfo).toHaveBeenCalledWith('Undone 2 changes');
  });

  it('later changes: Cancel (or closing the dialog) changes nothing and does not reload', async () => {
    const later = [{ id: 'act:z', at, by: 'Danni', summary: 'x' }];
    for (const answer of ['cancel', null]) {
      const deps = makeDeps([], { 'plan-undo-changes': () => planView({ later }) });
      deps.ask.mockResolvedValueOnce(answer);
      const c = await loaded(deps);
      await c.undo('c1');
      expect(names(deps)).toEqual(['plan-undo-changes']);
    }
  });

  it('later changes: cancelling the Everything since confirm applies nothing', async () => {
    const later = [{ id: 'act:z', at, by: 'Danni', summary: 'x' }];
    const deps = makeDeps(['everything-since', 'cancel'], {
      'plan-undo-changes': () => planView({ later }),
    });
    const c = await loaded(deps);
    await c.undo('c1');
    expect(names(deps)).toEqual(['plan-undo-changes', 'plan-undo-changes']);
  });

  describe('rewind the whole table', () => {
    const later = [{ id: 'act:z', at, by: 'Danni', summary: 'x' }];
    const routes = {
      'plan-undo-changes': (args: Record<string, unknown>): Record<string, unknown> =>
        args.scope === 'world-since'
          ? planView({
              planId: 'plan-w',
              count: 12,
              scope: 'world-since',
              diff: [{ kind: 'update', text: 'a world line' }],
              later: [],
              requires: { confirm: true, confirmDestructive: true },
            })
          : planView({ later }),
    };

    it('plans world-since with rewindTable, asks twice (the second names the count), then applies', async () => {
      const deps = makeDeps(['rewind', 'yes', 'yes'], routes);
      const c = await loaded(deps);

      await c.undo('c1');

      expect(deps.request).toHaveBeenNthCalledWith(2, 'plan-undo-changes', {
        id: 'c1',
        scope: 'world-since',
        rewindTable: true,
      });
      const step1 = deps.ask.mock.calls[1]?.[0] as DialogSpec;
      const step2 = deps.ask.mock.calls[2]?.[0] as DialogSpec;
      expect(step1.content).toContain(
        'This undoes 12 changes by everyone at the table since 09:05.'
      );
      expect(step1.content).toContain('a world line');
      expect(step2.buttons[0]?.label).toBe('Undo all 12 changes');
      expect(deps.request).toHaveBeenNthCalledWith(3, 'apply-planned-change', {
        planId: 'plan-w',
        confirm: true,
        confirmDestructive: true,
      });
      expect(deps.notifyInfo).toHaveBeenCalledWith('Rewound the table: 12 changes undone');
    });

    it('applies nothing when the first or the second step is cancelled', async () => {
      for (const answers of [
        ['rewind', 'cancel'],
        ['rewind', 'yes', 'cancel'],
      ]) {
        const deps = makeDeps(answers, routes);
        const c = await loaded(deps);
        await c.undo('c1');
        expect(names(deps)).toEqual(['plan-undo-changes', 'plan-undo-changes']);
        expect(deps.ask).toHaveBeenCalledTimes(answers.length);
      }
    });

    it('is under Advanced in the plain confirm too, when nothing came later on the thing', async () => {
      const plain = {
        'plan-undo-changes': (args: Record<string, unknown>): Record<string, unknown> =>
          args.scope === 'world-since'
            ? routes['plan-undo-changes'](args)
            : planView({ later: [] }),
      };
      const deps = makeDeps(['rewind', 'yes', 'yes'], plain);
      const c = await loaded(deps);

      await c.undo('c1');

      const first = deps.ask.mock.calls[0]?.[0] as DialogSpec;
      expect(first.content).toContain('Undo this change?');
      expect(first.content).toContain('data-choice="rewind"');
      expect(deps.request).toHaveBeenNthCalledWith(2, 'plan-undo-changes', {
        id: 'c1',
        scope: 'world-since',
        rewindTable: true,
      });
      expect(deps.notifyInfo).toHaveBeenCalledWith('Rewound the table: 12 changes undone');
    });
  });

  it('ignores an unknown id, a row that cannot be undone and a second click while busy', async () => {
    const deps = makeDeps(['yes'], {
      'list-changes': () => ({ changes: [item('c1'), item('c2', { canUndo: false })] }),
    });
    const c = await loaded(deps);

    await c.undo('nope');
    await c.undo('c2');
    expect(deps.ask).not.toHaveBeenCalled();

    let release: () => void = () => {};
    deps.request.mockImplementationOnce(
      (): Promise<unknown> =>
        new Promise<unknown>(resolve => {
          release = (): void => resolve(planView());
        })
    );
    const running = c.undo('c1');
    await Promise.resolve();
    await c.undo('c1');
    expect(deps.request).toHaveBeenCalledTimes(1);
    release();
    await running;
    expect(deps.ask).toHaveBeenCalledTimes(1);
  });

  it('on an older bridge: confirms with the row, calls undo-change, and reloads the AI-only list', async () => {
    const deps = makeDeps(['yes'], {
      'list-changes': () => {
        throw new Error(BRIDGE_TOO_OLD_MESSAGE);
      },
      'list-recent-changes': () => ({ changes: [legacyEntry('c1')] }),
    });
    const c = await loaded(deps);

    await c.undo('c1');

    expect((deps.ask.mock.calls[0]?.[0] as DialogSpec).content).toContain('a -&gt; b');
    expect(deps.request).toHaveBeenNthCalledWith(1, 'undo-change', {
      changeId: 'c1',
      confirm: true,
    });
    expect(deps.request).toHaveBeenNthCalledWith(2, 'list-changes', { limit: 20 });
    expect(deps.notifyInfo).toHaveBeenCalledWith('Undone: Change c1');
    expect(names(deps)).not.toContain('plan-undo-changes');
  });
});

describe('AiChangesController: redo', () => {
  const undone = {
    'list-changes': (): unknown => ({
      changes: [
        item('u1', { mode: 'undo', summary: 'Undo: Wolf: 4 damage', requestedBy: 'Danni' }),
        item('c1', { summary: 'Wolf: 4 damage', undone: true, undoneBy: 'u1', canUndo: false }),
      ],
    }),
  };

  it('confirms what comes back, then undoes the undo entry with confirm and reloads', async () => {
    const deps = makeDeps(['yes'], undone);
    const c = new AiChangesController(deps, () => {});
    await c.load();
    deps.request.mockClear();

    await c.redo('u1');

    const spec = deps.ask.mock.calls[0]?.[0] as DialogSpec;
    expect(spec.content).toContain('Bring this change back?');
    expect(spec.content).toContain('Wolf: 4 damage');
    expect(deps.request).toHaveBeenNthCalledWith(1, 'undo-change', {
      changeId: 'u1',
      confirm: true,
    });
    expect(deps.request).toHaveBeenNthCalledWith(2, 'list-changes', { limit: 20 });
    expect(deps.notifyInfo).toHaveBeenCalledWith('Redone: Wolf: 4 damage');
  });

  it('does nothing when cancelled, or for an id that no row offers Redo for', async () => {
    const deps = makeDeps(['cancel'], undone);
    const c = new AiChangesController(deps, () => {});
    await c.load();
    deps.request.mockClear();
    await c.redo('u1');
    await c.redo('c1');
    expect(deps.request).not.toHaveBeenCalled();
    expect(deps.ask).toHaveBeenCalledTimes(1);
  });

  it("shows the backend's refusal as it is", async () => {
    const deps = makeDeps(['yes'], {
      ...undone,
      'undo-change': () => {
        throw new Error('Wolf was edited since the change; nothing was undone');
      },
    });
    const c = new AiChangesController(deps, () => {});
    await c.load();
    await c.redo('u1');
    expect(deps.notifyError).toHaveBeenCalledWith(
      'Wolf was edited since the change; nothing was undone'
    );
  });
});

describe('the window class on a fake ApplicationV2', () => {
  let world: TestWorld;
  let restore: () => void;
  let rendered: any[];
  let selectHandlers: Array<() => void>;
  const fakeSelect = {
    value: 'all',
    addEventListener: (_: string, fn: () => void): number => selectHandlers.push(fn),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    world = createTestWorld({ foundryVersion: '14.368' });
    restore = world.install();
    rendered = [];
    selectHandlers = [];
    class FakeApplicationV2 {
      static DEFAULT_OPTIONS: Record<string, unknown> = {};
      content = {
        innerHTML: '',
        scrollTop: 0,
        querySelectorAll: (selector: string): unknown[] =>
          selector.startsWith('select') ? [fakeSelect] : [],
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
    g.foundry = { ...g.foundry, applications: { api: { ApplicationV2: FakeApplicationV2 } } };
    // A link this client holds, so aiToolRequest goes straight over it.
    setBridgeLink({
      isConnected: () => true,
      request: vi.fn((tool: string) =>
        Promise.resolve(
          tool === 'list-changes'
            ? {
                changes: [
                  item('c1', { summary: '<script>alert(1)</script>', lines: ['<b>x</b>'] }),
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

  it('is called "Changes" and offers Undo and Redo', async () => {
    await openAiChangesWindow();
    const cls = rendered[0].constructor as { DEFAULT_OPTIONS: any };
    expect(cls.DEFAULT_OPTIONS.window.title).toBe('Changes');
    expect(Object.keys(cls.DEFAULT_OPTIONS.actions).sort()).toEqual([
      'more',
      'redo',
      'refresh',
      'undo',
    ]);
  });

  it('opens one window, draws the fetched changes with every string escaped', async () => {
    await openAiChangesWindow();
    expect(rendered).toHaveLength(1);
    const html = rendered[0].content.innerHTML as string;
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('data-action="undo"');
    expect(html).toContain('data-fmb-filter');
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
      'list-changes',
      { limit: 20 },
      expect.any(Object),
      30_000
    );
  });

  it('the Show select reloads the list for the chosen person', async () => {
    await openAiChangesWindow();
    const link = (await import('./bridge-link.js')).getOpenBridgeLink() as any;
    link.request.mockClear();
    expect(selectHandlers.length).toBeGreaterThan(0);

    fakeSelect.value = 'ai';
    selectHandlers[selectHandlers.length - 1]?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(link.request).toHaveBeenCalledWith(
      'list-changes',
      { limit: 20, source: 'ai' },
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
      'list-changes',
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

  it('falls back to the AI-only list when the bridge is too old for list-changes', async () => {
    const link = (await import('./bridge-link.js')).getOpenBridgeLink() as any;
    link.request.mockImplementation((tool: string) =>
      tool === 'list-changes'
        ? Promise.reject(new Error(BRIDGE_TOO_OLD_MESSAGE))
        : Promise.resolve({ changes: [legacyEntry('old1')] })
    );
    await openAiChangesWindow();
    expect(link.request).toHaveBeenCalledWith(
      'list-recent-changes',
      { limit: 20 },
      expect.any(Object),
      30_000
    );
    const html = rendered[0].content.innerHTML as string;
    expect(html).toContain('data-change-id="old1"');
    expect(html).not.toContain('data-fmb-filter');
  });
});
