import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runVaultCli, type CliIo } from './cli.js';
import { VaultStore } from './store.js';
import { exportWorld, importWorld, type VaultBundle } from './transfer.js';
import { WorldIdResolver } from './world-id.js';

let tmp: string;
let store: VaultStore;

beforeEach(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'vault-transfer-'));
  store = new VaultStore({ dataDir: path.join(tmp, 'vault') });
});

afterEach(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
});

async function seed(): Promise<void> {
  await store.write('w1', 'gm', 'tarokka.json', { cards: ['a'] });
  await store.write('w1', 'backups', 'c1.json', { deleted: {} });
  await store.appendLines('w1', 'sessions', '2026-09-28.jsonl', [{ id: 'e1' }, { id: 'e2' }]);
}

describe('export/import', () => {
  it('round-trips every file byte for byte', async () => {
    await seed();
    const bundle = await exportWorld(store, 'w1');
    expect(bundle.files.map(f => `${f.area}/${f.file}`)).toEqual([
      'gm/tarokka.json',
      'sessions/2026-09-28.jsonl',
      'backups/c1.json',
    ]);

    const other = new VaultStore({ dataDir: path.join(tmp, 'restore') });
    expect(await importWorld(other, JSON.parse(JSON.stringify(bundle)))).toEqual({
      worldId: 'w1',
      written: 3,
    });
    for (const f of bundle.files) {
      expect(await other.readRaw('w1', f.area, f.file)).toBe(f.content);
    }
  });

  it('refuses to overwrite unless asked, and can import into another world', async () => {
    await seed();
    const bundle = await exportWorld(store, 'w1');
    await expect(importWorld(store, bundle)).rejects.toThrow(/Refusing to overwrite 3/);
    await store.write('w1', 'gm', 'tarokka.json', { cards: ['changed'] });
    await importWorld(store, bundle, { overwrite: true });
    expect((await store.read('w1', 'gm', 'tarokka.json'))?.data).toEqual({ cards: ['a'] });

    await importWorld(store, bundle, { worldId: 'w2' });
    expect(await store.listAll('w2')).toHaveLength(3);
  });

  it('rejects malformed bundles before writing anything', async () => {
    const base: VaultBundle = {
      format: 'foundry-ai-tool-vault',
      version: 1,
      worldId: 'w1',
      exportedAt: '',
      files: [],
    };
    const file = (area: string, name: string, content: unknown): Record<string, unknown> => ({
      area,
      file: name,
      content,
    });
    const cases: Array<[unknown, RegExp]> = [
      [null, /Not a Foundry AI Tool vault bundle/],
      [{ ...base, format: 'zip' }, /Not a Foundry AI Tool/],
      [{ ...base, version: 2 }, /Unsupported vault bundle version/],
      [{ ...base, worldId: '../x' }, /world id/],
      [{ ...base, files: 'x' }, /no files list/],
      [{ ...base, files: [file('gm', '../x.json', '{}')] }, /file name/],
      [{ ...base, files: [file('etc', 'x.json', '{}')] }, /area/],
      [{ ...base, files: [file('gm', 'x.json', 5)] }, /No content/],
      [{ ...base, files: [file('gm', 'x.json', '{')] }, /not valid JSON/],
      [{ ...base, files: [file('gm', 'x.json', '{"a":1}')] }, /envelope/],
      [
        {
          ...base,
          files: [file('sessions', 'a.jsonl', ''), file('sessions', 'a.jsonl', '')],
        },
        /Duplicate/,
      ],
    ];
    for (const [bundle, message] of cases) {
      await expect(importWorld(store, bundle)).rejects.toThrow(message);
    }
    expect(await store.listWorlds()).toEqual([]);
  });
});

