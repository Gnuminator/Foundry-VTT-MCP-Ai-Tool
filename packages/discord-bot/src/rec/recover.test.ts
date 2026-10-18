import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sessionFolderName, uniqueSessionDir } from '../bot.js';
import { RecordingSession, type Clock } from './session.js';
import { findOrphans, recoverMessage, recoverOrphans } from './recover.js';

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'discord-recover-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const clock: Clock = { now: () => 0 };
const anna = { userId: '111', username: 'anna', displayName: 'Anna' };

/** A session that was never stopped: tracks on disk, no session.json, no convert report. */
async function crashedSession(parent: string, name: string): Promise<string> {
  const dir = join(parent, name);
  const s = new RecordingSession(dir, clock, {}, new Date('2026-10-04T17:30:00Z'));
  s.packet(anna, Buffer.from([0xfc, 1, 0, 0]), undefined);
  await s.stop('test'); // closes the files; the crash is simulated by removing session.json
  rmSync(join(dir, 'raw', 'session.json'));
  return dir;
}

function age(dir: string, ms: number): void {
  const t = new Date(Date.now() - ms);
  for (const f of ['1-anna.rec', 'events.jsonl']) utimesSync(join(dir, 'raw', f), t, t);
}

describe('uniqueSessionDir', () => {
  it('does not reuse a folder from the same minute', () => {
    const parent = tempDir();
    const d = new Date(2026, 9, 4, 19, 30, 15);
    const first = uniqueSessionDir(parent, d);
    expect(first.endsWith(`${sessionFolderName(d)}`)).toBe(true);
    mkdirSync(first);
    const second = uniqueSessionDir(parent, d);
    expect(second).not.toBe(first);
    expect(second.endsWith('-discord-2')).toBe(true);
    mkdirSync(second);
    expect(uniqueSessionDir(parent, d).endsWith('-discord-3')).toBe(true);
  });
});

describe('orphan recovery', () => {
  it('converts an old unconverted run and reports it', async () => {
    const parent = tempDir();
    const dir = await crashedSession(parent, '2026-10-04_1930-discord');
    age(dir, 3_600_000);
    expect(findOrphans(parent)).toEqual([dir]);
    const outcomes = recoverOrphans(parent);
    expect(outcomes).toEqual([{ dir, ok: true, tracks: 1 }]);
    expect(existsSync(join(dir, '1-anna.ogg'))).toBe(true);
    expect(recoverMessage(outcomes)).toContain('converted 1 track');
    expect(findOrphans(parent)).toEqual([]); // convert-report.json now exists
  });

  it('leaves a fresh run, the active run and folders without tracks alone', async () => {
    const parent = tempDir();
    const fresh = await crashedSession(parent, 'fresh');
    const old = await crashedSession(parent, 'old');
    age(old, 3_600_000);
    mkdirSync(join(parent, 'empty', 'raw'), { recursive: true });
    writeFileSync(join(parent, 'note.txt'), 'x');
    expect(findOrphans(parent)).toEqual([old]);
    expect(findOrphans(parent, { skipDir: old })).toEqual([]);
    expect(fresh).toBeTruthy();
  });

  it('reports a folder that fails and still handles the others', async () => {
    const parent = tempDir();
    const a = await crashedSession(parent, 'a');
    const b = await crashedSession(parent, 'b');
    age(a, 3_600_000);
    age(b, 3_600_000);
    const outcomes = recoverOrphans(parent, {}, dir => {
      if (dir === a) throw new Error('bad track');
      return { dir, tracks: [], speakersWritten: false };
    });
    expect(outcomes.map(o => o.ok)).toEqual([false, true]);
    expect(recoverMessage(outcomes)).toContain('could not convert (bad track)');
    expect(recoverMessage([])).toBeUndefined();
  });
});
