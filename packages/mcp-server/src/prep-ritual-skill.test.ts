/**
 * The prep ritual skill (tools/prep-ritual/SKILL.md) names only real tools: a renamed or removed
 * tool fails here instead of the skill telling Claude to call something that is gone. Same pattern
 * as docs-tool-names.test.ts. It also checks the skill reaches all five steps and the pre-flight.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { stubToolRouterDeps } from './test-support/stub-tool-deps.js';
import { collectToolDefinitions } from './tool-router.js';
import { TOOL_SETS } from './tool-sets.js';

const SKILL = readFileSync(
  fileURLToPath(new URL('../../../tools/prep-ritual/SKILL.md', import.meta.url)),
  'utf8'
);

/** Backticked names in the skill that are not tools. */
const OTHER_NAMES = new Set(['foundry-mcp', 'foundry-mcp-prep']);

describe('prep ritual skill', () => {
  const tools = new Set(collectToolDefinitions(stubToolRouterDeps()).map(t => t.name));
  const names = [...SKILL.matchAll(/`([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`/g)].map(m => m[1]);

  it('names at least the tools of the five steps', () => {
    for (const tool of [
      'get-prep-digest',
      'list-scenes',
      'suggest-balanced-encounter',
      'get-player-handouts',
      'get-preflight',
      'apply-planned-change',
    ]) {
      expect(names).toContain(tool);
    }
  });

  it('names only real tools', () => {
    const unknown = names.filter(n => !tools.has(n) && !OTHER_NAMES.has(n));
    expect(unknown).toEqual([]);
  });

  it('names only tools of the core and prep sets', () => {
    const allowed = new Set([...TOOL_SETS.core.tools, ...TOOL_SETS.prep.tools]);
    const outside = names.filter(n => tools.has(n) && !allowed.has(n));
    expect(outside).toEqual([]);
  });

  it('has five numbered steps and ends with the ready checklist', () => {
    for (let i = 1; i <= 5; i++) expect(SKILL).toContain(`### Step ${i} of 5:`);
    expect(SKILL.indexOf('## The ready checklist')).toBeGreaterThan(
      SKILL.indexOf('### Step 5 of 5')
    );
  });

  it('has no em dashes', () => {
    expect(SKILL).not.toContain(String.fromCharCode(0x2014));
  });
});
