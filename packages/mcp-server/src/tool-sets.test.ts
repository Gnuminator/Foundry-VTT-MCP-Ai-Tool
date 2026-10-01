import { describe, expect, it } from 'vitest';

import {
  TOOL_SETS,
  TOOL_SET_NAMES,
  filterToolsBySets,
  resolveToolSets,
  toolSetInstructions,
  toolSetOf,
} from './tool-sets.js';

describe('resolveToolSets', () => {
  it('serves every tool when unset, blank or "all"', () => {
    for (const raw of [undefined, '', '   ', 'all', 'ALL', 'core,all']) {
      const s = resolveToolSets(raw);
      expect(s.all, String(raw)).toBe(true);
      expect(s.sets).toEqual(TOOL_SET_NAMES);
      expect(s.warnings).toEqual([]);
    }
  });

  it('reads names separated by commas or spaces, any case, in canonical order', () => {
    expect(resolveToolSets('prep').sets).toEqual(['prep']);
    expect(resolveToolSets(' Admin , CORE ').sets).toEqual(['core', 'admin']);
    expect(resolveToolSets('prep play').sets).toEqual(['play', 'prep']);
    expect(resolveToolSets('prep,prep').sets).toEqual(['prep']);
    expect(resolveToolSets('core').all).toBe(false);
    expect(resolveToolSets('admin,prep,play,core').all).toBe(false);
    expect(resolveToolSets('admin,build,prep,play,core').all).toBe(true);
  });

  it('ignores unknown names with a warning, and serves everything when none is valid', () => {
    const partly = resolveToolSets('core,combat');
    expect(partly.sets).toEqual(['core']);
    expect(partly.warnings).toEqual([expect.stringContaining('unknown tool set "combat"')]);

    const none = resolveToolSets('combat');
    expect(none.all).toBe(true);
    expect(none.warnings).toHaveLength(2);
    expect(none.warnings[1]).toContain('serving every tool');
  });
});

describe('filterToolsBySets', () => {
  const tools = [
    { name: 'get-world-info' },
    { name: 'plan-token-change' },
    { name: 'not-in-a-set' },
  ];

  it('keeps only the chosen sets, and drops a tool no set lists', () => {
    expect(filterToolsBySets(tools, resolveToolSets('core')).map(t => t.name)).toEqual([
      'get-world-info',
    ]);
    expect(filterToolsBySets(tools, resolveToolSets('core,play')).map(t => t.name)).toEqual([
      'get-world-info',
      'plan-token-change',
    ]);
  });

  it('keeps every tool with "all", even one no set lists yet', () => {
    expect(filterToolsBySets(tools, resolveToolSets(undefined))).toEqual(tools);
  });
});

describe('toolSetOf', () => {
  it('names the set of a tool, and nothing for an unknown name', () => {
    expect(toolSetOf('undo-change')).toBe('core');
    expect(toolSetOf('plan-actor-change')).toBe('play');
    expect(toolSetOf('plan-token-change')).toBe('play');
    for (const gone of ['move-token', 'update-token', 'delete-tokens', 'set-token-vision-light']) {
      expect(toolSetOf(gone), gone).toBeUndefined();
    }
    expect(toolSetOf('plan-page-reveal')).toBe('prep');
    expect(toolSetOf('dnd5e-create-npc')).toBe('build');
    expect(toolSetOf('get-module-errors')).toBe('admin');
    expect(toolSetOf('plan-ownership-change')).toBe('admin');
    expect(toolSetOf('list-actor-ownership')).toBe('admin');
    for (const gone of ['assign-actor-ownership', 'remove-actor-ownership']) {
      expect(toolSetOf(gone), gone).toBeUndefined();
    }
    expect(toolSetOf('toString')).toBeUndefined();
  });
});

describe('toolSetInstructions', () => {
  it("names this connector's sets and the ones to switch on for the rest", () => {
    const text = toolSetInstructions(resolveToolSets('prep'));
    expect(text).toContain(`- Prep: ${TOOL_SETS.prep.purpose}`);
    expect(text).toContain('switch on');
    for (const set of ['core', 'play', 'build', 'admin'] as const)
      expect(text).toContain(`- ${TOOL_SETS[set].title}:`);
    expect(text).toContain('do not work around it');
  });

  it('says nothing about other connectors when serving every set', () => {
    const text = toolSetInstructions(resolveToolSets('all'));
    expect(text).toContain('every tool set');
    expect(text).not.toContain('switch on');
  });

  it('has no em dashes', () => {
    for (const raw of ['all', 'core', 'play', 'prep', 'build', 'admin'])
      expect(toolSetInstructions(resolveToolSets(raw))).not.toMatch(/\u2014/);
  });
});
