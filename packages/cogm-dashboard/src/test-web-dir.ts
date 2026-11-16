/**
 * A stand-in for the built React dashboard (dist/web) for tests that start the real app and ask
 * for `/`: one folder per test process with a bare index.html, so a test does not depend on
 * `vite build` having run and the app does not log "not built".
 */
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

let dir: string | null = null;

export function testWebDir(): string {
  if (dir === null) {
    dir = mkdtempSync(path.join(tmpdir(), 'cogm-test-web-'));
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>test</title>');
  }
  return dir;
}
