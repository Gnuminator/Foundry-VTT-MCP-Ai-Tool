/**
 * Every registered bridge handler has a caller, and every full wire name the backend or
 * dashboard sends has a handler. The callers are read from the sources of the backend
 * (`packages/mcp-server/src`), the dashboard and `shared/src`. A handler counts as called when
 * a source file writes its full wire name (`foundry-mcp-bridge.<name>`) or its bare name as a
 * quoted string (`query('manageRest', ...)`, `LIVE_PLAN_QUERY = 'planLiveChange'`). A handler
 * nothing calls (dead code that still counts as a gated write and carries tests) or a full wire
 * name with no handler (a typo that only fails at runtime) fails here.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|mjs)$/.test(entry) && !/\.(test|stories|generated)\.[a-z]+$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** The text of every caller source file (tests, stories and generated files left out). */
function callerSources(): string[] {
  return CALLER_DIRS.flatMap(dir => sourceFiles(join(repoRoot, dir))).map(file =>
    readFileSync(file, 'utf8')
  );
}

/** The method names the callers write as full wire names (a `flags.` path is a document flag). */
function fullNamesSent(sources: string[]): Set<string> {
  const names = new Set<string>();
  const pattern = new RegExp(`(?<!flags\\.)${MODULE_ID}\\.([A-Za-z][A-Za-z0-9-]*)`, 'g');
  for (const text of sources) {
    for (const m of text.matchAll(pattern)) names.add(m[1]);
  }
  return names;
}

/** Whether any caller writes `name` as a full wire name or as a quoted bare name. */
function isCalled(name: string, sources: string[], full: Set<string>): boolean {
  if (full.has(name)) return true;
  return sources.some(text => ["'", '"', '`'].some(q => text.includes(q + name + q)));
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

describe('bridge handlers and the names the backend and dashboard send', () => {
  it('every registered handler has a caller', () => {
    new QueryHandlers().registerHandlers();
    const registered = bridgeHandlers.methods().map(m => m.slice(MODULE_ID.length + 1));
    const sources = callerSources();
    const full = fullNamesSent(sources);
    const uncalled = registered
      .filter(n => !(n in CALLED_ANOTHER_WAY) && !isCalled(n, sources, full))
      .sort();
    expect(uncalled).toEqual([]);
  });

  it('every name the callers send has a handler', () => {
    new QueryHandlers().registerHandlers();
    const registered = new Set(bridgeHandlers.methods().map(m => m.slice(MODULE_ID.length + 1)));
    const unknown = [...fullNamesSent(callerSources())].filter(n => !registered.has(n)).sort();
    expect(unknown).toEqual([]);
  });

  it('the exceptions list names only registered handlers', () => {
    new QueryHandlers().registerHandlers();
    const registered = new Set(bridgeHandlers.methods().map(m => m.slice(MODULE_ID.length + 1)));
    expect(Object.keys(CALLED_ANOTHER_WAY).filter(n => !registered.has(n))).toEqual([]);
  });
});
