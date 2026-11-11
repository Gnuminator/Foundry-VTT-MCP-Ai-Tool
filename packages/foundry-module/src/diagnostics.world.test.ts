import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Diagnostics } from './diagnostics.js';

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    addEventListener: () => undefined,
  });
});

afterEach(() => vi.unstubAllGlobals());

const entry = (id: string, timestampMs: number): object => ({
  id,
  timestamp: new Date(timestampMs).toISOString(),
  timestampMs,
  level: 'error',
  message: id,
  stack: null,
  source: null,
  module: null,
  kind: 'console',
  userName: null,
});

/**
 * Foundry's foundry.utils.expandObject over a flat `a.b.c` map, reduced to the part that throws:
 * setProperty walks into an existing value and runs `key in target` on it.
 */
function expandLikeFoundry(flat: Record<string, string>): object {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) {
    const parts = k.split('.');
    const last = parts.pop() ?? '';
    let target = out;
    for (const p of parts) {
      if (target[p] === undefined) target[p] = {};
      target = target[p] as Record<string, unknown>;
    }
    if (!(last in target) || target[last] !== v) target[last] = v;
  }
  return out;
}

describe('Diagnostics.bindWorld', () => {
  it('drops the previous world errors when the world changed, keeps this load', () => {
    store.set('foundry-mcp-bridge.diagnostics', JSON.stringify([entry('old', 1)]));
    store.set('foundry-mcp-bridge.diagnosticsWorld', 'strahd');
    const d = new Diagnostics();
    d.install();
    (d as unknown as { buffer: object[] }).buffer.push(entry('new', Date.now() + 1000));

    expect(d.bindWorld('test-world')).toBe(1);
    expect(d.getErrors().map(e => e.id)).toEqual(['new']);
  });

  it('a second call for the same world drops nothing more', () => {
    store.set('foundry-mcp-bridge.diagnostics', JSON.stringify([entry('old', 1)]));
    store.set('foundry-mcp-bridge.diagnosticsWorld', 'strahd');
    const d = new Diagnostics();
    d.install();
    (d as unknown as { buffer: object[] }).buffer.push(entry('new', Date.now() + 1000));

    expect(d.bindWorld('test-world')).toBe(1);
    expect(d.bindWorld('test-world')).toBe(0);
    expect(d.getErrors().map(e => e.id)).toEqual(['new']);
    expect(store.get('foundry-mcp-bridge.diagnosticsWorld')).toBe('test-world');
  });

  it('the first run (no stored world) drops what was restored and stores the world', () => {
    store.set('foundry-mcp-bridge.diagnostics', JSON.stringify([entry('old', 1)]));
    const d = new Diagnostics();
    d.install();

    expect(d.bindWorld('strahd')).toBe(1);
    expect(d.getErrors()).toEqual([]);
    expect(store.get('foundry-mcp-bridge.diagnosticsWorld')).toBe('strahd');
  });

  it('does not write errors captured before the bind under the previous world', () => {
    store.set('foundry-mcp-bridge.diagnostics', JSON.stringify([entry('old', 1)]));
    store.set('foundry-mcp-bridge.diagnosticsWorld', 'strahd');
    const d = new Diagnostics();
    d.install();
    (
      d as unknown as {
        capture: (p: object) => void;
      }
    ).capture({ level: 'error', kind: 'console', message: 'early', stack: null, source: null });

    // Storage is untouched while the world is unknown: no mix of old marker and new error.
    expect(JSON.parse(store.get('foundry-mcp-bridge.diagnostics') ?? '[]')).toHaveLength(1);
    expect(store.get('foundry-mcp-bridge.diagnosticsWorld')).toBe('strahd');

    d.bindWorld('test-world');
    const saved = JSON.parse(store.get('foundry-mcp-bridge.diagnostics') ?? '[]') as {
      message: string;
    }[];
    expect(saved.map(e => e.message)).toEqual(['early']);
    expect(store.get('foundry-mcp-bridge.diagnosticsWorld')).toBe('test-world');
  });

  it('persists the early errors on bind when the world is unchanged', () => {
    store.set('foundry-mcp-bridge.diagnosticsWorld', 'strahd');
    const d = new Diagnostics();
    d.install();
    (d as unknown as { capture: (p: object) => void }).capture({
      level: 'warn',
      kind: 'console',
      message: 'early',
      stack: null,
      source: null,
    });
    expect(store.has('foundry-mcp-bridge.diagnostics')).toBe(false);
    d.bindWorld('strahd');
    expect(JSON.parse(store.get('foundry-mcp-bridge.diagnostics') ?? '[]')).toHaveLength(1);
  });

  it('keeps the errors when the world is the same', () => {
    store.set('foundry-mcp-bridge.diagnostics', JSON.stringify([entry('old', 1)]));
    store.set('foundry-mcp-bridge.diagnosticsWorld', 'strahd');
    const d = new Diagnostics();
    d.install();

    expect(d.bindWorld('strahd')).toBe(0);
    expect(d.getErrors().map(e => e.id)).toEqual(['old']);
  });
});

describe('Diagnostics world key migration', () => {
  it('moves the old dotted world key to the new key and removes it at install', () => {
    store.set('foundry-mcp-bridge.diagnostics', JSON.stringify([entry('old', 1)]));
    store.set('foundry-mcp-bridge.diagnostics.world', 'strahd');
    const d = new Diagnostics();
    d.install();

    expect(store.has('foundry-mcp-bridge.diagnostics.world')).toBe(false);
    expect(store.get('foundry-mcp-bridge.diagnosticsWorld')).toBe('strahd');
    expect(d.bindWorld('strahd')).toBe(0);
    expect(d.getErrors().map(e => e.id)).toEqual(['old']);
  });

  it('drops the old errors when the migrated world differs from the bound one', () => {
    store.set('foundry-mcp-bridge.diagnostics', JSON.stringify([entry('old', 1)]));
    store.set('foundry-mcp-bridge.diagnostics.world', 'strahd');
    const d = new Diagnostics();
    d.install();

    expect(d.bindWorld('other-world')).toBe(1);
    expect(d.getErrors()).toEqual([]);
    expect(store.get('foundry-mcp-bridge.diagnosticsWorld')).toBe('other-world');
  });

  it('keeps an existing new key over the old one', () => {
    store.set('foundry-mcp-bridge.diagnostics.world', 'old-world');
    store.set('foundry-mcp-bridge.diagnosticsWorld', 'strahd');
    new Diagnostics().install();

    expect(store.has('foundry-mcp-bridge.diagnostics.world')).toBe(false);
    expect(store.get('foundry-mcp-bridge.diagnosticsWorld')).toBe('strahd');
  });

  it('leaves storage that expandObject can read (no key is a dotted prefix of another)', () => {
    store.set('foundry-mcp-bridge.diagnostics', JSON.stringify([entry('old', 1)]));
    store.set('foundry-mcp-bridge.diagnostics.world', 'strahd');
    expect(() => expandLikeFoundry(Object.fromEntries(store))).toThrow(
      /Cannot use 'in' operator to search for 'world'/
    );

    const d = new Diagnostics();
    d.install();
    d.bindWorld('test-world');
    expect(() => expandLikeFoundry(Object.fromEntries(store))).not.toThrow();
  });
});
