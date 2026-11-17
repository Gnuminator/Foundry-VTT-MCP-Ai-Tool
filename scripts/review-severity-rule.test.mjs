/**
 * The review severity rule (D-101, amended 2026-11-12) must stay in every reviewer definition and
 * in the lane review checklist, so a new review agent cannot leave it out.
 *
 *   node --test scripts/review-severity-rule.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RULE =
  'A missing or bypassed guard, a wrong condition, or two sides of a contract that disagree about what is written, refused, shown or undone is at least Medium, however small the diff. Low stays for wording, style, text-only mismatches and hardening.';

const agentsDir = path.join(root, '.claude', 'agents');
const files = [
  ...fs
    .readdirSync(agentsDir)
    .filter((f) => /^review-.*\.md$/.test(f))
    .map((f) => path.join(agentsDir, f)),
  path.join(root, '.claude', 'skills', 'lane', 'review-checklist.md')
];

test('there are review agents to check', () => {
  assert.ok(files.length >= 4);
});

for (const file of files) {
  test(`${path.relative(root, file)} holds the severity rule`, () => {
    const text = fs.readFileSync(file, 'utf8').replace(/\s+/g, ' ');
    assert.ok(text.includes(RULE), 'severity rule line missing or reworded');
  });
}
