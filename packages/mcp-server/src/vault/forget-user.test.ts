import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runVaultCli, type CliIo } from './cli.js';
import { forgetUser } from './forget-user.js';
import { VaultStore } from './store.js';

let tmp: string;
let store: VaultStore;

beforeEach(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'vault-forget-'));
  store = new VaultStore({ dataDir: path.join(tmp, 'vault') });
});

afterEach(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
});

const play = (
  key: string,
  kind: string,
  userId: string | null,
  userName?: string
): Record<string, unknown> => ({
  v: 2,
  key,
  t: 1,
  seq: 1,
  kind,
  userId,
  ...(userName ? { userName } : {}),
  sceneId: null,
  ...(kind === 'chat' ? { data: { text: `said by ${userName ?? userId}` } } : {}),
});

const usage = (
  key: string,
  userId: string | null,
  name: string | null
): Record<string, unknown> => ({
  v: 1,
  key,
  t: 1,
  seq: 1,
  clientId: 'c',
  surface: 'player-page',
  kind: 'view',
  name: 'handouts',
  who: { role: 'player', userId, name },
});

async function seed(): Promise<void> {
  await store.appendLines('w1', 'sessions', '2026-09-28.play.jsonl', [
    play('r1', 'roll', 'u-anna', 'Anna'),
    play('c1', 'chat', 'u-anna', 'Anna'),
    play('c2', 'chat', 'u-bo', 'Bo'),
    play('h1', 'hp', null),
  ]);
  await store.appendLines('w1', 'sessions', '2026-09-29.play.jsonl', [
    play('c3', 'chat', 'u-anna', ' anna '),
  ]);
  await store.appendLines('w1', 'sessions', '2026-09-28.usage.jsonl', [
    usage('k1', 'u-anna', 'Anna'),
    usage('k2', null, 'Bo'),
  ]);
  await store.appendLines('w1', 'sessions', '2026-09-28.jsonl', [
    { id: 'e1', description: 'Anna rolled' },
  ]);
}

async function keys(file: string): Promise<string[]> {
  return (await store.readLines('w1', 'sessions', file)).map(r => (r as { key: string }).key);
}

describe('forgetUser', () => {
  it('removes every play and usage record of the user, by name (any case) or id', async () => {
    await seed();
    const result = await forgetUser(store, 'w1', { user: 'ANNA' });
    expect(result.removed).toBe(4);
    expect(result.files).toEqual([
      { file: '2026-09-28.play.jsonl', removed: 2, kept: 2 },
      { file: '2026-09-28.usage.jsonl', removed: 1, kept: 1 },
      { file: '2026-09-29.play.jsonl', removed: 1, kept: 0 },
    ]);
    expect(await keys('2026-09-28.play.jsonl')).toEqual(['c2', 'h1']);
    expect(await keys('2026-09-28.usage.jsonl')).toEqual(['k2']);
    // A file left empty is removed; the session event log is not touched.
    expect(await store.list('w1', 'sessions')).toEqual([
      '2026-09-28.jsonl',
      '2026-09-28.play.jsonl',
      '2026-09-28.usage.jsonl',
    ]);
    expect(await store.readLines('w1', 'sessions', '2026-09-28.jsonl')).toHaveLength(1);

    expect((await forgetUser(store, 'w1', { user: 'u-bo' })).removed).toBe(1);
    expect(await keys('2026-09-28.play.jsonl')).toEqual(['h1']);
  });

  it('with chatOnly removes only the chat the user wrote', async () => {
    await seed();
    const result = await forgetUser(store, 'w1', { user: 'Anna', chatOnly: true });
    expect(result.removed).toBe(2);
    expect(await keys('2026-09-28.play.jsonl')).toEqual(['r1', 'c2', 'h1']);
    expect(await keys('2026-09-28.usage.jsonl')).toEqual(['k1', 'k2']);
  });

  it('changes nothing in a dry run, and keeps lines it cannot read', async () => {
    await seed();
    await fsp.appendFile(store.filePath('w1', 'sessions', '2026-09-28.play.jsonl'), '{"torn');
    const before = await store.readRaw('w1', 'sessions', '2026-09-28.play.jsonl');
    const dry = await forgetUser(store, 'w1', { user: 'Anna', dryRun: true });
    expect(dry).toMatchObject({ removed: 4, dryRun: true });
    expect(await store.readRaw('w1', 'sessions', '2026-09-28.play.jsonl')).toBe(before);

    await forgetUser(store, 'w1', { user: 'Anna' });
    expect(await store.readRaw('w1', 'sessions', '2026-09-28.play.jsonl')).toContain('{"torn');
  });

  it('needs a user', async () => {
    await expect(forgetUser(store, 'w1', { user: '  ' })).rejects.toThrow(/Name the user/);
  });
});

describe('vault forget-user', () => {
  function io(running: boolean): { out: string[]; err: string[]; io: CliIo } {
    const out: string[] = [];
    const err: string[] = [];
    return {
      out,
      err,
      io: {
        out: (t: string): void => void out.push(t),
        err: (t: string): void => void err.push(t),
        env: { FOUNDRY_AI_DATA_DIR: store.dataDir },
        bridgeRunning: (): boolean => running,
      },
    };
  }

  it('refuses to write while the bridge runs, but a dry run works', async () => {
    await seed();
    const busy = io(true);
    expect(await runVaultCli(['forget-user', 'w1', 'Anna'], busy.io)).toBe(1);
    expect(busy.err.join('\n')).toContain('Quit Claude Desktop');
    expect(await keys('2026-09-28.play.jsonl')).toHaveLength(4);

    expect(await runVaultCli(['forget-user', 'w1', 'Anna', '--dry-run'], busy.io)).toBe(0);
    expect(busy.err.at(-1)).toBe('Would remove 4 record(s) of "Anna" from "w1".');
  });

  it('removes the records and says how to rebuild the Obsidian notes', async () => {
    await seed();
    const a = io(false);
    expect(await runVaultCli(['forget-user', 'w1', 'Anna', '--chat-only'], a.io)).toBe(0);
    expect(a.out).toEqual([
      'sessions/2026-09-28.play.jsonl: 1 removed, 3 kept',
      'sessions/2026-09-29.play.jsonl: 1 removed, 0 kept',
    ]);
    expect(a.err.at(-1)).toContain('npm run obsidian -- export');
  });

  it('accepts a user name with spaces and shows usage without a user', async () => {
    await store.appendLines('w1', 'sessions', '2026-09-28.play.jsonl', [
      play('r1', 'roll', 'u-x', 'Old Marta'),
    ]);
    const a = io(false);
    expect(await runVaultCli(['forget-user', 'w1', 'Old', 'Marta'], a.io)).toBe(0);
    expect(await keys('2026-09-28.play.jsonl')).toEqual([]);
    expect(await runVaultCli(['forget-user', 'w1'], a.io)).toBe(2);
    expect(a.err.at(-1)).toContain('forget-user <worldId> <user>');
  });
});
