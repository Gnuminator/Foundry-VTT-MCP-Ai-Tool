// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  gateProblems,
  backlogIds,
  reviewNotePath,
  driftGuards,
  driftAdvice,
  main,
} from './lane-ready.mjs';

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
  assert.deepEqual(gateProblems('lane:merge: refused because ci: failing: x'), ['ci: failing: x']);
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

const driftRefusal = [
  'lane:merge: NOT merged #7',
  'lane:merge: refused because (1) drift: drift-check failed (guards: line baseline, mcp-server tests (tool counts, tool reference, tool sets), em-dash baseline) (log /tmp/x.log); last lines below',
].join('\n');

test('driftGuards reads the refusal reason, keeping commas inside parentheses', () => {
  assert.deepEqual(driftGuards(driftRefusal), [
    'line baseline',
    'mcp-server tests (tool counts, tool reference, tool sets)',
    'em-dash baseline',
  ]);
  assert.deepEqual(driftGuards('  ok   x\n  FAIL docs links\n', true), ['docs links']);
  assert.deepEqual(driftGuards('nothing'), []);
});

test('driftAdvice gives the exact command per guard and a by-hand line otherwise', () => {
  const a = driftAdvice(['line baseline', 'mcp-server tests (tool counts)', 'docs links']);
  assert.ok(a[0].includes('`npm run line:ratchet -- --update`'));
  assert.ok(a[1].includes('`npm run docs:tools`') && /tool reference test failed/.test(a[1]));
  assert.match(driftAdvice(['changelog fragments'])[0], /changelog\.d\/README\.md/);
  assert.doesNotMatch(driftAdvice(['changelog fragments'])[0], /run `npm run changelog:check`/);
  assert.match(a[2], /fix by hand/);
  assert.deepEqual(driftAdvice([]), []);
});

test('a drift refusal tells /ready what to run and writes no ready line', () => {
  const f = fake(driftRefusal, 1);
  assert.equal(main({ argv: ['--vault', '/none'], run: f.run, log: f.log }), 1);
  const text = f.out.join('\n');
  assert.match(text, /drift \(line baseline\): run `npm run line:ratchet -- --update`/);
  assert.match(text, /drift \(em-dash baseline\): run `npm run emdash:ratchet -- --update`/);
  assert.match(text, /run \/ready again/);
  assert.ok(!f.calls.some(c => c.includes('progress')));
});

test('when the gate skipped drift-check, /ready runs it and lists its failures', () => {
  const gateOut = [
    'lane:merge: drift-check not run: it is slow, so it runs once the other checks pass',
    'lane:merge: refused because (1) changelog: no added or changed changelog.d/*.md fragment',
  ].join('\n');
  /** @type {string[][]} */
  const calls = [];
  /** @type {string[]} */
  const out = [];
  /** @type {(c: string, a: string[]) => { status: number, stdout: string, stderr: string }} */
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'gh') {
      return {
        status: 0,
        stdout: JSON.stringify({ number: 7, headRefOid: HEAD, body: 'Backlog: item-x' }),
        stderr: '',
      };
    }
    if (cmd === 'npm') return { status: 1, stdout: '  FAIL line baseline\n', stderr: '' };
    return { status: 1, stdout: gateOut, stderr: '' };
  };
  assert.equal(main({ argv: ['--vault', '/none'], run, log: l => out.push(l) }), 1);
  assert.ok(calls.some(c => c.join(' ') === 'npm run drift:check'));
  assert.ok(out.some(l => /changelog: no added/.test(l)));
  assert.ok(out.some(l => /drift \(line baseline\): run `npm run line:ratchet/.test(l)));
});

test('no separate drift run when the gate judged the wrong tree (local: failure)', () => {
  const gateOut = [
    'lane:merge: drift-check not run: it is slow, so it runs once the other checks pass',
    'lane:merge: refused because (1) local: the working tree is not clean (1 change); commit or stash first',
  ].join('\n');
  const f = fake(gateOut, 1);
  assert.equal(main({ argv: ['--vault', '/none'], run: f.run, log: f.log }), 1);
  assert.ok(!f.calls.some(c => c.join(' ').includes('drift')));
});

test('drift-check failing with no FAIL lines gives the by-hand command', () => {
  const gateOut =
    'lane:merge: drift-check not run: x\nlane:merge: refused because (1) review: no review note';
  const f = fake(gateOut, 1);
  assert.equal(main({ argv: ['--vault', '/none'], run: f.run, log: f.log }), 1);
  // fake's other commands return status 0 with no output: passes, so no drift line at all
  assert.ok(!f.out.some(l => /drift \(/.test(l)));
});

test('--check writes nothing', () => {
  const f = fake('lane:merge: OK #7 at aaaaaaa (dry run)', 0);
  assert.equal(main({ argv: ['--check', '--vault', '/none'], run: f.run, log: f.log }), 0);
  assert.ok(!f.calls.some(c => c.includes('progress')));
});
