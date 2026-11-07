import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  claimOnReady,
  claimRunMarker,
  clearRunMarker,
  destroyThenClear,
  markerPath,
  restartAfterCrashMessage,
} from './run-marker.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'run-marker-'));
  dirs.push(d);
  return d;
}

describe('run marker', () => {
  it('is silent on a first run and after a clean stop', () => {
    const path = markerPath(tmp());
    expect(claimRunMarker(path, new Date('2026-11-05T20:00:00Z'))).toBeNull();
    expect(existsSync(path)).toBe(true);
    clearRunMarker(path);
    expect(existsSync(path)).toBe(false);
    expect(claimRunMarker(path)).toBeNull();
  });

  it('reports the previous start when the marker was left behind', () => {
    const path = markerPath(tmp());
    claimRunMarker(path, new Date('2026-11-05T20:00:00Z'));
    const previous = claimRunMarker(path, new Date('2026-11-05T20:10:00Z'));
    expect(previous).toBe('2026-11-05T20:00:00.000Z');
    expect(restartAfterCrashMessage(previous!)).toContain('2026-11-05T20:00:00.000Z');
  });

  it('creates the folder and survives an unwritable path', () => {
    const base = tmp();
    expect(claimRunMarker(join(base, 'deep', 'er', '.bot-running'))).toBeNull();
    expect(() => claimRunMarker(join(base, 'file\0bad'))).not.toThrow();
  });

  it('claims the marker only when the bot is ready, so a failed login leaves none', () => {
    const path = markerPath(tmp());
    let ready: () => void = () => {};
    const seen: Array<string | null> = [];
    claimOnReady(
      cb => (ready = cb),
      path,
      previous => seen.push(previous)
    );
    // The login failed: the ready event never came.
    expect(existsSync(path)).toBe(false);
    expect(seen).toEqual([]);
    ready();
    expect(existsSync(path)).toBe(true);
    expect(seen).toEqual([null]);
  });

  it('removes the marker on shutdown even when stopping the client throws', async () => {
    const path = markerPath(tmp());
    claimRunMarker(path);
    await expect(
      destroyThenClear(() => Promise.reject(new Error('socket stuck')), path)
    ).rejects.toThrow('socket stuck');
    expect(existsSync(path)).toBe(false);
  });
});
