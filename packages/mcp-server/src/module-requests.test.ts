/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/explicit-function-return-type -- fakes that mimic async calls */
import { describe, expect, it, vi } from 'vitest';
import {
  AI_CHANGES_UPDATED_QUERY,
  MODULE_PLANNERS,
  createAiChangesAnnouncer,
  createModuleRequestHandler,
  requesterLabel,
} from './module-requests.js';

const danni = { userId: 'u1', userName: 'Danni' };

function makeHandler(planFeature = 'handouts') {
  const list = vi.fn(async () => ({ changes: [] }));
  const plan = vi.fn(async () => ({ planId: 'plan-1', feature: planFeature }));
  const listPages = vi.fn(async () => ({ pages: [], queue: [] }));
  const apply = vi.fn(async () => ({ applied: true }));
  const handleUndoChange = vi.fn(async () => ({ mode: 'undo' }));
  const handleApplyPlannedChange = vi.fn(async () => ({ changeId: 'chg-1' }));
  const tarokkaPlan = vi.fn(async () => ({ planId: 'plan-tarokka' }));
  const readTarokka = vi.fn(async () => ({ available: false }));
  const listChanges = vi.fn(async () => ({ changes: [] }));
  const planUndo = vi.fn(async () => ({ planId: 'plan-undo' }));
  const revealed = new Set<string>();
  const tarokkaPositionRevealed = vi.fn(async (position: string) => revealed.has(position));
  const getPlan = vi.fn((planId: string) => {
    if (planId === 'plan-1' || planId === 'plan-2') return { planId, feature: planFeature };
    if (planId === 'plan-tarokka') return { planId, feature: 'tarokka' };
    if (planId === 'plan-undo') return { planId, feature: 'change-undo' };
    throw new Error(`No pending plan ${planId} (plans expire after 15 minutes)`);
  });
  const handler = createModuleRequestHandler({
    toolRouter: {
      'list-recent-changes': list,
      'list-revealed-pages': listPages,
      'plan-page-reveal': plan,
      'apply-planned-change': apply,
      'plan-tarokka-reveal': tarokkaPlan,
      'get-tarokka-reading': readTarokka,
      'list-changes': listChanges,
      'plan-undo-changes': planUndo,
      'plan-tarokka-links': vi.fn(async () => ({ planId: 'plan-links' })),
      'plan-tarokka-import': vi.fn(async () => ({ planId: 'plan-import' })),
    },
    guardedChangeTools: { handleUndoChange, handleApplyPlannedChange } as never,
    guardedWrites: { getPlan } as never,
    tarokkaPositionRevealed,
  });
  return {
    handler,
    list,
    listPages,
    plan,
    apply,
    handleUndoChange,
    handleApplyPlannedChange,
    getPlan,
    tarokkaPlan,
    readTarokka,
    listChanges,
    planUndo,
    revealed,
    tarokkaPositionRevealed,
  };
}

