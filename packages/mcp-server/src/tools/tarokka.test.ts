import { describe, expect, it, vi } from 'vitest';

import { TarokkaTools } from './tarokka.js';

function makeTools(): { tools: TarokkaTools; tarokka: Record<string, ReturnType<typeof vi.fn>> } {
  const tarokka = {
    getReading: vi.fn(() => Promise.resolve({ available: false })),
    planImport: vi.fn(() => Promise.resolve({ planId: 'p1' })),
    planLinks: vi.fn(() => Promise.resolve({ planId: 'p2' })),
    planReveal: vi.fn(() => Promise.resolve({ planId: 'p3' })),
    suggestLinks: vi.fn(() => Promise.resolve({ candidates: [] })),
  };
  const logger: any = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  logger.child = (): unknown => logger;
  return { tools: new TarokkaTools({ tarokka: tarokka as never, logger }), tarokka };
}

describe('TarokkaTools', () => {
  it('defines five read-only (get-/plan-/suggest-) tools', () => {
    const defs = makeTools().tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual([
      'get-tarokka-reading',
      'plan-tarokka-import',
      'suggest-tarokka-links',
      'plan-tarokka-links',
      'plan-tarokka-reveal',
    ]);
    for (const d of defs) {
      expect(d.inputSchema.type).toBe('object');
      expect(d.name).toMatch(/^(get|plan|suggest)-/);
    }
    expect(defs[4].inputSchema.required).toEqual(['position', 'text']);
  });

  it('validates and forwards arguments', async () => {
    const { tools, tarokka } = makeTools();
    await tools.handleGetTarokkaReading({});
    expect(tarokka.getReading).toHaveBeenCalled();

    await tools.handlePlanTarokkaImport({ source: 'builtin-roll' });
    expect(tarokka.planImport).toHaveBeenLastCalledWith({ source: 'builtin-roll' });
    await tools.handlePlanTarokkaImport(undefined);
    expect(tarokka.planImport).toHaveBeenLastCalledWith({});
    await expect(tools.handlePlanTarokkaImport({ source: 'dice' })).rejects.toThrow();

    await tools.handlePlanTarokkaLinks({ position: 'ally', cardId: 'raven', clear: true });
    expect(tarokka.planLinks).toHaveBeenLastCalledWith({
      position: 'ally',
      cardId: 'raven',
      clear: true,
    });
    await expect(tools.handlePlanTarokkaLinks({ position: 'moon' })).rejects.toThrow();

    await tools.handlePlanTarokkaReveal({ position: 'tome', text: 'Hi', title: 'T' });
    expect(tarokka.planReveal).toHaveBeenLastCalledWith({
      position: 'tome',
      text: 'Hi',
      title: 'T',
    });
    await expect(tools.handlePlanTarokkaReveal({ position: 'tome', text: '' })).rejects.toThrow();
    await tools.handlePlanTarokkaReveal({ position: 'tome', text: 'Hi', showNow: true });
    expect(tarokka.planReveal).toHaveBeenLastCalledWith({
      position: 'tome',
      text: 'Hi',
      showNow: true,
    });
    await expect(
      tools.handlePlanTarokkaReveal({ position: 'tome', text: 'Hi', showNow: 'yes' })
    ).rejects.toThrow();

    await tools.handleSuggestTarokkaLinks({ query: 'vallaki', limit: 3 });
    expect(tarokka.suggestLinks).toHaveBeenLastCalledWith('vallaki', 3);
    await expect(tools.handleSuggestTarokkaLinks({ query: 'v' })).rejects.toThrow();
  });

  it('logs and rethrows a refused plan', async () => {
    const { tools, tarokka } = makeTools();
    tarokka.planImport.mockRejectedValueOnce(new Error('No reading'));
    await expect(tools.handlePlanTarokkaImport({})).rejects.toThrow('No reading');
  });
});
