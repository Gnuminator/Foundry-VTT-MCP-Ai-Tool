// Keeps the page shots out of the repo. The full-page shots (dashboard moments, drawers, player
// pages) are rendered on every CI run and uploaded as an artifact (web/visual/page-shot.ts), not
// committed: a control added to a page used to change dozens of committed PNGs. Only the story
// shots are committed, in __screenshots__/stories/. This test fails if any other file comes back.
import { readdirSync, statSync } from 'node:fs';
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
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? filesBelow(full) : [full];
  });
}

describe('committed screenshots', () => {
  it('hold story shots only, no page shot', () => {
    const stray = filesBelow(root)
      .map(file => path.relative(root, file).split(path.sep).join('/'))
      .filter(rel => !(rel.startsWith('stories/') && rel.endsWith('.png')));
    expect(
      stray,
      'page shots are not committed (they are the CI artifact dashboard-page-shots-N); delete these from web/visual/__screenshots__/'
    ).toEqual([]);
  });
});
