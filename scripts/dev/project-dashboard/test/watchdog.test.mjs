import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readWatchdog, sessionsDirFrom, watchdogWarning } from '../watchdog.mjs';

const NOW = new Date('2026-10-08T12:00:00Z');
const HOUR = 3600 * 1000;
const SECRET = 'SECRET-CAMPAIGN-TEXT';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wd-'));
}

function touch(file, ms) {
  const t = new Date(ms);
  fs.utimesSync(file, t, t);
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// Makes a recording folder. opts: finishedHoursAgo (null = still recording), audio, notes, audit.
function recording(dir, name, opts = {}) {
  const folder = path.join(dir, name);
  fs.mkdirSync(folder, { recursive: true });
  const { finishedHoursAgo = 1, audio = true, notes = null, audit = null } = opts;
  if (finishedHoursAgo !== null) {
    const session = path.join(folder, 'raw', 'session.json');
    write(session, JSON.stringify({ note: SECRET }));
    touch(session, NOW.getTime() - finishedHoursAgo * HOUR);
  }
  if (audio) write(path.join(folder, '1-someone.flac'), 'x');
  if (notes !== null) write(path.join(folder, 'notes', 'notes.json'), notes);
  if (audit !== null) write(path.join(folder, 'notes', 'audit.jsonl'), audit);
  return folder;
}

const doneNotes = JSON.stringify({ session: { summary: SECRET } });
const auditLine = event => JSON.stringify({ event, detail: SECRET });

function states(w) {
  return Object.fromEntries(w.items.map(i => [i.name, i.state]));
}

test('sessionsDirFrom: env override and default', () => {
  assert.equal(sessionsDirFrom({ FVTT_SESSIONS_DIR: 'D:\\Rec' }), 'D:\\Rec');
  assert.equal(sessionsDirFrom({}), path.join(os.homedir(), 'Documents', 'FoundrySessions'));
});

test('readWatchdog: no folder', () => {
  const dir = path.join(tmp(), 'missing');
  assert.deepEqual(readWatchdog({ dir, now: NOW }), {
    dir,
    state: 'no-folder',
    lastPass: null,
    items: [],
  });
});

test('readWatchdog: no recordings ignores other folders and files', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, '2026-10-01_2000-manual'));
  fs.mkdirSync(path.join(dir, '.hidden'));
  write(path.join(dir, '2026-10-02_2000-discord.zip'), 'x');
  const w = readWatchdog({ dir, now: NOW });
  assert.equal(w.state, 'no-recordings');
  assert.deepEqual(w.items, []);
});

test('readWatchdog: every item state', () => {
  const dir = tmp();
  recording(dir, '2026-10-01_2000-discord', { finishedHoursAgo: null });
  recording(dir, '2026-10-02_2000-discord', { audio: false });
  recording(dir, '2026-10-03_2000-discord', { notes: doneNotes, finishedHoursAgo: 100 });
  recording(dir, '2026-10-04_2000-discord', {
    finishedHoursAgo: 100,
    audit: `${auditLine('start')}\n${auditLine('paused')}\n`,
  });
  recording(dir, '2026-10-05_2000-discord', { finishedHoursAgo: 23 });
  recording(dir, '2026-10-06_2000-discord', { finishedHoursAgo: 24 });
  const w = readWatchdog({ dir, now: NOW });
  assert.deepEqual(states(w), {
    '2026-10-06_2000-discord': 'missed',
    '2026-10-05_2000-discord': 'waiting',
    '2026-10-04_2000-discord': 'paused',
    '2026-10-03_2000-discord': 'done',
    '2026-10-02_2000-discord': 'empty',
    '2026-10-01_2000-discord': 'recording',
  });
  assert.deepEqual(
    w.items.map(i => i.name),
    [...w.items.map(i => i.name)].sort().reverse()
  );
  const byName = Object.fromEntries(w.items.map(i => [i.name, i]));
  assert.equal(byName['2026-10-05_2000-discord'].finishedAt, '2026-10-07T13:00:00.000Z');
  assert.equal(byName['2026-10-01_2000-discord'].finishedAt, null);
  assert.equal(w.state, 'missed');
});

test('readWatchdog: audio must sit in the folder itself', () => {
  const dir = tmp();
  const folder = recording(dir, '2026-10-01_2000-discord', { audio: false });
  write(path.join(folder, 'sub', 'a.flac'), 'x');
  assert.equal(readWatchdog({ dir, now: NOW }).items[0].state, 'empty');
});

