import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { BANNED, IMAGES, checkLinks, findBanned } from './build.mjs';

const page = readFileSync(new URL('../../site/index.html', import.meta.url), 'utf8');

test('findBanned catches campaign words in any case', () => {
  assert.deepEqual(findBanned('Welcome to Barovia'), ['barovia']);
  assert.deepEqual(findBanned('plain text'), []);
  assert.ok(BANNED.length > 5);
});

test('checkLinks flags a missing file, a missing anchor and an outside src', () => {
  const html =
    '<a href="#a" id="a"></a><a href="#b"></a><img src="x.png"><img src="https://x.test/y.png"><a href="gm/">g</a>';
  const problems = checkLinks(html, () => false);
  assert.equal(problems.length, 4);
  assert.deepEqual(checkLinks(html, () => true).length, 2);
});

test('standalone mode skips wiki pages only', () => {
  const html = '<a href="gm/">g</a><img src="showcase/a.png">';
  assert.deepEqual(
    checkLinks(html, () => false, { standalone: true }),
    ['src points at a missing file: showcase/a.png']
  );
});

test('the real landing page has no banned words, no outside loads and no dead anchors', () => {
  assert.deepEqual(findBanned(page), []);
  const seen = new Set(IMAGES.map(([, to]) => `showcase/img/${to}`));
  seen.add('showcase/style.css');
  const problems = checkLinks(page, rel => seen.has(rel), { standalone: true });
  assert.deepEqual(problems, []);
});
