import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VaultStore } from './store.js';

let dataDir: string;

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vault-store-'));
});

afterEach(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true });
});

function makeStore(extra: Partial<ConstructorParameters<typeof VaultStore>[0]> = {}): VaultStore {
  return new VaultStore({
    dataDir,
    now: () => new Date('2026-09-28T10:00:00.000Z'),
    renameRetryDelaysMs: [1, 1, 1],
    ...extra,
  });
}

describe('VaultStore JSON files', () => {
  it('writes an envelope under <dataDir>/<worldId>/<area>/ and reads it back', async () => {
    const store = makeStore();
    await store.write('w1', 'gm', 'tarokka.json', { cards: [1, 2] }, 3);
    const raw = JSON.parse(
      await fsp.readFile(path.join(dataDir, 'w1', 'gm', 'tarokka.json'), 'utf8')
    );
    expect(raw).toEqual({
      schema: 3,
      updatedAt: '2026-09-28T10:00:00.000Z',
      data: { cards: [1, 2] },
    });
    expect(await store.read('w1', 'gm', 'tarokka.json')).toEqual(raw);
    expect(await store.read('w1', 'gm', 'missing.json')).toBeNull();
  });

  it('leaves no temp files behind', async () => {
    const store = makeStore();
    await store.write('w1', 'gm', 'a.json', 1);
    await store.write('w1', 'gm', 'a.json', 2);
    expect(await fsp.readdir(path.join(dataDir, 'w1', 'gm'))).toEqual(['a.json']);
  });

  it('reports a corrupt file and never overwrites it through update', async () => {
    const store = makeStore();
    const file = path.join(dataDir, 'w1', 'gm', 'bad.json');
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, '{not json');
    await expect(store.read('w1', 'gm', 'bad.json')).rejects.toThrow(/not valid JSON/);
    await expect(store.update('w1', 'gm', 'bad.json', 1, () => ({}))).rejects.toThrow(
      /not valid JSON/
    );
    expect(await fsp.readFile(file, 'utf8')).toBe('{not json');

    await fsp.writeFile(file, '{"just":"data"}');
    await expect(store.read('w1', 'gm', 'bad.json')).rejects.toThrow(/envelope/);
  });

  it('serializes concurrent updates to one file (no lost writes)', async () => {
    const store = makeStore();
    await Promise.all(
      Array.from({ length: 25 }, () =>
        store.update<number>('w1', 'gm', 'counter.json', 1, async current => {
          const value = current?.data ?? 0;
          await new Promise(r => setTimeout(r, 1));
          return value + 1;
        })
      )
    );
    expect((await store.read<number>('w1', 'gm', 'counter.json'))?.data).toBe(25);
  });

  it('keeps the queue going after a failed update', async () => {
    const store = makeStore();
    await expect(
      store.update('w1', 'gm', 'x.json', 1, () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    await store.write('w1', 'gm', 'x.json', 'ok');
    expect((await store.read('w1', 'gm', 'x.json'))?.data).toBe('ok');
  });

  it('retries a rename that fails with EPERM/EBUSY (Windows file locks)', async () => {
    const rename = vi.fn(fsp.rename);
    const locked = Object.assign(new Error('locked'), { code: 'EPERM' });
    const busy = Object.assign(new Error('busy'), { code: 'EBUSY' });
    rename.mockRejectedValueOnce(locked).mockRejectedValueOnce(busy);
    const store = makeStore({ rename });
    await store.write('w1', 'gm', 'a.json', 'v');
    expect(rename).toHaveBeenCalledTimes(3);
    expect((await store.read('w1', 'gm', 'a.json'))?.data).toBe('v');
  });

  it('gives up after the retries, removing the temp file', async () => {
    const locked = Object.assign(new Error('locked'), { code: 'EBUSY' });
    const store = makeStore({ rename: () => Promise.reject(locked) });
    await expect(store.write('w1', 'gm', 'a.json', 'v')).rejects.toThrow('locked');
    expect(await fsp.readdir(path.join(dataDir, 'w1', 'gm'))).toEqual([]);
  });

  it('does not retry other rename errors', async () => {
    const rename = vi.fn(() =>
      Promise.reject(Object.assign(new Error('nope'), { code: 'ENOSPC' }))
    );
    const store = makeStore({ rename });
    await expect(store.write('w1', 'gm', 'a.json', 'v')).rejects.toThrow('nope');
    expect(rename).toHaveBeenCalledTimes(1);
  });

  it('refuses invalid names before touching the disk', async () => {
    const store = makeStore();
    await expect(store.write('../evil', 'gm', 'a.json', 1)).rejects.toThrow(/world id/);
    await expect(store.write('w1', 'gm', '../../a.json', 1)).rejects.toThrow(/file name/);
    expect(await fsp.readdir(dataDir)).toEqual([]);
  });
});

describe('VaultStore lists, lines and removal', () => {
  it('lists worlds and files, skipping temp and foreign names', async () => {
    const store = makeStore();
    await store.write('w1', 'gm', 'b.json', 1);
    await store.write('w1', 'gm', 'a.json', 1);
    await store.appendLines('w1', 'sessions', '2026-09-28.jsonl', [{ id: 1 }]);
    await fsp.writeFile(path.join(dataDir, 'w1', 'gm', '.a.json.1.tmp'), '');
    await fsp.writeFile(path.join(dataDir, 'w1', 'gm', 'notes.txt'), '');
    await fsp.mkdir(path.join(dataDir, 'not a world'));

    expect(await store.listWorlds()).toEqual(['w1']);
    expect(await store.list('w1', 'gm')).toEqual(['a.json', 'b.json']);
    expect(await store.listAll('w1')).toEqual([
      { area: 'gm', file: 'a.json' },
      { area: 'gm', file: 'b.json' },
      { area: 'sessions', file: '2026-09-28.jsonl' },
    ]);
    expect(await store.list('w2', 'gm')).toEqual([]);
    expect(await makeStore({ dataDir: path.join(dataDir, 'nope') }).listWorlds()).toEqual([]);
  });

  it('appends and reads JSON lines, skipping a torn line', async () => {
    const store = makeStore();
    await store.appendLines('w1', 'sessions', 'd.jsonl', [{ a: 1 }, { b: 2 }]);
    await store.appendLines('w1', 'sessions', 'd.jsonl', []);
    await fsp.appendFile(path.join(dataDir, 'w1', 'sessions', 'd.jsonl'), '{"torn":');
    expect(await store.readLines('w1', 'sessions', 'd.jsonl')).toEqual([{ a: 1 }, { b: 2 }]);
    expect(await store.readLines('w1', 'sessions', 'none.jsonl')).toEqual([]);
    await expect(store.appendLines('w1', 'sessions', 'd.json', [1])).rejects.toThrow(/jsonl/);
  });

  it('keeps the newest lines that fit, hands over the rest, and loses no append made meanwhile', async () => {
    const store = makeStore();
    const rows = Array.from({ length: 6 }, (_, i) => ({ n: i }));
    await store.appendLines('w1', 'gm', 'k.jsonl', rows);
    // Each line is `{"n":i}` plus a newline: 8 characters.
    expect(await store.keepLastLines('w1', 'gm', 'k.jsonl', 100)).toBe(0);
    const dropped: unknown[] = [];
    const kept: unknown[] = [];
    let renamedYet: boolean | null = null;
    const keeping = store.keepLastLines('w1', 'gm', 'k.jsonl', 24, {
      onDropped: v => dropped.push(v),
      onKept: v => kept.push(v),
      beforeRename: async () => {
        renamedYet = (await store.readLines('w1', 'gm', 'k.jsonl')).length !== 6;
      },
    });
    const appending = store.appendLines('w1', 'gm', 'k.jsonl', [{ n: 6 }]);
    expect(await keeping).toBe(3);
    await appending;
    expect(dropped).toEqual([{ n: 0 }, { n: 1 }, { n: 2 }]);
    expect(kept).toEqual([{ n: 3 }, { n: 4 }, { n: 5 }]);
    expect(renamedYet).toBe(false);
    expect(await store.readLines('w1', 'gm', 'k.jsonl')).toEqual([
      { n: 3 },
      { n: 4 },
      { n: 5 },
      { n: 6 },
    ]);
    // The last line always stays, and a missing file is left alone.
    expect(await store.keepLastLines('w1', 'gm', 'k.jsonl', 1)).toBe(3);
    expect(await store.readLines('w1', 'gm', 'k.jsonl')).toEqual([{ n: 6 }]);
    expect(await store.keepLastLines('w1', 'gm', 'none.jsonl', 1)).toBe(0);
    expect(await store.list('w1', 'gm')).toEqual(['k.jsonl']);
    // A failing beforeRename leaves the file as it was and its temp file removed.
    await store.appendLines('w1', 'gm', 'k.jsonl', [{ n: 7 }]);
    await expect(
      store.keepLastLines('w1', 'gm', 'k.jsonl', 1, {
        beforeRename: () => Promise.reject(new Error('no state')),
      })
    ).rejects.toThrow('no state');
    expect(await store.readLines('w1', 'gm', 'k.jsonl')).toEqual([{ n: 6 }, { n: 7 }]);
    expect(await fsp.readdir(path.join(dataDir, 'w1', 'gm'))).toEqual(['k.jsonl']);
  });

  it('removes only old temp files of the given prefix', async () => {
    const store = makeStore();
    const dir = path.join(dataDir, 'w1', 'gm');
    await fsp.mkdir(dir, { recursive: true });
    const old = '.changes-2026-10-07.jsonl.12.abc.tmp';
    for (const name of [old, '.changes-2026-10-08.jsonl.12.def.tmp', '.other.json.12.a.tmp']) {
      await fsp.writeFile(path.join(dir, name), 'x');
    }
    const hourAgo = new Date(Date.now() - 3_600_000);
    await fsp.utimes(path.join(dir, old), hourAgo, hourAgo);
    await fsp.utimes(path.join(dir, '.other.json.12.a.tmp'), hourAgo, hourAgo);
    expect(await store.removeStaleTemps('w1', 'gm', 'changes-', 600_000)).toEqual([old]);
    expect((await fsp.readdir(dir)).sort()).toEqual([
      '.changes-2026-10-08.jsonl.12.def.tmp',
      '.other.json.12.a.tmp',
    ]);
    expect(await store.removeStaleTemps('w2', 'gm', 'changes-', 0)).toEqual([]);
  });

  it('reads JSON lines one at a time with their length, across CRLF, blank and bad lines', async () => {
    const store = makeStore();
    await fsp.mkdir(path.join(dataDir, 'w1', 'gm'), { recursive: true });
    await fsp.writeFile(
      path.join(dataDir, 'w1', 'gm', 'c.jsonl'),
      '{"a":1}\r\n\r\nnot json\n{"b":"æ"}\n{"torn":'
    );
    const seen: Array<[unknown, number]> = [];
    await store.forEachLine('w1', 'gm', 'c.jsonl', (value, chars) => {
      seen.push([value, chars]);
    });
    expect(seen).toEqual([
      [{ a: 1 }, 7],
      [{ b: 'æ' }, 9],
    ]);
    let calls = 0;
    await store.forEachLine('w1', 'gm', 'none.jsonl', () => {
      calls += 1;
    });
    expect(calls).toBe(0);
    // A throw from the callback is the caller's, not a bad line to skip.
    await expect(
      store.forEachLine('w1', 'gm', 'c.jsonl', () => {
        throw new Error('stop');
      })
    ).rejects.toThrow('stop');
  });

  it('removes files, tolerating missing ones', async () => {
    const store = makeStore();
    await store.write('w1', 'backups', 'x.json', 1);
    await store.remove('w1', 'backups', 'x.json');
    await store.remove('w1', 'backups', 'x.json');
    expect(await store.read('w1', 'backups', 'x.json')).toBeNull();
  });
});
