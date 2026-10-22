import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { defaultSessionsDir, sessionsDirFrom } from './sessions-dir.js';

describe('the bot keeps a copy of the shared sessions folder helper', () => {
  it('is identical to shared/src/sessions-dir.ts', () => {
    const norm = (t: string): string => t.replace(/\r\n/g, '\n');
    const copy = readFileSync(fileURLToPath(new URL('./sessions-dir.ts', import.meta.url)), 'utf8');
    const shared = readFileSync(
      fileURLToPath(new URL('../../../shared/src/sessions-dir.ts', import.meta.url)),
      'utf8'
    );
    expect(norm(copy)).toBe(norm(shared));
  });

  it('falls back to the default when FVTT_SESSIONS_DIR is empty', () => {
    expect(sessionsDirFrom('', '/home/x')).toBe(defaultSessionsDir('/home/x'));
    expect(sessionsDirFrom('D:/rec', '/home/x')).toBe('D:/rec');
  });
});
