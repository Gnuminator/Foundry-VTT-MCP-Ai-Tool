/**
 * Atomic writes (docs/OBSIDIAN-PLAN.md O2 item 2): a dot-prefixed temp name in
 * the target directory, renamed into place, retried on a transient Windows
 * rename error.
 */
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeFileAtomic } from './atomic-write.js';

let dir: string;

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'obs-atomic-'));
});

afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

describe('writeFileAtomic', () => {
  it('writes the file via a dot-prefixed temp name that does not survive', async () => {
    const seenTmpNames: string[] = [];
    const target = path.join(dir, 'note.md');
    await writeFileAtomic(target, 'hello', {
      rename: async (from, to) => {
        seenTmpNames.push(path.basename(from));
        await fsp.rename(from, to);
      },
    });
    expect(seenTmpNames).toHaveLength(1);
    expect(seenTmpNames[0]).toMatch(/^\.note\.md\.\d+\.tmp$/);
    expect(await fsp.readFile(target, 'utf8')).toBe('hello');
    const leftover = await fsp.readdir(dir);
    expect(leftover).toEqual(['note.md']);
  });

  it('retries the rename on EPERM/EBUSY/EACCES and eventually succeeds', async () => {
    const target = path.join(dir, 'note.md');
    let attempts = 0;
    await writeFileAtomic(target, 'hello', {
      retryDelaysMs: [0, 0, 0],
      rename: async (from, to) => {
        attempts += 1;
        if (attempts < 3) {
          const error = new Error('busy') as NodeJS.ErrnoException;
          error.code = 'EBUSY';
          throw error;
        }
        await fsp.rename(from, to);
      },
    });
    expect(attempts).toBe(3);
    expect(await fsp.readFile(target, 'utf8')).toBe('hello');
  });

  it('gives up and cleans the temp file after a non-retryable error', async () => {
    const target = path.join(dir, 'note.md');
    await expect(
      writeFileAtomic(target, 'hello', {
        rename: () => Promise.reject(new Error('boom')),
      })
    ).rejects.toThrow('boom');
    const leftover = await fsp.readdir(dir);
    expect(leftover).toEqual([]);
  });
});
