/* eslint-disable @typescript-eslint/require-await -- fakes that mimic async calls */
/**
 * Tests for the "Tarokka" window (I-108 part 3): the controller (load, the forms, Reveal
 * with the plan, the confirm and the apply) with fake deps, and the window class on a
 * fake `ApplicationV2` (veiled cards, singleton, live refresh, ticks and typed text kept
 * across redraws and cleared on close). The card names and texts are made up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import {
  TarokkaController,
  openTarokkaWindow,
  resetTarokkaWindowForTests,
  type TarokkaDeps,
} from './tarokka-window.js';
import { announceAiChangesUpdated } from './ai-changes-signal.js';
import { setBridgeLink } from './bridge-link.js';

const g = globalThis as any;

function pos(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    position: id,
    label: `Slot ${id}`,
    deck: 'common',
    cardId: `card-${id}`,
    cardName: `Test card ${id}`,
    gmNote: null,
    links: {},
    linked: false,
    revealed: false,
    revealPageUuid: null,
    ...over,
  };
}

function reading(positions: unknown[] = [pos('a'), pos('b')]): Record<string, unknown> {
  return {
    available: true,
    reading: {
      readingId: 'r1',
      source: 'builtin-roll',
      readAt: '2026-10-06T19:30:00.000Z',
      providerVersion: null,
      positions,
    },
    archivedReadings: 1,
    revealJournalUuid: null,
    note: '',
  };
}

const plan = {
  planId: 'plan-t1',
  summary: 'Reveal Tarokka slot a to players (page "Card 1")',
  risk: 'destructive',
  diff: [{ text: 'creates the page' }],
};

function makeDeps(over: Partial<TarokkaDeps> = {}): TarokkaDeps & {
  request: ReturnType<typeof vi.fn>;
  confirmReveal: ReturnType<typeof vi.fn>;
  openDocument: ReturnType<typeof vi.fn>;
  notifyInfo: ReturnType<typeof vi.fn>;
  notifyError: ReturnType<typeof vi.fn>;
} {
  return {
    request: vi.fn(async (tool: string) => {
      if (tool === 'get-tarokka-reading') return reading();
      if (tool === 'plan-tarokka-reveal') return plan;
      return { changeId: 'chg-1' };
    }),
    confirmReveal: vi.fn().mockResolvedValue(true),
    openDocument: vi.fn().mockResolvedValue({ opened: true }),
    notifyInfo: vi.fn(),
    notifyError: vi.fn(),
    ...over,
  } as any;
}

/** A controller with the two positions loaded and the form of position a open and filled in. */
async function withForm(
  deps = makeDeps(),
  form: { text?: string; title?: string; showNow?: boolean } = { text: 'Words for players' }
): Promise<{ c: TarokkaController; deps: ReturnType<typeof makeDeps> }> {
  const c = new TarokkaController(deps, () => {});
  await c.load();
  c.openForm('a');
  if (form.text !== undefined) c.setField('revealText', 'a', form.text);
  if (form.title !== undefined) c.setField('revealTitle', 'a', form.title);
  if (form.showNow !== undefined) c.setField('revealShowNow', 'a', form.showNow);
  deps.request.mockClear();
  return { c, deps };
}

