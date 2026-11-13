// Tests for scripts/backlog.mjs and scripts/backlog-items.mjs: every command on a fixture in LF and
// CRLF, the edit checks (including the doubled-file accident), and the git loop on real temp repos
// with a simulated push race.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkEdit,
  isMerged,
  newestProgress,
  parseBacklog,
  parseProgress,
  parseReady,
} from './backlog-items.mjs';
import {
  BACKLOG,
  DONE,
  LOWS,
  PI_LIST,
  addEdit,
  claimEdit,
  doneEdit,
  lowEdit,
  progressEdit,
  releaseEdit,
  run,
  statusText,
  piListStatus,
  takeLock,
} from './backlog.mjs';

const FIXTURE = [
  '---',
  'type: list',
  'updated: 2026-11-08',
  '---',
  '# Backlog',
  '',
  'Format: `## <S|M|L> <title>` then `- id:`. A sentence that says ## S Not a heading stays text.',
  '',
  '## Review picks: top priority',
  '',
  'Chapter text.',
  '',
  '## M First item',
  '- id: first',
  'claimed: First lane 2026-11-11',
  '- progress: 2026-11-11 PR #1 draft',
  '- board: Orange Pi',
  '- touches: scripts/pi/remote/, scripts/x.mjs (about lines 5 to 9)',
  '',
  '## S Second item',
  '',
  '- id: second',
  '- board: Process and tooling',
  '- done when: it works; the text says ## M fake heading inside a line',
  '- source: Fable review, pick P1',
  '',
  '## S Third item',
  '',
  '- id: third',
  '- board: CI',
  '- blocked by: item:second',
  '',
  '## S Fourth item',
  '',
  '- id: fourth',
  '- board: CI',
  '- progress: 2026-11-10 PR #5 merged at abc',
  '',
  '## S Fifth item',
  '',
  '- id: fifth',
  '- board: Docs',
  '- blocked by: item:gone-already, W21',
  '- depends on: item:first',
  '- private: yes',
  '',
  '## Captured on the board (triage)',
  '',
  '## S Captured thing',
  '- id: captured-thing',
  '- captured: 2026-11-10',
  '',
].join('\n');

const DONE_FIXTURE = [
  '---',
  'type: list',
  '---',
  '# Backlog done',
  '',
  'Filled by the planner on merge, newest first.',
  '- 2026-11-12 older: PR #3 merged (planner) | CI',
  '- old style | CI | #1 | 2026-10-01',
  '',
].join('\n');

const crlf = (/** @type {string} */ s) => s.replace(/\n/g, '\r\n');
const D = '2026-11-12';
const block = (/** @type {string} */ text, /** @type {string} */ id) =>
  parseBacklog(text)
    .items.find(i => i.id === id)
    ?.lines.join('\n');

