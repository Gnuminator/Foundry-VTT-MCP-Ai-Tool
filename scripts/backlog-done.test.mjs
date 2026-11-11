/**
 * The Done list lives in vault `Backlog done.md`, not in `Backlog.md` (Backlog chain, step 1). This keeps it true: no skill,
 * script or hook may tell a writer to put a line under `## Done` of Backlog.md, and the planner skill names the new file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

// A "## Done" section heading (not "## Done when it looks like this" in the GM guides).
const DONE_SECTION = /^\s*(?:[-*]\s+)?`?##\s+Done`?(?!\s+when)\b/m;
const INLINE = /(?:to|under|into|in)\s+`##\s+Done`/i;

test('no skill, hook or script (outside tests) names a `## Done` section of Backlog.md', () => {
  const files = [
    ...walk(path.join(root, '.claude', 'skills')),
    ...walk(path.join(root, '.claude', 'hooks')),
    ...readdirSync(path.join(root, 'scripts'))
      .filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))
      .map((f) => path.join(root, 'scripts', f)),
    path.join(root, 'CLAUDE.md'),
  ].filter((f) => /\.(md|mjs)$/.test(f) && !/\.test\.mjs$/.test(f));
  const bad = [];
  for (const f of files) {
    let text = '';
    try {
      text = readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    if (DONE_SECTION.test(text) || INLINE.test(text)) bad.push(path.relative(root, f));
  }
  assert.deepEqual(bad, [], 'a writer is told to put Done lines in Backlog.md; use vault Backlog done.md');
});

test('the planner skill says Done lines go to Backlog done.md', () => {
  const text = readFileSync(path.join(root, '.claude', 'skills', 'planner', 'SKILL.md'), 'utf8');
  assert.match(text, /Backlog done\.md/);
});

test('the matcher catches the old wording', () => {
  assert.ok(INLINE.test('add a line to `## Done`, and'));
  assert.ok(DONE_SECTION.test('x\n## Done\n- a'));
  assert.ok(!DONE_SECTION.test('## Done when it looks like this'));
});