describe('TarokkaController', () => {
  it('loads the reading with get-tarokka-reading', async () => {
    const deps = makeDeps();
    const changed = vi.fn();
    const c = new TarokkaController(deps, changed);
    await c.load();
    expect(deps.request).toHaveBeenCalledWith('get-tarokka-reading', {});
    expect(c.view.status).toBe('ready');
    expect(c.view.reading?.positions.map(p => p.position)).toEqual(['a', 'b']);
    expect(c.view.showCards).toBe(false);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('shows one line when loading fails and recovers on the next load', async () => {
    const deps = makeDeps();
    deps.request.mockRejectedValueOnce(new Error('The AI Tool bridge is not connected.'));
    const c = new TarokkaController(deps, () => {});
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
      .mockResolvedValueOnce(reading([pos('new')]));
    const c = new TarokkaController(deps, () => {});
    const first = c.load();
    await c.load();
    finishFirst(reading([pos('old')]));
    await first;
    expect(c.view.reading?.positions.map(p => p.position)).toEqual(['new']);
  });

  it('a reading without a card state is "no reading yet"', async () => {
    const deps = makeDeps();
    deps.request.mockResolvedValueOnce({ available: false, archivedReadings: 0, note: '' });
    const c = new TarokkaController(deps, () => {});
    await c.load();
    expect(c.view).toMatchObject({ status: 'ready', reading: null });
  });

  describe('the forms', () => {
    it('opens a form empty and unticked, and leaves an open form as typed', async () => {
      const c = new TarokkaController(makeDeps(), () => {});
      await c.load();
      c.openForm('a');
      expect(c.view.forms.a).toEqual({ text: '', title: '', showNow: false });
      c.setField('revealText', 'a', 'typed');
      c.setField('revealShowNow', 'a', true);
      c.openForm('a');
      expect(c.view.forms.a).toEqual({ text: 'typed', title: '', showNow: true });
    });

    it('closing a form drops what was typed; reopening starts clean', async () => {
      const c = new TarokkaController(makeDeps(), () => {});
      await c.load();
      c.openForm('a');
      c.setField('revealText', 'a', 'typed');
      c.setField('revealShowNow', 'a', true);
      c.closeForm('a');
      expect(c.view.forms).toEqual({});
      c.openForm('a');
      expect(c.view.forms.a).toEqual({ text: '', title: '', showNow: false });
    });

    it('ignores a field of a form that is not open, or an unknown field', async () => {
      const c = new TarokkaController(makeDeps(), () => {});
      await c.load();
      c.setField('revealText', 'a', 'x');
      c.openForm('a');
      c.setField('mystery', 'a', 'x');
      c.setField('revealText', undefined, 'x');
      expect(c.view.forms.a).toEqual({ text: '', title: '', showNow: false });
    });

    it('keeps an open form and its typed text through a reload, but drops it once the position is revealed', async () => {
      const deps = makeDeps();
      const c = new TarokkaController(deps, () => {});
      await c.load();
      c.openForm('a');
      c.openForm('b');
      c.setField('revealText', 'a', 'typed a');
      await c.load();
      expect(c.view.forms.a?.text).toBe('typed a');
      deps.request.mockResolvedValueOnce(reading([pos('a'), pos('b', { revealed: true })]));
      await c.load();
      expect(Object.keys(c.view.forms)).toEqual(['a']);
      expect(c.view.forms.a?.text).toBe('typed a');
    });

    it('Show cards redraws, and closing the window forgets the tick, the forms and the reading', async () => {
      const changed = vi.fn();
      const c = new TarokkaController(makeDeps(), changed);
      await c.load();
      changed.mockClear();
      c.setShowCards(true);
      expect(changed).toHaveBeenCalledTimes(1);
      c.openForm('a');
      c.resetUi();
      expect(c.view).toMatchObject({ showCards: false, forms: {}, reading: null });
    });

    it('a load still running when the window closes does not bring the reading back', async () => {
      let finish: (v: unknown) => void = () => {};
      const deps = makeDeps();
      deps.request.mockImplementationOnce(() => new Promise(resolve => (finish = resolve)));
      const c = new TarokkaController(deps, () => {});
      const running = c.load();
      c.resetUi();
      finish(reading());
      await running;
      expect(c.view.reading).toBeNull();
    });
  });

  describe('Open ... buttons', () => {
    it('opens the document on this screen and reports a failure as a notification', async () => {
      const deps = makeDeps();
      const c = new TarokkaController(deps, () => {});
      await c.openDocument('Scene.S');
      expect(deps.openDocument).toHaveBeenCalledWith('Scene.S');
      deps.openDocument.mockRejectedValueOnce(new Error('Document not found: Scene.S'));
      await expect(c.openDocument('Scene.S')).resolves.toBeUndefined();
      expect(deps.notifyError).toHaveBeenCalledWith('Document not found: Scene.S');
    });
  });

  describe('Reveal', () => {
    it('plans with position, text and title, confirms, applies with both confirmations, then reloads', async () => {
      const { c, deps } = await withForm(makeDeps(), {
        text: '  Words for players  ',
        title: ' Page ',
      });
      await c.revealPosition('a');

      expect(deps.request).toHaveBeenNthCalledWith(1, 'plan-tarokka-reveal', {
        position: 'a',
        text: 'Words for players',
        title: 'Page',
      });
      expect(deps.confirmReveal).toHaveBeenCalledWith({
        planId: 'plan-t1',
        summary: plan.summary,
        diff: ['creates the page'],
        note: '',
      });
      expect(deps.request).toHaveBeenNthCalledWith(2, 'apply-planned-change', {
        planId: 'plan-t1',
        confirm: true,
        confirmDestructive: true,
      });
      expect(deps.request).toHaveBeenNthCalledWith(3, 'get-tarokka-reading', {});
      expect(deps.notifyInfo).toHaveBeenCalledWith(`Revealed: ${plan.summary}`);
      expect(c.view.forms).toEqual({}); // a reveal closes the form
      expect(c.view.busy).toBe(false);
    });

    it('sends no title when none is given, and showNow only when ticked', async () => {
      const { c, deps } = await withForm();
      await c.revealPosition('a');
      expect(deps.request.mock.calls[0]?.[1]).toEqual({ position: 'a', text: 'Words for players' });

      const second = await withForm(makeDeps(), { text: 'More words', showNow: true });
      await second.c.revealPosition('a');
      expect(second.deps.request.mock.calls[0]?.[1]).toEqual({
        position: 'a',
        text: 'More words',
        showNow: true,
      });
      const applyArgs = second.deps.request.mock.calls.find(
        call => call[0] === 'apply-planned-change'
      )?.[1];
      expect(applyArgs).not.toHaveProperty('showNow');
    });

    it('a cancel applies nothing, says nothing, keeps the typed text and unticks Show it now', async () => {
      const { c, deps } = await withForm(
        makeDeps({ confirmReveal: vi.fn().mockResolvedValue(false) }),
        {
          text: 'Words',
          showNow: true,
        }
      );
      await c.revealPosition('a');
      expect(deps.request.mock.calls.map(call => call[0])).toEqual([
        'plan-tarokka-reveal',
        'get-tarokka-reading',
      ]);
      expect(deps.notifyInfo).not.toHaveBeenCalled();
      expect(deps.notifyError).not.toHaveBeenCalled();
      expect(c.view.forms.a).toEqual({ text: 'Words', title: '', showNow: false });
    });

    it('a planning or apply failure is shown, never thrown; the form stays and Show it now is unticked', async () => {
      const { c, deps } = await withForm(makeDeps(), { text: 'Words', showNow: true });
      deps.request.mockRejectedValueOnce(new Error('Tarokka writes are switched off'));
      await expect(c.revealPosition('a')).resolves.toBeUndefined();
      expect(c.view.actionError).toBe('Tarokka writes are switched off');
      expect(deps.notifyError).toHaveBeenCalledWith('Tarokka writes are switched off');
      expect(c.view.forms.a).toEqual({ text: 'Words', title: '', showNow: false });

      c.setField('revealShowNow', 'a', true);
      deps.request.mockImplementationOnce(async () => plan);
      deps.request.mockRejectedValueOnce(new Error('The page was edited since the plan'));
      await c.revealPosition('a');
      expect(deps.notifyError).toHaveBeenLastCalledWith('The page was edited since the plan');
      expect(c.view.forms.a?.showNow).toBe(false);
      expect(c.view.busy).toBe(false);
    });

    it('needs text: an empty or blank text is refused before anything is planned', async () => {
      const { c, deps } = await withForm(makeDeps(), { text: '   ' });
      await c.revealPosition('a');
      expect(deps.request).not.toHaveBeenCalled();
      expect(c.view.actionError).toMatch(/Write the text/);
      expect(deps.notifyError).toHaveBeenCalled();
      expect(c.view.forms.a).toBeDefined();
    });

    it('refuses text over 5000 characters before anything is planned', async () => {
      const { c, deps } = await withForm(makeDeps(), { text: 'x'.repeat(5001) });
      await c.revealPosition('a');
      expect(deps.request).not.toHaveBeenCalled();
      expect(c.view.actionError).toMatch(/5000/);
    });

    it('a result without a plan is an error', async () => {
      const { c, deps } = await withForm();
      deps.request.mockResolvedValueOnce({ note: 'nothing' });
      await c.revealPosition('a');
      expect(c.view.actionError).toMatch(/no plan/);
      expect(deps.confirmReveal).not.toHaveBeenCalled();
    });

    it('says so when the page was revealed but could not be shown on screens', async () => {
      const { c, deps } = await withForm(makeDeps(), { text: 'Words', showNow: true });
      deps.request.mockResolvedValueOnce(plan);
      deps.request.mockResolvedValueOnce({ shown: { ok: false, error: 'nobody is online' } });
      await c.revealPosition('a');
      expect(deps.notifyInfo).toHaveBeenCalled();
      expect(c.view.actionError).toMatch(/could not be shown.*nobody is online/);
    });

    it('does nothing for a position with no open form, and ignores a second click while busy', async () => {
      const { c, deps } = await withForm();
      await c.revealPosition('b');
      expect(deps.request).not.toHaveBeenCalled();

      let release: (v: boolean) => void = () => {};
      deps.confirmReveal.mockImplementationOnce(
        () => new Promise<boolean>(resolve => (release = resolve))
      );
      const running = c.revealPosition('a');
      await vi.waitFor(() => expect(deps.confirmReveal).toHaveBeenCalled());
      await c.revealPosition('a');
      c.openForm('b');
      expect(deps.confirmReveal).toHaveBeenCalledTimes(1);
      expect(c.view.forms.b).toBeUndefined();
      release(false);
      await running;
    });
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
          tool === 'get-tarokka-reading'
            ? reading([
                pos('a', {
                  label: '<script>alert(1)</script>',
                  gmNote: 'Hidden note',
                  links: { sceneUuid: 'Scene.S1' },
                }),
                pos('b', { revealed: true, revealPageUuid: 'JournalEntry.R.JournalEntryPage.Q' }),
              ])
            : tool === 'plan-tarokka-reveal'
              ? { ...plan, summary: 'Reveal <b>x</b>' }
              : { changeId: 'c' }
        )
      ),
    };
    setBridgeLink({ isConnected: () => true, request: link.request } as any);
    resetTarokkaWindowForTests();
  });

  afterEach(() => {
    for (const w of rendered) w._onClose();
    setBridgeLink(null);
    restore();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const html = (): string => rendered[0].content.innerHTML as string;

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

  /** The GM changes an input: the browser fires an event that bubbles to the content element. */
  function change(
    field: string,
    value: string | boolean,
    position?: string,
    type: 'change' | 'input' = 'change'
  ): Promise<void> {
    const target = {
      dataset: { field, ...(position ? { position } : {}) },
      type: typeof value === 'boolean' ? 'checkbox' : 'textarea',
      ...(typeof value === 'boolean' ? { checked: value } : { value }),
    };
    for (const listener of rendered[0].content.listeners[type] ?? []) listener({ target });
    return vi.advanceTimersByTimeAsync(0);
  }

  it('opens one window, veils the cards, and draws names from the reading, every string escaped', async () => {
    await openTarokkaWindow();
    expect(rendered).toHaveLength(1);
    expect(rendered[0].constructor.DEFAULT_OPTIONS).toMatchObject({
      id: 'fmb-tarokka',
      window: { title: 'Tarokka' },
    });
    expect(html()).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html()).not.toContain('<script>');
    expect(html()).toContain('fmb-tk-veiled');
    expect(html()).not.toContain('Test card a');
    expect(html()).not.toContain('Hidden note');
    expect(html()).toContain('Open Scene');
    expect(html()).toContain('Open page');
    expect(html()).toContain('builtin-roll');
    expect(html()).toContain('1 archived');
    expect(link.request).toHaveBeenCalledWith(
      'get-tarokka-reading',
      {},
      expect.any(Object),
      30_000
    );
  });

  it('opening again reuses the same window (a singleton per client)', async () => {
    await openTarokkaWindow();
    await openTarokkaWindow();
    expect(rendered).toHaveLength(1);
    expect(rendered[0].bringToFront).toHaveBeenCalledTimes(2);
  });

  it('says there is no reading yet when none is stored', async () => {
    link.request.mockResolvedValue({ available: false, archivedReadings: 0, note: '' });
    await openTarokkaWindow();
    expect(html()).toContain('No reading yet');
  });

  it('shows the error at the top when the bridge is not reachable', async () => {
    link.request.mockRejectedValue(new Error('Tarokka is off'));
    await openTarokkaWindow();
    expect(html()).toContain('role="alert">Tarokka is off');
  });

  it('Show cards shows the card and the note, and survives a refresh and the change-log signal', async () => {
    await openTarokkaWindow();
    await change('showCards', true);
    expect(html()).toContain('Test card a <code>card-a</code>');
    expect(html()).toContain('Hidden note');

    await click('refresh');
    expect(html()).toContain('Test card a');
    announceAiChangesUpdated();
    await vi.advanceTimersByTimeAsync(350);
    expect(html()).toContain('Test card a');
    await openTarokkaWindow(); // the toolbar button again: the same window, the same tick
    expect(html()).toContain('Test card a');

    await change('showCards', false);
    expect(html()).not.toContain('Test card a');
    expect(html()).not.toContain('Hidden note');
  });

  it('Show cards is unticked, and the old reading is gone, when the window is opened again after a close', async () => {
    await openTarokkaWindow();
    await change('showCards', true);
    rendered[0]._onClose();
    rendered[0].state = 'closed';
    link.request.mockImplementation(() => new Promise(() => {})); // the new reading never arrives
    void openTarokkaWindow();
    await vi.advanceTimersByTimeAsync(0);
    expect(html()).not.toContain('Test card a');
    expect(html()).not.toContain('data-field="showCards" checked');
    expect(html()).toContain('Loading the reading');
  });

  it('Reveal... opens the form; typed text and the tick survive a refresh and the signal', async () => {
    await openTarokkaWindow();
    await click('revealOpen', { position: 'a' });
    expect(html()).toContain('What the players read');
    expect(html()).toContain('data-action="revealGo" data-position="a"');

    await change('revealText', 'My made-up text', 'a', 'input');
    await change('revealTitle', 'My title', 'a', 'input');
    await change('revealShowNow', true, 'a');
    await click('refresh');
    announceAiChangesUpdated();
    await vi.advanceTimersByTimeAsync(350);

    expect(html()).toContain('>My made-up text</textarea>');
    expect(html()).toContain('value="My title"');
    expect(html()).toContain('data-field="revealShowNow" data-position="a" checked');
  });

  it('Cancel closes the form and drops the text; opening it again is empty and unticked', async () => {
    await openTarokkaWindow();
    await click('revealOpen', { position: 'a' });
    await change('revealText', 'Some text', 'a', 'input');
    await change('revealShowNow', true, 'a');
    await click('revealCancel', { position: 'a' });
    expect(html()).not.toContain('data-form=');
    await click('revealOpen', { position: 'a' });
    expect(html()).toContain('></textarea>');
    expect(html()).not.toContain('data-field="revealShowNow" data-position="a" checked');
  });

  it('Reveal: plans, confirms in a dialog with the escaped plan, then applies; the tick is gone after', async () => {
    await openTarokkaWindow();
    await click('revealOpen', { position: 'a' });
    await change('revealText', 'My made-up text', 'a', 'input');
    await change('revealShowNow', true, 'a');
    link.request.mockClear();

    await click('revealGo', { position: 'a' });

    expect(link.request).toHaveBeenNthCalledWith(
      1,
      'plan-tarokka-reveal',
      { position: 'a', text: 'My made-up text', showNow: true },
      expect.any(Object),
      30_000
    );
    const dialog = confirm.mock.calls[0][0];
    expect(dialog.content).toContain('Reveal &lt;b&gt;x&lt;/b&gt;');
    expect(dialog.content).toContain('creates the page');
    expect(dialog.rejectClose).toBe(false);
    expect(link.request).toHaveBeenNthCalledWith(
      2,
      'apply-planned-change',
      { planId: 'plan-t1', confirm: true, confirmDestructive: true },
      expect.any(Object),
      120_000 // an apply writes in Foundry first
    );
    expect(link.request).toHaveBeenNthCalledWith(
      3,
      'get-tarokka-reading',
      {},
      expect.any(Object),
      30_000
    );
    expect(html()).not.toContain('data-form=');
  });

  it('Reveal: a cancelled dialog applies nothing; the text stays and Show it now is unticked', async () => {
    confirm.mockResolvedValue(null);
    await openTarokkaWindow();
    await click('revealOpen', { position: 'a' });
    await change('revealText', 'My made-up text', 'a', 'input');
    await change('revealShowNow', true, 'a');
    link.request.mockClear();
    await click('revealGo', { position: 'a' });
    expect(link.request.mock.calls.map(call => call[0])).not.toContain('apply-planned-change');
    expect(html()).toContain('>My made-up text</textarea>');
    expect(html()).not.toContain('data-field="revealShowNow" data-position="a" checked');
  });

  it('Reveal: an empty text asks for text and sends nothing', async () => {
    await openTarokkaWindow();
    await click('revealOpen', { position: 'a' });
    link.request.mockClear();
    await click('revealGo', { position: 'a' });
    expect(link.request).not.toHaveBeenCalled();
    expect(html()).toContain('Write the text the players will read first.');
  });

  it('Open buttons open the linked document through Foundry', async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    g.fromUuid = vi.fn().mockResolvedValue({
      documentName: 'Scene',
      name: 'S',
      view: open,
    });
    await openTarokkaWindow();
    await click('openDoc', { uuid: 'Scene.S1' });
    expect(g.fromUuid).toHaveBeenCalledWith('Scene.S1');
    expect(open).toHaveBeenCalled();
  });

  it('Open: a document that cannot be found is a notification, not an unhandled error', async () => {
    g.fromUuid = vi.fn().mockResolvedValue(null);
    await openTarokkaWindow();
    await click('openDoc', { uuid: 'Scene.Gone' });
    expect(world.notifications.some(n => n.level === 'error' && /not found/i.test(n.message))).toBe(
      true
    );
  });

  it('Refresh and the change-log signal fetch again (the signal debounced)', async () => {
    await openTarokkaWindow();
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
    await openTarokkaWindow();
    rendered[0]._onClose();
    link.request.mockClear();
    announceAiChangesUpdated();
    await vi.advanceTimersByTimeAsync(500);
    expect(link.request).not.toHaveBeenCalled();
  });
});
