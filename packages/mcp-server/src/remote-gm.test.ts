import { describe, expect, it, vi, type Mock } from 'vitest';

import { remoteGmCall, remoteGmList, remoteGmSet } from './remote-gm.js';
import type { ToolDefinitionLike } from './tool-router.js';
import { TOOL_SETS } from './tool-sets.js';

const defs = (names: string[]): ToolDefinitionLike[] =>
  names.map(name => ({ name, description: name, inputSchema: { type: 'object' } }));

const coreTool = TOOL_SETS.core.tools[0];
const playTool = TOOL_SETS.play.tools[0];
const playerTool = TOOL_SETS.player.tools[0];
const all = defs([coreTool, playTool, playerTool]);

describe('remoteGmSet', () => {
  it('accepts the five served sets only', () => {
    expect(remoteGmSet('core')).toBe('core');
    expect(remoteGmSet('admin')).toBe('admin');
    expect(remoteGmSet('player')).toBeNull();
    expect(remoteGmSet('all')).toBeNull();
    expect(remoteGmSet(undefined)).toBeNull();
  });
});

describe('remoteGmList', () => {
  it('lists one set and never the player set', () => {
    const core = remoteGmList(all, 'core');
    expect(core.tools.map(t => t.name)).toEqual([coreTool]);
    expect(remoteGmList(all, 'play').tools.map(t => t.name)).toEqual([playTool]);
    expect(core.instructions).toContain('This connector serves:');
    expect(core.instructions).toContain('Core');
  });
});

describe('remoteGmCall', () => {
  const deps = (
    run: (n: string, a: unknown) => Promise<unknown>
  ): Omit<Parameters<typeof remoteGmCall>[0], 'record'> & { record: Mock } => ({
    allTools: all,
    run,
    record: vi.fn(),
  });

  it('runs a tool of the set and logs it', async () => {
    const d = deps(async () => ({ ok: 1 }));
    const r = await remoteGmCall(d, 'core', coreTool, { a: 1 });
    expect(r.isError).toBeUndefined();
    expect(r.content[0]?.text).toBe('{"ok":1}');
    expect(d.record).toHaveBeenCalledOnce();
  });

  it('refuses a tool of another set, a player tool and an unknown name without running', async () => {
    const run = vi.fn();
    const d = deps(run);
    for (const name of [playTool, playerTool, 'nope', 'constructor']) {
      const r = await remoteGmCall(d, 'core', name, {});
      expect(r.isError).toBe(true);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses a dashboard-only route that sits in no set', async () => {
    const run = vi.fn(async () => ({}));
    const d = deps(run);
    expect((await remoteGmCall(d, 'core', 'plan-obsidian-quest-import', {})).isError).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it('turns a thrown error into an error result', async () => {
    const d = deps(async () => {
      throw new Error('boom');
    });
    const r = await remoteGmCall(d, 'core', coreTool, 'not-an-object');
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain('boom');
  });
});
