/**
 * Feeds `npm run tool-eval`: with TOOL_EVAL_DUMP=<file> this writes main's real tool list (names,
 * descriptions, schemas, the set of each tool) and the connector instructions for every set
 * combination to that file, the way docs:tools writes its page. The eval stub serves them. Without
 * the variable it only checks the dump is complete.
 */
import { writeFileSync } from 'node:fs';

import { stripToolRefs } from '@gnuminator/shared';
import { describe, expect, it } from 'vitest';

import { stubToolRouterDeps } from './test-support/stub-tool-deps.js';
import { collectToolDefinitions } from './tool-router.js';
import {
  TOOL_SET_NAMES,
  toolSetInstructions,
  toolSetOf,
  type ServedToolSetName,
} from './tool-sets.js';

function dump(): {
  tools: { name: string; description?: string; inputSchema: unknown; set: string }[];
  instructions: Record<string, string>;
} {
  const tools = stripToolRefs(collectToolDefinitions(stubToolRouterDeps())).map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    set: toolSetOf(t.name) ?? 'core',
  }));
  const instructions: Record<string, string> = {};
  const others = TOOL_SET_NAMES.filter(s => s !== 'core');
  for (let mask = 0; mask < 1 << others.length; mask++) {
    const sets = ['core', ...others.filter((_, i) => mask & (1 << i))] as ServedToolSetName[];
    const all = sets.length === TOOL_SET_NAMES.length;
    instructions[sets.join(',')] = toolSetInstructions({ sets, all });
  }
  return { tools, instructions };
}

describe('tool eval dump', () => {
  it('lists every tool with a set and has instructions for each set combination', () => {
    const out = dump();
    if (process.env.TOOL_EVAL_DUMP) writeFileSync(process.env.TOOL_EVAL_DUMP, JSON.stringify(out));
    expect(out.tools.length).toBeGreaterThan(80);
    expect(out.tools.every(t => t.description && t.inputSchema)).toBe(true);
    expect(Object.keys(out.instructions)).toHaveLength(1 << (TOOL_SET_NAMES.length - 1));
  });
});
