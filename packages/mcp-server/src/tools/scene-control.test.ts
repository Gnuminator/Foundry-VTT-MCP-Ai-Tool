import { describe, expect, it, vi } from 'vitest';

import { SceneControlTools } from './scene-control.js';

/**
 * Tests for SceneControlTools — a thin, deterministic layer over FoundryClient.query.
 * Pattern: validate args → dispatch correct `foundry-mcp-bridge.*` method →
 * propagate foundry-side failures → return/throw validation errors.
 *
 * Validation error behavior per handler (matches source exactly):
 *   handleSetSceneMood        — ZodError → returns "Parameter error" string; other errors re-throw
 *   handleAddMapNote          — all errors re-throw (no ZodError string path)
 *   handleSetTokenVisionLight — ZodError → returns "Parameter error" string; other errors re-throw
 *   handleDeleteMapNote       — all errors re-throw (no ZodError string path)
 *
 * The FoundryClient is mocked so these tests run with no bridge connection.
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
  return { tools: new SceneControlTools({ foundryClient, logger }), query };
}

// ---------------------------------------------------------------------------
// getToolDefinitions
// ---------------------------------------------------------------------------

describe('SceneControlTools.getToolDefinitions', () => {
  it('exposes the four scene-control tools with object input schemas', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual([
      'set-scene-mood',
      'add-map-note',
      'set-token-vision-light',
      'delete-map-note',
    ]);
    for (const d of defs) {
      expect((d.inputSchema as any).type).toBe('object');
    }
  });

  it('set-token-vision-light requires tokenName', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const setVision = defs.find(d => d.name === 'set-token-vision-light')!;
    expect((setVision.inputSchema as any).required).toEqual(['tokenName']);
  });

  it('set-scene-mood has no required fields', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const setMood = defs.find(d => d.name === 'set-scene-mood')!;
    expect((setMood.inputSchema as any).required).toBeUndefined();
  });

  it('add-map-note has no required fields', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const addNote = defs.find(d => d.name === 'add-map-note')!;
    expect((addNote.inputSchema as any).required).toBeUndefined();
  });

  it('delete-map-note has no required fields', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const deleteNote = defs.find(d => d.name === 'delete-map-note')!;
    expect((deleteNote.inputSchema as any).required).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// handleSetSceneMood
// ---------------------------------------------------------------------------

describe('SceneControlTools.handleSetSceneMood', () => {
  it('dispatches with darkness and returns the response', async () => {
    const payload = { success: true };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleSetSceneMood({ darkness: 0.5 });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.setSceneMood', { darkness: 0.5 });
    expect(result).toBe(payload);
  });

  it('dispatches with globalLight', async () => {
    const { tools, query } = makeTools(() => ({ success: true }));
    await tools.handleSetSceneMood({ globalLight: true });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.setSceneMood', { globalLight: true });
  });

  it('dispatches with playlistName and playlistAction', async () => {
    const { tools, query } = makeTools(() => ({ success: true }));
    await tools.handleSetSceneMood({ playlistName: 'Battle', playlistAction: 'play' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.setSceneMood', {
      playlistName: 'Battle',
      playlistAction: 'play',
    });
  });

  it('dispatches with all args combined', async () => {
    const { tools, query } = makeTools(() => ({ success: true }));
    await tools.handleSetSceneMood({
      darkness: 0.8,
      globalLight: false,
      playlistName: 'Ambient',
      playlistAction: 'stop',
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.setSceneMood', {
      darkness: 0.8,
      globalLight: false,
      playlistName: 'Ambient',
      playlistAction: 'stop',
    });
  });

  it('dispatches with empty params when called with no args', async () => {
    const { tools, query } = makeTools(() => ({ success: true }));
    await tools.handleSetSceneMood(undefined);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.setSceneMood', {});
  });

  it('returns a parameter-error string (not a throw) when darkness is out of range', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleSetSceneMood({ darkness: 1.5 });
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a parameter-error string when playlistAction is an invalid enum value', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleSetSceneMood({ playlistAction: 'pause' });
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('throws when Foundry reports a failure with an error message', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'no active scene' }));
    await expect(tools.handleSetSceneMood({})).rejects.toThrow('no active scene');
  });

  it('throws a generic message when Foundry reports failure with no error field', async () => {
    const { tools } = makeTools(() => ({ success: false }));
    await expect(tools.handleSetSceneMood({})).rejects.toThrow('Failed to set scene mood');
  });
});

// ---------------------------------------------------------------------------
// handleAddMapNote
// ---------------------------------------------------------------------------

describe('SceneControlTools.handleAddMapNote', () => {
  it('dispatches with text and x/y coordinates', async () => {
    const payload = { success: true, noteId: 'note-1' };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleAddMapNote({ text: 'Dungeon Entrance', x: 100, y: 200 });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.addMapNote', {
      text: 'Dungeon Entrance',
      x: 100,
      y: 200,
    });
    expect(result).toBe(payload);
  });

  it('dispatches with tokenName instead of x/y', async () => {
    const { tools, query } = makeTools(() => ({ success: true }));
    await tools.handleAddMapNote({ text: 'Here', tokenName: 'Goblin' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.addMapNote', {
      text: 'Here',
      tokenName: 'Goblin',
    });
  });

  it('dispatches with journalName and entryId', async () => {
    const { tools, query } = makeTools(() => ({ success: true }));
    await tools.handleAddMapNote({ journalName: 'Quest Log', entryId: 'entry-42' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.addMapNote', {
      journalName: 'Quest Log',
      entryId: 'entry-42',
    });
  });

  it('dispatches with icon and iconSize', async () => {
    const { tools, query } = makeTools(() => ({ success: true }));
    await tools.handleAddMapNote({ icon: 'icons/svg/skull.svg', iconSize: 60 });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.addMapNote', {
      icon: 'icons/svg/skull.svg',
      iconSize: 60,
    });
  });

  it('dispatches with empty params when called with no args', async () => {
    const { tools, query } = makeTools(() => ({ success: true }));
    await tools.handleAddMapNote(undefined);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.addMapNote', {});
  });

  it('throws (not returns string) when Foundry reports a failure with an error message', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'no active scene' }));
    await expect(tools.handleAddMapNote({})).rejects.toThrow('no active scene');
  });

  it('throws a generic message when Foundry reports failure with no error field', async () => {
    const { tools } = makeTools(() => ({ success: false }));
    await expect(tools.handleAddMapNote({})).rejects.toThrow('Failed to add map note');
  });
});

// ---------------------------------------------------------------------------
// handleSetTokenVisionLight
// ---------------------------------------------------------------------------

describe('SceneControlTools.handleSetTokenVisionLight', () => {
  it('dispatches with required tokenName and optional sight fields', async () => {
    const payload = { success: true };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleSetTokenVisionLight({
      tokenName: 'Aragorn',
      sightEnabled: true,
      sightRange: 60,
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.setTokenVisionLight', {
      tokenName: 'Aragorn',
      sightEnabled: true,
      sightRange: 60,
    });
    expect(result).toBe(payload);
  });

  it('dispatches with torch light settings', async () => {
    const { tools, query } = makeTools(() => ({ success: true }));
    await tools.handleSetTokenVisionLight({
      tokenName: 'Torch Bearer',
      lightDim: 40,
      lightBright: 20,
      lightColor: '#ff9329',
      lightAnimation: 'torch',
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.setTokenVisionLight', {
      tokenName: 'Torch Bearer',
      lightDim: 40,
      lightBright: 20,
      lightColor: '#ff9329',
      lightAnimation: 'torch',
    });
  });

  it('dispatches with visionMode', async () => {
    const { tools, query } = makeTools(() => ({ success: true }));
    await tools.handleSetTokenVisionLight({ tokenName: 'Elf', visionMode: 'darkvision' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.setTokenVisionLight', {
      tokenName: 'Elf',
      visionMode: 'darkvision',
    });
  });

  it('returns a parameter-error string (not a throw) when tokenName is missing', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleSetTokenVisionLight({ sightEnabled: true });
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a parameter-error string when args are null/undefined', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleSetTokenVisionLight(undefined);
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/Parameter error/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('throws when Foundry reports a failure with an error message', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'token not found' }));
    await expect(tools.handleSetTokenVisionLight({ tokenName: 'Ghost' })).rejects.toThrow(
      'token not found'
    );
  });

  it('throws a generic message when Foundry reports failure with no error field', async () => {
    const { tools } = makeTools(() => ({ success: false }));
    await expect(tools.handleSetTokenVisionLight({ tokenName: 'Ghost' })).rejects.toThrow(
      'Failed to set token vision/light'
    );
  });
});

// ---------------------------------------------------------------------------
// handleDeleteMapNote
// ---------------------------------------------------------------------------

describe('SceneControlTools.handleDeleteMapNote', () => {
  it('dispatches with noteId and returns the response', async () => {
    const payload = { success: true };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.handleDeleteMapNote({ noteId: 'note-42' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.deleteMapNote', { noteId: 'note-42' });
    expect(result).toBe(payload);
  });

  it('dispatches with text label', async () => {
    const { tools, query } = makeTools(() => ({ success: true }));
    await tools.handleDeleteMapNote({ text: 'Dungeon Entrance' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.deleteMapNote', {
      text: 'Dungeon Entrance',
    });
  });

  it('dispatches with both noteId and text', async () => {
    const { tools, query } = makeTools(() => ({ success: true }));
    await tools.handleDeleteMapNote({ noteId: 'note-1', text: 'Old Label' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.deleteMapNote', {
      noteId: 'note-1',
      text: 'Old Label',
    });
  });

  it('dispatches with empty params when called with no args', async () => {
    const { tools, query } = makeTools(() => ({ success: true }));
    await tools.handleDeleteMapNote(undefined);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.deleteMapNote', {});
  });

  it('throws (not returns string) when Foundry reports a failure with an error message', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'note not found' }));
    await expect(tools.handleDeleteMapNote({ noteId: 'missing' })).rejects.toThrow(
      'note not found'
    );
  });

  it('throws a generic message when Foundry reports failure with no error field', async () => {
    const { tools } = makeTools(() => ({ success: false }));
    await expect(tools.handleDeleteMapNote({})).rejects.toThrow('Failed to delete map note');
  });
});