test('readWatchdog: audio extensions are case-insensitive', () => {
  const dir = tmp();
  const folder = recording(dir, '2026-10-01_2000-discord', { audio: false });
  write(path.join(folder, 'A.OGG'), 'x');
  assert.equal(readWatchdog({ dir, now: NOW }).items[0].state, 'waiting');
});

test('readWatchdog: overall state precedence', () => {
  const cases = [
    [[{ notes: doneNotes }], 'ok'],
    [[{ notes: doneNotes }, { finishedHoursAgo: 2 }], 'waiting'],
    [[{ finishedHoursAgo: 2 }, { audit: auditLine('paused') }], 'paused'],
    [[{ audit: auditLine('paused') }, { finishedHoursAgo: 30 }], 'missed'],
    [[{ finishedHoursAgo: null }, { audio: false }], 'ok'],
  ];
  for (const [opts, expected] of cases) {
    const dir = tmp();
    opts.forEach((o, i) => recording(dir, `2026-10-0${i + 1}_2000-discord`, o));
    assert.equal(readWatchdog({ dir, now: NOW }).state, expected);
  }
});

test('readWatchdog: limit cuts the items but not the overall state', () => {
  const dir = tmp();
  recording(dir, '2026-10-01_2000-discord', { finishedHoursAgo: 100 });
  for (let d = 2; d <= 6; d++) recording(dir, `2026-10-0${d}_2000-discord`, { notes: doneNotes });
  const w = readWatchdog({ dir, now: NOW, limit: 3 });
  assert.equal(w.items.length, 3);
  assert.equal(w.items[0].name, '2026-10-06_2000-discord');
  assert.ok(w.items.every(i => i.state === 'done'));
  assert.equal(w.state, 'missed');
  assert.equal(readWatchdog({ dir, now: NOW }).items.length, 6);
});

test('readWatchdog: lastPass is the auto.log mtime', () => {
  const dir = tmp();
  recording(dir, '2026-10-01_2000-discord');
  assert.equal(readWatchdog({ dir, now: NOW }).lastPass, null);
  write(path.join(dir, 'auto.log'), SECRET);
  touch(path.join(dir, 'auto.log'), NOW.getTime() - 2 * HOUR);
  assert.equal(readWatchdog({ dir, now: NOW }).lastPass, '2026-10-08T10:00:00.000Z');
});

test('readWatchdog: notes.json without a session is not done', () => {
  const cases = [
    JSON.stringify({ scenes: [{ text: SECRET }] }),
    JSON.stringify({ session: null }),
    JSON.stringify({ session: 'text' }),
    '{ broken',
    '',
  ];
  for (const notes of cases) {
    const dir = tmp();
    recording(dir, '2026-10-01_2000-discord', { notes, finishedHoursAgo: 30 });
    assert.equal(readWatchdog({ dir, now: NOW }).items[0].state, 'missed');
  }
});

test('readWatchdog: done wins over a paused audit', () => {
  const dir = tmp();
  recording(dir, '2026-10-01_2000-discord', { notes: doneNotes, audit: auditLine('paused') });
  assert.equal(readWatchdog({ dir, now: NOW }).items[0].state, 'done');
});

test('readWatchdog: only the last audit event counts', () => {
  const dir = tmp();
  recording(dir, '2026-10-01_2000-discord', {
    audit: `${auditLine('paused')}\n${auditLine('scene_ok')}\n`,
  });
  assert.equal(readWatchdog({ dir, now: NOW }).items[0].state, 'waiting');
});

test('readWatchdog: a huge audit file is read from the tail, broken lines skipped', () => {
  const dir = tmp();
  const filler = `${auditLine('scene_ok')}\n`.repeat(20000);
  // The paused line sits in the first bytes, far outside the last 64 KB.
  const early = `${auditLine('paused')}\n${filler}`;
  assert.ok(early.length > 200 * 1024);
  recording(dir, '2026-10-01_2000-discord', { audit: early });
  // Tail ends with a paused line followed by a cut-off line and garbage.
  const late = `${filler}${auditLine('paused')}\n{"event":"sce\nnot json at all\n[1,2]\n"str"\n`;
  recording(dir, '2026-10-02_2000-discord', { audit: late });
  // Blank, non-string and missing events are skipped too.
  recording(dir, '2026-10-03_2000-discord', {
    audit: `${auditLine('paused')}\n{"event":5}\n{"other":1}\n\n`,
  });
  const w = readWatchdog({ dir, now: NOW });
  assert.deepEqual(states(w), {
    '2026-10-03_2000-discord': 'paused',
    '2026-10-02_2000-discord': 'paused',
    '2026-10-01_2000-discord': 'waiting',
  });
});