for (const [name, conv] of /** @type {const} */ ([
  ['LF', (/** @type {string} */ s) => s],
  ['CRLF', crlf],
])) {
  const fx = conv(FIXTURE);
  const keepsEndings = (/** @type {string} */ out) => {
    if (name === 'CRLF') assert.ok(!/[^\r]\n/.test(out), 'a bare LF crept into a CRLF file');
    else assert.ok(!out.includes('\r'), 'a CR crept into an LF file');
    assert.equal(out.endsWith(name === 'CRLF' ? '\r\n' : '\n'), true, 'the final newline is kept');
  };

  test(`${name}: claim writes claimed and link after the id line`, () => {
    const r = claimEdit(fx, { id: 'second', title: 'Second lane', date: D, link: 'claude://x' });
    keepsEndings(r.text);
    assert.match(
      block(r.text, 'second') ?? '',
      /- id: second\n- claimed: Second lane 2026-11-12\n- link: claude:\/\/x\n- board/
    );
    assert.equal(r.text.split(/\r?\n/).length, fx.split(/\r?\n/).length + 2);
  });

  test(`${name}: progress replaces the line, keeps its place, adds the date`, () => {
    const r = progressEdit(fx, { id: 'first', text: 'PR #1 ready, head abc', date: D });
    keepsEndings(r.text);
    assert.equal(parseProgress(r.text).get('first'), '2026-11-12 PR #1 ready, head abc');
    assert.match(
      block(r.text, 'first') ?? '',
      /claimed: First lane 2026-11-11\n- progress: 2026-11-12 PR #1 ready/
    );
    assert.equal(r.text.split(/\r?\n/).length, fx.split(/\r?\n/).length);
  });

  test(`${name}: release removes the claim (bare claimed: line too)`, () => {
    const r = releaseEdit(fx, { id: 'first' });
    keepsEndings(r.text);
    assert.doesNotMatch(block(r.text, 'first') ?? '', /claimed/);
    assert.match(block(r.text, 'first') ?? '', /- progress: 2026-11-11 PR #1 draft/);
  });

  test(`${name}: done removes exactly the item and dates the Done line`, () => {
    const r = doneEdit(fx, conv(DONE_FIXTURE), {
      id: 'second',
      pr: '#42',
      date: D,
      sha: 'abcdef1234',
      summary: 'all good',
    });
    keepsEndings(r.text);
    keepsEndings(r.done);
    assert.equal(block(r.text, 'second'), undefined);
    assert.equal(parseBacklog(r.text).items.length, parseBacklog(fx).items.length - 1);
    assert.equal(
      r.line,
      '- 2026-11-12 second: PR #42 merged at abcdef1; all good (planner) | Process and tooling'
    );
    const lines = r.done.split(/\r?\n/);
    assert.equal(lines[6], r.line, 'goes above the first dated line');
    assert.equal(lines[7], '- 2026-11-12 older: PR #3 merged (planner) | CI');
  });

  test(`${name}: add goes to triage with a captured line and keeps blank lines around it`, () => {
    const r = addEdit(fx, DONE_FIXTURE, {
      block: [
        '## S New item',
        '',
        '- id: new-item',
        '- board: CI',
        '- source: Fable review, pick P1',
        '- touches: scripts/x.mjs',
      ],
      date: D,
    });
    keepsEndings(r.text);
    const p = parseBacklog(r.text);
    assert.equal(p.items.at(-1)?.id, 'new-item');
    assert.match(
      block(r.text, 'new-item') ?? '',
      /- touches: scripts\/x\.mjs\n- captured: 2026-11-12/
    );
    assert.deepEqual(r.notes, [
      'touches overlap: first (First item) on scripts/x.mjs',
      'same source: second (Second item)',
    ]);
    assert.ok(
      /- captured: 2026-11-10\r?\n\r?\n## S New item/.test(r.text),
      'a blank line before the new item'
    );
  });

  test(`${name}: low appends one dated line`, () => {
    const lows = conv('# Lows: CI\n\nOne line per low.\n\n- 2026-11-11 PR 1 L1: a, x\n');
    const out = lowEdit(lows, '- 2026-11-12 PR 2 L1: b, y');
    keepsEndings(out);
    assert.equal(out.split(/\r?\n/).at(-2), '- 2026-11-12 PR 2 L1: b, y');
    assert.throws(() => lowEdit(out, '- 2026-11-12 PR 2 L1: b, y'), /already/);
  });
}

test('parser: only whole lines are headings; a bare claimed: line counts', () => {
  const p = parseBacklog(FIXTURE);
  assert.deepEqual(
    p.items.map(i => i.id),
    ['first', 'second', 'third', 'fourth', 'fifth', 'captured-thing']
  );
  assert.equal(p.items[0].fields.get('claimed')?.[0], 'First lane 2026-11-11');
  assert.deepEqual(
    p.chapters.map(c => c.title),
    ['Review picks: top priority', 'Captured on the board (triage)']
  );
});

test('claim refuses a claimed, merged or blocked item and notes open dependencies', () => {
  const c = (/** @type {string} */ id) => claimEdit(FIXTURE, { id, title: 't', date: D });
  assert.throws(() => c('first'), /already claimed: First lane/);
  assert.throws(() => c('fourth'), /merged or fixed/);
  assert.throws(() => c('third'), /blocked by open item\(s\): second/);
  assert.throws(() => c('nope'), /no item with id nope/);
  const r = c('fifth'); // blocked by an item that left the Backlog: free
  assert.deepEqual(r.notes, ['note: fifth depends on open item(s) first']);
  assert.match(block(r.text, 'fifth') ?? '', /- claimed: t 2026-11-12\n- board/);
});

test('claim replaces a stale link line', () => {
  const fx = FIXTURE.replace('- id: second\n', '- id: second\n- link: claude://old\n');
  const r = claimEdit(fx, { id: 'second', title: 't', date: D, link: 'claude://new' });
  assert.doesNotMatch(r.text, /claude:\/\/old/);
  assert.match(block(r.text, 'second') ?? '', /- claimed: t 2026-11-12\n- link: claude:\/\/new\n/);
});

test('progress puts several old progress lines into one and inserts one where none was', () => {
  const fx = FIXTURE.replace(
    '- progress: 2026-11-11 PR #1 draft\n',
    '- progress: one\n- board: x\n- progress: two\n'
  );
  const r = progressEdit(fx, { id: 'first', text: '2026-11-01 three', date: D });
  assert.match(
    block(r.text, 'first') ?? '',
    /claimed: First lane 2026-11-11\n- progress: 2026-11-01 three\n- board: x\n- board: Orange Pi/
  );
  const s = progressEdit(FIXTURE, { id: 'second', text: 'started', date: D });
  assert.match(block(s.text, 'second') ?? '', /- id: second\n- progress: 2026-11-12 started\n/);
  assert.throws(() => progressEdit(FIXTURE, { id: 'second', text: 'a\nb', date: D }), /one line/);
});

test('release refuses an unclaimed item', () => {
  assert.throws(() => releaseEdit(FIXTURE, { id: 'second' }), /not claimed/);
});

test('done keeps a private marker and refuses a PR that is not a number', () => {
  const r = doneEdit(FIXTURE, DONE_FIXTURE, { id: 'fifth', pr: '7', date: D, by: 'merge runner' });
  assert.equal(r.line, '- 2026-11-12 fifth: PR #7 merged (merge runner) | Docs | private');
  assert.throws(
    () => doneEdit(FIXTURE, DONE_FIXTURE, { id: 'fifth', pr: 'soon', date: D }),
    /must be a number/
  );
});

test('add refuses a used id, a bad block and an unknown chapter; places --after and --chapter', () => {
  const add = (/** @type {string[]} */ b, /** @type {object} */ o = {}) =>
    addEdit(FIXTURE, DONE_FIXTURE, { block: b, date: D, ...o });
  assert.throws(() => add(['## S X', '- id: second']), /already in Backlog\.md/);
  assert.throws(() => add(['## S X', '- id: older']), /never reused/);
  assert.throws(() => add(['## S X', '- id: Bad Id']), /slug/);
  assert.throws(() => add(['## S X', '- id: x', '## S Y', '- id: y']), /exactly one/);
  assert.throws(() => add(['## S X', '- id: x'], { chapter: 'nowhere' }), /no chapter/);
  const a = add(['## S X', '- id: x'], { after: 'first' });
  assert.deepEqual(
    parseBacklog(a.text)
      .items.map(i => i.id)
      .slice(0, 3),
    ['first', 'x', 'second']
  );
  assert.doesNotMatch(block(a.text, 'x') ?? '', /captured/);
  const c = add(['## S X', '- id: x'], { chapter: 'review picks' });
  // The end of the chapter: after its last item, before the next chapter heading.
  assert.deepEqual(
    parseBacklog(c.text)
      .items.map(i => i.id)
      .slice(4, 7),
    ['fifth', 'x', 'captured-thing']
  );
  assert.match(c.text, /- private: yes\n\n## S X\n- id: x\n\n## Captured on the board/);
});

test('checkEdit refuses a doubled file, a changed neighbour, a Done chapter item and a broken preamble', () => {
  assert.throws(() => checkEdit(FIXTURE, FIXTURE + FIXTURE, { id: 'x', items: 0 }), /item count/);
  const neighbour = FIXTURE.replace('- board: CI\n- blocked by', '- board: Docs\n- blocked by');
  assert.throws(
    () => checkEdit(FIXTURE, neighbour, { id: 'second', items: 0 }),
    /other than the target/
  );
  const withDone = FIXTURE.replace('## S Fifth item', '## Done\n\n## S Fifth item');
  assert.throws(() => checkEdit(withDone, withDone, { id: 'x', items: 0 }), /Done chapter/);
  const noTitle = FIXTURE.replace('# Backlog\n', '');
  assert.throws(() => checkEdit(FIXTURE, noTitle, { id: 'x', items: 0 }), /Backlog. title/);
  assert.throws(
    () => checkEdit(FIXTURE, FIXTURE + '\nextra', { id: 'x', items: 0, lines: 0 }),
    /line count/
  );
  checkEdit(FIXTURE, FIXTURE, { id: 'x', items: 0, lines: 0 });
});

test('status lists claimed items with progress, then free unblocked ones, in about 400 words', () => {
  const s = statusText(FIXTURE);
  assert.match(
    s,
    /^Claimed \(1\):\n- first \(2026-11-11\): 2026-11-11 PR #1 draft\nTop free \(3 of 3\):/
  );
  assert.match(
    s,
    /- second \(S\): Second item\n- fifth \(S\): Fifth item \[blocked by item:gone-already, W21\]\n- captured-thing/
  );
  assert.doesNotMatch(s, /third|fourth/);
  const many =
    FIXTURE +
    Array.from(
      { length: 40 },
      (_, i) =>
        `\n## S Item ${i}\n- id: i${i}\n- claimed: lane ${i} 2026-11-11\n- progress: ${'word '.repeat(60)}\n`
    ).join('');
  assert.ok(statusText(many).split(/\s+/).length < 1000);
});

/** @param {string[]} progressLines */
const itemWith = progressLines =>
  parseBacklog(
    ['# Backlog', '', '## S T', '', '- id: t', ...progressLines.map(p => `- progress: ${p}`)].join(
      '\n'
    )
  ).items[0];

test('isMerged: the three false positives of 2026-11-12 are not merged, the two misses are', () => {
  // dnd-helper-player-connector: other PRs merged, work left
  assert.equal(
    isMerged(
      itemWith([
        '2026-11-08 planner: design, auth (#866, #875) merged; Pi route live; left: player-connector-canary',
      ])
    ),
    false
  );
  // docs-react-images: newest line says "merges only after", an older line has MERGED as #582
  assert.equal(
    isMerged(
      itemWith([
        '2026-10-31 planner: #680 already swaps the README picture, so it merges only after W73',
        '2026-10-29 stills MERGED as #582. Left: the demo video',
      ])
    ),
    false
  );
  // mcp-sdk-v2-spike: "main merged" is a merge of main into the branch
  assert.equal(
    isMerged(itemWith(['2026-10-28 HELD, merge-ready: PR #534 (main merged, round 2 fixes)'])),
    false
  );
  // real-tool-usage and main-red-auto-revert style: PR #n merged
  assert.equal(isMerged(itemWith(['2026-11-10 planner: PR #909 merged (weekly line)'])), true);
  assert.equal(isMerged(itemWith(['2026-10-28 PR #301 MERGED at ad13367 after rounds'])), true);
});

test('newestProgress reads the newest date, not the last line; an undated line is oldest', () => {
  const i = itemWith(['2026-11-12 PR #5 merged', '2026-11-01 PR #4 ready', 'no date']);
  assert.equal(newestProgress(i), '2026-11-12 PR #5 merged');
  assert.equal(isMerged(i), true);
  // the old last-line reading would have said "not merged" here
  assert.equal(isMerged(itemWith(['2026-11-12 PR #5 merged', '2026-11-01 PR #4 ready'])), true);
});

test('claim and status use the same matcher as the Pi flag', () => {
  const text = [
    '---',
    'type: list',
    '---',
    '# Backlog',
    '',
    '## S T',
    '',
    '- id: t',
    '- progress: 2026-11-12 planner: PR #3 merged at abc1234',
    '',
    '## S U',
    '',
    '- id: u',
    '- progress: 2026-11-12 (main merged, round 2)',
    '',
  ].join('\n');
  assert.throws(() => claimEdit(text, { id: 't', title: 'x', date: '2026-11-13' }), /merged/);
  assert.doesNotThrow(() => claimEdit(text, { id: 'u', title: 'x', date: '2026-11-13' }));
  assert.match(piListStatus(text, '', '2026-11-20'), /still open \(1\): t;/);
});

test('done takes the merge commit from gh, --sha overrides, an unanswered gh gives no sha', () => {
  const v = vaults();
  const asked = [];
  const gh = (/** @type {string[]} */ a) => {
    asked.push(a.join(' '));
    return { state: 'MERGED', mergeCommit: { oid: 'a1b2c3d4e5f6' } };
  };
  const r = v.cli(['done', 'second', '42'], { gh });
  assert.equal(r.code, 0, r.err);
  assert.match(v.remoteFile(DONE), /second: PR #42 merged at a1b2c3d /);
  assert.match(asked[0], /^pr view 42 -R .* --json state,mergeCommit$/);
  const none = v.cli(['done', 'fourth', '2'], { gh: () => null });
  assert.equal(none.code, 0, none.err);
  assert.match(none.out, /no merge commit from gh for PR #2/);
  assert.match(v.remoteFile(DONE), /fourth: PR #2 merged \(planner\)/);
});

test('status counts the Pi sitting list and flags items merged more than 3 days ago', () => {
  const backlog = [
    '---',
    'type: backlog',
    '---',
    '# Backlog',
    '',
    '## S Old merged',
    '',
    '- id: old-merged',
    '- progress: 2026-11-07 planner: PR #1 MERGED, only the Pi run left',
    '',
    '## S Fresh merged',
    '',
    '- id: fresh-merged',
    '- progress: 2026-11-11 PR #2 merged',
    '',
    '## S Open',
    '',
    '- id: open-one',
    '- progress: 2026-11-01 PR #3 ready',
    '',
  ].join('\n');
  const pi = '# Pi sitting list\n\nIntro.\n\n- 2026-11-12 a: x\n- 2026-11-12 b: y\n';
  const s = piListStatus(backlog, pi, '2026-11-12');
  assert.match(s, /^Pi sitting list: 2 runs waiting\n/);
  assert.match(s, /still open \(1\): old-merged;/);
  assert.doesNotMatch(s, /fresh-merged|open-one/);
  assert.equal(piListStatus(backlog, '', '2026-11-09').split('\n').length, 1);
  assert.match(piListStatus(backlog, '', '2026-11-12'), /^Pi sitting list: 0 runs waiting/);
});

test('skills: lane and planner point at backlog.mjs and stay under the word budget the planner skill names', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const read = (/** @type {string} */ s) =>
    fs.readFileSync(path.join(root, '.claude', 'skills', s, 'SKILL.md'), 'utf8');
  const lane = read('lane');
  const planner = read('planner');
  for (const t of [lane, planner]) assert.match(t, /scripts\/backlog\.mjs/);
  // the advisor was dropped for every lane (the user, 2026-11-12): the lane skill must not bring it back
  assert.doesNotMatch(lane, /advisor/i);
  const m = /lane skill under ([\d,]+) words, planner under ([\d,]+)/.exec(planner);
  assert.ok(m, 'the planner skill names both budgets');
  const words = (/** @type {string} */ t) => t.split(/\s+/).filter(Boolean).length;
  const num = (/** @type {string} */ s) => Number(s.replace(/,/g, ''));
  assert.ok(words(lane) < num(m[1]), `lane skill has ${words(lane)} words, budget under ${m[1]}`);
  assert.ok(
    words(planner) < num(m[2]),
    `planner skill has ${words(planner)} words, budget under ${m[2]}`
  );
});

// ---- git: real temp repos ------------------------------------------------------------------------

const git = (/** @type {string} */ cwd, /** @type {string[]} */ args) => {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

/** A bare remote and two clones (a = this session's vault, b = the board or the planner). */
function vaults(/** @type {string} */ text = crlf(FIXTURE)) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-test-'));
  const remote = path.join(root, 'remote.git');
  git(root, ['init', '-q', '--bare', '-b', 'main', remote]);
  const clone = (/** @type {string} */ name) => {
    const dir = path.join(root, name);
    // Set before the checkout: a later config change leaves CRLF files that `commit -a` rewrites.
    git(root, ['clone', '-q', '-c', 'core.autocrlf=false', remote, dir]);
    for (const [k, v] of [
      ['core.autocrlf', 'false'],
      ['user.name', 'test'],
      ['user.email', 'test@example.invalid'],
      ['commit.gpgsign', 'false'],
    ])
      git(dir, ['config', k, v]);
    return dir;
  };
  const a = clone('a');
  fs.mkdirSync(path.join(a, LOWS), { recursive: true });
  fs.writeFileSync(path.join(a, BACKLOG), text);
  fs.writeFileSync(path.join(a, DONE), crlf(DONE_FIXTURE));
  fs.writeFileSync(path.join(a, LOWS, 'CI.md'), '# Lows: CI\n\n');
  fs.writeFileSync(path.join(a, 'other.md'), 'x\n');
  git(a, ['add', '-A']);
  git(a, ['commit', '-q', '-m', 'seed']);
  git(a, ['push', '-q', '-u', 'origin', 'main']);
  const b = clone('b');
  const cli = (/** @type {string[]} */ argv, /** @type {object} */ env = {}) => {
    const out = [];
    const err = [];
    const code = run([...argv, '--date', D], {
      vault: a,
      out: s => out.push(s),
      err: s => err.push(s),
      gh: () => null,
      ...env,
    });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };
  const remoteFile = (/** @type {string} */ rel) => git(a, ['show', `origin/main:${rel}`]);
  return { root, a, b, cli, remoteFile };
}

test('git: claim pushes one commit with only Backlog.md; an unrelated dirty file is left alone', () => {
  const v = vaults();
  fs.writeFileSync(path.join(v.a, 'other.md'), 'someone else is editing\n');
  const r = v.cli(['claim', 'second', 'My', 'lane', '--link', 'claude://me']);
  assert.equal(r.code, 0, r.err);
  assert.match(
    v.remoteFile(BACKLOG),
    /- id: second\r\n- claimed: My lane 2026-11-12\r\n- link: claude:\/\/me\r\n/
  );
  assert.equal(
    git(v.a, ['log', '-1', '--format=%s', 'origin/main']).trim(),
    'Backlog: claim second (My lane)'
  );
  assert.equal(git(v.a, ['show', '--name-only', '--format=', 'origin/main']).trim(), BACKLOG);
  assert.equal(fs.readFileSync(path.join(v.a, 'other.md'), 'utf8'), 'someone else is editing\n');
});

test('git: a dirty Backlog.md is refused before anything happens', () => {
  const v = vaults();
  fs.appendFileSync(path.join(v.a, BACKLOG), 'half an edit\r\n');
  const r = v.cli(['progress', 'first', 'x']);
  assert.equal(r.code, 1);
  assert.match(
    r.err,
    /another session has uncommitted changes in a file this writes; retry in a minute/
  );
});

test("git: a push race redoes the edit on the board's new text and keeps both changes", () => {
  const v = vaults();
  let raced = 0;
  const r = v.cli(['progress', 'first', 'PR #1 ready'], {
    beforePush: (/** @type {number} */ attempt) => {
      if (attempt > 1) return;
      raced++;
      // The board rewrites the file in between: it claims another item.
      git(v.b, ['pull', '-q']);
      const f = path.join(v.b, BACKLOG);
      fs.writeFileSync(
        f,
        fs
          .readFileSync(f, 'utf8')
          .replace('- id: second\r\n', '- id: second\r\n- claimed: board 2026-11-12\r\n')
      );
      git(v.b, ['commit', '-q', '-am', 'board']);
      git(v.b, ['push', '-q']);
    },
  });
  assert.equal(r.code, 0, r.err);
  assert.equal(raced, 1);
  assert.match(r.err, /push rejected \(attempt 1 of 5\)/);
  const final = v.remoteFile(BACKLOG);
  assert.match(final, /- progress: 2026-11-12 PR #1 ready\r\n/);
  assert.match(final, /- claimed: board 2026-11-12\r\n/);
  assert.equal(final.split('\r\n').length, crlf(FIXTURE).split('\r\n').length + 1);
  assert.equal(git(v.a, ['status', '--porcelain']).trim(), '');
});

test('git: five rejected pushes give up and leave nothing behind', () => {
  const v = vaults();
  let n = 0;
  const r = v.cli(['claim', 'second', 'lane'], {
    beforePush: () => {
      n++;
      git(v.b, ['pull', '-q']);
      fs.appendFileSync(path.join(v.b, 'other.md'), `${n}\n`);
      git(v.b, ['commit', '-q', '-am', `race ${n}`]);
      git(v.b, ['push', '-q']);
    },
  });
  assert.equal(r.code, 1);
  assert.equal(n, 5);
  assert.match(r.err, /rejected 5 times/);
  assert.doesNotMatch(v.remoteFile(BACKLOG), /claimed: lane/);
  assert.equal(git(v.a, ['status', '--porcelain']).trim(), '');
  assert.equal(git(v.a, ['rev-list', '--count', 'origin/main..HEAD']).trim(), '0');
});

test('git: done moves the item, writes the Done line and the Pi sitting list in one commit', () => {
  const v = vaults();
  const r = v.cli([
    'done',
    'second',
    '42',
    '--sha',
    'abcdef1234',
    '--pi-run',
    'run stage 9 on the Pi',
  ]);
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(v.remoteFile(BACKLOG), /- id: second/);
  assert.match(
    v.remoteFile(DONE),
    /\r\n- 2026-11-12 second: PR #42 merged at abcdef1 \(planner\) \| Process and tooling\r\n- 2026-11-12 older/
  );
  assert.match(
    v.remoteFile(PI_LIST),
    /^---\n[\s\S]*\n- 2026-11-12 second: run stage 9 on the Pi\n$/
  );
  assert.equal(
    git(v.a, ['show', '--name-only', '--format=', 'origin/main']).trim().split('\n').length,
    3
  );
});

test('git: add and low go through the same loop; low needs a known area', () => {
  const v = vaults();
  const a = v.cli([
    'add',
    '--id',
    'new-one',
    '--size',
    'm',
    '--title',
    'New one',
    '--board',
    'CI',
    '--done-when',
    'done',
    '--touches',
    'scripts/x.mjs',
  ]);
  assert.equal(a.code, 0, a.err);
  assert.match(a.out, /touches overlap: first/);
  assert.match(
    v.remoteFile(BACKLOG),
    /\r\n## M New one\r\n\r\n- id: new-one\r\n- board: CI\r\n- done when: done\r\n- touches: scripts\/x\.mjs\r\n- captured: 2026-11-12\r\n/
  );
  const again = v.cli([
    'add',
    '--id',
    'new-one',
    '--size',
    'S',
    '--title',
    'x',
    '--board',
    'CI',
    '--done-when',
    'y',
  ]);
  assert.equal(again.code, 1);
  const missing = v.cli(['add', '--id', 'x']);
  assert.equal(missing.code, 2);
  const l = v.cli(['low', 'ci', 'PR 9 L1: a thing, scripts/x.mjs']);
  assert.equal(l.code, 0, l.err);
  assert.equal(
    v.remoteFile(`${LOWS}/CI.md`),
    '# Lows: CI\n\n- 2026-11-12 PR 9 L1: a thing, scripts/x.mjs\n'
  );
  const bad = v.cli(['low', 'nowhere', 'x']);
  assert.match(bad.err, /no Lows\/nowhere\.md; areas: CI/);
});

test('git: the doubled-file accident cannot happen through done (heading text inside sentences)', () => {
  const v = vaults();
  const before = crlf(FIXTURE).split('\r\n').length;
  assert.equal(v.cli(['done', 'second', '1']).code, 0);
  assert.equal(v.cli(['done', 'fourth', '2']).code, 0);
  const after = v.remoteFile(BACKLOG);
  assert.equal(after.split('\r\n').length, before - 13);
  assert.match(after, /A sentence that says ## S Not a heading stays text\./);
  assert.equal((after.match(/^# Backlog\r$/gm) ?? []).length, 1);
});

test('dry run prints the change and writes nothing; unknown commands are usage errors', () => {
  const v = vaults();
  const r = v.cli(['claim', 'second', 'x', '--dry-run']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /\+ - claimed: x 2026-11-12/);
  assert.equal(fs.readFileSync(path.join(v.a, BACKLOG), 'utf8'), crlf(FIXTURE));
  assert.equal(v.cli(['frobnicate']).code, 2);
});

test('git: a second writer on the same vault is refused while the first holds the lock', () => {
  const v = vaults();
  /** @type {{ code: number, err: string } | undefined} */
  let inner;
  const r = v.cli(['progress', 'first', 'outer'], {
    beforePush: () => {
      inner ??= v.cli(['claim', 'second', 'inner'], { lockWaitMs: 0 });
    },
  });
  assert.equal(r.code, 0, r.err);
  assert.equal(inner?.code, 1);
  assert.match(inner?.err ?? '', /another session is writing the Backlog right now/);
  assert.match(v.remoteFile(BACKLOG), /- progress: 2026-11-12 outer\r\n/);
  assert.equal(fs.existsSync(path.join(v.a, '.git', 'backlog-tool.lock')), false, 'released');
});

test('git: a stale lock (dead pid, or older than 15 minutes) is taken over; a live holder is not', () => {
  const v = vaults();
  const lock = path.join(v.a, '.git', 'backlog-tool.lock');
  fs.writeFileSync(lock, JSON.stringify({ pid: 2 ** 22 + 12345, start: Date.now() }));
  assert.equal(v.cli(['claim', 'second', 'x'], { lockWaitMs: 0 }).code, 0);
  // a live holder 3 minutes in (a slow push race) keeps its lock
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, start: Date.now() - 3 * 60 * 1000 }));
  const refused = v.cli(['release', 'second'], { lockWaitMs: 0 });
  assert.equal(refused.code, 1);
  assert.match(refused.err, /another session is writing/);
  assert.ok(fs.existsSync(lock), "the live holder's lock is still there");
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, start: Date.now() - 20 * 60 * 1000 }));
  assert.equal(v.cli(['release', 'second'], { lockWaitMs: 0 }).code, 0);
  assert.doesNotMatch(v.remoteFile(BACKLOG), /claimed: x/);
  assert.ok(!fs.existsSync(lock), 'released');
});

test('git: release leaves a lock another run has taken over', () => {
  const v = vaults();
  const gitDir = path.join(v.a, '.git');
  const release = takeLock(gitDir, 0);
  const lock = path.join(gitDir, 'backlog-tool.lock');
  const theirs = JSON.stringify({ pid: process.pid, start: Date.now() + 1 });
  fs.writeFileSync(lock, theirs);
  release();
  assert.equal(fs.readFileSync(lock, 'utf8'), theirs);
});

test('git: when HEAD moved after our commit, a rejected push resets nothing', () => {
  const v = vaults();
  const r = v.cli(['claim', 'second', 'x'], {
    beforePush: () => {
      git(v.b, ['pull', '-q']);
      fs.appendFileSync(path.join(v.b, 'other.md'), 'b\n');
      git(v.b, ['commit', '-q', '-am', 'race']);
      git(v.b, ['push', '-q']);
      git(v.a, ['commit', '-q', '--allow-empty', '-m', 'someone else in the same tree']);
    },
  });
  assert.equal(r.code, 1);
  assert.match(r.err, /HEAD moved/);
  assert.equal(git(v.a, ['log', '-1', '--format=%s']).trim(), 'someone else in the same tree');
  assert.match(git(v.a, ['log', '-2', '--format=%s']), /Backlog: claim second/);
});

test('git: status reads the upstream copy and never touches the working tree', () => {
  const v = vaults();
  git(v.b, ['pull', '-q']);
  const f = path.join(v.b, BACKLOG);
  fs.writeFileSync(
    f,
    fs
      .readFileSync(f, 'utf8')
      .replace('- id: second\r\n', '- id: second\r\n- claimed: remote lane 2026-11-12\r\n')
  );
  git(v.b, ['commit', '-q', '-am', 'remote claim']);
  git(v.b, ['push', '-q']);
  fs.writeFileSync(path.join(v.a, 'other.md'), 'dirty\n');
  const head = git(v.a, ['rev-parse', 'HEAD']);
  const r = v.cli(['status']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /- second \(2026-11-12\): no progress yet/);
  assert.equal(git(v.a, ['rev-parse', 'HEAD']), head, 'no pull into the shared tree');
  assert.equal(fs.readFileSync(path.join(v.a, 'other.md'), 'utf8'), 'dirty\n');
});

test('git: unpushed local commits are rebased and pushed with the edit', () => {
  const v = vaults();
  fs.writeFileSync(path.join(v.a, 'other.md'), 'planner note\n');
  git(v.a, ['commit', '-q', '-am', 'planner, not pushed']);
  git(v.b, ['pull', '-q']);
  fs.appendFileSync(path.join(v.b, LOWS, 'CI.md'), '- 2026-11-12 b\n');
  git(v.b, ['commit', '-q', '-am', 'remote']);
  git(v.b, ['push', '-q']);
  const r = v.cli(['claim', 'second', 'x']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /1 unpushed commit/);
  assert.equal(git(v.a, ['show', 'origin/main:other.md']), 'planner note\n');
  assert.match(git(v.a, ['show', `origin/main:${LOWS}/CI.md`]), /- 2026-11-12 b/);
});

test("git: unpushed commits plus another session's uncommitted edit: refused, the edit is never stashed", () => {
  const v = vaults();
  fs.writeFileSync(path.join(v.a, 'other.md'), 'planner note\n');
  git(v.a, ['commit', '-q', '-am', 'planner, not pushed']);
  fs.appendFileSync(path.join(v.a, LOWS, 'CI.md'), '- half written\n');
  const r = v.cli(['claim', 'second', 'x']);
  assert.equal(r.code, 1);
  assert.match(r.err, /uncommitted edits by another session/);
  assert.match(fs.readFileSync(path.join(v.a, LOWS, 'CI.md'), 'utf8'), /half written/);
  assert.equal(git(v.a, ['stash', 'list']).trim(), '');
});

test('git: a push that landed but reported failure counts as written', () => {
  const v = vaults();
  const r = v.cli(['claim', 'second', 'x'], {
    // the push is rejected by a hook-less trick: push to the remote ourselves, then make ours fail
    beforePush: () => {
      git(v.a, ['push', '-q']);
      git(v.a, ['remote', 'set-url', '--push', 'origin', '/nonexistent/none.git']);
    },
  });
  assert.equal(r.code, 0, r.err);
});

test('git: a rebase conflict is aborted, so the shared vault is never left mid-rebase', () => {
  const v = vaults();
  fs.writeFileSync(path.join(v.a, 'other.md'), 'local\n');
  git(v.a, ['commit', '-q', '-am', 'local, not pushed']);
  git(v.b, ['pull', '-q']);
  fs.writeFileSync(path.join(v.b, 'other.md'), 'remote\n');
  git(v.b, ['commit', '-q', '-am', 'remote']);
  git(v.b, ['push', '-q']);
  const r = v.cli(['claim', 'second', 'x']);
  assert.equal(r.code, 1);
  assert.match(r.err, /git rebase failed/);
  assert.equal(fs.existsSync(path.join(v.a, '.git', 'rebase-merge')), false);
  assert.equal(git(v.a, ['log', '-1', '--format=%s']).trim(), 'local, not pushed');
  assert.equal(fs.existsSync(path.join(v.a, '.git', 'backlog-tool.lock')), false);
});

test('progress --ready writes the fixed ready line the merge runner reads back', () => {
  const sha = 'a'.repeat(40);
  const v = vaults();
  const r = v.cli(['progress', 'first', '--ready', '12', '--head', sha, '--review', 'Handoff/x.md']);
  assert.equal(r.code, 0, r.err);
  const line = parseProgress(v.remoteFile(BACKLOG)).get('first') ?? '';
  assert.equal(line, `${D} PR #12 ready, head ${sha}, review Handoff/x.md`);
  assert.deepEqual(parseReady(line), { pr: 12, head: sha });
  assert.equal(v.cli(['progress', 'first', '--ready', '12', '--head', 'abc']).code, 1);
  assert.equal(v.cli(['progress', 'first', '--ready', 'x', '--head', sha]).code, 1);
  assert.equal(v.cli(['progress', 'first', 'text', '--ready', '12', '--head', sha]).code, 2);
  // --if-ready: written only while that ready line is still the item's line.
  const other = 'c'.repeat(40);
  const stale = v.cli(['progress', 'first', 'refused', '--if-ready', `12@${other}`]);
  assert.equal(stale.code, 1);
  assert.match(stale.err, /no longer the ready line of PR #12/);
  assert.equal(v.cli(['progress', 'first', 'refused', '--if-ready', '12']).code, 2);
  assert.equal(v.cli(['progress', 'first', 'refused', '--if-ready', `12@${sha}`]).code, 0);
  assert.equal(parseProgress(v.remoteFile(BACKLOG)).get('first'), `${D} refused`);
});

test('parseReady: the last line, a date in front or not; a short sha or other text is not ready', () => {
  const sha = 'b'.repeat(40);
  assert.deepEqual(parseReady(`PR #3 ready, head ${sha}`), { pr: 3, head: sha });
  assert.deepEqual(parseReady(`old\n2026-11-12 PR #4 ready, head ${sha}, review r.md`), {
    pr: 4,
    head: sha,
  });
  assert.equal(parseReady('2026-11-12 PR #970 ready (move 1 of 3)'), null);
  assert.equal(parseReady(`PR #5 ready, head ${sha.slice(0, 7)}`), null);
  assert.equal(parseReady(`PR #5 ready, head ${sha}\nlater: fixing`), null);
  assert.equal(parseReady(`2026-11-12 PR #5 merged; was PR #5 ready, head ${sha}`), null);
});
