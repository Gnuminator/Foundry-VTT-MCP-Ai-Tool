import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countByCode,
  compilerFailure,
  evaluate,
  WORKSPACES,
  STRICT_CODES,
} from './typecheck-tests-ratchet.mjs';

test('countByCode counts errors per TS code', () => {
  const out = [
    "src/a.test.ts(1,1): error TS2339: Property 'x' does not exist.",
    'src/b.test.ts(2,2): error TS18046: unknown.',
    'src/c.test.ts(3,3): error TS2339: again.',
    'Found 3 errors.',
  ].join('\n');
  assert.deepEqual(countByCode(out), { TS2339: 2, TS18046: 1 });
});

test('evaluate: a rise or a new code fails, equal or lower passes', () => {
  const baseline = { 'packages/x': { TS18046: 10 } };
  assert.deepEqual(evaluate({ 'packages/x': { TS18046: 10 } }, baseline), []);
  assert.deepEqual(evaluate({ 'packages/x': { TS18046: 4 } }, baseline), []);
  assert.deepEqual(evaluate({ 'packages/x': { TS18046: 11 } }, baseline), [
    'packages/x: TS18046 10 -> 11',
  ]);
  assert.deepEqual(evaluate({ 'packages/y': { TS7006: 1 } }, baseline), [
    'packages/y: TS7006 0 -> 1',
  ]);
});

test('compilerFailure: a run that did not really run is a failure, a normal error exit is not', () => {
  const ok = { status: 0, signal: null };
  assert.equal(compilerFailure(ok, ''), null);
  assert.equal(compilerFailure({ status: 2, signal: null }, 'a.ts: error TS2339: x'), null);
  assert.match(
    compilerFailure({ status: 1, signal: null }, 'tsc7: not installed') ?? '',
    /exit code 1/
  );
  assert.match(compilerFailure({ status: null, signal: 'SIGKILL' }, '') ?? '', /SIGKILL/);
  assert.match(
    compilerFailure({ status: null, signal: null, error: new Error('spawn') }, '') ?? '',
    /could not start/
  );
});

test('every workspace has a tsconfig.test.json and the strict codes are the real mismatches', async () => {
  const { existsSync } = await import('node:fs');
  const root = new URL('..', import.meta.url);
  for (const ws of WORKSPACES) assert.ok(existsSync(new URL(`${ws}/tsconfig.test.json`, root)), ws);
  assert.deepEqual(STRICT_CODES, ['TS2339', 'TS2304', 'TS2345', 'TS2322', 'TS2769']);
});
