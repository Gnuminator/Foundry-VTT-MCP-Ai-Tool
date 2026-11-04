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

describe('Diagnostics.bindWorld', () => {
  it('drops the previous world errors when the world changed, keeps this load', () => {
    store.set('foundry-mcp-bridge.diagnostics', JSON.stringify([entry('old', 1)]));
    store.set('foundry-mcp-bridge.diagnostics.world', 'strahd');
    const d = new Diagnostics();
    d.install();
    (d as unknown as { buffer: object[] }).buffer.push(entry('new', Date.now() + 1000));

    expect(d.bindWorld('test-world')).toBe(1);
    expect(d.getErrors().map(e => e.id)).toEqual(['new']);
  });

  it('keeps the errors when the world is the same', () => {
    store.set('foundry-mcp-bridge.diagnostics', JSON.stringify([entry('old', 1)]));
    store.set('foundry-mcp-bridge.diagnostics.world', 'strahd');
    const d = new Diagnostics();
    d.install();

    expect(d.bindWorld('strahd')).toBe(0);
    expect(d.getErrors().map(e => e.id)).toEqual(['old']);
  });
});
