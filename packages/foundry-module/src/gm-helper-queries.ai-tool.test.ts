/**
 * Tests for the AI Tool relay (I-108): a GM's client asks the GM client that
 * holds the bridge link, through the GM-only `user.query`, which forwards the
 * request over the link. When this client holds the link itself, the query hop
 * is skipped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, makeUser, type TestWorld } from './test-support/foundry-mock/index.js';
import { setBridgeLink } from './bridge-link.js';
import { MODULE_NOT_ACTIVE_LINK_ERROR } from './constants.js';
import {
  AI_TOOL_NOT_CONNECTED,
  GM_HELPER_QUERIES,
  aiToolRequest,
  aiToolTimeoutMs,
  parseAiToolPayload,
  registerGmHelperQueries,
} from './gm-helper-queries.js';

let world: TestWorld;
let restore: () => void;
const g = globalThis as any;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  world = createTestWorld({ foundryVersion: '14.368' });
  restore = world.install();
  g.CONFIG.queries = {};
});

afterEach(() => {
  setBridgeLink(null);
  restore();
  vi.restoreAllMocks();
});

function addUser(opts: Record<string, unknown>): any {
  const user = makeUser(opts);
  world.users.set(user.id, user);
  return user;
}

function fakeLink(connected = true): { isConnected: any; request: any } {
  return {
    isConnected: vi.fn(() => connected),
    request: vi.fn().mockResolvedValue({ changes: [] }),
  };
}

describe('parseAiToolPayload', () => {
  it('accepts the two tools with object args', () => {
    expect(parseAiToolPayload({ tool: 'list-recent-changes', args: { limit: 20 } })).toEqual({
      tool: 'list-recent-changes',
      args: { limit: 20 },
    });
    expect(parseAiToolPayload({ tool: 'undo-change' }).args).toEqual({});
  });

  it('accepts the Tarokka window tools', () => {
    expect(parseAiToolPayload({ tool: 'get-tarokka-reading' }).args).toEqual({});
    expect(
      parseAiToolPayload({ tool: 'plan-tarokka-reveal', args: { position: 'tome', text: 'x' } })
        .tool
    ).toBe('plan-tarokka-reveal');
  });

  it.each([
    undefined,
    {},
    { tool: 'plan-tarokka-links', args: {} },
    { tool: 'plan-tarokka-import', args: {} },
    { tool: 'toString', args: {} },
    { tool: 'list-recent-changes', args: [1] },
    { tool: 'list-recent-changes', args: 'x' },
    { tool: 'list-recent-changes', args: { pad: 'x'.repeat(20_001) } },
  ])('rejects %j', data => {
    expect(() => parseAiToolPayload(data)).toThrow(/Invalid payload/);
  });

  it('counts UTF-8 bytes, not characters', () => {
    // 8,000 characters but 24,000 bytes of JSON.
    expect(() =>
      parseAiToolPayload({ tool: 'list-recent-changes', args: { pad: '€'.repeat(8_000) } })
    ).toThrow(/too large/);
    expect(() =>
      parseAiToolPayload({ tool: 'list-recent-changes', args: { pad: '€'.repeat(5_000) } })
    ).not.toThrow();
  });

  it('gives an undo a longer timeout than a read', () => {
    expect(aiToolTimeoutMs('list-recent-changes')).toBe(30_000);
    expect(aiToolTimeoutMs('undo-change')).toBe(120_000);
    expect(aiToolTimeoutMs('apply-planned-change')).toBe(120_000);
    expect(aiToolTimeoutMs('plan-page-reveal')).toBe(30_000);
    expect(aiToolTimeoutMs('plan-tarokka-reveal')).toBe(30_000);
  });
});

describe('aiToolRequest on the client that holds the link', () => {
  it('calls the link directly, as this user, without a user.query hop', async () => {
    const link = fakeLink();
    setBridgeLink(link);
    const query = vi.fn();
    addUser({ id: 'danni', name: 'Danni', isGM: true, active: true, role: 4, query });

    const result = await aiToolRequest('list-recent-changes', { limit: 20 });

    expect(result).toEqual({ changes: [] });
    expect(link.request).toHaveBeenCalledWith(
      'list-recent-changes',
      { limit: 20 },
      { userId: 'gm', userName: 'Gamemaster' },
      30_000
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('falls back to the GM that holds the active link when the bridge says this one is not (Any GM)', async () => {
    const link = fakeLink();
    link.request.mockRejectedValue(new Error(MODULE_NOT_ACTIVE_LINK_ERROR));
    setBridgeLink(link);
    const holder = vi.fn().mockResolvedValue({ changes: ['via relay'] });
    addUser({ id: 'gm2', name: 'Newer GM', isGM: true, active: true, role: 4, query: holder });
    world.setSetting('foundry-mcp-bridge', 'bridgeUserId', '');

    const result = await aiToolRequest('list-recent-changes', { limit: 20 });

    expect(result).toEqual({ changes: ['via relay'] });
    expect(link.request).toHaveBeenCalledTimes(1);
    expect(holder).toHaveBeenCalledWith(
      GM_HELPER_QUERIES.aiToolRequest,
      { tool: 'list-recent-changes', args: { limit: 20 } },
      { timeout: 32_000 }
    );
  });

  it('still says the bridge is not connected when the direct link is inactive and no GM answers', async () => {
    const link = fakeLink();
    link.request.mockRejectedValue(new Error(MODULE_NOT_ACTIVE_LINK_ERROR));
    setBridgeLink(link);
    world.setSetting('foundry-mcp-bridge', 'bridgeUserId', '');
    await expect(aiToolRequest('list-recent-changes', {})).rejects.toThrow(AI_TOOL_NOT_CONNECTED);
  });

  it('passes any other direct-link error through without trying the relay', async () => {
    const link = fakeLink();
    link.request.mockRejectedValue(new Error('Documents changed since the change'));
    setBridgeLink(link);
    const other = vi.fn();
    addUser({ id: 'gm2', name: 'Other', isGM: true, active: true, role: 4, query: other });
    world.setSetting('foundry-mcp-bridge', 'bridgeUserId', '');
    await expect(aiToolRequest('undo-change', { changeId: 'c1', confirm: true })).rejects.toThrow(
      'Documents changed since the change'
    );
    expect(other).not.toHaveBeenCalled();
  });

  it('refuses a tool that is not on the list before sending anything', async () => {
    const link = fakeLink();
    setBridgeLink(link);
    await expect(aiToolRequest('plan-tarokka-links', {})).rejects.toThrow(/Invalid payload/);
    expect(link.request).not.toHaveBeenCalled();
  });
});

describe('aiToolRequest on another GM client (user.query)', () => {
  it('asks the configured bridge user', async () => {
    const query = vi.fn().mockResolvedValue({ changes: [{ changeId: 'c1' }] });
    addUser({ id: 'asst', name: 'Assistant GM', isGM: true, active: true, role: 3, query });
    world.setSetting('foundry-mcp-bridge', 'bridgeUserId', 'asst');

    const result = await aiToolRequest('list-recent-changes', { limit: 20 });

    expect(result).toEqual({ changes: [{ changeId: 'c1' }] });
    expect(query).toHaveBeenCalledWith(
      GM_HELPER_QUERIES.aiToolRequest,
      { tool: 'list-recent-changes', args: { limit: 20 } },
      { timeout: 32_000 }
    );
  });

  it('with "Any GM", tries the other active GMs until one holds the link', async () => {
    const noLink = vi.fn().mockRejectedValue(new Error(AI_TOOL_NOT_CONNECTED));
    const holder = vi.fn().mockResolvedValue('ok');
    addUser({ id: 'gm2', name: 'Second GM', isGM: true, active: true, role: 4, query: noLink });
    addUser({ id: 'asst', name: 'Assistant GM', isGM: true, active: true, role: 3, query: holder });
    world.setSetting('foundry-mcp-bridge', 'bridgeUserId', '');

    await expect(aiToolRequest('undo-change', { changeId: 'c1', confirm: true })).resolves.toBe(
      'ok'
    );
    expect(noLink).toHaveBeenCalledTimes(1);
    expect(holder).toHaveBeenCalledWith(
      GM_HELPER_QUERIES.aiToolRequest,
      { tool: 'undo-change', args: { changeId: 'c1', confirm: true } },
      { timeout: 122_000 }
    );
  });

  it('with "Any GM", keeps looking when the first candidate holds an inactive link', async () => {
    const inactive = vi.fn().mockRejectedValue(new Error(MODULE_NOT_ACTIVE_LINK_ERROR));
    const active = vi.fn().mockResolvedValue('answered');
    addUser({
      id: 'gm2',
      name: 'Older GM tab',
      isGM: true,
      active: true,
      role: 4,
      query: inactive,
    });
    addUser({ id: 'gm3', name: 'Newest GM tab', isGM: true, active: true, role: 4, query: active });
    world.setSetting('foundry-mcp-bridge', 'bridgeUserId', '');

    await expect(aiToolRequest('list-recent-changes', {})).resolves.toBe('answered');
    expect(inactive).toHaveBeenCalledTimes(1);
    expect(active).toHaveBeenCalledTimes(1);
  });

  it('passes a real backend error through (an undo conflict), without trying another GM', async () => {
    const conflict = vi.fn().mockRejectedValue(new Error('Documents changed since the change'));
    const other = vi.fn();
    addUser({
      id: 'asst',
      name: 'Assistant GM',
      isGM: true,
      active: true,
      role: 3,
      query: conflict,
    });
    addUser({ id: 'gm3', name: 'Third GM', isGM: true, active: true, role: 4, query: other });

    await expect(aiToolRequest('undo-change', { changeId: 'c1', confirm: true })).rejects.toThrow(
      'Documents changed since the change'
    );
    expect(other).not.toHaveBeenCalled();
  });

  it('says the bridge is not connected when no GM holds the link', async () => {
    addUser({
      id: 'asst',
      name: 'Assistant GM',
      isGM: true,
      active: true,
      role: 3,
      query: vi.fn().mockRejectedValue(new Error(AI_TOOL_NOT_CONNECTED)),
    });
    await expect(aiToolRequest('list-recent-changes', {})).rejects.toThrow(AI_TOOL_NOT_CONNECTED);
  });

  it('says so when the configured bridge user is not logged in, or when no other GM exists', async () => {
    addUser({
      id: 'asst',
      name: 'Assistant GM',
      isGM: true,
      active: false,
      role: 3,
      query: vi.fn(),
    });
    world.setSetting('foundry-mcp-bridge', 'bridgeUserId', 'asst');
    await expect(aiToolRequest('list-recent-changes', {})).rejects.toThrow(AI_TOOL_NOT_CONNECTED);
    world.setSetting('foundry-mcp-bridge', 'bridgeUserId', '');
    await expect(aiToolRequest('list-recent-changes', {})).rejects.toThrow(AI_TOOL_NOT_CONNECTED);
  });

  it('needs Foundry 14.352 to reach another client', async () => {
    g.game.release = { generation: 14, build: 351 };
    addUser({
      id: 'asst',
      name: 'Assistant GM',
      isGM: true,
      active: true,
      role: 3,
      query: vi.fn(),
    });
    await expect(aiToolRequest('list-recent-changes', {})).rejects.toThrow(/14\.352/);
  });
});

describe('the registered aiToolRequest query (the link holder side)', () => {
  const handler = (): any => g.CONFIG.queries[GM_HELPER_QUERIES.aiToolRequest];

  it('is registered with the other helper queries', () => {
    expect(registerGmHelperQueries()).toBe(true);
    expect(handler()).toBeTypeOf('function');
  });

  it('forwards to the open link as the GM who asked', async () => {
    registerGmHelperQueries();
    const link = fakeLink();
    setBridgeLink(link);
    const danni = addUser({ id: 'danni', name: 'Danni', isGM: true, role: 4 });

    const result = await handler()(
      { tool: 'list-recent-changes', args: { limit: 20 } },
      { user: danni }
    );

    expect(result).toEqual({ changes: [] });
    expect(link.request).toHaveBeenCalledWith(
      'list-recent-changes',
      { limit: 20 },
      { userId: 'danni', userName: 'Danni' },
      30_000
    );
  });

  it('rejects a player, a missing sender and a forged sender before touching the link', async () => {
    registerGmHelperQueries();
    const link = fakeLink();
    setBridgeLink(link);
    const player = addUser({ id: 'p1', name: 'Player', isGM: false });
    const payload = { tool: 'undo-change', args: { changeId: 'c1', confirm: true } };

    await expect(handler()(payload, { user: player })).rejects.toThrow(/GM-only/);
    await expect(handler()(payload, { timeout: 1 })).rejects.toThrow(/no sender/);
    await expect(handler()(payload, { user: { id: 'p1', isGM: true } })).rejects.toThrow(
      /not a user of this world/
    );
    expect(link.request).not.toHaveBeenCalled();
  });

  it('says the bridge is not connected when this client holds no open link', async () => {
    registerGmHelperQueries();
    const danni = addUser({ id: 'danni', name: 'Danni', isGM: true, role: 4 });
    const payload = { tool: 'list-recent-changes', args: {} };

    await expect(handler()(payload, { user: danni })).rejects.toThrow(AI_TOOL_NOT_CONNECTED);
    setBridgeLink(fakeLink(false));
    await expect(handler()(payload, { user: danni })).rejects.toThrow(AI_TOOL_NOT_CONNECTED);
  });

  it('validates the payload', async () => {
    registerGmHelperQueries();
    setBridgeLink(fakeLink());
    const danni = addUser({ id: 'danni', name: 'Danni', isGM: true, role: 4 });
    await expect(
      handler()({ tool: 'plan-tarokka-links', args: {} }, { user: danni })
    ).rejects.toThrow(/Invalid payload/);
  });
});
