import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { classifyTool } from './tool-policy.js';

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

/**
 * Tools of tool-sets.ts the live sweep (scripts/live-write-sweep.mjs) does not run, each with
 * the reason. Empty today: a new write tool gets a sweep step in the same PR, or an entry here.
 */
const RECORDED_SKIPS: Record<string, string> = {};

/** Every tool name listed in a `tools: [...]` array of tool-sets.ts. */
function toolSetNames(): string[] {
  const source = read('../../mcp-server/src/tool-sets.ts');
  const names = new Set<string>();
  for (const block of source.matchAll(/tools:\s*\[([^\]]*)\]/g)) {
    for (const name of block[1].matchAll(/'([a-z][a-z0-9-]*)'/g)) names.add(name[1]);
  }
  return [...names];
}

describe('live sweep coverage (I-016)', () => {
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
