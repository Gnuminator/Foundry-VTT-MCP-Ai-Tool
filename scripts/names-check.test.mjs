/** scripts/names-check.mjs: matching, the speaker check on the cleaner's line, clip timing, sweep. No ffmpeg. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  termRegex,
  spread,
  clipWindow,
  cleanerLine,
  parseCleaned,
  parseCheckPage,
  buildEntry,
  sweep,
  similar,
  who,
  hms,
  cutClip,
  renderPage,
  transcriptNote,
} from './names-check.mjs';

test('termRegex: whole word, listed spellings, inflections and possessives', () => {
  const rx = termRegex(['Hrafne', 'Raffne']);
  assert.ok(rx.test('Hrafne er her'));
  assert.ok(rx.test("Hrafne's sword"));
  assert.ok(rx.test('Hrafnes sværd'));
  assert.ok(rx.test('sagde raffne'));
  assert.ok(!rx.test('Hrafnexyz'));
  assert.ok(!rx.test('xHrafne'));
  const short = termRegex(['Ken']);
  assert.ok(short.test('Kens hat'));
  assert.ok(!short.test('Kenkun'));
});

test('spread: first, middle and last of many hits', () => {
  assert.deepEqual(spread([1, 2], 3), [1, 2]);
  assert.deepEqual(spread([1, 2, 3, 4, 5, 6, 7], 3), [1, 4, 7]);
});

test('spread with max 1 returns one hit; inflections are per term', () => {
  assert.deepEqual(spread([1, 2, 3, 4], 1), [1]);
  const rx = termRegex(['Ken', 'Kenkun']);
  assert.ok(rx.test('Kens hat'));
  assert.ok(rx.test('Kenkuner'));
  assert.ok(!rx.test('Kener'));
});

test('cleanerLine honours the 40 s and 2 s bounds and prefers the id', () => {
  const lines = parseCleaned(
    ['**[00:00:10] GM (Danni):** early ^u000001', '**[00:02:00] GM (Danni):** by id ^u000050'].join(
      '\n'
    )
  );
  const row = { id: 'u000050', player: 'GM (Danni)', speaker: 'danni_d' };
  assert.equal(cleanerLine(lines, row, 20).id, 'u000050'); // id wins over the nearer line
  const nid = { id: 'u000099', player: 'GM (Danni)', speaker: 'danni_d' };
  assert.equal(cleanerLine(lines, nid, 51), null); // 41 s after the early line
  assert.equal(cleanerLine(lines, nid, 50).id, 'u000001');
  assert.equal(cleanerLine(lines, nid, 7), null); // line starts 3 s after the hit
});

test('transcriptNote has no stray space before the semicolon', () => {
  assert.equal(
    transcriptNote('W', 2, ['a', 'b'], { from: 'cleaner', value: 'Y' }),
    'Heard 2 times in the raw transcript as a, b; the cleaner wrote Y.'
  );
});

test('clipWindow: 6 s either side, never before 0', () => {
  assert.deepEqual(clipWindow(100, 100.5), { start: 94, end: 106.5 });
  assert.deepEqual(clipWindow(2, 2.4), { start: 0, end: 8.4 });
});

const cleaned = parseCleaned(
  [
    '**[00:01:00] Barnon (David):** *I see Hrafne.* (out of character) ^u000010',
    '**[00:01:01] GM (Danni):** Hrafne is the captain. ^u000011',
    '**[00:02:00] GM (Danni):** Later line. ^u000020',
  ].join('\n')
);

test('parseCleaned reads time, speaker, text and id', () => {
  assert.equal(cleaned.length, 3);
  assert.deepEqual(cleaned[0], {
    t: 60,
    speaker: 'Barnon (David)',
    text: 'I see Hrafne.',
    id: 'u000010',
  });
});

test('cleanerLine: same id and same player; never another speaker', () => {
  const row = { id: 'u000011', speaker: 'danni_d', player: 'GM (Danni)' };
  assert.equal(cleanerLine(cleaned, row, 61).id, 'u000011');
  // id points at David's line but the raw speaker is Danni: falls back to Danni's nearest line, not David's
  const wrong = { id: 'u000010', speaker: 'danni_d', player: 'GM (Danni)' };
  assert.equal(cleanerLine(cleaned, wrong, 61).speaker, 'GM (Danni)');
  // nothing by this player within 40 s
  const other = { id: 'u000099', speaker: 'x', player: 'Nobody (Eve)' };
  assert.equal(cleanerLine(cleaned, other, 61), null);
  assert.equal(who('Barnon (David)'), 'David');
  assert.equal(hms(3725), '01:02:05');
});

test('buildEntry: raw hits with highlight, cleaner line, guess from the cleaner, clip window', () => {
  const timeline = [
    {
      id: 'u000010',
      n: 10,
      speaker: 'rokksteddy',
      player: 'Barnon (David)',
      start: 59,
      end: 62,
      text: 'Se, Raffne kommer',
      words: [
        { word: 'Se,', start: 59, end: 59.3 },
        { word: 'Raffne', start: 60, end: 60.5 },
        { word: 'kommer', start: 60.6, end: 61 },
      ],
    },
    {
      id: 'u000011',
      n: 11,
      speaker: 'danni_d',
      player: 'GM (Danni)',
      start: 60,
      end: 64,
      text: 'Haften er kaptajnen',
      words: [{ word: 'Haften', start: 61, end: 61.5 }],
    },
  ];
  const e = buildEntry({ word: 'Raffne', also: ['Haften'] }, 1, timeline, cleaned);
  assert.equal(e.heard, 2);
  assert.equal(e.context[0].hit, 'Raffne');
  assert.equal(e.context[0].clean.speaker, 'Barnon (David)');
  assert.equal(e.context[1].clean.speaker, 'GM (Danni)');
  assert.deepEqual(e.context[0].win, { start: 54, end: 66.5 });
  assert.equal(e.context[0].track, 'rokksteddy');
  assert.equal(e.guess.from, 'cleaner');
  assert.equal(e.guess.value, 'Hrafne');
  assert.match(e.note, /Heard 2 times/);
  assert.ok(!/NPC/.test(e.note));
});

test('parseCheckPage reads name entries, variants and the suggestion', () => {
  const md =
    '# x\n## Names\n<!-- names -->\n\n### Barn\nHeard 2 time(s), also as: Bar, Barns\nWhere: x\nSuggestion: Barnon\nAnswer:\n\n### Botte\nHeard 1 time(s)\nAnswer: not a name\n';
  const c = parseCheckPage(md);
  assert.equal(c.length, 2);
  assert.deepEqual(c[0].also, ['Bar', 'Barns']);
  assert.equal(c[0].guess.value, 'Barnon');
});

test('similar: Ken vs Kenkun and Raffne vs Raphne', () => {
  assert.ok(similar('Ken', 'Kenkun'));
  assert.ok(similar('Raffne', 'Raphne'));
  assert.ok(!similar('Ebbe', 'Strahd'));
});

test('sweep: capitalised words outside names.txt and the cards, plus duplicates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-'));
  try {
    fs.mkdirSync(path.join(dir, 'timeline'));
    fs.writeFileSync(path.join(dir, 'names.txt'), 'Barnon\nHrafne\n');
    fs.writeFileSync(
      path.join(dir, 'timeline', 'fixes.json'),
      JSON.stringify({ applied: [{ correct: 'Danni' }] })
    );
    fs.writeFileSync(
      path.join(dir, 'timeline', 'low_confidence.jsonl'),
      JSON.stringify({ word: 'Vesper,' }) + '\n'
    );
    const lines = parseCleaned(
      '**[00:00:01] GM (Danni):** We met Barnon and Gideon near the gate. ^u000001\n'
    );
    const cards = [
      { word: 'Raffne', also: '' },
      { word: 'Raphne', also: '' },
    ];
    const s = sweep(dir, cards, lines, new Set(['near', 'gate']));
    const words = s.outside.map(o => o.word);
    assert.ok(words.includes('Gideon'));
    assert.ok(words.includes('Danni'));
    assert.ok(words.includes('Vesper'));
    assert.ok(!words.includes('Barnon'));
    assert.equal(s.duplicates.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('renderPage fills title and escaped suggestions', () => {
  const out = renderPage('<h1>{{TITLE}}</h1>{{OPTIONS}}', 'S "1"', ['Barnon', 'A<b>']);
  assert.equal(out, '<h1>S &quot;1&quot;</h1><option value="Barnon"><option value="A&lt;b&gt;">');
});

const HAS_FFMPEG = spawnSync('ffmpeg', ['-version']).status === 0;

test('cutClip cuts a real file of the window length', { skip: !HAS_FFMPEG && 'no ffmpeg' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-real-'));
  try {
    const src = path.join(dir, 'src.wav');
    const made = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=d=6', src]);
    assert.equal(made.status, 0);
    const out = path.join(dir, 'clips', 'c.mp4');
    cutClip(src, { start: 1, end: 3.5 }, out);
    assert.ok(fs.statSync(out).size > 0);
    const probe = spawnSync('ffmpeg', ['-i', out, '-f', 'null', '-'], { encoding: 'utf8' });
    const t = /time=(\d+):(\d+):([\d.]+)/g;
    const last = [...probe.stderr.matchAll(t)].pop();
    const secs = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
    assert.ok(Math.abs(secs - 2.5) < 0.3, `cut is ${secs}s, expected about 2.5`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cutClip builds the ffmpeg call for the window', () => {
  const calls = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-'));
  try {
    cutClip(
      't.ogg',
      { start: 54, end: 66.5 },
      path.join(dir, 'a', 'c.mp4'),
      (cmd, a) => (calls.push([cmd, a]), { status: 0 })
    );
    assert.equal(calls[0][0], 'ffmpeg');
    assert.ok(calls[0][1].join(' ').includes('-ss 54.00 -to 66.50 -i t.ogg'));
    assert.ok(calls[0][1].includes('aac'));
    assert.ok(calls[0][1].at(-1).endsWith('c.mp4'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
