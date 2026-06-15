import { describe, expect, it, vi } from 'vitest';

import { SceneTools } from './scene.js';

/**
 * Tests for SceneTools — a thin, deterministic layer over FoundryClient.query.
 * Pattern: validate args → dispatch correct `foundry-mcp-bridge.*` method →
 * propagate foundry-side failures (always throw) → transform / shape the result.
 *
 * Both handlers do non-trivial shaping via private format* helpers; we cover the
 * key transformations on representative mock responses.
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
  return { tools: new SceneTools({ foundryClient, logger }), query };
}

// ---------------------------------------------------------------------------
// getToolDefinitions
// ---------------------------------------------------------------------------

describe('SceneTools.getToolDefinitions', () => {
  it('exposes exactly two scene tools with object input schemas', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual(['get-current-scene', 'get-world-info']);
    for (const d of defs) {
      expect((d.inputSchema as any).type).toBe('object');
    }
  });

  it('get-current-scene has no required fields', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'get-current-scene')!;
    expect((def.inputSchema as any).required).toBeUndefined();
  });

  it('get-world-info has no required fields', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'get-world-info')!;
    expect((def.inputSchema as any).required).toBeUndefined();
  });

  it('get-current-scene declares includeTokens and includeHidden properties', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'get-current-scene')!;
    const props = (def.inputSchema as any).properties;
    expect(props).toHaveProperty('includeTokens');
    expect(props).toHaveProperty('includeHidden');
  });
});

// ---------------------------------------------------------------------------
// handleGetCurrentScene
// ---------------------------------------------------------------------------

describe('SceneTools.handleGetCurrentScene', () => {
  /** Minimal valid scene payload returned by the bridge. */
  const minimalScene = {
    id: 'scene-abc',
    name: 'Dungeon Level 1',
    active: true,
    width: 3000,
    height: 2000,
    padding: 0.25,
    background: 'dungeon.jpg',
    navigation: true,
    walls: 12,
    lights: 4,
    sounds: 2,
    notes: [],
    tokens: [],
  };

  it('dispatches foundry-mcp-bridge.getActiveScene with no extra params', async () => {
    const { tools, query } = makeTools(() => minimalScene);
    await tools.handleGetCurrentScene({});
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getActiveScene');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('shapes the response: top-level fields id/name/active/dimensions/hasBackground/navigation/elements', async () => {
    const { tools } = makeTools(() => minimalScene);
    const result = await tools.handleGetCurrentScene({});
    expect(result.id).toBe('scene-abc');
    expect(result.name).toBe('Dungeon Level 1');
    expect(result.active).toBe(true);
    expect(result.dimensions).toEqual({ width: 3000, height: 2000, padding: 0.25 });
    expect(result.hasBackground).toBe(true);
    expect(result.navigation).toBe(true);
    expect(result.elements).toEqual({ walls: 12, lights: 4, sounds: 2, notes: 0 });
  });

  it('hasBackground is false when background is falsy', async () => {
    const { tools } = makeTools(() => ({ ...minimalScene, background: undefined }));
    const result = await tools.handleGetCurrentScene({});
    expect(result.hasBackground).toBe(false);
  });

  it('includes token list and summary when includeTokens is true (default)', async () => {
    const scene = {
      ...minimalScene,
      tokens: [
        {
          id: 't1',
          name: 'Goblin',
          x: 100,
          y: 200,
          width: 1,
          height: 1,
          actorId: 'a1',
          disposition: -1,
          hidden: false,
          img: 'goblin.png',
        },
        {
          id: 't2',
          name: 'Guard',
          x: 300,
          y: 400,
          width: 1,
          height: 1,
          actorId: null,
          disposition: 1,
          hidden: false,
          img: '',
        },
      ],
    };
    const { tools } = makeTools(() => scene);
    const result = await tools.handleGetCurrentScene({ includeTokens: true });
    expect(result.tokens).toHaveLength(2);
    expect(result.tokenSummary.total).toBe(2);
    expect(result.tokenSummary.byDisposition.hostile).toBe(1);
    expect(result.tokenSummary.byDisposition.friendly).toBe(1);
    expect(result.tokenSummary.hasActors).toBe(1);
    expect(result.tokenSummary.withoutActors).toBe(1);
  });

  it('omits token list and summary when includeTokens is false', async () => {
    const scene = {
      ...minimalScene,
      tokens: [
        {
          id: 't1',
          name: 'Goblin',
          x: 100,
          y: 200,
          width: 1,
          height: 1,
          actorId: 'a1',
          disposition: -1,
          hidden: false,
          img: 'goblin.png',
        },
      ],
    };
    const { tools } = makeTools(() => scene);
    const result = await tools.handleGetCurrentScene({ includeTokens: false });
    expect(result.tokens).toBeUndefined();
    expect(result.tokenSummary).toBeUndefined();
  });

  it('filters out hidden tokens when includeHidden is false (default)', async () => {
    const scene = {
      ...minimalScene,
      tokens: [
        {
          id: 't1',
          name: 'Goblin',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          actorId: null,
          disposition: -1,
          hidden: false,
          img: '',
        },
        {
          id: 't2',
          name: 'Hidden Spy',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          actorId: null,
          disposition: 0,
          hidden: true,
          img: '',
        },
      ],
    };
    const { tools } = makeTools(() => scene);
    const result = await tools.handleGetCurrentScene({ includeTokens: true, includeHidden: false });
    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0].name).toBe('Goblin');
    expect(result.tokenSummary.total).toBe(1);
  });

  it('includes hidden tokens when includeHidden is true', async () => {
    const scene = {
      ...minimalScene,
      tokens: [
        {
          id: 't1',
          name: 'Goblin',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          actorId: null,
          disposition: -1,
          hidden: false,
          img: '',
        },
        {
          id: 't2',
          name: 'Hidden Spy',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          actorId: null,
          disposition: 0,
          hidden: true,
          img: '',
        },
      ],
    };
    const { tools } = makeTools(() => scene);
    const result = await tools.handleGetCurrentScene({ includeTokens: true, includeHidden: true });
    expect(result.tokens).toHaveLength(2);
    expect(result.tokenSummary.total).toBe(2);
  });

  it('shapes individual token fields correctly', async () => {
    const scene = {
      ...minimalScene,
      tokens: [
        {
          id: 't1',
          name: 'Orc',
          x: 150,
          y: 250,
          width: 2,
          height: 2,
          actorId: 'actor-99',
          disposition: -1,
          hidden: false,
          img: 'orc.png',
        },
      ],
    };
    const { tools } = makeTools(() => scene);
    const result = await tools.handleGetCurrentScene({ includeTokens: true });
    const token = result.tokens[0];
    expect(token).toEqual({
      id: 't1',
      name: 'Orc',
      position: { x: 150, y: 250 },
      size: { width: 2, height: 2 },
      actorId: 'actor-99',
      disposition: 'hostile',
      hidden: false,
      hasImage: true,
    });
  });

  it('maps disposition numbers to names: -1→hostile, 0→neutral, 1→friendly, other→unknown', async () => {
    const makeToken = (id: string, disposition: number) => ({
      id,
      name: id,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      actorId: null,
      disposition,
      hidden: false,
      img: '',
    });
    const scene = {
      ...minimalScene,
      tokens: [makeToken('h', -1), makeToken('n', 0), makeToken('f', 1), makeToken('u', 99)],
    };
    const { tools } = makeTools(() => scene);
    const result = await tools.handleGetCurrentScene({ includeTokens: true });
    const names = result.tokens.map((t: any) => t.disposition);
    expect(names).toEqual(['hostile', 'neutral', 'friendly', 'unknown']);
  });

  it('includes notes array when scene has notes', async () => {
    const scene = {
      ...minimalScene,
      notes: [
        { id: 'n1', text: 'A short note', x: 100, y: 200 },
        { id: 'n2', text: 'x'.repeat(200), x: 300, y: 400 },
      ],
    };
    const { tools } = makeTools(() => scene);
    const result = await tools.handleGetCurrentScene({});
    expect(result.notes).toHaveLength(2);
    expect(result.notes[0]).toEqual({
      id: 'n1',
      text: 'A short note',
      position: { x: 100, y: 200 },
    });
    // Long text is truncated to 100 chars (97 + '...')
    expect(result.notes[1].text).toHaveLength(100);
    expect(result.notes[1].text.endsWith('...')).toBe(true);
  });

  it('elements.notes counts note array length', async () => {
    const scene = {
      ...minimalScene,
      notes: [
        { id: 'n1', text: 'Note 1', x: 0, y: 0 },
        { id: 'n2', text: 'Note 2', x: 0, y: 0 },
      ],
    };
    const { tools } = makeTools(() => scene);
    const result = await tools.handleGetCurrentScene({});
    expect(result.elements.notes).toBe(2);
  });

  it('uses default args (includeTokens=true, includeHidden=false) when args are empty', async () => {
    const scene = {
      ...minimalScene,
      tokens: [
        {
          id: 't1',
          name: 'Goblin',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          actorId: 'a1',
          disposition: -1,
          hidden: false,
          img: 'g.png',
        },
      ],
    };
    const { tools } = makeTools(() => scene);
    const result = await tools.handleGetCurrentScene({});
    // includeTokens defaults true → tokens present
    expect(result.tokens).toHaveLength(1);
    // includeHidden defaults false → hidden token excluded (none hidden here, just verify key present)
    expect(result.tokenSummary).toBeDefined();
  });

  it('throws (wraps message) when the Foundry client throws', async () => {
    const { tools } = makeTools(() => {
      throw new Error('bridge offline');
    });
    await expect(tools.handleGetCurrentScene({})).rejects.toThrow(
      'Failed to get current scene: bridge offline'
    );
  });

  it('throws with Unknown error message when client throws a non-Error', async () => {
    const { tools } = makeTools(() => {
      throw 'oops';
    });
    await expect(tools.handleGetCurrentScene({})).rejects.toThrow(
      'Failed to get current scene: Unknown error'
    );
  });

  it('throws (ZodError) when includeTokens is not a boolean', async () => {
    const { tools } = makeTools(() => minimalScene);
    await expect(tools.handleGetCurrentScene({ includeTokens: 'yes' })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// handleGetWorldInfo
// ---------------------------------------------------------------------------

describe('SceneTools.handleGetWorldInfo', () => {
  /** Representative world payload returned by the bridge. */
  const worldPayload = {
    id: 'world-1',
    title: 'The Forgotten Realm',
    system: 'dnd5e',
    systemVersion: '3.3.1',
    foundryVersion: '11.315',
    users: [
      { id: 'u1', name: 'GM Chris', isGM: true, active: true },
      { id: 'u2', name: 'Player A', isGM: false, active: true },
      { id: 'u3', name: 'Player B', isGM: false, active: false },
    ],
  };

  it('dispatches foundry-mcp-bridge.getWorldInfo with no params', async () => {
    const { tools, query } = makeTools(() => worldPayload);
    await tools.handleGetWorldInfo({});
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getWorldInfo');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('shapes top-level id and title', async () => {
    const { tools } = makeTools(() => worldPayload);
    const result = await tools.handleGetWorldInfo({});
    expect(result.id).toBe('world-1');
    expect(result.title).toBe('The Forgotten Realm');
  });

  it('shapes system object with id and version', async () => {
    const { tools } = makeTools(() => worldPayload);
    const result = await tools.handleGetWorldInfo({});
    expect(result.system).toEqual({ id: 'dnd5e', version: '3.3.1' });
  });

  it('shapes foundry object with version', async () => {
    const { tools } = makeTools(() => worldPayload);
    const result = await tools.handleGetWorldInfo({});
    expect(result.foundry).toEqual({ version: '11.315' });
  });

  it('computes users summary: total, active, gms, players', async () => {
    const { tools } = makeTools(() => worldPayload);
    const result = await tools.handleGetWorldInfo({});
    expect(result.users).toEqual({ total: 3, active: 2, gms: 1, players: 2 });
  });

  it('computes activeUsers list filtered to active users only', async () => {
    const { tools } = makeTools(() => worldPayload);
    const result = await tools.handleGetWorldInfo({});
    expect(result.activeUsers).toEqual([
      { id: 'u1', name: 'GM Chris', isGM: true },
      { id: 'u2', name: 'Player A', isGM: false },
    ]);
  });

  it('handles empty users array gracefully', async () => {
    const { tools } = makeTools(() => ({ ...worldPayload, users: [] }));
    const result = await tools.handleGetWorldInfo({});
    expect(result.users).toEqual({ total: 0, active: 0, gms: 0, players: 0 });
    expect(result.activeUsers).toEqual([]);
  });

  it('handles missing users (undefined) gracefully', async () => {
    const { tools } = makeTools(() => ({ ...worldPayload, users: undefined }));
    const result = await tools.handleGetWorldInfo({});
    expect(result.users.total).toBe(0);
    expect(result.activeUsers).toEqual([]);
  });

  it('is callable with undefined args (ignores args entirely)', async () => {
    const { tools, query } = makeTools(() => worldPayload);
    await tools.handleGetWorldInfo(undefined);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getWorldInfo');
  });

  it('throws (wraps message) when the Foundry client throws', async () => {
    const { tools } = makeTools(() => {
      throw new Error('connection refused');
    });
    await expect(tools.handleGetWorldInfo({})).rejects.toThrow(
      'Failed to get world information: connection refused'
    );
  });

  it('throws with Unknown error message when client throws a non-Error', async () => {
    const { tools } = makeTools(() => {
      throw 42;
    });
    await expect(tools.handleGetWorldInfo({})).rejects.toThrow(
      'Failed to get world information: Unknown error'
    );
  });
});