describe('vault CLI', () => {
  function io(): { out: string[]; err: string[]; io: CliIo } {
    const out: string[] = [];
    const err: string[] = [];
    return {
      out,
      err,
      io: {
        out: (t: string): void => void out.push(t),
        err: (t: string): void => void err.push(t),
        env: { FOUNDRY_AI_DATA_DIR: store.dataDir },
      },
    };
  }

  it('prints the path, worlds and files', async () => {
    await seed();
    const a = io();
    expect(await runVaultCli(['path'], a.io)).toBe(0);
    expect(await runVaultCli(['worlds'], a.io)).toBe(0);
    expect(await runVaultCli(['list', 'w1'], a.io)).toBe(0);
    expect(a.out).toEqual([
      store.dataDir,
      'w1',
      'gm/tarokka.json',
      'sessions/2026-09-28.jsonl',
      'backups/c1.json',
    ]);
  });

  it('exports to a file (never overwriting one) and imports into another world', async () => {
    await seed();
    const bundlePath = path.join(tmp, 'bundle.json');
    const a = io();
    expect(await runVaultCli(['export', 'w1', bundlePath], a.io)).toBe(0);
    expect(a.err[0]).toMatch(/Exported 3 file\(s\)/);
    expect(await runVaultCli(['export', 'w1', bundlePath], a.io)).toBe(1);

    expect(await runVaultCli(['import', bundlePath, '--world', 'w9'], a.io)).toBe(0);
    expect(await store.listAll('w9')).toHaveLength(3);
    expect(await runVaultCli(['import', bundlePath, '--world', 'w9'], a.io)).toBe(1);
    expect(a.err.at(-1)).toMatch(/Refusing to overwrite/);
    expect(await runVaultCli(['import', bundlePath, '--world', 'w9', '--overwrite'], a.io)).toBe(0);
  });

  it('exports to stdout without a file', async () => {
    await seed();
    const a = io();
    expect(await runVaultCli(['export', 'w1'], a.io)).toBe(0);
    expect(JSON.parse(a.out[0]).files).toHaveLength(3);
  });

  it('prints usage for bad arguments', async () => {
    const a = io();
    for (const argv of [
      [],
      ['nope'],
      ['list'],
      ['export'],
      ['import'],
      ['import', 'x', '--world'],
    ]) {
      expect(await runVaultCli(argv, a.io)).toBe(2);
    }
    expect(a.err.every(t => t.startsWith('Usage:'))).toBe(true);
  });
});

describe('WorldIdResolver', () => {
  function client(worldId: unknown = 'curse-of-strahd'): {
    state: { connected: boolean; serial: number; worldId: unknown };
    query: ReturnType<typeof vi.fn>;
    source: Record<string, unknown>;
  } {
    const state = { connected: true, serial: 1, worldId };
    const query = vi.fn(() => Promise.resolve({ id: state.worldId }));
    return {
      state,
      query,
      source: {
        query,
        isConnected: (): boolean => state.connected,
        getConnectionSerial: (): number => state.serial,
      },
    };
  }

  it('asks Foundry once per connection', async () => {
    const c = client();
    const resolver = new WorldIdResolver(c.source as never);
    const [a, b] = await Promise.all([resolver.current(), resolver.current()]);
    expect([a, b, await resolver.current()]).toEqual(Array(3).fill('curse-of-strahd'));
    expect(c.query).toHaveBeenCalledTimes(1);
    expect(c.query).toHaveBeenCalledWith('foundry-mcp-bridge.getWorldInfo');

    c.state.serial = 2;
    c.state.worldId = 'other-world';
    expect(await resolver.current()).toBe('other-world');
    expect(c.query).toHaveBeenCalledTimes(2);

    resolver.reset();
    await resolver.current();
    expect(c.query).toHaveBeenCalledTimes(3);
  });

  it('fails when Foundry is disconnected or reports an unusable id', async () => {
    const c = client('../../etc');
    const resolver = new WorldIdResolver(c.source as never);
    await expect(resolver.current()).rejects.toThrow(/Invalid world id/);
    c.state.connected = false;
    await expect(resolver.current()).rejects.toThrow(/not connected/);
  });
});