test('readWatchdog: a cut-off first line of the tail is dropped', () => {
  const dir = tmp();
  // 70 KB without newlines, then one complete line. The tail starts mid-line.
  const audit = `{"event":"paused","pad":"${'x'.repeat(70 * 1024)}"}\n${auditLine('start')}\n`;
  recording(dir, '2026-10-01_2000-discord', { audit });
  assert.equal(readWatchdog({ dir, now: NOW }).items[0].state, 'waiting');
});

test('readWatchdog: the result holds no campaign text', () => {
  const dir = tmp();
  recording(dir, '2026-10-01_2000-discord', {
    notes: JSON.stringify({ session: null, scenes: [SECRET] }),
    audit: `${auditLine('paused')}\n`,
    finishedHoursAgo: 40,
  });
  recording(dir, '2026-10-02_2000-discord', { notes: doneNotes });
  write(path.join(dir, 'auto.log'), SECRET);
  const w = readWatchdog({ dir, now: NOW });
  assert.ok(!JSON.stringify(w).includes(SECRET));
  assert.ok(!watchdogWarning(w).includes(SECRET));
  assert.deepEqual(Object.keys(w).sort(), ['dir', 'items', 'lastPass', 'state']);
  for (const i of w.items) assert.deepEqual(Object.keys(i).sort(), ['finishedAt', 'name', 'state']);
});

test('readWatchdog: strings are clipped and it never throws', () => {
  const root = tmp();
  const longName = `${'a'.repeat(205)}-discord`;
  const dir = path.join(root, 'sessions');
  fs.mkdirSync(path.join(dir, longName), { recursive: true });
  assert.equal(readWatchdog({ dir, now: NOW }).items[0].name.length, 200);
  const farAway = path.join(root, 'b'.repeat(250));
  assert.equal(readWatchdog({ dir: farAway, now: NOW }).dir.length, 200);
  // A file where the folder should be, and a directory named like a file.
  write(path.join(root, 'file.txt'), 'x');
  assert.equal(readWatchdog({ dir: path.join(root, 'file.txt'), now: NOW }).state, 'no-folder');
  const bad = path.join(root, 'bad');
  fs.mkdirSync(path.join(bad, '2026-10-01_2000-discord', 'raw', 'session.json'), {
    recursive: true,
  });
  fs.mkdirSync(path.join(bad, '2026-10-01_2000-discord', 'notes', 'notes.json'), {
    recursive: true,
  });
  fs.mkdirSync(path.join(bad, '2026-10-01_2000-discord', 'notes', 'audit.jsonl'), {
    recursive: true,
  });
  assert.doesNotThrow(() => readWatchdog({ dir: bad, now: NOW }));
  assert.doesNotThrow(() => readWatchdog({}));
});

test('watchdogWarning', () => {
  const item = (name, state) => ({ name, state, finishedAt: null });
  const w = (state, items) => ({ dir: 'd', state, lastPass: null, items });
  assert.equal(watchdogWarning(w('ok', [item('a-discord', 'done')])), null);
  assert.equal(watchdogWarning(w('waiting', [item('a-discord', 'waiting')])), null);
  assert.equal(watchdogWarning(w('no-folder', [])), null);
  assert.equal(watchdogWarning(w('no-recordings', [])), null);
  assert.equal(watchdogWarning(null), null);
  assert.equal(
    watchdogWarning(w('missed', [item('c-discord', 'missed'), item('b-discord', 'done')])),
    'session notes missed for c-discord (no run within 24 h)'
  );
  assert.equal(
    watchdogWarning(
      w('missed', [
        item('d-discord', 'paused'),
        item('c-discord', 'missed'),
        item('b-discord', 'missed'),
      ])
    ),
    'session notes missed for c-discord and 1 more (no run within 24 h)'
  );
  assert.equal(
    watchdogWarning(w('paused', [item('c-discord', 'waiting'), item('b-discord', 'paused')])),
    'session notes paused on the usage limit for b-discord'
  );
  assert.equal(
    watchdogWarning(w('missed', [])),
    'session notes missed for a recording (no run within 24 h)'
  );
});
