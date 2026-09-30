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
 */
import { TOOL_REF_KEY, checkToolRefs, stripToolRefs } from '@gnuminator/shared';
import { describe, expect, it } from 'vitest';

import { stubToolRouterDeps } from './test-support/stub-tool-deps.js';
import { buildToolRouter, collectToolDefinitions } from './tool-router.js';

const deps = stubToolRouterDeps();

const tools = collectToolDefinitions(deps);

describe('tool catalog', () => {
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
});
