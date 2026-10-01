/**
 * The whole tool catalog, built from the real tool classes (with stub
 * dependencies: definitions do not touch them).
 *
 * - Every tool has exactly one control-channel route and every route a tool.
 * - Every parameter that names something carries a picker annotation
 *   (`toolRef(...)` or `freeText(reason)`, see shared/src/tool-refs.ts), so the
 *   dashboard's tool runner can offer a list instead of a blank field. A new
 *   tool with an unannotated `...Id` / `...Name` / `targets` parameter fails
 *   here.
 * - Every tool is in exactly one tool set (tool-sets.ts), and each set stays
 *   within its size budget: the sets exist to keep Claude Desktop's context small.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { TOOL_REF_KEY, checkToolRefs, stripToolRefs } from '@gnuminator/shared';
import { describe, expect, it } from 'vitest';

import { stubToolRouterDeps } from './test-support/stub-tool-deps.js';
import { buildToolRouter, collectToolDefinitions } from './tool-router.js';
import { TOOL_SETS, TOOL_SET_NAMES, filterToolsBySets, resolveToolSets } from './tool-sets.js';

const deps = stubToolRouterDeps();

const tools = collectToolDefinitions(deps);

describe('tool catalog', () => {
  it('lists exactly 89 tools; control methods such as record_usage are not tools', () => {
    expect(tools).toHaveLength(89);
    expect(tools.map(t => t.name)).not.toContain('record_usage');
    expect(Object.keys(buildToolRouter(deps))).not.toContain('record_usage');
  });

  it('has unique names, one route per tool and a tool per route', () => {
    const names = tools.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(Object.keys(buildToolRouter(deps)).sort()).toEqual([...names].sort());
  });

  it('annotates every parameter that names something (picker or free text)', () => {
    expect(tools.flatMap(t => checkToolRefs(t))).toEqual([]);
  });

  it('gives MCP clients the schemas without the annotations', () => {
    expect(JSON.stringify(tools)).toContain(TOOL_REF_KEY);
    expect(JSON.stringify(stripToolRefs(tools))).not.toContain(TOOL_REF_KEY);
  });

  it('puts every tool in exactly one tool set, and sets list only real tools', () => {
    const listed = TOOL_SET_NAMES.flatMap(set => TOOL_SETS[set].tools);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(tools.map(t => t.name).sort());
  });

  it('keeps each tool set within its size budget (characters of JSON Claude Desktop receives)', () => {
    // Budgets with some room; all tools were about 92,500 characters at 95 tools (before F5 replaced four tools with one). Raise one only on purpose.
    const budget = {
      core: 15_000,
      play: 30_000,
      prep: 20_000,
      build: 28_000,
      admin: 8_000,
    } as const;
    for (const set of TOOL_SET_NAMES) {
      const served = stripToolRefs(filterToolsBySets(tools, resolveToolSets(set)));
      expect(JSON.stringify(served).length, set).toBeLessThanOrEqual(budget[set]);
    }
  });

  it('matches the set lists in docs/reference/TOOL-SETS.md', () => {
    const doc = readFileSync(
      fileURLToPath(new URL('../../../docs/reference/TOOL-SETS.md', import.meta.url)),
      'utf8'
    ).replace(/\r\n/g, '\n');
    for (const set of TOOL_SET_NAMES) {
      // The bullet "- **<set>:** `a`, `b`, ..." runs until the next bullet or a blank line.
      const start = doc.indexOf(`- **${set}:**`);
      expect(start, set).toBeGreaterThanOrEqual(0);
      const rest = doc.slice(start + 1);
      const end = Math.min(
        ...['\n- **', '\n\n'].map(s => rest.indexOf(s)).filter(n => n >= 0),
        rest.length
      );
      const block = rest.slice(0, end);
      const named = [...block.matchAll(/`([^`]+)`/g)].map(m => m[1]);
      expect(named, set).toEqual([...TOOL_SETS[set].tools]);
    }
  });
});
