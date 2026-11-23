/**
 * Every registered bridge handler has a caller, and every full wire name the backend or
 * dashboard sends has a handler. The callers are read from the sources of the backend
 * (`packages/mcp-server/src`), the dashboard and `shared/src`. A handler counts as called when
 * a string literal in code (not a comment or a type key) is its full wire name (`foundry-mcp-bridge.<name>`)
 * or, for camelCase names, its bare name (`query('manageRest', ...)`, `LIVE_PLAN_QUERY = 'planLiveChange'`);
 * a kebab-case handler needs its full wire name, since the bare string is also an MCP tool name. A
 * handler nothing calls (dead code that still counts as a gated write and carries tests) or a
 * full wire name with no handler (a typo that only fails at runtime) fails here.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bridgeHandlers } from './bridge-handlers.js';
import { MODULE_ID } from './constants.js';
import { QueryHandlers } from './queries.js';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const CALLER_DIRS = [
  'packages/mcp-server/src',
  'packages/cogm-dashboard/src',
  'packages/cogm-dashboard/web/src',
  'shared/src',
];

/**
 * Handlers whose caller does not write the full wire name as a literal (the name is built from
 * a variable) or that Foundry itself calls. Each entry says who calls it; keep this list short.
 */
const CALLED_ANOTHER_WAY: Record<string, string> = {};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'test-support') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (
      /\.(ts|tsx|mjs)$/.test(entry) &&
      !/\.(test|stories|generated)\.[a-z]+$/.test(entry) &&
      // The typed method map lists every method as a type key, not as a call.
      entry !== 'bridge-queries.ts'
    ) {
      out.push(full);
    }
  }
  return out;
}

/** The text of every string literal in the caller sources (comments and type keys do not count). */
function literalsOf(fileName: string, text: string): string[] {
  const out: string[] = [];
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    const typeOnly =
      ts.isLiteralTypeNode(node.parent ?? node) ||
      (ts.isPropertySignature(node.parent ?? node) &&
        (node.parent as ts.PropertySignature).name === node);
    if (typeOnly) {
      // A quoted type key or a string literal type is not a call.
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      out.push(node.text);
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      out.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

let cachedLiterals: string[] | undefined;

/** Parsed once: the scan reads every backend, dashboard and shared source file. */
function callerLiterals(): string[] {
  cachedLiterals ??= CALLER_DIRS.flatMap(dir => sourceFiles(join(repoRoot, dir))).flatMap(file =>
    literalsOf(file, readFileSync(file, 'utf8'))
  );
  return cachedLiterals;
}

/** The method names the callers write as full wire names (a `flags.` or `settings.` path is not a call). */
function fullNamesSent(literals: string[]): Set<string> {
  const names = new Set<string>();
  const pattern = new RegExp(
    `(?<!flags\\.|settings\\.)${MODULE_ID}\\.([A-Za-z][A-Za-z0-9-]*)`,
    'g'
  );
  for (const text of literals) {
    for (const m of text.matchAll(pattern)) names.add(m[1]);
  }
  return names;
}

/**
 * Whether a caller names `name`: as a full wire name, or (camelCase names only) as a bare string
 * such as `query('manageRest')` or a `*_QUERY` constant. A bare kebab-case string is also an MCP
 * tool name, so a kebab handler needs its full wire name.
 */
function isCalled(name: string, literals: string[], full: Set<string>): boolean {
  if (full.has(name)) return true;
  return !name.includes('-') && literals.includes(name);
}

let world: TestWorld;
let restore: () => void;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  world = createTestWorld();
  restore = world.install();
  (globalThis as any).CONFIG.queries = {};
  bridgeHandlers.deleteByPrefix('');
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

describe(
  'bridge handlers and the names the backend and dashboard send',
  { timeout: 60_000 },
  () => {
    it('every registered handler has a caller', () => {
      new QueryHandlers().registerHandlers();
      const registered = bridgeHandlers.methods().map(m => m.slice(MODULE_ID.length + 1));
      const literals = callerLiterals();
      const full = fullNamesSent(literals);
      const uncalled = registered
        .filter(n => !(n in CALLED_ANOTHER_WAY) && !isCalled(n, literals, full))
        .sort();
      expect(uncalled).toEqual([]);
    });

    it('every name the callers send has a handler', () => {
      new QueryHandlers().registerHandlers();
      const registered = new Set(bridgeHandlers.methods().map(m => m.slice(MODULE_ID.length + 1)));
      const unknown = [...fullNamesSent(callerLiterals())].filter(n => !registered.has(n)).sort();
      expect(unknown).toEqual([]);
    });

    it('a comment or a type-only mention does not count as a caller', () => {
      const source = [
        '// `getTokenDetails` is mentioned here',
        '/** and `getTokenDetails` here */',
        'interface T { getTokenDetails: string }',
        "const call = query('manageRest');",
        "interface Q { 'getTokenDetails': string; m: 'getTokenDetails' | 'ping' }",
      ].join('\n');
      const literals = literalsOf('x.ts', source);
      expect(literals).toEqual(['manageRest']);
      expect(isCalled('getTokenDetails', literals, new Set())).toBe(false);
      expect(isCalled('manageRest', literals, new Set())).toBe(true);
      // A bare kebab-case string is a tool name, not a wire call.
      expect(isCalled('get-token-details', ['get-token-details'], new Set())).toBe(false);
    });

    it('the exceptions list names only registered handlers', () => {
      new QueryHandlers().registerHandlers();
      const registered = new Set(bridgeHandlers.methods().map(m => m.slice(MODULE_ID.length + 1)));
      expect(Object.keys(CALLED_ANOTHER_WAY).filter(n => !registered.has(n))).toEqual([]);
    });
  }
);
