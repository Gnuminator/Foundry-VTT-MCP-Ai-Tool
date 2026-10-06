// Tests for the pure parts of scripts/pi/world-refs.mjs (no LevelDB):
//   node --test scripts/pi/world-refs.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  classifyPath,
  collectPaths,
  normalizeAssetPath,
  pathsInString,
  secretSettingKeys,
  summarize,
} from './world-refs.mjs';

test('normalizeAssetPath keeps local asset paths and drops everything else', () => {
  assert.equal(
    normalizeAssetPath('/ddb-images/other/monster/Bat%20Swarm.webp?v=2'),
    'ddb-images/other/monster/Bat Swarm.webp'
  );
  assert.equal(normalizeAssetPath('./tcoe/images/cover.jpg'), 'tcoe/images/cover.jpg');
  assert.equal(normalizeAssetPath('modules/aitool-content/a.OGG'), 'modules/aitool-content/a.OGG');
  assert.equal(normalizeAssetPath('https://example.com/a.png'), null);
  assert.equal(normalizeAssetPath('data:image/png;base64,AAAA'), null);
  assert.equal(normalizeAssetPath('//cdn.example.com/a.png'), null);
  assert.equal(normalizeAssetPath('notes.txt'), null);
  assert.equal(normalizeAssetPath('Fireball.png'), null, 'a bare name is not a path');
  assert.equal(normalizeAssetPath('../secret/a.png'), null);
  assert.equal(normalizeAssetPath('<img src="a/b.png">'), null);
});

test('pathsInString reads src and url() inside HTML', () => {
  const html =
    '<p><img src="/ddb-images/adventures/Curse_of_Strahd/a.webp"> <a href="https://x.org/y.png">x</a></p>' +
    '<div style="background: url(\'modules/aitool-content/b.jpg\')"></div>';
  assert.deepEqual(pathsInString(html).sort(), [
    'ddb-images/adventures/Curse_of_Strahd/a.webp',
    'modules/aitool-content/b.jpg',
  ]);
});

test('collectPaths walks nested objects and arrays', () => {
  const doc = {
    img: 'icons/svg/mystery-man.svg',
    prototypeToken: { texture: { src: 'tokenizer/npc-images/a.png' } },
    items: [{ img: 'worlds/w/x.webp' }, { name: 'text' }],
  };
  assert.deepEqual([...collectPaths(doc)].sort(), [
    'icons/svg/mystery-man.svg',
    'tokenizer/npc-images/a.png',
    'worlds/w/x.webp',
  ]);
});

test('classifyPath sorts paths by root and names the folder to copy', () => {
  assert.deepEqual(classifyPath('icons/svg/x.svg'), { root: 'core' });
  assert.deepEqual(classifyPath('modules/dae/a.png'), { root: 'modules', id: 'dae' });
  assert.deepEqual(classifyPath('worlds/curse-of-strahd/a.png'), {
    root: 'worlds',
    id: 'curse-of-strahd',
  });
  assert.deepEqual(classifyPath('systems/dnd5e/a.png'), { root: 'systems', id: 'dnd5e' });
  assert.deepEqual(classifyPath('ddb-images/adventures/Curse_of_Strahd/assets/a.png'), {
    root: 'ddb-images',
    folder: 'ddb-images/adventures/Curse_of_Strahd',
  });
  assert.deepEqual(classifyPath('ddb-images/other/monster/a.webp'), {
    root: 'ddb-images',
    folder: 'ddb-images/other/monster',
  });
  assert.deepEqual(classifyPath('ddb-images/other/a.webp'), {
    root: 'ddb-images',
    folder: 'ddb-images/other',
  });
  assert.deepEqual(classifyPath('tokenizer/npc-images/a.png'), {
    root: 'tokenizer',
    folder: 'tokenizer/npc-images',
  });
  assert.deepEqual(classifyPath('nue/defaultscene/a.webp'), { root: 'other' });
});

test('summarize reports the problems and the folders', () => {
  const paths = new Set([
    'icons/svg/a.svg',
    'ddb-images/other/monster/a.webp',
    'ddb-images/other/monster/gone.webp',
    'modules/aitool-content/a.png',
    'modules/foundry-mcp-bridge/a.png',
    'modules/JB2A_DnD5e/a.webm',
    'worlds/other-world/a.png',
    'weird/a.png',
  ]);
  const s = summarize(paths, {
    world: 'curse-of-strahd',
    modules: ['aitool-content'],
    exists: p => !p.endsWith('gone.webp'),
  });
  assert.equal(s.counts['ddb-images'], 2);
  assert.deepEqual(s.folders, ['ddb-images/other/monster']);
  assert.deepEqual([...s.problems.foreignModules], ['JB2A_DnD5e']);
  assert.deepEqual([...s.problems.foreignWorlds], ['other-world']);
  assert.deepEqual(s.problems.missing, ['ddb-images/other/monster/gone.webp']);
  assert.deepEqual(s.problems.other, ['weird/a.png']);
});

test('secretSettingKeys lists key names with a value and never values', () => {
  const docs = [
    { key: 'ddb-importer.cobalt-cookie', value: '"abc"' },
    { key: 'ddb-importer.empty', value: '""' },
    { key: 'foo.apiKey', value: '"k"' },
    { key: 'foo.patreon-token', value: '' },
    { key: 'core.language', value: '"en"' },
    { key: 'bar.Secret', value: 'x' },
    { key: 'core.dynamicTokenRing', value: 'true' },
    { key: 'ddb-importer.entity-spell-compendium', value: '"world.spells"' },
  ];
  assert.deepEqual(secretSettingKeys(docs), [
    'bar.Secret',
    'ddb-importer.cobalt-cookie',
    'ddb-importer.entity-spell-compendium',
    'foo.apiKey',
  ]);
  assert.deepEqual(secretSettingKeys(docs, ['bar.Secret']), [
    'ddb-importer.cobalt-cookie',
    'ddb-importer.entity-spell-compendium',
    'foo.apiKey',
  ]);
  assert.deepEqual(secretSettingKeys(docs, ['ddb-importer.entity-*', 'bar.Secret']), [
    'ddb-importer.cobalt-cookie',
    'foo.apiKey',
  ]);
});

const remote = path.join(path.dirname(fileURLToPath(import.meta.url)), 'remote');
const hasBash = spawnSync('bash', ['-c', 'true']).status === 0;

test(
  'stage 11 and the helpers it runs with parse (bash -n)',
  { skip: !hasBash && 'bash is not available' },
  () => {
    for (const file of ['lib.sh', '11-world.sh']) {
      const r = spawnSync('bash', ['-n', path.join(remote, file)], { encoding: 'utf8' });
      assert.equal(r.status, 0, `${file}: ${r.stderr}`);
    }
  }
);
