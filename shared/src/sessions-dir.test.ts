import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dataFolder, defaultSessionsDir, sessionsDirFrom } from './sessions-dir.js';

describe('sessions folder', () => {
  // The GM's machine may have FVTT_DATA_DIR set; these tests pass what they mean.
  beforeEach(() => vi.stubEnv('FVTT_DATA_DIR', ''));
  afterEach(() => vi.unstubAllEnvs());

  it('defaults to Documents/FoundrySessions under the home folder', () => {
    expect(defaultSessionsDir('/home/x')).toBe(join('/home/x', 'Documents', 'FoundrySessions'));
  });

  it('uses the data folder when a folder lives there, or nothing exists yet', () => {
    const root = mkdtempSync(join(tmpdir(), 'dataf-'));
    try {
      const home = join(root, 'home');
      const data = join(root, 'data');
      // Nothing anywhere: the data folder wins.
      expect(dataFolder('FoundrySessions', data, home)).toBe(join(data, 'FoundrySessions'));
      // Only the old folder exists (not moved yet): the old place answers.
      mkdirSync(join(home, 'Documents', 'FoundrySessions'), { recursive: true });
      expect(dataFolder('FoundrySessions', data, home)).toBe(
        join(home, 'Documents', 'FoundrySessions')
      );
      // Moved: the data folder answers again.
      mkdirSync(join(data, 'FoundrySessions'), { recursive: true });
      expect(defaultSessionsDir(home, data)).toBe(join(data, 'FoundrySessions'));
      // No data folder set: the old place, as before.
      expect(dataFolder('FoundryRehearsals', undefined, home)).toBe(
        join(home, 'Documents', 'FoundryRehearsals')
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses FVTT_SESSIONS_DIR when it is set and not empty', () => {
    expect(sessionsDirFrom('D:/rec', '/home/x')).toBe('D:/rec');
    expect(sessionsDirFrom('', '/home/x')).toBe(defaultSessionsDir('/home/x'));
    expect(sessionsDirFrom(undefined, '/home/x')).toBe(defaultSessionsDir('/home/x'));
  });
});
