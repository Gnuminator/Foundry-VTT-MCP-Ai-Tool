import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { buildReport, renderPage, renderSummary, writeReport } from './visual-diff-report.mjs';

function shard(root, name, items) {
  const dir = path.join(root, name);
  mkdirSync(path.join(dir, 'entries'), { recursive: true });
  for (const [entry, kinds] of items) {
    writeFileSync(path.join(dir, 'entries', `${entry.id}.json`), JSON.stringify(entry));
    for (const kind of kinds) {
      mkdirSync(path.join(dir, kind), { recursive: true });
      writeFileSync(path.join(dir, kind, `${entry.id}.png`), 'png');
    }
  }
  return dir;
}

test('merges shards, sorts, counts and hashes the flagged ids', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'vdr-'));
  const a = shard(root, 'a', [
    [{ id: 'b--one', status: 'changed', pixels: 12 }, ['before', 'after', 'diff']],
    [{ id: 'a--same', status: 'same', pixels: 0 }, []],
  ]);
  const b = shard(root, 'b', [
    [{ id: 'c--new', status: 'added', pixels: 0 }, ['after']],
    [{ id: 'd--gone', status: 'removed', pixels: 0 }, ['before']],
    [{ id: 'e--bad', status: 'error', error: 'head: boom' }, []],
  ]);
  const out = path.join(root, 'out');
  const report = writeReport(out, [a, b], { baseSha: 'x'.repeat(40), headSha: 'y'.repeat(40) });
  assert.equal(report.compared, 5);
  assert.deepEqual(report.changed, [{ id: 'b--one', pixels: 12, sizeDiffers: false }]);
  assert.deepEqual(report.added, ['c--new']);
  assert.deepEqual(report.removed, ['d--gone']);
  assert.equal(report.errors.length, 1);
  assert.equal(report.count, 3);
  assert.match(report.hash, /^[0-9a-f]{8}$/);
  assert.ok(existsSync(path.join(out, 'diff', 'b--one.png')));
  assert.ok(existsSync(path.join(out, 'after', 'c--new.png')));
  assert.equal(JSON.parse(readFileSync(path.join(out, 'visual-diff.json'), 'utf8')).hash, report.hash);
  assert.match(readFileSync(path.join(out, 'index.html'), 'utf8'), /b--one/);
});

test('the hash depends on the flagged id set only', () => {
  const one = buildReport([{ id: 'a', status: 'changed', pixels: 1 }]);
  const same = buildReport([
    { id: 'a', status: 'changed', pixels: 99 },
    { id: 'z', status: 'same', pixels: 0 },
  ]);
  const more = buildReport([
    { id: 'a', status: 'changed', pixels: 1 },
    { id: 'b', status: 'changed', pixels: 1 },
  ]);
  assert.equal(one.hash, same.hash);
  assert.notEqual(one.hash, more.hash);
});

test('no differences: zero count and a plain page', () => {
  const report = buildReport([{ id: 'a', status: 'same', pixels: 0 }]);
  assert.equal(report.count, 0);
  assert.match(renderPage(report), /No differences/);
  assert.match(renderSummary(report), /0 changed against the base/);
});

test('escapes ids in the page', () => {
  const report = buildReport([{ id: '<x>', status: 'added', pixels: 0 }]);
  assert.ok(!renderPage(report).includes('<x>'));
});
