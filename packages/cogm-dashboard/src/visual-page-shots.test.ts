// Keeps screenshots out of the repo. The full-page shots (dashboard moments, drawers, player
// pages) are rendered on every CI run and uploaded as an artifact (web/visual/page-shot.ts), and
// the story shots are rendered on both sides (base and head) in CI and shown in the artifact
// dashboard-visual-diff. Nothing is committed: a restyle used to change dozens of PNGs. This test
// fails if any file comes back under web/visual/__screenshots__/.
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'web',
  'visual',
  '__screenshots__'
);

function filesBelow(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? filesBelow(full) : [full];
  });
}

describe('committed screenshots', () => {
  it('hold no PNG at all', () => {
    const stray = filesBelow(root).map(file => path.relative(root, file).split(path.sep).join('/'));
    expect(
      stray,
      'screenshots are not committed (page shots: artifact dashboard-page-shots-N; story shots: artifact dashboard-visual-diff); delete these from web/visual/__screenshots__/'
    ).toEqual([]);
  });
});
