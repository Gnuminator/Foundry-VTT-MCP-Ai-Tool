/**
 * The player vault renders only from its own input (sheets, handouts, the player log). It never
 * reads the GM-side export index or the GM vault's mirror notes, so GM-only mirror content (such
 * as a scene's "Who is here" list with hidden tokens) cannot reach a player folder. This pins it:
 * no player-vault source file may import or name those sources.
 */
import { readdirSync, readFileSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { describe, expect, it } from 'vitest';

const DIR = path.dirname(fileURLToPath(import.meta.url));

const FORBIDDEN: Array<[string, RegExp]> = [
  ['the export index', /getExportIndex|export-index/],
  ['export index rows', /\bExport(Scene|Actor|Journal|Item|Page)\w*\b/],
  ['the GM vault mirror', /from\s+['"][^'"]*(\/obsidian\/|mirror-(render|pump|common|scan))/],
  ['GM mirror note folders', /AI Tool\/Foundry/],
];

function sources(): string[] {
  return readdirSync(DIR)
    .filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort();
}

describe('player vault isolation', () => {
  it('has source files to check', () => {
    expect(sources()).toContain('render.ts');
    expect(sources()).toContain('service.ts');
  });

  it.each(sources())('%s never reads the export index or the GM mirror', name => {
    const text = readFileSync(path.join(DIR, name), 'utf8');
    for (const [what, pattern] of FORBIDDEN) {
      expect(pattern.test(text), `${name} names ${what}`).toBe(false);
    }
  });
});
