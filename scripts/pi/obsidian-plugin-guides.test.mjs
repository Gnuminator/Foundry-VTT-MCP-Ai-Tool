// The sync guides carry the same Syncthing ignore lines as Pi stage 33 and stage 7 (backlog obsidian-plugin-via-vault):
//   node --test scripts/pi/obsidian-plugin-guides.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INCLUDES = ['main.js', 'manifest.json', 'styles.css'].map(
  (f) => `!.obsidian/plugins/foundry-ai-tool/${f}`
);

test('the guides carry the three include lines above .obsidian/plugins, English and Danish', () => {
  for (const p of ['docs/gm/setup-obsidian-sync.md', 'docs/da/gm/setup-obsidian-sync.md']) {
    const t = readFileSync(path.join(repo, p), 'utf8');
    for (const l of INCLUDES) assert.ok(t.includes(l), `${p} has ${l}`);
    assert.ok(
      t.indexOf(INCLUDES[0]) < t.indexOf('\n   .obsidian/plugins\n'),
      `${p}: includes above the plugins line`
    );
  }
});
