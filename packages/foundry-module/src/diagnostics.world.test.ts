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