describe('createModuleRequestHandler', () => {
  it('routes a read through the tool router', async () => {
    const { handler, list, listPages } = makeHandler();
    await expect(handler('list-recent-changes', { limit: 5 }, danni)).resolves.toEqual({
      changes: [],
    });
    expect(list).toHaveBeenCalledWith({ limit: 5 });
    await handler('list-revealed-pages', {}, danni);
    expect(listPages).toHaveBeenCalledWith({});
  });

  it('runs an undo with the name of the GM who asked, so the audit entry records it', async () => {
    const { handler, handleUndoChange } = makeHandler();
    await handler('undo-change', { changeId: 'c1', confirm: true }, danni);
    expect(handleUndoChange).toHaveBeenCalledWith({ changeId: 'c1', confirm: true }, 'Danni');
  });

  it('refuses a tool that is not on the module-request list, even when the router has it', async () => {
    const { handler } = makeHandler();
    for (const tool of ['plan-tarokka-links', 'plan-tarokka-import']) {
      await expect(handler(tool, { position: 'tome' }, danni)).rejects.toThrow(
        /not allowed for module requests/
      );
    }
    await expect(handler('toString', {}, danni)).rejects.toThrow(/not allowed/);
  });

  describe('the Tarokka window', () => {
    it('reads the reading through the router', async () => {
      const { handler, readTarokka } = makeHandler();
      await expect(handler('get-tarokka-reading', {}, danni)).resolves.toEqual({
        available: false,
      });
      expect(readTarokka).toHaveBeenCalledWith({});
    });

    it('plans a reveal with the arguments it is given (it changes nothing until applied)', async () => {
      const { handler, tarokkaPlan } = makeHandler();
      await handler(
        'plan-tarokka-reveal',
        { position: 'tome', text: 'Made-up words', title: 'T', showNow: true },
        danni
      );
      expect(tarokkaPlan).toHaveBeenCalledWith({
        position: 'tome',
        text: 'Made-up words',
        title: 'T',
        showNow: true,
      });
    });

    it('refuses to plan a position that is already revealed, and plans an unrevealed one', async () => {
      const { handler, tarokkaPlan, revealed, tarokkaPositionRevealed } = makeHandler();
      revealed.add('tome');
      await expect(
        handler('plan-tarokka-reveal', { position: 'tome', text: 'x' }, danni)
      ).rejects.toThrow(/already revealed; change it from the dashboard or with Claude/);
      expect(tarokkaPlan).not.toHaveBeenCalled();
      expect(tarokkaPositionRevealed).toHaveBeenCalledWith('tome');
      await handler('plan-tarokka-reveal', { position: 'ally', text: 'x' }, danni);
      expect(tarokkaPlan).toHaveBeenCalledTimes(1);
    });

    it('leaves a bad position to the planner (no revealed lookup for a non-text one)', async () => {
      const { handler, tarokkaPlan, tarokkaPositionRevealed } = makeHandler();
      await handler('plan-tarokka-reveal', { position: 5, text: 'x' }, danni);
      expect(tarokkaPositionRevealed).not.toHaveBeenCalled();
      expect(tarokkaPlan).toHaveBeenCalledTimes(1);
    });

    it('applies the Tarokka plan it made, with the GM named and only the allowed arguments', async () => {
      const { handler, handleApplyPlannedChange } = makeHandler();
      await handler('plan-tarokka-reveal', { position: 'tome', text: 'x' }, danni);
      await handler(
        'apply-planned-change',
        { planId: 'plan-tarokka', confirm: true, confirmDestructive: true, showNow: true },
        danni
      );
      expect(handleApplyPlannedChange).toHaveBeenCalledWith(
        { planId: 'plan-tarokka', confirm: true, confirmDestructive: true },
        'Danni'
      );
    });

    it('refuses to apply a Tarokka plan that Claude or the dashboard made', async () => {
      const { handler, handleApplyPlannedChange } = makeHandler();
      await expect(
        handler('apply-planned-change', { planId: 'plan-tarokka', confirm: true }, danni)
      ).rejects.toThrow(/only apply a plan it made itself/);
      expect(handleApplyPlannedChange).not.toHaveBeenCalled();
    });
  });

  describe('the Changes window', () => {
    it('lists the changes of everyone through the router', async () => {
      const { handler, listChanges } = makeHandler();
      await handler('list-changes', { limit: 20, source: 'ai' }, danni);
      expect(listChanges).toHaveBeenCalledWith({ limit: 20, source: 'ai' });
    });

    it('plans an undo in any scope and applies the plan it made, with the GM named', async () => {
      const { handler, planUndo, handleApplyPlannedChange } = makeHandler();
      for (const args of [
        { id: 'act:a1', scope: 'just-this' },
        { id: 'act:a1', scope: 'everything-since' },
        { id: 'act:a1', scope: 'world-since', rewindTable: true },
      ]) {
        await handler('plan-undo-changes', args, danni);
        expect(planUndo).toHaveBeenLastCalledWith(args);
      }
      await handler(
        'apply-planned-change',
        { planId: 'plan-undo', confirm: true, confirmDestructive: true },
        danni
      );
      expect(handleApplyPlannedChange).toHaveBeenCalledWith(
        { planId: 'plan-undo', confirm: true, confirmDestructive: true },
        'Danni'
      );
    });

    it('refuses to apply an undo plan Claude or the dashboard made', async () => {
      const { handler, handleApplyPlannedChange } = makeHandler();
      await expect(
        handler('apply-planned-change', { planId: 'plan-undo', confirm: true }, danni)
      ).rejects.toThrow(/only apply a plan it made itself/);
      expect(handleApplyPlannedChange).not.toHaveBeenCalled();
    });
  });

  describe('plan-page-reveal', () => {
    it.each(['reveal-next', 'unqueue'])('runs the action %s', async action => {
      const { handler, plan } = makeHandler();
      await handler('plan-page-reveal', { action, sceneId: 's1', showNow: true }, danni);
      expect(plan).toHaveBeenCalledWith({ action, sceneId: 's1', showNow: true });
    });

    it.each(['reveal', 'hide', 'queue', 'anything'])('refuses the action %s', async action => {
      const { handler, plan } = makeHandler();
      await expect(
        handler(
          'plan-page-reveal',
          { action, pageUuid: 'JournalEntry.A.JournalEntryPage.B' },
          danni
        )
      ).rejects.toThrow(/only run plan-page-reveal with action "reveal-next" or "unqueue"/);
      expect(plan).not.toHaveBeenCalled();
    });

    it('refuses a missing or non-text action', async () => {
      const { handler, plan } = makeHandler();
      await expect(handler('plan-page-reveal', {}, danni)).rejects.toThrow(/only run/);
      await expect(handler('plan-page-reveal', { action: ['reveal-next'] }, danni)).rejects.toThrow(
        /only run/
      );
      expect(plan).not.toHaveBeenCalled();
    });
  });

  describe('apply-planned-change', () => {
    it('applies a plan a module request made through an allowed planner, with the GM named', async () => {
      const { handler, handleApplyPlannedChange } = makeHandler();
      await handler('plan-page-reveal', { action: 'reveal-next' }, danni);
      await handler(
        'apply-planned-change',
        { planId: 'plan-1', confirm: true, confirmDestructive: true, extra: 'dropped' },
        danni
      );
      expect(handleApplyPlannedChange).toHaveBeenCalledWith(
        { planId: 'plan-1', confirm: true, confirmDestructive: true },
        'Danni'
      );
    });

    it('refuses a plan nobody asked a module planner for (made by Claude or the dashboard)', async () => {
      const { handler, handleApplyPlannedChange } = makeHandler();
      await expect(
        handler('apply-planned-change', { planId: 'plan-2', confirm: true }, danni)
      ).rejects.toThrow(/only apply a plan it made itself/);
      expect(handleApplyPlannedChange).not.toHaveBeenCalled();
    });

    it('refuses a plan of another feature, even one a module request planned', async () => {
      const { handler, handleApplyPlannedChange } = makeHandler('live-play');
      await handler('plan-page-reveal', { action: 'reveal-next' }, danni);
      await expect(
        handler('apply-planned-change', { planId: 'plan-1', confirm: true }, danni)
      ).rejects.toThrow(/only apply a plan it made itself/);
      expect(handleApplyPlannedChange).not.toHaveBeenCalled();
    });

    it('refuses an unknown or expired plan with the guarded-write error', async () => {
      const { handler, handleApplyPlannedChange } = makeHandler();
      await expect(
        handler('apply-planned-change', { planId: 'nope', confirm: true }, danni)
      ).rejects.toThrow(/No pending plan nope/);
      expect(handleApplyPlannedChange).not.toHaveBeenCalled();
    });

    it('refuses a missing or non-text plan id', async () => {
      const { handler, handleApplyPlannedChange } = makeHandler();
      await expect(handler('apply-planned-change', { confirm: true }, danni)).rejects.toThrow(
        /needs a planId/
      );
      await expect(handler('apply-planned-change', { planId: 5 }, danni)).rejects.toThrow(
        /needs a planId/
      );
      expect(handleApplyPlannedChange).not.toHaveBeenCalled();
    });

    it('remembers no plan from an answer without a plan id (an unqueue)', async () => {
      const { handler, plan, handleApplyPlannedChange } = makeHandler();
      plan.mockResolvedValueOnce({ queued: false } as never);
      await handler('plan-page-reveal', { action: 'unqueue', pageUuid: 'x' }, danni);
      await expect(handler('apply-planned-change', { planId: 'plan-2' }, danni)).rejects.toThrow(
        /only apply a plan it made itself/
      );
      expect(handleApplyPlannedChange).not.toHaveBeenCalled();
    });
  });
});

