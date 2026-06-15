import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DiagnosticsTools } from './diagnostics.js';

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
  return { tools: new DiagnosticsTools({ foundryClient, logger }), query, logger };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

describe('DiagnosticsTools.getToolDefinitions', () => {
  it('exposes four diagnostics tools with object input schemas', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual([
      'get-modules',
      'get-module-errors',
      'clear-module-errors',
      'get-module-manifest',
    ]);
    for (const d of defs) {
      expect(d.inputSchema.type).toBe('object');
    }
  });

  it('only get-module-manifest has required fields', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();

    const getModules = defs.find(d => d.name === 'get-modules')!;
    expect((getModules.inputSchema as any).required).toBeUndefined();

    const getModuleErrors = defs.find(d => d.name === 'get-module-errors')!;
    expect((getModuleErrors.inputSchema as any).required).toBeUndefined();

    const clearModuleErrors = defs.find(d => d.name === 'clear-module-errors')!;
    expect((clearModuleErrors.inputSchema as any).required).toBeUndefined();

    const getModuleManifest = defs.find(d => d.name === 'get-module-manifest')!;
    expect((getModuleManifest.inputSchema as any).required).toEqual(['moduleId']);
  });
});

// ---------------------------------------------------------------------------
// handleGetModules
// ---------------------------------------------------------------------------

describe('DiagnosticsTools.handleGetModules', () => {
  it('dispatches the correct query method and returns the response', async () => {
    const payload = { success: true, modules: [] };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleGetModules({});
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getModules', {});
    expect(result).toBe(payload);
  });

  it('passes activeOnly and withIssuesOnly through to the query', async () => {
    const { tools, query } = makeTools(() => ({ success: true }));
    await tools.handleGetModules({ activeOnly: true, withIssuesOnly: false });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getModules', {
      activeOnly: true,
      withIssuesOnly: false,
    });
  });

  it('defaults to empty object when args are omitted', async () => {
    const { tools, query } = makeTools();
    await tools.handleGetModules(undefined);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getModules', {});
  });

  it('throws when Foundry reports a failure', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'bridge unavailable' }));
    await expect(tools.handleGetModules({})).rejects.toThrow('bridge unavailable');
  });

  it('throws (not string) on invalid args and does not call query', async () => {
    const { tools, query } = makeTools();
    // activeOnly must be boolean; passing a string triggers a ZodError
    await expect(tools.handleGetModules({ activeOnly: 'yes' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleGetModuleErrors
// ---------------------------------------------------------------------------

describe('DiagnosticsTools.handleGetModuleErrors', () => {
  it('dispatches the correct query method and returns the response', async () => {
    const payload = { success: true, errors: [] };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleGetModuleErrors({});
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getModuleErrors', {});
    expect(result).toBe(payload);
  });

  it('passes all optional filter fields through to the query', async () => {
    const { tools, query } = makeTools(() => ({ success: true }));
    await tools.handleGetModuleErrors({
      level: 'error',
      moduleId: 'lib-wrapper',
      sinceTimestamp: '2024-01-01T00:00:00Z',
      limit: 50,
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getModuleErrors', {
      level: 'error',
      moduleId: 'lib-wrapper',
      sinceTimestamp: '2024-01-01T00:00:00Z',
      limit: 50,
    });
  });

  it('defaults to empty object when args are omitted', async () => {
    const { tools, query } = makeTools();
    await tools.handleGetModuleErrors(undefined);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getModuleErrors', {});
  });

  it('throws when Foundry reports a failure', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'no diagnostics buffer' }));
    await expect(tools.handleGetModuleErrors({})).rejects.toThrow('no diagnostics buffer');
  });

  it('throws (not string) on invalid args and does not call query', async () => {
    const { tools, query } = makeTools();
    // level must be 'error' | 'warn'; passing an invalid value triggers a ZodError
    await expect(tools.handleGetModuleErrors({ level: 'info' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleClearModuleErrors
// ---------------------------------------------------------------------------

describe('DiagnosticsTools.handleClearModuleErrors', () => {
  it('dispatches clearModuleErrors with an empty params object', async () => {
    const payload = { success: true };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleClearModuleErrors({});
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.clearModuleErrors', {});
    expect(result).toBe(payload);
  });

  it('ignores any args passed and still sends empty params', async () => {
    const { tools, query } = makeTools(() => ({ success: true }));
    await tools.handleClearModuleErrors({ anything: 'ignored' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.clearModuleErrors', {});
  });

  it('throws when Foundry reports a failure', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'clear failed' }));
    await expect(tools.handleClearModuleErrors({})).rejects.toThrow('clear failed');
  });
});

// ---------------------------------------------------------------------------
// handleGetModuleManifest
// ---------------------------------------------------------------------------

describe('DiagnosticsTools.handleGetModuleManifest', () => {
  let consoleErr: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('dispatches the correct query method and returns the response', async () => {
    const payload = { success: true, manifest: { id: 'lib-wrapper', version: '1.0.0' } };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleGetModuleManifest({ moduleId: 'lib-wrapper' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getModuleManifest', {
      moduleId: 'lib-wrapper',
    });
    expect(result).toBe(payload);
    consoleErr.mockRestore();
  });

  it('returns a Parameter-error string (not a throw) when moduleId is missing', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleGetModuleManifest({});
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it('returns a Parameter-error string (not a throw) when args are null/undefined', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleGetModuleManifest(null);
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it('throws (not string) when Foundry reports a failure', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'module not found' }));
    await expect(tools.handleGetModuleManifest({ moduleId: 'unknown-module' })).rejects.toThrow(
      'module not found'
    );
    consoleErr.mockRestore();
  });
});
