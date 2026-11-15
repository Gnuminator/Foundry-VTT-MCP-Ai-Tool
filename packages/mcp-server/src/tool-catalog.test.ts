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
import { TOOL_SET_BUDGETS } from './tool-budgets.js';
import { TOOL_HINTS } from './tool-hints.js';
import { TOOL_MODULES } from './tools/index.js';
import { instanceOf } from './tools/tool-module.js';
import { buildToolRouter, collectToolDefinitions } from './tool-router.js';
import {
  ALL_TOOL_SET_NAMES,
  PLAYER_TOOL_SET,
  TOOL_SETS,
  filterToolsBySets,
  resolveToolSets,
} from './tool-sets.js';

const deps = stubToolRouterDeps();

const tools = collectToolDefinitions(deps);

/** The tools one set lists (the player set is not reachable through resolveToolSets). */
const inSet = (set: (typeof ALL_TOOL_SET_NAMES)[number]): typeof tools =>
  tools.filter(t => TOOL_SETS[set].tools.includes(t.name));

describe('tool catalog', () => {
  it('lists the tools of the tool modules in order; control methods such as record_usage are not tools', () => {
    expect(tools.map(t => t.name)).toEqual(TOOL_MODULES.flatMap(m => Object.keys(m.tools)));
    expect(tools.length).toBeGreaterThan(0);
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
    // The player tools have no call_tool route: they run only through the player_tool message.
    const playerTools = TOOL_SETS[PLAYER_TOOL_SET].tools;
    expect(Object.keys(buildToolRouter(deps)).sort()).toEqual(
      names.filter(n => !playerTools.includes(n)).sort()
    );
  });

  it('keeps the tools map of each module equal to its definitions and routes', () => {
    const names = new Set<string>();
    for (const module of TOOL_MODULES) {
      const instance = instanceOf(deps, module);
      const defined = module.definitions(instance).map(d => d.name);
      expect(Object.keys(module.tools), module.id).toEqual(defined);
      // Player tools have no call_tool route (they run only through the player_tool message).
      const routed = defined.filter(name => module.tools[name]?.set !== PLAYER_TOOL_SET);
      expect(Object.keys(module.routes).sort(), module.id).toEqual([...routed].sort());
      for (const name of defined) {
        expect(names.has(name), `${name} declared twice`).toBe(false);
        names.add(name);
        expect(ALL_TOOL_SET_NAMES as readonly string[], name).toContain(module.tools[name]?.set);
      }
    }
  });

  it('annotates every parameter that names something (picker or free text)', () => {
    expect(tools.flatMap(t => checkToolRefs(t))).toEqual([]);
  });

  it('gives MCP clients the schemas without the annotations', () => {
    expect(JSON.stringify(tools)).toContain(TOOL_REF_KEY);
    expect(JSON.stringify(stripToolRefs(tools))).not.toContain(TOOL_REF_KEY);
  });

  it('puts every tool in exactly one tool set, and sets list only real tools', () => {
    const listed = ALL_TOOL_SET_NAMES.flatMap(set => TOOL_SETS[set].tools);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(tools.map(t => t.name).sort());
  });

  it('keeps each tool set within its size budget (characters of JSON Claude Desktop receives)', () => {
    // Budgets are in tool-budgets.ts (user-owned: a raise needs the user's OK).
    for (const set of ALL_TOOL_SET_NAMES) {
      const served = stripToolRefs(inSet(set));
      const size = JSON.stringify(served).length;
      // Read by scripts/drift-check.mjs, which prints these lines and warns under 500 characters.
      // Written before the assertion, so an over-budget set still shows its (negative) room.
      const room = TOOL_SET_BUDGETS[set] - size;
      process.stdout.write(
        `tool-set headroom: ${set} ${room} characters (${size} of ${TOOL_SET_BUDGETS[set]})${room < 500 ? ' WARNING: under 500, the next tool needs a raise (the user decides)' : ''}\n`
      );
      // A GitHub warning annotation on the CI run; nothing fails for it.
      if (room < 500 && process.env.GITHUB_ACTIONS) {
        process.stdout.write(
          `::warning title=Tool-set headroom::${set} has ${room} characters left; the next tool needs a raise (the user decides)\n`
        );
      }
      expect(size, set).toBeLessThanOrEqual(TOOL_SET_BUDGETS[set]);
    }
  });

  it('matches the set lists in docs/reference/TOOL-SETS.md', () => {
    const doc = readFileSync(
      fileURLToPath(new URL('../../../docs/reference/TOOL-SETS.md', import.meta.url)),
      'utf8'
    ).replace(/\r\n/g, '\n');
    for (const set of ALL_TOOL_SET_NAMES) {
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

  it('keeps the tool counts and sizes in docs/reference/TOOL-SETS.md true and out of README.md', () => {
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
    for (const set of ALL_TOOL_SET_NAMES) {
      const row = new RegExp(
        String.raw`^\| \*\*${set}\*\*\s*\|[^|]*\|\s*([\d,]+)\s*\|\s*about ([\d,]+)\s*\|`,
        'm'
      );
      const match = row.exec(doc);
      expect(match, `${docFile}: no table row for ${set}`).not.toBeNull();
      expect(num(match![1]), `${docFile}: tool count of ${set}`).toBe(TOOL_SETS[set].tools.length);
      within10(docFile, `size of ${set}`, num(match![2]), size(inSet(set)));
    }

    // The README carries no tool counts or sizes (they drift); they live in the generated docs.
    const readme = read('README.md');
    expect(readme, 'README.md: a hard-coded tool count').not.toMatch(/\b\d[\d,]*\s+tools\b/);
    expect(readme, 'README.md: a hard-coded definition size').not.toMatch(/[\d,]+ characters of/);
    for (const set of ALL_TOOL_SET_NAMES) {
      expect(readme, `README.md: a tool count column for ${set}`).not.toMatch(
        new RegExp(String.raw`^\| \*\*${set}\*\*\s*\|\s*[\d,]+\s*\|`, 'm')
      );
    }
  });

  it('marks every direct write "Direct write." and no plan-* tool', () => {
    // The connector instructions promise: a tool whose description starts "Direct write." acts
    // at once; plan-* tools only stage. apply-planned-change and undo-change are the plan story's
    // own writes, not direct ones.
    // plan-actor-image is hinted as a write (it stores a file when planned, the user 2026-11-11)
    // but only stages the actor change, so it is no "Direct write." either.
    const planStory = new Set(['apply-planned-change', 'undo-change', 'plan-actor-image']);
    const missing = tools
      .filter(t => TOOL_HINTS[t.name]?.kind !== 'read' && !planStory.has(t.name))
      .filter(t => !(t.description ?? '').startsWith('Direct write.'))
      .map(t => t.name);
    expect(missing, 'writes whose description does not start "Direct write."').toEqual([]);
    const plans = tools
      .filter(t => t.name.startsWith('plan-') && (t.description ?? '').startsWith('Direct write.'))
      .map(t => t.name);
    expect(plans, 'plan-* tools marked "Direct write."').toEqual([]);
    for (const name of planStory)
      expect(tools.find(t => t.name === name)?.description ?? '').not.toMatch(/^Direct write\./);
  });
});
