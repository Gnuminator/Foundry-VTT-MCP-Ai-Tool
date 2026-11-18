// node --test tools/backstory-buddy/build.test.mjs
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { frontMatter } from '../gm-coach/build.mjs';
import { BUDDY_TOOLS, SKILL_NAME, build, collectFiles, findDeniedTerms } from './build.mjs';

/** PLAYER_BASE_DENY_TERMS, read from the source so the two lists cannot drift apart. */
function baseDenyTerms() {
  const src = readFileSync(
    new URL('../../packages/mcp-server/src/tools/player.ts', import.meta.url),
    'utf8'
  );
  const m = src.match(/PLAYER_BASE_DENY_TERMS[^=]*=\s*\[([^\]]*)\]/);
  assert.ok(m, 'found PLAYER_BASE_DENY_TERMS');
  const terms = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  assert.ok(terms.length >= 5);
  return terms;
}

test('front matter fits what claude.ai accepts', () => {
  const { name, description } = frontMatter(collectFiles().get('SKILL.md'));
  assert.equal(name, SKILL_NAME);
  assert.ok(description && description.length <= 200, `description is ${description?.length}`);
});

test('the build writes the folder and a zip', () => {
  const out = mkdtempSync(path.join(tmpdir(), 'backstory-buddy-'));
  try {
    const { zipFile } = build(out);
    assert.ok(existsSync(zipFile));
    assert.ok(existsSync(path.join(out, SKILL_NAME, 'SKILL.md')));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('every page SKILL.md names is in the skill, and each page is small', () => {
  const files = collectFiles();
  const named = [...files.get('SKILL.md').matchAll(/`(references\/[^`]+\.md)`/g)].map(m => m[1]);
  assert.equal(named.length, 3);
  for (const n of named) assert.ok(files.has(n), n);
  for (const [n, t] of files) assert.ok(t.length < 6000, `${n} is ${t.length} characters`);
});

test('the skill names only its own player tools and has no em dash', () => {
  const emDash = String.fromCharCode(0x2014);
  const named = new Set();
  for (const [name, text] of collectFiles()) {
    assert.ok(!text.includes(emDash), `${name} has an em dash`);
    for (const m of text.matchAll(/`([a-z0-9]+(?:-[a-z0-9]+)+)`/g)) {
      named.add(m[1]);
      assert.ok(BUDDY_TOOLS.includes(m[1]), `${name} names ${m[1]}`);
    }
  }
  for (const t of BUDDY_TOOLS) assert.ok(named.has(t), `${t} is named`);
});

test('the skill itself carries no term from the player deny list', () => {
  const terms = baseDenyTerms();
  for (const [name, text] of collectFiles()) {
    assert.deepEqual(findDeniedTerms(text, terms), [], name);
  }
});

test('the deny-term helper accepts a clean sample and flags a leak', () => {
  const terms = baseDenyTerms();
  const sample =
    'Ebbe grew up mending nets in a harbour town. A debt to a ferryman (idea) still weighs on her.';
  assert.deepEqual(findDeniedTerms(sample, terms), []);
  assert.deepEqual(findDeniedTerms('Ebbe fled the lands of STRAHD.', terms), ['Strahd']);
});
