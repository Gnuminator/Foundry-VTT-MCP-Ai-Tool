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
  it('lists exactly 86 tools; control methods such as record_usage are not tools', () => {
    expect(tools).toHaveLength(86);
    for (const method of [
      'record_usage',
      'session_switches',
      'feature_switches',
      'character_sheet',
    ]) {
      expect(tools.map(t => t.name)).not.toContain(method);
      expect(Object.keys(buildToolRouter(deps))).not.toContain(method);
    }
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
    // Budgets with some room. Raise one only on purpose.
    // I-124 raised core and prep by 2,000 for the tool hints (title, readOnlyHint, destructiveHint).
    const budget = {
      core: 17_000,
      play: 30_000, // about 29,100 with the I-124 hints: close
      prep: 22_000,
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

  it('keeps the tool counts and sizes in README.md and docs/reference/TOOL-SETS.md true', () => {
    const read = (path: string): string =>
      readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), 'utf8').replace(
        /\r\n/g,
        '\n'
      );
    const num = (text: string): number => Number(text.replace(/,/g, ''));
    const size = (value: unknown): number => JSON.stringify(stripToolRefs(value)).length;
    const within10 = (file: string, what: string, written: number, actual: number): void => {
      expect(
        Math.abs(written - actual) / actual,
        `${file}: ${what} says ${written}, measured ${actual}; update the number`
      ).toBeLessThanOrEqual(0.1);
    };
    /** The first capture group of `pattern` in `text`, or a failure naming the file. */
    const grab = (file: string, text: string, pattern: RegExp): number => {
      const match = pattern.exec(text);
      expect(match, `${file}: no text matching ${pattern}`).not.toBeNull();
      return num(match![1]);
    };
    const total = size(tools);

    const docFile = 'docs/reference/TOOL-SETS.md';
    const doc = read(docFile);
    expect(grab(docFile, doc, /The bridge has ([\d,]+) tools\./), `${docFile}: tool count`).toBe(
      tools.length
    );
    within10(docFile, 'total size', grab(docFile, doc, /about ([\d,]+) characters of JSON/), total);
    // The token range is the character count at about 4.2 and 3.2 characters per token.
    within10(
      docFile,
      'low token estimate',
      grab(docFile, doc, /about ([\d,]+) to\s+[\d,]+\s+tokens/),
      total / 4.2
    );
    within10(
      docFile,
      'high token estimate',
      grab(docFile, doc, /about [\d,]+ to\s+([\d,]+)\s+tokens/),
      total / 3.2
    );
    const corePrep = size(filterToolsBySets(tools, resolveToolSets('core,prep')));
    within10(
      docFile,
      'core and prep size',
      grab(docFile, doc, /core and prep on carries about ([\d,]+) characters/),
      corePrep
    );
    within10(
      docFile,
      'total in the core and prep sentence',
      grab(docFile, doc, /characters instead of ([\d,]+)\./),
      total
    );
    const corePercent = (100 * size(filterToolsBySets(tools, resolveToolSets('core')))) / total;
    expect(
      Math.abs(grab(docFile, doc, /Core alone is\s+about (\d+)% of everything/) - corePercent),
      `${docFile}: core share, measured ${corePercent.toFixed(1)}%; update the number`
    ).toBeLessThanOrEqual(2);
    for (const set of TOOL_SET_NAMES) {
      const row = new RegExp(
        String.raw`^\| \*\*${set}\*\*\s*\|[^|]*\|\s*([\d,]+)\s*\|\s*about ([\d,]+)\s*\|`,
        'm'
      );
      const match = row.exec(doc);
      expect(match, `${docFile}: no table row for ${set}`).not.toBeNull();
      expect(num(match![1]), `${docFile}: tool count of ${set}`).toBe(TOOL_SETS[set].tools.length);
      within10(
        docFile,
        `size of ${set}`,
        num(match![2]),
        size(filterToolsBySets(tools, resolveToolSets(set)))
      );
    }

    const readmeFile = 'README.md';
    const readme = read(readmeFile);
    expect(
      grab(readmeFile, readme, /([\d,]+) tools in five sets/),
      `${readmeFile}: tool count`
    ).toBe(tools.length);
    expect(
      grab(readmeFile, readme, /([\d,]+) tools let Claude/),
      `${readmeFile}: tool count in the feature list`
    ).toBe(tools.length);
    expect(
      grab(readmeFile, readme, /serves all ([\d,]+) tools/),
      `${readmeFile}: tool count in the setup section`
    ).toBe(tools.length);
    expect(
      grab(readmeFile, readme, /all ([\d,]+) tools are about/),
      `${readmeFile}: tool count in the size sentence`
    ).toBe(tools.length);
    within10(
      readmeFile,
      'total size',
      grab(readmeFile, readme, /tools are about ([\d,]+) characters/),
      total
    );
    for (const set of TOOL_SET_NAMES) {
      const row = new RegExp(String.raw`^\| \*\*${set}\*\*\s*\|\s*([\d,]+)\s*\|`, 'm');
      const match = row.exec(readme);
      expect(match, `${readmeFile}: no table row for ${set}`).not.toBeNull();
      expect(num(match![1]), `${readmeFile}: tool count of ${set}`).toBe(
        TOOL_SETS[set].tools.length
      );
    }
  });
});
