import assert from 'node:assert/strict';
import test from 'node:test';
import { classify, clean, diagnose, failedCommands, signal, tail } from './ci-evidence.mjs';

test('classify names the known kinds', () => {
  assert.equal(classify('lint ratchet: baseline grew by 2').kind, 'ratchet');
  assert.equal(classify('src/a.ts(3,1): error TS2322: bad').kind, 'typecheck');
  assert.equal(classify('merge conflict: PR is CONFLICTING').kind, 'conflict');
  assert.equal(classify('the operation was canceled').kind, 'hang');
  assert.equal(classify('not ok 3 - something').kind, 'test');
  assert.equal(classify('nothing familiar').kind, 'unknown');
});

test('diagnose goes by the failed command, not by passing test names', () => {
  const log = ' ✓ src/app-routes-ratchet.test.ts (4 tests)\n##[error]test-shared failed (exit 1): npm test -w @gnuminator/shared';
  const d = diagnose('', log);
  assert.equal(d.kind, 'test');
  assert.match(d.via, /npm test/);
  assert.equal(diagnose('failure .github:118 unused-ratchet failed (exit 1): npm run unused:ratchet', '').kind, 'ratchet');
  assert.equal(diagnose('', '##[error]typecheck-tests failed (exit 1): npm run typecheck:tests').kind, 'typecheck');
});

test('a node --test command is a test failure whatever its file names say', () => {
  const d = diagnose('', '##[error]scripts failed (exit 1): node --test scripts/typecheck-tests-ratchet.test.mjs');
  assert.equal(d.kind, 'test');
});

test('signal ignores lines far from an error and passing lines', () => {
  const log = ['ratchet mentioned early', ...Array(20).fill('noise'), 'src/a.ts:3 boom', '##[error]x'].join('\n');
  const s = signal(log);
  assert.ok(s.includes('boom'));
  assert.ok(!s.includes('ratchet'));
});

test('failedCommands reads the sweep naming', () => {
  assert.deepEqual(failedCommands('##[error]lint-ratchet failed (exit 1): npm run lint:ratchet'), ['npm run lint:ratchet']);
});

test('tail keeps the last lines', () => {
  assert.equal(tail('a\nb\nc\nd', 2), 'c\nd');
});

test('clean strips prefixes and colours', () => {
  assert.equal(clean('job\tstep\t2026-11-24T10:00:00.1234567Z \x1b[31mboom\x1b[0m'), 'boom');
});
