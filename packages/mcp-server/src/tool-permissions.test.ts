import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import {
  GRANT_MS,
  TOOL_PERMISSIONS_FILE,
  ToolPermissions,
  handleToolPermissions,
} from './tool-permissions.js';
import { TOOL_SETS } from './tool-sets.js';

const dir = (): string => mkdtempSync(path.join(tmpdir(), 'perms-'));
const [playTool] = TOOL_SETS.play.tools;
const [coreTool, otherCore] = TOOL_SETS.core.tools;

describe('ToolPermissions', () => {
  it('allows everything until the GM sets something', () => {
    const p = new ToolPermissions(dir());
    expect(p.check(playTool).ok).toBe(true);
    expect(p.check('no-such-tool').ok).toBe(true);
  });

  it('deny refuses, a tool setting beats its set, and default clears it', async () => {
    const p = new ToolPermissions(dir());
    await p.set('set', 'play', 'deny');
    expect(p.check(playTool).ok).toBe(false);
    await p.set('tool', playTool, 'allow');
    expect(p.check(playTool).ok).toBe(true);
    await p.set('tool', playTool, null);
    expect(p.check(playTool).ok).toBe(false);
  });

  it('ask lists a pending card, and Allow once lets exactly one retry through', async () => {
    let t = 1000;
    const p = new ToolPermissions(dir(), () => t);
    await p.set('tool', coreTool, 'ask');
    expect(p.check(coreTool).ok).toBe(false);
    expect(p.check(coreTool).ok).toBe(false);
    expect(p.snapshot([coreTool]).pending.map(x => x.tool)).toEqual([coreTool]);
    p.approve(coreTool);
    expect(p.snapshot([coreTool]).pending).toEqual([]);
    expect(p.check(coreTool).ok).toBe(true);
    expect(p.check(coreTool).ok).toBe(false);
    p.approve(coreTool);
    t += GRANT_MS + 1;
    expect(p.check(coreTool).ok).toBe(false);
  });

  it('a set-wide change drops cards and grants of tools no longer on ask', async () => {
    const p = new ToolPermissions(dir());
    await p.set('set', 'play', 'ask');
    expect(p.check(playTool).ok).toBe(false);
    expect(p.snapshot([playTool]).pending).toHaveLength(1);
    await p.set('set', 'play', 'allow');
    expect(p.snapshot([playTool]).pending).toEqual([]);
    await p.set('set', 'play', 'ask');
    p.approve(playTool);
    await p.set('set', 'play', 'deny');
    await p.set('set', 'play', 'ask');
    expect(p.check(playTool).ok).toBe(false);
  });

  it('saves to the data dir and a new instance reads it back', async () => {
    const d = dir();
    const p = new ToolPermissions(d);
    await p.set('tool', coreTool, 'deny');
    await p.set('set', 'build', 'ask');
    expect(JSON.parse(readFileSync(path.join(d, TOOL_PERMISSIONS_FILE), 'utf8'))).toEqual({
      tools: { [coreTool]: 'deny' },
      sets: { build: 'ask' },
    });
    const again = new ToolPermissions(d);
    expect(again.policyFor(coreTool)).toBe('deny');
    expect(again.policyFor(otherCore)).toBe('allow');
  });

  it('refuses unknown tools and sets, and handleToolPermissions rejects a bad policy', async () => {
    const p = new ToolPermissions(dir());
    await expect(p.set('tool', 'nope', 'deny')).rejects.toThrow(/Unknown tool/);
    await expect(p.set('set', 'nope', 'deny')).rejects.toThrow(/Unknown tool set/);
    await expect(
      handleToolPermissions(p, [coreTool], { action: 'set', name: coreTool, policy: 'maybe' })
    ).rejects.toThrow(/policy must be/);
    const snap = await handleToolPermissions(p, [coreTool], {
      action: 'set',
      name: coreTool,
      policy: 'ask',
    });
    expect(snap.tools[0]).toMatchObject({ own: 'ask', effective: 'ask' });
  });

  it('a damaged file means allow everything', () => {
    const d = dir();
    writeFileSync(path.join(d, TOOL_PERMISSIONS_FILE), '{nope');
    expect(new ToolPermissions(d).policyFor(coreTool)).toBe('allow');
  });
});
