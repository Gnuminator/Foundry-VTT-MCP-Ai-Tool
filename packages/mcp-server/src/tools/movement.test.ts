import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MovementTools } from './movement.js';

/**
 * Template for chunk-4 tool tests: a tool class is a thin, deterministic layer
 * over `FoundryClient.query` — validate args → dispatch the right
 * `foundry-mcp-bridge.*` method → propagate a foundry-side failure → shape the
 * result. We mock the client so the layer is tested in isolation (no bridge),
 * which is the whole reason the Node-side tool layer is the safe rewrite target.
 */

function makeTools(queryImpl?: (method: string, data: unknown) => unknown) {
  const query = vi.fn(queryImpl ?? (() => ({ success: true })));
  const foundryClient = { query } as any;
  // Minimal Logger stub: `.child()` returns itself; level methods are no-ops.
  const logger: any = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
  logger.child = () => logger;
  return { tools: new MovementTools({ foundryClient, logger }), query };
}

describe('MovementTools.getToolDefinitions', () => {
  it('exposes the three movement tools with object input schemas', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual([
      'get-token-positions',
      'measure-distance',
      'get-targets',
    ]);
    for (const d of defs) {
      expect(d.inputSchema.type).toBe('object');
    }
    // measure-distance requires both token names.
    const measure = defs.find(d => d.name === 'measure-distance')!;
    expect((measure.inputSchema as any).required).toEqual(['fromTokenName', 'toTokenName']);
  });
});

describe('MovementTools.handleGetTokenPositions', () => {
  it('dispatches the correct query method and returns the response', async () => {
    const payload = { success: true, tokens: [{ name: 'Goblin' }] };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleGetTokenPositions({ sceneId: 'scene-1' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getTokenPositions', {
      sceneId: 'scene-1',
    });
    expect(result).toBe(payload);
  });

  it('defaults to no sceneId when args are omitted', async () => {
    const { tools, query } = makeTools();
    await tools.handleGetTokenPositions(undefined);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getTokenPositions', {});
  });

  it('throws when Foundry reports a failure', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'no scene' }));
    await expect(tools.handleGetTokenPositions({})).rejects.toThrow('no scene');
  });
});

describe('MovementTools.handleMeasureDistance', () => {
  it('dispatches with both token names', async () => {
    const { tools, query } = makeTools(() => ({ success: true, distance: 30 }));
    await tools.handleMeasureDistance({ fromTokenName: 'A', toTokenName: 'B' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.measureDistance', {
      fromTokenName: 'A',
      toTokenName: 'B',
    });
  });

  it('returns a parameter-error string (not a throw) on invalid args', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleMeasureDistance({ fromTokenName: 'A' }); // missing toTokenName
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('throws when Foundry reports a failure', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'token not found' }));
    await expect(
      tools.handleMeasureDistance({ fromTokenName: 'A', toTokenName: 'B' })
    ).rejects.toThrow('token not found');
  });
});

describe('MovementTools.handleGetTargets', () => {
  let consoleErr: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('dispatches getTargets and returns the response', async () => {
    const payload = { success: true, targets: [] };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleGetTargets({});
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getTargets', {});
    expect(result).toBe(payload);
    consoleErr.mockRestore();
  });

  it('throws when Foundry reports a failure', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'no targets' }));
    await expect(tools.handleGetTargets({})).rejects.toThrow('no targets');
    consoleErr.mockRestore();
  });
});
