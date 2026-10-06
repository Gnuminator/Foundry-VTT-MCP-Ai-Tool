import { describe, expect, it, vi } from 'vitest';

import { PlayerViewTools } from './player-view.js';

function makeTools(): {
  tools: PlayerViewTools;
  handouts: Record<string, ReturnType<typeof vi.fn>>;
  secretTerms: Record<string, ReturnType<typeof vi.fn>>;
  foundryClient: { query: ReturnType<typeof vi.fn> };
  worldIds: { current: ReturnType<typeof vi.fn> };
} {
  const handouts = {
    listRevealed: vi.fn(() => Promise.resolve([])),
    listQueue: vi.fn(() => Promise.resolve([])),
    queuePage: vi.fn(() => Promise.resolve({ queued: true, pageUuid: 'x', note: '' })),
    unqueuePage: vi.fn(() => Promise.resolve({ queued: false, pageUuid: 'x', note: '' })),
    playerHandouts: vi.fn(() => Promise.resolve({ handouts: [], revealedUuids: [] })),
    planPageReveal: vi.fn(() => Promise.resolve({ planId: 'p1', pageUuid: 'x' })),
  };
  const secretTerms = {
    findSecretTerms: vi.fn(() => Promise.resolve({ matches: [] })),
  };
  const foundryClient = { query: vi.fn(() => Promise.resolve({ schema: 1 })) };
  const worldIds = { current: vi.fn(() => Promise.resolve('curse-of-strahd')) };
  const logger: any = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  logger.child = (): unknown => logger;
  const tools = new PlayerViewTools({
    handouts: handouts as never,
    secretTerms: secretTerms as never,
    foundryClient: foundryClient as never,
    worldIds: worldIds as never,
    logger,
  });
  return { tools, handouts, secretTerms, foundryClient, worldIds };
}

