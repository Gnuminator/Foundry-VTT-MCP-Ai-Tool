/** The pipeline status line: the newest session folder's notes/status.json. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readPipelineStatus } from './session-notes-route.js';

const dirs: string[] = [];
function sessions(): string {
  const d = mkdtempSync(join(tmpdir(), 'pipeline-status-'));
  dirs.push(d);
  return d;
}
function put(root: string, name: string, body: string): void {
  mkdirSync(join(root, name, 'notes'), { recursive: true });
  writeFileSync(join(root, name, 'notes', 'status.json'), body);
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('readPipelineStatus', () => {
  it('reads the newest session folder', () => {
    const root = sessions();
    put(root, '2026-10-03_0913-a', '{"state":"done","message":"old"}');
    put(
      root,
      '2026-10-10_1900-b',
      '{"state":"incomplete","message":"2 scenes raw","at":"2026-10-11T08:00:00+02:00"}'
    );
    return expect(readPipelineStatus(root)).resolves.toEqual({
      session: '2026-10-10_1900-b',
      state: 'incomplete',
      message: '2 scenes raw',
      at: '2026-10-11T08:00:00+02:00',
    });
  });

  it('does not fall back to an older session when the newest has no status', async () => {
    const root = sessions();
    put(root, '2026-10-03_0913-a', '{"state":"published","message":"old"}');
    mkdirSync(join(root, '2026-10-17_1900-c'));
    expect(await readPipelineStatus(root)).toBeNull();
  });

  it('is null for an unreadable file or an unknown state', async () => {
    const root = sessions();
    put(root, '2026-10-10_1900-b', '{not json');
    expect(await readPipelineStatus(root)).toBeNull();
    put(root, '2026-10-17_1900-c', '{"state":"exploded"}');
    expect(await readPipelineStatus(root)).toBeNull();
  });

  it('is null for a missing folder', async () => {
    expect(await readPipelineStatus(join(tmpdir(), 'no-such-sessions-dir-xyz'))).toBeNull();
  });
});
