import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { classifyTool } from './tool-policy.js';

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

/**
 * Tools of tool-sets.ts the live sweep (scripts/live-write-sweep.mjs) does not run, each with
 * the reason. A new write tool gets a sweep step in the same PR, or an entry here.
 */
const RECORDED_SKIPS: Record<string, string> = {
  'plan-scene-mood':
    'ships off (feature scene-mood) and needs a playlist in the world (I-034, I-129); checked by hand on server A (save, apply, music switch, undo), see the PR',
  'plan-table-viewer':
    'creates a Foundry user; checked by hand on server A (plan, apply, join as Table, undo), see the PR',
  'plan-scene-restore':
    'needs a backup copy of the world on disk and Foundry app files (I-128); checked by hand on server A (break a scene, restore, undo), see the PR',
};

/** Source text without `//` and block comments (a `]` in a comment must not end an array). */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/** Every tool name listed in a `tools: [...]` array of tool-sets.ts. */
export function toolSetNamesOf(source: string): string[] {
  const names = new Set<string>();
  for (const block of stripComments(source).matchAll(/tools:\s*\[([^\]]*)\]/g)) {
    for (const name of block[1].matchAll(/'([a-z][a-z0-9-]*)'/g)) names.add(name[1]);
  }
  return [...names];
}

function toolSetNames(): string[] {
  return toolSetNamesOf(read('../../mcp-server/src/tool-sets.ts'));
}

describe('live sweep coverage (I-016)', () => {
  it('reads the names after a comment that holds a closing bracket', () => {
    const source = [
      "tools: ['alpha-one', // see [I-016]",
      "  'beta-two', /* [x] */ 'gamma-three',",
      '],',
    ].join('\n');
    expect(toolSetNamesOf(source)).toEqual(['alpha-one', 'beta-two', 'gamma-three']);
  });

  it('finds every quoted tool entry between TOOL_SETS and TOOL_SETS_ENV', () => {
    const source = read('../../mcp-server/src/tool-sets.ts');
    const start = source.indexOf('export const TOOL_SETS:');
    const end = source.indexOf('export const TOOL_SETS_ENV');
    const quoted = new Set<string>();
    for (const block of stripComments(source.slice(start, end)).matchAll(
      /tools:\s*\[([\s\S]*?)\n\s*\],/g
    )) {
      for (const name of block[1].matchAll(/'([a-z][a-z0-9-]*)'/g)) quoted.add(name[1]);
    }
    expect(toolSetNames().sort()).toEqual([...quoted].sort());
  });

  it('runs every write tool and every guarded plan tool, or records why not', () => {
    const names = toolSetNames();
    expect(names.length).toBeGreaterThan(50);
    const sweep = read('../../../scripts/live-write-sweep.mjs');
    const missing = names
      // classifyTool calls plan-* tools reads (they only plan), but they are the guarded writes.
      .filter(name => classifyTool(name) !== 'read' || name.startsWith('plan-'))
      .filter(name => !sweep.includes(`'${name}'`) && !(name in RECORDED_SKIPS));
    expect(missing, `add a sweep step (or a recorded skip) for: ${missing.join(', ')}`).toEqual([]);
  });

  it('keeps no skip entry for a tool that no longer exists or that the sweep now runs', () => {
    const names = toolSetNames();
    const sweep = read('../../../scripts/live-write-sweep.mjs');
    for (const name of Object.keys(RECORDED_SKIPS)) {
      expect(names).toContain(name);
      expect(sweep.includes(`'${name}'`)).toBe(false);
    }
  });
});