describe('PlayerViewTools', () => {
  it('defines five tools, all read-only except plan-page-reveal', () => {
    const defs = makeTools().tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual([
      'get-player-visibility',
      'list-revealed-pages',
      'get-player-handouts',
      'plan-page-reveal',
      'check-secret-terms',
    ]);
    for (const d of defs) expect(d.inputSchema.type).toBe('object');
    // pageUuid is checked in the handler: "reveal-next" takes the next queued page (I-039).
    expect(defs[3].inputSchema.required).toEqual(['action']);
    expect(defs[4].inputSchema.required).toEqual(['text']);
  });

  it('get-player-visibility queries the module method with the prefixed name', async () => {
    const { tools, foundryClient } = makeTools();
    foundryClient.query.mockResolvedValueOnce({
      schema: 1,
      computedAt: 1,
      pcActorIds: [],
      scene: null,
      tokens: [],
    });
    const result = await tools.handleGetPlayerVisibility({});
    expect(foundryClient.query).toHaveBeenCalledWith('foundry-mcp-bridge.getPlayerVisibility', {});
    expect(result).toMatchObject({ schema: 1 });
  });

  it('get-player-visibility throws on a refused query', async () => {
    const { tools, foundryClient } = makeTools();
    foundryClient.query.mockResolvedValueOnce({ success: false, error: 'not GM' });
    await expect(tools.handleGetPlayerVisibility({})).rejects.toThrow('not GM');
  });

  it('list-revealed-pages wraps the service result', async () => {
    const { tools, handouts } = makeTools();
    handouts.listRevealed.mockResolvedValueOnce([{ pageId: 'p', uuid: 'u' }]);
    handouts.listQueue.mockResolvedValueOnce([{ entryId: 'q', uuid: 'v' }]);
    expect(await tools.handleListRevealedPages({})).toEqual({
      pages: [{ pageId: 'p', uuid: 'u' }],
      queue: [{ entryId: 'q', uuid: 'v' }],
    });
  });

  it('plan-page-reveal needs pageUuid except for reveal-next, and forwards players and sceneId', async () => {
    const { tools, handouts } = makeTools();
    await expect(tools.handlePlanPageReveal({ action: 'queue' })).rejects.toThrow(/pageUuid/);
    await tools.handlePlanPageReveal({ action: 'reveal-next', sceneId: 'abcdefghijklmnop' });
    expect(handouts.planPageReveal).toHaveBeenLastCalledWith({
      action: 'reveal-next',
      sceneId: 'abcdefghijklmnop',
    });
    await tools.handlePlanPageReveal({ pageUuid: 'x', action: 'queue', players: ['u1'] });
    expect(handouts.queuePage).toHaveBeenLastCalledWith({ pageUuid: 'x', players: ['u1'] });
    await tools.handlePlanPageReveal({ pageUuid: 'x', action: 'unqueue' });
    expect(handouts.unqueuePage).toHaveBeenLastCalledWith({ pageUuid: 'x' });
  });

  it('get-player-handouts forwards the service result as is', async () => {
    const { tools, handouts } = makeTools();
    const view = {
      handouts: [{ id: 'p', uuid: 'u', title: 't', html: '<p>x</p>', revealedAt: 'a' }],
      revealedUuids: ['u'],
    };
    handouts.playerHandouts.mockResolvedValueOnce(view);
    expect(await tools.handleGetPlayerHandouts({})).toEqual(view);
  });

  it('plan-page-reveal validates and forwards arguments', async () => {
    const { tools, handouts } = makeTools();
    await tools.handlePlanPageReveal({
      pageUuid: 'JournalEntry.a.JournalEntryPage.b',
      action: 'reveal',
      setOwnership: false,
    });
    expect(handouts.planPageReveal).toHaveBeenLastCalledWith({
      pageUuid: 'JournalEntry.a.JournalEntryPage.b',
      action: 'reveal',
      setOwnership: false,
    });

    await tools.handlePlanPageReveal({ pageUuid: 'x', action: 'hide' });
    expect(handouts.planPageReveal).toHaveBeenLastCalledWith({ pageUuid: 'x', action: 'hide' });

    await expect(tools.handlePlanPageReveal({ pageUuid: 'x', action: 'delete' })).rejects.toThrow();
    await expect(tools.handlePlanPageReveal({ action: 'hide' })).rejects.toThrow();
  });

  it('plan-page-reveal takes an optional showNow flag, forwards it, and refuses it for queueing', async () => {
    const { tools, handouts } = makeTools();
    const schema = tools.getToolDefinitions().find(d => d.name === 'plan-page-reveal')!;
    expect(schema.inputSchema.properties.showNow).toMatchObject({ type: 'boolean' });
    expect(schema.inputSchema.required).not.toContain('showNow');

    await tools.handlePlanPageReveal({ pageUuid: 'x', action: 'reveal', showNow: true });
    expect(handouts.planPageReveal).toHaveBeenLastCalledWith({
      pageUuid: 'x',
      action: 'reveal',
      showNow: true,
    });
    await tools.handlePlanPageReveal({ action: 'reveal-next', showNow: true });
    expect(handouts.planPageReveal).toHaveBeenLastCalledWith({
      action: 'reveal-next',
      showNow: true,
    });
    await expect(
      tools.handlePlanPageReveal({ pageUuid: 'x', action: 'reveal', showNow: 'yes' })
    ).rejects.toThrow();
    await expect(
      tools.handlePlanPageReveal({ pageUuid: 'x', action: 'queue', showNow: true })
    ).rejects.toThrow(/showNow only goes with a reveal/);
  });

  it('plan-page-reveal takes an optional copy flag and forwards it only when given', async () => {
    const { tools, handouts } = makeTools();
    const schema = tools.getToolDefinitions().find(d => d.name === 'plan-page-reveal')!;
    expect(schema.inputSchema.properties.copy).toMatchObject({ type: 'boolean' });
    expect(schema.inputSchema.required).not.toContain('copy');

    for (const copy of [true, false]) {
      await tools.handlePlanPageReveal({ pageUuid: 'x', action: 'reveal', copy });
      expect(handouts.planPageReveal).toHaveBeenLastCalledWith({
        pageUuid: 'x',
        action: 'reveal',
        copy,
      });
    }
    await tools.handlePlanPageReveal({ pageUuid: 'x', action: 'reveal' });
    expect(handouts.planPageReveal).toHaveBeenLastCalledWith({ pageUuid: 'x', action: 'reveal' });
    await expect(
      tools.handlePlanPageReveal({ pageUuid: 'x', action: 'reveal', copy: 'yes' })
    ).rejects.toThrow();
  });

  it('plan-page-reveal logs and rethrows a refused plan', async () => {
    const { tools, handouts } = makeTools();
    handouts.planPageReveal.mockRejectedValueOnce(new Error('already revealed'));
    await expect(tools.handlePlanPageReveal({ pageUuid: 'x', action: 'reveal' })).rejects.toThrow(
      'already revealed'
    );
  });

  it('check-secret-terms resolves the current world and forwards the text', async () => {
    const { tools, secretTerms, worldIds } = makeTools();
    secretTerms.findSecretTerms.mockResolvedValueOnce({
      matches: [{ category: 'tarokka-card', term: 'Raven' }],
    });
    const result = await tools.handleCheckSecretTerms({ text: 'A raven watches.' });
    expect(worldIds.current).toHaveBeenCalled();
    expect(secretTerms.findSecretTerms).toHaveBeenCalledWith('curse-of-strahd', 'A raven watches.');
    expect(result).toEqual({ matches: [{ category: 'tarokka-card', term: 'Raven' }] });
  });

  it('check-secret-terms rejects empty text', async () => {
    const { tools } = makeTools();
    await expect(tools.handleCheckSecretTerms({ text: '' })).rejects.toThrow();
    await expect(tools.handleCheckSecretTerms({})).rejects.toThrow();
  });
});