describe('MODULE_PLANNERS', () => {
  it('lists the planners a module request may use, each with its feature and actions', () => {
    expect(MODULE_PLANNERS).toEqual({
      'plan-page-reveal': { feature: 'handouts', actions: ['reveal-next', 'unqueue'] },
      'plan-tarokka-reveal': { feature: 'tarokka' },
      'plan-undo-changes': { feature: 'change-undo' },
    });
  });
});

describe('requesterLabel', () => {
  it('prefers the name and falls back to the id', () => {
    expect(requesterLabel(danni)).toBe('Danni');
    expect(requesterLabel({ userId: 'u2', userName: '' })).toBe('u2');
  });
});

describe('createAiChangesAnnouncer', () => {
  it('asks the module to announce, without waiting for it', () => {
    let finish: (value: unknown) => void = () => undefined;
    const query = vi.fn(() => new Promise(resolve => (finish = resolve)));
    const logger = { debug: vi.fn() };
    const result = createAiChangesAnnouncer(
      { query, activeModuleHasCapability: () => true },
      logger
    )('world', 'chg-1');
    expect(result).toBeUndefined(); // the recorded hook never waits for the module
    expect(query).toHaveBeenCalledWith(
      AI_CHANGES_UPDATED_QUERY,
      {},
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    );
    finish({ announced: true });
  });

  it('does not ask a module that does not list the signal capability (older than I-108)', () => {
    const query = vi.fn(async () => ({}));
    const has = vi.fn(() => false);
    const announce = createAiChangesAnnouncer(
      { query, activeModuleHasCapability: has },
      { debug: vi.fn() }
    );
    announce();
    expect(has).toHaveBeenCalledWith('ai-changes-signal');
    expect(query).not.toHaveBeenCalled();
    has.mockReturnValue(true);
    announce();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('logs and swallows a failure (Foundry disconnected, or an older module)', async () => {
    const query = vi.fn(async () => {
      throw new Error('Foundry VTT module not connected');
    });
    const logger = { debug: vi.fn() };
    expect(() =>
      createAiChangesAnnouncer({ query, activeModuleHasCapability: () => true }, logger)(
        'world',
        'chg-1'
      )
    ).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(logger.debug).toHaveBeenCalledWith(
      'Could not announce the recorded change to the module',
      { error: 'Foundry VTT module not connected' }
    );
  });
});
