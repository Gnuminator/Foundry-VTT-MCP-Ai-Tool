import { describe, expect, it, vi } from 'vitest';

import { SessionLogTools } from './session-log.js';

/**
 * SessionLogTools — thin dispatch layer over FoundryClient.query.
 * Validation is done via Zod (parse throws on bad input — there is no
 * "return a string" path here, unlike MovementTools.handleMeasureDistance).
 * Foundry-side failures ({success:false}) are surfaced as thrown Errors.
 */

function makeTools(queryImpl?: (method: string, data: unknown) => unknown) {
  const query = vi.fn(queryImpl ?? (() => ({ success: true })));
  const foundryClient = { query } as any;
  const logger: any = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
  logger.child = () => logger;
  return { tools: new SessionLogTools({ foundryClient, logger }), query, logger };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

describe('SessionLogTools.getToolDefinitions', () => {
  it('exposes exactly two tools with object input schemas', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual(['get-session-log', 'get-recent-events']);
    for (const d of defs) {
      expect(d.inputSchema.type).toBe('object');
    }
  });

  it('get-session-log has no required fields', () => {
    const { tools } = makeTools();
    const def = tools.getToolDefinitions().find(d => d.name === 'get-session-log')!;
    expect((def.inputSchema as any).required).toBeUndefined();
  });

  it('get-recent-events has no required fields', () => {
    const { tools } = makeTools();
    const def = tools.getToolDefinitions().find(d => d.name === 'get-recent-events')!;
    expect((def.inputSchema as any).required).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// handleGetSessionLog
// ---------------------------------------------------------------------------

describe('SessionLogTools.handleGetSessionLog', () => {
  it('dispatches foundry-mcp-bridge.getSessionLog with no params when called with undefined', async () => {
    const { tools, query } = makeTools();
    await tools.handleGetSessionLog(undefined);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getSessionLog', {});
  });

  it('dispatches with provided params', async () => {
    const { tools, query } = makeTools();
    await tools.handleGetSessionLog({ limit: 50, eventType: 'damage', actorName: 'Frodo' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getSessionLog', {
      limit: 50,
      eventType: 'damage',
      actorName: 'Frodo',
    });
  });

  it('returns the query response on success', async () => {
    const payload = { success: true, events: [{ type: 'combat-start' }] };
    const { tools } = makeTools(() => payload);
    const result = await tools.handleGetSessionLog({});
    expect(result).toBe(payload);
  });

  it('throws when Foundry reports {success:false}', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'module not ready' }));
    await expect(tools.handleGetSessionLog({})).rejects.toThrow('module not ready');
  });

  it('uses fallback message when Foundry failure has no error string', async () => {
    const { tools } = makeTools(() => ({ success: false }));
    await expect(tools.handleGetSessionLog({})).rejects.toThrow('Failed to get session log');
  });

  it('throws (not returns string) when Zod validation fails, and does not call query', async () => {
    const { tools, query } = makeTools();
    // limit must be an integer — pass a non-number to trigger Zod error
    await expect(tools.handleGetSessionLog({ limit: 'bad' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('logs the error before rethrowing on Foundry failure', async () => {
    const { tools, logger } = makeTools(() => ({ success: false, error: 'oops' }));
    await expect(tools.handleGetSessionLog({})).rejects.toThrow('oops');
    expect(logger.error).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleGetRecentEvents
// ---------------------------------------------------------------------------

describe('SessionLogTools.handleGetRecentEvents', () => {
  it('dispatches foundry-mcp-bridge.getRecentEvents with no params when called with undefined', async () => {
    const { tools, query } = makeTools();
    await tools.handleGetRecentEvents(undefined);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getRecentEvents', {});
  });

  it('dispatches with provided params', async () => {
    const { tools, query } = makeTools();
    const args = { sinceTimestamp: '2024-01-01T00:00:00Z', limit: 20, eventType: 'healing' };
    await tools.handleGetRecentEvents(args);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getRecentEvents', args);
  });

  it('returns the query response on success', async () => {
    const payload = { success: true, events: [], latestTimestamp: '2024-06-15T12:00:00Z' };
    const { tools } = makeTools(() => payload);
    const result = await tools.handleGetRecentEvents({});
    expect(result).toBe(payload);
  });

  it('throws when Foundry reports {success:false}', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'no events available' }));
    await expect(tools.handleGetRecentEvents({})).rejects.toThrow('no events available');
  });

  it('uses fallback message when Foundry failure has no error string', async () => {
    const { tools } = makeTools(() => ({ success: false }));
    await expect(tools.handleGetRecentEvents({})).rejects.toThrow('Failed to get recent events');
  });

  it('throws (not returns string) when Zod validation fails, and does not call query', async () => {
    const { tools, query } = makeTools();
    // limit must be integer >= 1 — pass 0 to trigger Zod min error
    await expect(tools.handleGetRecentEvents({ limit: 0 })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('logs the error before rethrowing on Foundry failure', async () => {
    const { tools, logger } = makeTools(() => ({ success: false, error: 'bridge down' }));
    await expect(tools.handleGetRecentEvents({})).rejects.toThrow('bridge down');
    expect(logger.error).toHaveBeenCalled();
  });
});
