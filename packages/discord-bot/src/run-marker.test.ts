import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  claimRunMarker,
  clearRunMarker,
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
});
