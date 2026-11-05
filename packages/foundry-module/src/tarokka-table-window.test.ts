import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyTable, parsePublicTable, type PublicTable } from './tarokka-table-model.js';
import { restorePendingLines, TableController, type TableDeps } from './tarokka-table-window.js';

const CARDS = [
  ['tome', 'swords-7', 'Seven of Swords'],
  ['holySymbol', 'coins-master', 'Master of Coins'],
  ['sunsword', 'stars-3', 'Three of Stars'],
  ['ally', 'raven', 'The Raven'],
  ['strahdLocation', 'donjon', 'The Donjon'],
] as const;

function readingResult(revealed: string[] = [], readingId = 'roll-1', tome = 'swords-7'): unknown {
  return {
    available: true,
    archivedReadings: 0,
    reading: {
      readingId,
      source: 'gm-chosen',
      readAt: '2026-10-29T20:00:00.000Z',
      positions: CARDS.map(([position, cardId, cardName]) => ({
        position,
        label: position,
        cardId: position === 'tome' ? tome : cardId,
        cardName,
        gmNote: null,
        links: {},
        revealed: revealed.includes(position),
        revealPageUuid: null,
      })),
    },
  };
}

function makeController(options: { flipText?: string | null; picked?: string | null } = {}): {
  controller: TableController;
  deps: TableDeps;
  request: ReturnType<typeof vi.fn>;
  backend: { readingId: string; tome: string; failApply: boolean };
  revealed: string[];
  get: () => PublicTable;
  getImages: () => Record<string, string>;
} {
  let table: PublicTable = emptyTable();
  let images: Record<string, string> = {};
  const revealed: string[] = [];
  const backend = { readingId: 'roll-1', tome: 'swords-7', failApply: false };
  let planned = '';
  const request = vi.fn(async (tool: string, args: Record<string, unknown>) => {
    if (tool === 'get-tarokka-reading') {
      return readingResult(revealed, backend.readingId, backend.tome);
    }
    if (tool === 'plan-tarokka-reveal') {
      planned = String(args.position);
      return { planId: 'plan-1', summary: 'Reveal', diff: [], note: '' };
    }
    if (tool === 'apply-planned-change') {
      if (backend.failApply) throw new Error('apply refused');
      revealed.push(planned);
      return { ok: true };
    }
    throw new Error(`unexpected ${tool}`);
  });
  const deps: TableDeps = {
    request,
    readTable: () => table,
    writeTable: async t => {
      table = parsePublicTable(JSON.parse(JSON.stringify(t)));
    },
    readImages: () => images,
    writeImages: async i => {
      images = i;
    },
    confirmFlip: vi.fn(async () => (options.flipText === undefined ? '' : options.flipText)),
    pickImage: vi.fn(async () =>
      options.picked === undefined ? '/worlds/w/raven.webp' : options.picked
    ),
    notifyInfo: vi.fn(),
    notifyError: vi.fn(),
  };
  const controller = new TableController(deps, () => undefined);
  return {
    controller,
    deps,
    request,
    backend,
    revealed,
    get: (): PublicTable => table,
    getImages: (): Record<string, string> => images,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('TableController', () => {
  it('loads the reading and starts a clean public table for it', async () => {
    const { controller, get } = makeController();
    await controller.load();
    expect(controller.view.status).toBe('ready');
    expect(controller.view.slots).toHaveLength(5);
    expect(get().readingId).toBe('roll-1');
    expect(get().slots.every(s => s.stage === 'empty')).toBe(true);
  });

  it('places cards in order, writing only the stage to the public table', async () => {
    const { controller, get } = makeController();
    await controller.load();
    await controller.place();
    await controller.place();
    expect(get().slots.map(s => s.stage)).toEqual(['placed', 'placed', 'empty', 'empty', 'empty']);
    const json = JSON.stringify(get());
    for (const [, id, name] of CARDS) {
      expect(json).not.toContain(id);
      expect(json).not.toContain(name);
    }
  });

  it('shows and stops showing the table to the players', async () => {
    const { controller, get } = makeController();
    await controller.load();
    await controller.setShown(true);
    expect(get().shown).toBe(true);
    await controller.setShown(false);
    expect(get().shown).toBe(false);
  });

  it('keeps the GM line on the flipped slot so the ceremony can show it', async () => {
    const { controller, get } = makeController({ flipText: '  The sun shines on you.  ' });
    await controller.load();
    await controller.place();
    await controller.flip(0);
    expect(get().slots[0]).toMatchObject({
      stage: 'revealed',
      line: 'The sun shines on you.',
    });
    // A later reload keeps the line; a flip with no typed text has none.
    await controller.load();
    expect(get().slots[0]?.line).toBe('The sun shines on you.');
    await controller.place();
    const second = makeController({ flipText: '' });
    await second.controller.load();
    await second.controller.place();
    await second.controller.flip(0);
    expect(second.get().slots[0]?.line).toBeUndefined();
  });

  it('puts the line back when another GM client wrote the flipped card without it', async () => {
    const { controller, deps, get } = makeController({ flipText: 'Kept line.' });
    await controller.load();
    await controller.place();
    // The other client's write lands last and has no line: the first revealed write loses it.
    const write = deps.writeTable.bind(deps);
    let stripNext = true;
    deps.writeTable = async (t): Promise<void> => {
      if (!stripNext || !t.slots.some(s => s.stage === 'revealed')) return write(t);
      stripNext = false;
      const stripped = { ...t, slots: t.slots.map(s => ({ ...s, line: undefined })) };
      await write(stripped as PublicTable);
    };
    await controller.flip(0);
    expect(get().slots[0]?.stage).toBe('revealed');
    expect(get().slots[0]?.line).toBe('Kept line.');
  });

  it('does not carry a line from a failed flip into the next flip with an empty field', async () => {
    const { controller, backend, deps, get } = makeController({ flipText: 'Lost line.' });
    await controller.load();
    await controller.place();
    backend.failApply = true;
    await controller.flip(0);
    expect(controller.view.actionError).toBe('apply refused');
    backend.failApply = false;
    (deps.confirmFlip as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => '');
    await controller.flip(0);
    expect(get().slots[0]).toMatchObject({ stage: 'revealed' });
    expect(get().slots[0]?.line).toBeUndefined();
  });

  it('keeps the line when a second load drops the first one (sequence drop)', async () => {
    const { controller, request, get } = makeController({ flipText: 'Survives.' });
    await controller.load();
    await controller.place();
    // A change-watcher load starts right after the flip's own load began, so it is the newer one
    // and the flip's load drops its table write (sequence check).
    let applied = false;
    let started = false;
    const original = request.getMockImplementation() as (
      tool: string,
      args: Record<string, unknown>
    ) => Promise<unknown>;
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let held = false;
    request.mockImplementation(async (tool, args) => {
      if (tool === 'get-tarokka-reading' && started && !held) {
        // The watcher's own reading arrives only after the flip is over.
        held = true;
        await gate;
      }
      const result = await original(tool, args);
      if (tool === 'apply-planned-change') applied = true;
      else if (tool === 'get-tarokka-reading' && applied && !started) {
        started = true;
        void controller.load();
      }
      return result;
    });
    await controller.flip(0);
    // The flip's own load was dropped, so the table still lacks the card; the watcher load lands
    // now and must still find the kept line.
    release();
    await new Promise(r => setTimeout(r, 0));
    expect(started).toBe(true);
    expect(get().slots[0]).toMatchObject({ stage: 'revealed', line: 'Survives.' });
  });

  it('does nothing once the stored table shows the line', async () => {
    const { controller, deps, get } = makeController({ flipText: 'Kept for the watcher.' });
    await controller.load();
    await controller.place();
    await controller.flip(0);
    expect(get().slots[0]?.line).toBe('Kept for the watcher.');
    // Settled: the stored table shows the line, so there is nothing to restore.
    expect(await restorePendingLines(deps)).toBeNull();
  });

  it('reports a successful flip even when restoring the kept line throws', async () => {
    const { controller, deps, get } = makeController({ flipText: 'Kept.' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await controller.load();
    await controller.place();
    const write = deps.writeTable.bind(deps);
    deps.writeTable = async (t): Promise<void> => {
      if (!t.slots.some(s => s.stage === 'revealed')) return write(t);
      // The flip's own write loses the line, so the restore has work to do, and then fails.
      await write({ ...t, slots: t.slots.map(s => ({ ...s, line: undefined })) } as PublicTable);
      deps.writeTable = async (): Promise<void> => {
        throw new Error('write refused');
      };
    };
    await controller.flip(0);
    expect(controller.view.actionError).toBeFalsy();
    expect(deps.notifyError).not.toHaveBeenCalled();
    expect(get().slots[0]?.stage).toBe('revealed');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('drops a kept line whose card was never revealed, so a later reveal does not use it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-05T20:00:00Z'));
    const { controller, deps, backend, revealed, get } = makeController({ flipText: 'Old line.' });
    await controller.load();
    await controller.place();
    // The apply "succeeds" but the stored table never shows the card revealed (undone at once).
    backend.failApply = false;
    const request = deps.request.bind(deps);
    deps.request = async (tool, args): Promise<unknown> => {
      const result = await request(tool, args);
      if (tool === 'apply-planned-change') revealed.length = 0;
      return result;
    };
    await controller.flip(0);
    expect(get().slots[0]?.stage).toBe('placed');
    // Claude reveals the same card later, with no line.
    vi.setSystemTime(new Date('2026-11-05T20:00:03Z'));
    revealed.push('tome');
    await controller.load();
    expect(await restorePendingLines(deps)).toBeNull();
    expect(get().slots[0]?.line).toBeUndefined();
  });

  it('puts the line back on a write that lands after the flip is over, then gives up', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-05T20:00:00Z'));
    const { controller, deps, get } = makeController({ flipText: 'Late write.' });
    await controller.load();
    await controller.place();
    const write = deps.writeTable.bind(deps);
    let strip = true;
    deps.writeTable = async (t): Promise<void> => {
      // The flip's own writes lose the line, as another client's last write would.
      if (strip && t.slots.some(s => s.stage === 'revealed')) {
        await write({ ...t, slots: t.slots.map(s => ({ ...s, line: undefined })) } as PublicTable);
        return;
      }
      await write(t);
    };
    await controller.flip(0);
    strip = false;
    // The flip's own restore was stripped too; the watcher's later restore lands it.
    expect(get().slots[0]?.line).toBeUndefined();
    expect((await restorePendingLines(deps))?.slots[0]?.line).toBe('Late write.');
    expect(get().slots[0]?.line).toBe('Late write.');

    // After 10 s a dropped line is no longer restored.
    const second = makeController({ flipText: 'Too late.' });
    await second.controller.load();
    await second.controller.place();
    const w2 = second.deps.writeTable.bind(second.deps);
    second.deps.writeTable = async (t): Promise<void> => {
      await w2({ ...t, slots: t.slots.map(s => ({ ...s, line: undefined })) } as PublicTable);
    };
    await second.controller.flip(0);
    vi.setSystemTime(new Date('2026-11-05T20:00:11Z'));
    expect(await restorePendingLines(second.deps)).toBeNull();
    expect(second.get().slots[0]?.line).toBeUndefined();
  });

  it('place and show start from the stored table, not an older copy', async () => {
    const { controller, deps, get } = makeController({ flipText: 'Line.' });
    await controller.load();
    await controller.place();
    await controller.flip(0);
    // Another client placed the second card and showed the table; this window did not hear.
    await deps.writeTable({
      ...get(),
      shown: true,
      slots: get().slots.map((s, i) => (i === 1 ? { stage: 'placed' as const } : s)),
    });
    await controller.place();
    expect(get().slots.map(s => s.stage)).toEqual([
      'revealed',
      'placed',
      'placed',
      'empty',
      'empty',
    ]);
    expect(get().slots[0]?.line).toBe('Line.');
    await controller.setShown(false);
    expect(get().shown).toBe(false);
    expect(get().slots[0]?.line).toBe('Line.');
    expect(get().slots[2]?.stage).toBe('placed');
  });

  it('flips a placed card through a normal reveal, then the face appears', async () => {
    const { controller, request, get } = makeController({ flipText: '  ' });
    await controller.load();
    await controller.place();
    await controller.flip(0);
    expect(request).toHaveBeenCalledWith('plan-tarokka-reveal', {
      position: 'tome',
      text: 'Seven of Swords',
    });
    expect(request).toHaveBeenCalledWith('apply-planned-change', {
      planId: 'plan-1',
      confirm: true,
      confirmDestructive: true,
    });
    expect(get().slots[0]).toMatchObject({ stage: 'revealed', cardId: 'swords-7' });
    expect(get().slots[1].stage).toBe('empty');
  });

  it('sends the text the GM typed, and does nothing on cancel', async () => {
    const typed = makeController({ flipText: 'Read this aloud' });
    await typed.controller.load();
    await typed.controller.place();
    await typed.controller.flip(0);
    expect(typed.request).toHaveBeenCalledWith(
      'plan-tarokka-reveal',
      expect.objectContaining({ text: 'Read this aloud' })
    );

    const cancelled = makeController({ flipText: null });
    await cancelled.controller.load();
    await cancelled.controller.place();
    await cancelled.controller.flip(0);
    expect(cancelled.request).not.toHaveBeenCalledWith('plan-tarokka-reveal', expect.anything());
    expect(cancelled.get().slots[0].stage).toBe('placed');
  });

  it('refuses a flip when the reading changed behind the window, and refreshes', async () => {
    const { controller, backend, request, deps, get } = makeController();
    await controller.load();
    await controller.place();
    backend.readingId = 'roll-2';
    backend.tome = 'stars-4';
    await controller.flip(0);
    expect(deps.confirmFlip).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalledWith('plan-tarokka-reveal', expect.anything());
    expect(controller.view.actionError).toMatch(/reading changed/);
    expect(get().readingId).toBe('roll-2');
    expect(get().slots.every(s => s.stage === 'empty')).toBe(true);
  });

  it('refuses a flip when the reading changed while the dialog was open', async () => {
    const { controller, backend, request, deps } = makeController();
    await controller.load();
    await controller.place();
    (deps.confirmFlip as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      backend.readingId = 'roll-2';
      backend.tome = 'stars-4';
      return '';
    });
    await controller.flip(0);
    expect(request).not.toHaveBeenCalledWith('plan-tarokka-reveal', expect.anything());
    expect(controller.view.actionError).toMatch(/reading changed/);
  });

  it('leaves the card face down when the apply fails', async () => {
    const { controller, backend, get } = makeController();
    await controller.load();
    await controller.place();
    backend.failApply = true;
    await controller.flip(0);
    expect(get().slots[0].stage).toBe('placed');
    expect(controller.view.actionError).toBe('apply refused');
  });

  it('turns a face down again when a reveal is undone behind the window', async () => {
    const { controller, revealed, get } = makeController();
    await controller.load();
    await controller.place();
    await controller.flip(0);
    expect(get().slots[0].stage).toBe('revealed');
    revealed.length = 0;
    await controller.load();
    expect(get().slots[0].stage).not.toBe('revealed');
  });

  it('does not flip a card that is not on the table', async () => {
    const { controller, deps } = makeController();
    await controller.load();
    await controller.flip(2);
    expect(deps.confirmFlip).not.toHaveBeenCalled();
  });

  it('shows an error from the backend in the window', async () => {
    const { controller, deps, request } = makeController();
    await controller.load();
    await controller.place();
    request.mockImplementationOnce(async () => {
      throw new Error('Tarokka writes are switched off');
    });
    await controller.flip(0);
    expect(controller.view.actionError).toBe('Tarokka writes are switched off');
    expect(deps.notifyError).toHaveBeenCalled();
    expect(controller.view.busy).toBe(false);
  });

  it('attaches and clears a picture, shown on the face only once the card is flipped', async () => {
    const { controller, getImages, get } = makeController();
    await controller.load();
    await controller.pickPicture(3);
    expect(getImages()).toEqual({ raven: '/worlds/w/raven.webp' });
    expect(controller.view.slots?.[3].image).toBe('/worlds/w/raven.webp');
    expect(get().slots[3].stage).toBe('empty');
    await controller.clearPicture(3);
    expect(getImages()).toEqual({});
  });

  it('does not lock the table while a picture picker is open or was closed without a pick', async () => {
    const { controller, deps, get } = makeController();
    await controller.load();
    (deps.pickImage as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise(() => {})
    );
    void controller.pickPicture(3);
    expect(controller.view.busy).toBe(false);
    await controller.place();
    expect(get().slots[0].stage).toBe('placed');
  });

  it('reports a missing backend as an error, not a crash', async () => {
    const { controller, request } = makeController();
    request.mockImplementationOnce(async () => {
      throw new Error('The AI Tool bridge is not connected');
    });
    await controller.load();
    expect(controller.view.status).toBe('error');
    expect(controller.view.error).toContain('not connected');
  });
});
