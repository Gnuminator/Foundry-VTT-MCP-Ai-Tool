import { describe, expect, it } from 'vitest';

import { isSessionFolderName, newestSessionFirst } from './session-folder.js';

describe('session folder names', () => {
  it('counts only dated -discord folders', () => {
    expect(isSessionFolderName('2026-10-04_1930-discord')).toBe(true);
    expect(isSessionFolderName('2026-10-04_1930-discord-2')).toBe(true);
    expect(isSessionFolderName('livekit-recordings')).toBe(false);
    expect(isSessionFolderName('.incoming')).toBe(false);
    expect(isSessionFolderName('discord')).toBe(false);
    expect(isSessionFolderName('2026-10-04_1930-discord-notes')).toBe(false);
  });

  it('sorts newest first, restarts as numbers', () => {
    const names = [
      '2026-10-04_1930-discord-9',
      '2026-10-04_1930-discord-10',
      '2026-11-01_1900-discord',
      '2026-10-04_1930-discord',
    ];
    expect(names.sort(newestSessionFirst)).toEqual([
      '2026-11-01_1900-discord',
      '2026-10-04_1930-discord-10',
      '2026-10-04_1930-discord-9',
      '2026-10-04_1930-discord',
    ]);
  });
});
