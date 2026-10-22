import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { defaultSessionsDir, sessionsDirFrom } from './sessions-dir.js';

describe('sessions folder', () => {
  it('defaults to Documents/FoundrySessions under the home folder', () => {
    expect(defaultSessionsDir('/home/x')).toBe(join('/home/x', 'Documents', 'FoundrySessions'));
  });

  it('uses FVTT_SESSIONS_DIR when it is set and not empty', () => {
    expect(sessionsDirFrom('D:/rec', '/home/x')).toBe('D:/rec');
    expect(sessionsDirFrom('', '/home/x')).toBe(defaultSessionsDir('/home/x'));
    expect(sessionsDirFrom(undefined, '/home/x')).toBe(defaultSessionsDir('/home/x'));
  });
});
