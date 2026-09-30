/**
 * Every control name written in the two pages is a valid usage name for its surface (I-084).
 * The names are literal strings in the source (attributes and calls), so this reads the files
 * the way the catalogue script does: `data-track="..."` and literal `track`, `trackView` and
 * `trackShortcut` calls.
 */
import { readFileSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { USAGE_KINDS, USAGE_NAME_MAX, USAGE_NAME_RE } from '@gnuminator/shared';
import { describe, expect, it } from 'vitest';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

function read(file: string): string {
  return readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
}

interface Found {
  kind: string;
  name: string;
}

function scan(files: string[]): Found[] {
  const found: Found[] = [];
  for (const file of files) {
    const text = read(file);
    for (const m of text.matchAll(/data-track="([^"]+)"/g)) {
      found.push({ kind: 'action', name: m[1] ?? '' });
    }
    for (const m of text.matchAll(/\.track\(\s*'([a-z]+)'\s*,\s*'([^']+)'/g)) {
      found.push({ kind: m[1] ?? '', name: m[2] ?? '' });
    }
    for (const m of text.matchAll(/\.trackView\(\s*'([^']+)'/g)) {
      found.push({ kind: 'view', name: m[1] ?? '' });
    }
    for (const m of text.matchAll(/\.trackShortcut\(\s*'([^']+)'/g)) {
      found.push({ kind: 'shortcut', name: m[1] ?? '' });
    }
  }
  return found;
}

describe.each([
  ['the GM page', ['index.html', 'app.js'], 'dash.'],
  ['the player page', ['player.html', 'player.js'], 'player.'],
])('control names of %s', (_label, files, prefix) => {
  const found = scan(files);

  it('has instrumented controls', () => {
    expect(found.length).toBeGreaterThanOrEqual(5);
  });

  it('are valid, lowercase, literal and use the surface prefix', () => {
    for (const { kind, name } of found) {
      expect(USAGE_KINDS as readonly string[], name).toContain(kind);
      expect(name.length, name).toBeLessThanOrEqual(USAGE_NAME_MAX);
      expect(name, name).toMatch(USAGE_NAME_RE);
      expect(name.startsWith(prefix), name).toBe(true);
    }
  });

  it('never put free text in a name (no spaces, capitals or underscores)', () => {
    for (const { name } of found) expect(name).not.toMatch(/\s|[A-Z_]/);
  });
});

describe('usage.js', () => {
  const source = read('usage.js');

  it('is plain browser JS: no inline scripts in the pages, no eval', () => {
    for (const page of ['index.html', 'player.html']) {
      const html = read(page);
      expect(html).toMatch(/src="(\.\/)?usage\.js"/);
    }
    expect(source).not.toMatch(/\beval\s*\(|new Function\s*\(/);
  });

  it('sends the page-specific endpoint, never reads typed text', () => {
    expect(read('index.html')).toContain('data-usage-endpoint="/api/usage"');
    expect(read('player.html')).toContain('data-usage-endpoint="/api/player/usage"');
    expect(source).not.toMatch(/\.value\b/);
  });
});
