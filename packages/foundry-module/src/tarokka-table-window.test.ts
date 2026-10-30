import { describe, expect, it, vi } from 'vitest';
import { emptyTable, parsePublicTable, type PublicTable } from './tarokka-table-model.js';
import { TableController, type TableDeps } from './tarokka-table-window.js';

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
