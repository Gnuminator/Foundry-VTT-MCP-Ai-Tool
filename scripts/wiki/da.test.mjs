import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkTwins, englishPages, frontMatter, hashOf, stamp } from './da.mjs';

function tree(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'da-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  return root;
}

const EN = '---\ntitle: Join\n---\n\n# Join\n\nHello.\n';
const twin = hash =>
  `---\ntitle: Kom med\ndescription: Sådan kommer du ind.\nsource: player/join.md\nsourceHash: ${hash}\n---\n\n# Kom med\n\nHej.\n`;

test('hashOf ignores line endings and is 12 hex characters', () => {
  assert.match(hashOf('a\nb\n'), /^[0-9a-f]{12}$/);
  assert.equal(hashOf('a\r\nb\r\n'), hashOf('a\nb\n'));
  assert.notEqual(hashOf('a\n'), hashOf('b\n'));
});

test('frontMatter reads flat keys and drops quotes', () => {
  assert.deepEqual(frontMatter('---\ntitle: "A: b"\nsource: gm/x.md\n---\n\ntext'), {
    title: 'A: b',
    source: 'gm/x.md',
  });
});

test('a current twin passes', () => {
  const root = tree({ 'player/join.md': EN, 'da/player/join.md': twin(hashOf(EN)) });
  assert.deepEqual(englishPages(root), ['player/join.md']);
  assert.deepEqual(checkTwins(root), []);
  rmSync(root, { recursive: true });
});

test('a missing twin, a stale twin, an em dash and an orphan twin are each reported', () => {
  const root = tree({
    'gm/a.md': EN,
    'player/join.md': EN,
    'da/player/join.md': twin('000000000000').replace(
      'Hej.',
      `Hej ${String.fromCharCode(0x2014)} hej.`
    ),
    'da/player/old.md': twin(hashOf(EN)),
  });
  const problems = checkTwins(root);
  assert.equal(problems.length, 4);
  assert.ok(problems.some(p => p.includes('docs/gm/a.md has no Danish twin')));
  assert.ok(problems.some(p => p.includes('older than docs/player/join.md')));
  assert.ok(problems.some(p => p.includes('em dash')));
  assert.ok(problems.some(p => p.includes('docs/da/player/old.md has no English page')));
  rmSync(root, { recursive: true });
});

test('an unquoted front matter value with a colon is reported', () => {
  const bad = twin(hashOf(EN)).replace(
    'description: Sådan kommer du ind.',
    'description: Trin: kom ind.'
  );
  const root = tree({ 'player/join.md': EN, 'da/player/join.md': bad });
  assert.equal(checkTwins(root).length, 1);
  assert.match(checkTwins(root)[0], /description needs quotes/);
  rmSync(root, { recursive: true });
});

test('stamp writes the current hash and keeps the rest of the twin', () => {
  const root = tree({ 'player/join.md': EN, 'da/player/join.md': twin('000000000000') });
  stamp(['player/join.md'], root);
  const after = readFileSync(path.join(root, 'da/player/join.md'), 'utf8');
  assert.equal(after, twin(hashOf(EN)));
  assert.deepEqual(checkTwins(root), []);
  rmSync(root, { recursive: true });
});

test('stamp adds source and sourceHash to a twin that has neither', () => {
  const bare = '---\ntitle: Kom med\ndescription: Sådan.\n---\n\nHej.\n';
  const root = tree({ 'player/join.md': EN, 'da/player/join.md': bare });
  stamp(['player/join.md'], root);
  assert.deepEqual(checkTwins(root), []);
  rmSync(root, { recursive: true });
});
