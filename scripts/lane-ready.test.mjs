// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gateProblems, backlogIds, reviewNotePath, main } from './lane-ready.mjs';

const HEAD = 'a'.repeat(40);
const refusal = [
  'lane:merge: NOT merged #7',
  'review: no review note for head aaaaaaa',
  'changelog: no added or changed changelog.d/*.md fragment',
  'lane:merge: risky (guarded writes): x.ts; an Opus review is required',
  '  FAIL drift tail line one',
  'second drift tail line',
  'lane:merge: refused because (1) review: no review note for head aaaaaaa (2) changelog: no added or changed changelog.d/*.md fragment',
].join('\n');

test('gateProblems lists the reasons, not the notices or the drift tail', () => {
  assert.deepEqual(gateProblems(refusal), [
    'review: no review note for head aaaaaaa',
    'changelog: no added or changed changelog.d/*.md fragment',
  ]);
  assert.deepEqual(gateProblems('lane:merge: refused because ci: failing: x'), [
    'ci: failing: x',
  ]);
  assert.deepEqual(gateProblems('lane:merge: OK #7'), []);
});

test('backlogIds reads Backlog and Backlog-part lines, backticks and repeats', () => {
  assert.deepEqual(backlogIds('x\nBacklog: a-b, c\nBacklog-part: d'), ['a-b', 'c', 'd']);
  assert.deepEqual(backlogIds('Backlog: `a-b`\nBacklog-part: a-b'), ['a-b']);
  assert.deepEqual(backlogIds('nothing'), []);
});

test('reviewNotePath finds the note naming the head', () => {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-'));
  const dir = path.join(v, 'Dev', 'Foundry AI Tool', 'Handoff', 'Reviews 2026-11-18');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, '7-review.md'),
    `# PR #7 review\n\nHead reviewed: ${HEAD}\n\n## Verdict\n\n**Merge.**\n`
  );
  assert.equal(reviewNotePath(v, 7, HEAD), 'Handoff/Reviews 2026-11-18/7-review.md');
  assert.equal(reviewNotePath(v, 8, HEAD), null);
});

/** @param {string} gateOut @param {number} gateStatus @param {string} body */
function fake(gateOut, gateStatus, body = 'Backlog: item-x') {
  /** @type {string[][]} */
  const calls = [];
  /** @type {(cmd: string, args: string[]) => { status: number, stdout: string, stderr: string }} */
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'gh') {
      return {
        status: 0,
        stdout: JSON.stringify({ number: 7, headRefOid: HEAD, body }),
        stderr: '',
      };
    }
    if (args[0].endsWith('lane-merge.mjs')) {
      return { status: gateStatus, stdout: gateOut, stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  };
  /** @type {string[]} */
  const out = [];
  return { calls, out, run, log: (/** @type {string} */ l) => out.push(l) };
}

test('one list when the gate refuses and the Backlog line is missing', () => {
  const f = fake(refusal, 1, 'no id');
  assert.equal(main({ argv: ['--vault', '/none'], run: f.run, log: f.log }), 1);
  assert.match(f.out[0], /NOT ready #7: 3 things missing/);
  assert.equal(f.out.length, 4);
  assert.ok(!f.calls.some(c => c.includes('progress')));
});

test('writes the ready line when the gate says OK', () => {
  const f = fake('lane:merge: OK #7 at aaaaaaa (dry run)', 0);
  assert.equal(main({ argv: ['--vault', '/none'], run: f.run, log: f.log }), 0);
  const w = f.calls.find(c => c.includes('progress'));
  assert.ok(w);
  assert.ok(w.join(' ').includes(`item-x --ready 7 --head ${HEAD}`));
  assert.match(f.out[0], /ready #7 at aaaaaaa; progress line written on item-x/);
});

test('usage errors exit 2; a silent gate failure still gives a line', () => {
  const f = fake('', 1);
  assert.equal(main({ argv: ['--item', '--check'], run: f.run, log: f.log }), 2);
  assert.equal(main({ argv: ['--vault', '/none'], run: f.run, log: f.log }), 1);
  assert.ok(f.out.some(l => /dry run ended with exit 1/.test(l)));
  assert.ok(f.calls.some(c => c.join(' ').includes('7 --dry-run --vault /none')));
});

test('--check writes nothing', () => {
  const f = fake('lane:merge: OK #7 at aaaaaaa (dry run)', 0);
  assert.equal(main({ argv: ['--check', '--vault', '/none'], run: f.run, log: f.log }), 0);
  assert.ok(!f.calls.some(c => c.includes('progress')));
});
