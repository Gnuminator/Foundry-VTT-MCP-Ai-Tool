// Tests for `npm run usage:week` (usage-week.mjs): fixture transcripts in a temp dir, the Usage log
// parsing with a weekly reset, price weighting, startup share, the targets line and --json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PROJECT_DIR,
  buildReport,
  dayKey,
  findTranscripts,
  formatReport,
  formatTargets,
  isProjectDir,
  main,
  median,
  parseArgs,
  parseResponse,
  parseUsageLog,
  priceOf,
  usageLogFile,
  weeklyPoints,
} from './usage-week.mjs';

const NOW = new Date(2026, 9, 10, 12, 0); // local noon, 10 Oct 2026
const at = (day, hour = 10, minute = 0) => new Date(2026, 9, day, hour, minute);

// An API response whose context is exactly `ctx` (input 100, the rest cache read), no output.
function resp(id, when, model, ctx, extra = {}) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: when.toISOString(),
    message: {
      id,
      model,
      usage: {
        input_tokens: 100,
        cache_read_input_tokens: ctx - 100,
        cache_creation_input_tokens: 0,
        output_tokens: 0,
      },
    },
    ...extra,
  });
}

const costOf = (model, ctx) => (priceOf(model) * (100 + 0.1 * (ctx - 100))) / 1e6;

const LOG = `---
type: log
---

# Usage log (measured)

## PC ONE

| When (local) | Session | Event | Context tokens | Peak tokens | 5-hour % | Weekly % (all) |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-08 10:00 | s1 | start | 80,000 | 80,000 |  | 40 |
| 2026-10-08 18:00 | s2 | start | 80,000 | 80,000 | 20 | 53 |
| 2026-10-09 08:00 | s3 | start | 80,000 | 80,000 |  |  |
| 2026-10-09 09:00 | s4 | start | 80,000 | 80,000 |  | 13 |
| 2026-10-09 12:00 | s5 | start | 80,000 | 80,000 |  | 12 |
| 2026-10-09 15:00 | s6 | end | 90,000 | 90,000 |  | 20 |

## PC TWO

| When (local) | Session | Event | Context tokens | Peak tokens | 5-hour % | Weekly % (all) |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-10 11:00 | s7 | end | 90,000 | 90,000 | 5 | 27 |
`;

// Two sessions over two days, a subagent file, a message id repeated in another file, a sidechain
// line, a response before the window, and folders that must not be read.
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'usage-week-'));
  const projects = path.join(root, 'projects');
  const put = (dir, rel, lines) => {
    const file = path.join(projects, dir, ...rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${lines.join('\n')}\n`);
  };
  const wt = `${PROJECT_DIR}--claude-worktrees-lane-x`;
  // Session A (main checkout), 9 Oct, sonnet: 50k, 60k, 70k, 80k and a sidechain line of 1M.
  put(
    PROJECT_DIR,
    ['a.jsonl'],
    [
      resp('a1', at(9, 9), 'claude-sonnet-5-5', 50_000),
      resp('a2', at(9, 10), 'claude-sonnet-5-5', 60_000),
      resp('a-side', at(9, 10, 5), 'claude-sonnet-5-5', 1_000_000, { isSidechain: true }),
      JSON.stringify({ type: 'user', message: { content: 'hello "usage"' } }),
      resp('a3', at(9, 11), 'claude-sonnet-5-5', 70_000),
      resp('a4', at(9, 12), 'claude-sonnet-5-5', 80_000),
    ]
  );
  // A session from before the window (its mtime is new, its response is old).
  put(
    PROJECT_DIR,
    ['old.jsonl'],
    [resp('old', new Date(2026, 8, 20, 9), 'claude-sonnet-5-5', 99_000)]
  );
  // Its subagent, 9 Oct, haiku: two responses of 20k.
  put(
    PROJECT_DIR,
    ['a', 'subagents', 'agent-1.jsonl'],
    [
      resp('s1', at(9, 9, 30), 'claude-haiku-5-5', 20_000, { isSidechain: true }),
      resp('s2', at(9, 9, 40), 'claude-haiku-5-5', 20_000, { isSidechain: true }),
    ]
  );
  // Session B (a worktree), 10 Oct, opus: 40k, 50k, 60k.
  put(
    wt,
    ['b.jsonl'],
    [
      resp('b1', at(10, 8), 'claude-opus-5-1', 40_000),
      resp('b2', at(10, 9), 'claude-opus-5-1', 50_000),
      resp('b3', at(10, 10), 'claude-opus-5-1', 60_000),
    ]
  );
  // Session C, 10 Oct, sonnet: only two turns (no session). A third file repeats b2's id.
  put(
    wt,
    ['c.jsonl'],
    [
      resp('c1', at(10, 8, 30), 'claude-sonnet-5-5', 30_000),
      resp('c2', at(10, 9, 30), 'claude-sonnet-5-5', 35_000),
    ]
  );
  put(wt, ['d.jsonl'], [resp('b2', at(10, 9), 'claude-opus-5-1', 50_000)]);
  // Folders that are not this project.
  put(
    'C--Users-chris-AppData-Local-Temp-claude-C--Users-chris-Documents-Claude-Code-Projects-Foundry-VTT-AI-Tool--claude-worktrees-x-scratchpad',
    ['z.jsonl'],
    [resp('z1', at(10, 8), 'claude-opus-5-1', 500_000)]
  );
  put(
    `${PROJECT_DIR}-packages-mcp-server`,
    ['y.jsonl'],
    [resp('y1', at(10, 8), 'claude-opus-5-1', 500_000)]
  );
  const vault = path.join(root, 'vault');
  const log = usageLogFile(vault);
  mkdirSync(path.dirname(log), { recursive: true });
  writeFileSync(log, LOG);
  return {
    root,
    projects,
    vault,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

const prs = [
  { number: 1, mergedAt: at(10, 9).toISOString() },
  { number: 2, mergedAt: at(10, 11).toISOString() },
  { number: 3, mergedAt: at(8, 15).toISOString() },
  { number: 4, mergedAt: new Date(2026, 8, 1).toISOString() },
];

test('helpers: project folders, price ratios, median, args', () => {
  assert.ok(isProjectDir(PROJECT_DIR));
  assert.ok(isProjectDir(`${PROJECT_DIR}--claude-worktrees-lane-x`));
  assert.ok(!isProjectDir(`${PROJECT_DIR}-packages-mcp-server`));
  assert.ok(!isProjectDir('C--Users-chris-AppData-Local-Temp-claude-scratchpad'));
  assert.deepEqual(
    [
      'claude-opus-5-1',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
      'claude-fable-1',
      'x',
      undefined,
    ].map(priceOf),
    [5, 3, 1, 5, 3, 3]
  );
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([40_000, 50_000]), 45_000);
  assert.equal(median([]), null);
  assert.deepEqual(parseArgs([]), { days: 7, json: false });
  assert.deepEqual(parseArgs(['--json', '--days', '3']), { days: 3, json: true });
  assert.deepEqual(parseArgs(['--days=14']), { days: 14, json: false });
  assert.equal(parseArgs(['--days', 'abc']).days, 7);
});

test('parseResponse: price weighting uses input, 0.1 cache read, 2 cache creation and 5 output', () => {
  const line = JSON.stringify({
    type: 'assistant',
    timestamp: at(9).toISOString(),
    message: {
      id: 'm',
      model: 'claude-sonnet-5-5',
      usage: {
        input_tokens: 1000,
        cache_read_input_tokens: 10_000,
        cache_creation_input_tokens: 1000,
        output_tokens: 100,
      },
    },
  });
  const r = parseResponse(line);
  assert.equal(r.ctx, 12_000);
  assert.ok(Math.abs(r.cost - (3 * (1000 + 1000 + 2000 + 500)) / 1e6) < 1e-12);
  const opus = parseResponse(line.replace('sonnet-5-5', 'opus-5-1'));
  assert.ok(Math.abs(opus.cost / r.cost - 5 / 3) < 1e-9);
  assert.equal(parseResponse('{"type":"user","usage":1}'), null);
  assert.equal(parseResponse('garbage "usage"'), null);
  assert.equal(parseResponse(line.replace('claude-sonnet-5-5', '<synthetic>')), null);
});

test('findTranscripts: only this project, main-thread files before subagents', () => {
  const f = fixture();
  try {
    const files = findTranscripts(f.projects, 0).map(p => path.relative(f.projects, p));
    assert.equal(files.length, 6);
    assert.ok(files.every(p => !p.includes('scratchpad') && !p.includes('packages-mcp-server')));
    assert.ok(files[files.length - 1].includes('subagents'));
  } finally {
    f.cleanup();
  }
});

test('parseUsageLog and weeklyPoints: two PC sections, blanks skipped, a weekly reset, noise ignored', () => {
  const readings = parseUsageLog(LOG);
  assert.deepEqual(
    readings.map(r => r.v),
    [40, 53, 13, 12, 20, 27]
  );
  const points = weeklyPoints(readings);
  assert.equal(points.get('2026-10-08'), 13); // 40 -> 53
  assert.equal(points.get('2026-10-09'), 13 + 7); // reset to 13 counts from 0; 12 is noise; 13 -> 20
  assert.equal(points.get('2026-10-10'), 7); // 20 -> 27 (the other PC's section)
  assert.equal(weeklyPoints([]).size, 0);
  assert.equal(weeklyPoints([{ t: at(9).getTime(), v: 30 }]).size, 0);
});

test('buildReport: sessions, startup, share, tokens, cost, Opus share, PRs and weekly points per day', async () => {
  const f = fixture();
  try {
    const r = await buildReport({ root: f.projects, now: NOW, days: 7, prs, usageLog: LOG });
    assert.equal(r.window.from, '2026-10-04');
    assert.equal(r.window.to, '2026-10-10');
    assert.equal(r.days.length, 7);
    assert.equal(r.files, 6);
    const day = k => r.days.find(d => d.day === k);

    const d9 = day('2026-10-09');
    assert.equal(d9.sessions, 1);
    assert.equal(d9.startup, 50_000);
    assert.ok(Math.abs(d9.share - (50_000 * 4) / 260_000) < 1e-9); // sidechain not in the share
    assert.equal(d9.tokens, 260_000 + 1_000_000 + 40_000); // main + sidechain + subagent
    const cost9 =
      costOf('claude-sonnet-5-5', 50_000) +
      costOf('claude-sonnet-5-5', 60_000) +
      costOf('claude-sonnet-5-5', 1_000_000) +
      costOf('claude-sonnet-5-5', 70_000) +
      costOf('claude-sonnet-5-5', 80_000) +
      2 * costOf('claude-haiku-5-5', 20_000);
    assert.ok(Math.abs(d9.cost - cost9) < 1e-9);
    assert.equal(d9.opusCost, 0);
    assert.equal(d9.weeklyPoints, 20);
    assert.ok(Math.abs(d9.costPerPoint - cost9 / 20) < 1e-9);
    assert.equal(d9.prs, 0);
    assert.equal(d9.tokensPerPr, null);

    // 10 Oct: B (opus) 150k, C (2 turns, no session) 65k; the repeated id b2 counts once.
    const d10 = day('2026-10-10');
    assert.equal(d10.sessions, 1);
    assert.equal(d10.startup, 40_000);
    assert.ok(Math.abs(d10.share - (40_000 * 3) / 150_000) < 1e-9);
    assert.equal(d10.tokens, 150_000 + 65_000);
    const opus10 =
      costOf('claude-opus-5-1', 40_000) +
      costOf('claude-opus-5-1', 50_000) +
      costOf('claude-opus-5-1', 60_000);
    assert.ok(Math.abs(d10.opusCost - opus10) < 1e-9);
    assert.ok(
      Math.abs(
        d10.cost -
          (opus10 + costOf('claude-sonnet-5-5', 30_000) + costOf('claude-sonnet-5-5', 35_000))
      ) < 1e-9
    );
    assert.equal(d10.prs, 2);
    assert.ok(Math.abs(d10.tokensPerPr - 215_000 / 2 / 1e6) < 1e-12);
    assert.equal(d10.weeklyPoints, 7);

    const d8 = day('2026-10-08');
    assert.equal(d8.sessions, 0);
    assert.equal(d8.startup, null);
    assert.equal(d8.prs, 1);
    assert.equal(d8.weeklyPoints, 13);

    const t = r.total;
    assert.equal(t.sessions, 2);
    assert.equal(t.startup, 45_000); // median of 50k and 40k
    assert.ok(Math.abs(t.share - (200_000 + 120_000) / (260_000 + 150_000)) < 1e-9);
    assert.equal(t.tokens, 1_300_000 + 215_000);
    assert.equal(t.prs, 3);
    assert.ok(Math.abs(t.tokensPerPr - 1_515_000 / 3 / 1e6) < 1e-12);
    assert.equal(t.weeklyPoints, 40);
    assert.equal(t.coveredDays, 3); // the log starts on 8 Oct: 4 to 7 Oct are unknown
    assert.equal(day('2026-10-07').weeklyPoints, null);
    assert.ok(Math.abs(t.costPerPoint - (d8.cost + d9.cost + d10.cost) / 40) < 1e-9);
    assert.ok(Math.abs(t.cost - (d9.cost + d10.cost)) < 1e-9);
  } finally {
    f.cleanup();
  }
});

test('buildReport: without PRs or the Usage log those columns are unknown, not zero', async () => {
  const f = fixture();
  try {
    const r = await buildReport({ root: f.projects, now: NOW, days: 7 });
    assert.equal(r.total.prs, null);
    assert.equal(r.total.tokensPerPr, null);
    assert.equal(r.total.weeklyPoints, null);
    assert.equal(r.days[0].prs, null);
    assert.deepEqual(
      r.targets.filter(t => t.ok === null).map(t => t.name),
      ['M tokens per PR', 'weekly % a day']
    );
    const text = formatReport(r);
    assert.match(text, /n\/a/);
  } finally {
    f.cleanup();
  }
});

test('the window limits days and files: --days 1 reads only today', async () => {
  const f = fixture();
  try {
    const r = await buildReport({ root: f.projects, now: NOW, days: 1, prs, usageLog: LOG });
    assert.equal(r.days.length, 1);
    assert.equal(r.total.sessions, 1);
    assert.equal(r.total.tokens, 215_000);
    assert.equal(r.total.prs, 2);
    assert.equal(r.total.weeklyPoints, 7);
  } finally {
    f.cleanup();
  }
});

test('targets line: every figure marked ok or over', async () => {
  const f = fixture();
  try {
    const r = await buildReport({ root: f.projects, now: NOW, days: 7, prs, usageLog: LOG });
    const line = formatTargets(r.targets);
    assert.match(line, /^Targets \(D-122\): /);
    assert.match(line, /startup 45k ok \(<=45k\)/); // exactly on the target
    assert.match(line, /share 78% over \(<20%\)/);
    assert.match(line, /M\/PR 0\.5 ok \(<=18\)/);
    assert.match(line, /sessions\/day 0\.3 ok \(~15\)/);
    assert.match(line, /weekly %\/day 13.3 ok \(~14\)/);
    const over = formatTargets([
      { name: 'startup', value: 52_000, ok: false },
      { name: 'startup share', value: 0.31, ok: false },
      { name: 'M tokens per PR', value: 22, ok: false },
      { name: 'sessions a day', value: 20, ok: false },
      { name: 'weekly % a day', value: 18, ok: false },
    ]);
    assert.equal((over.match(/over/g) || []).length, 5);
  } finally {
    f.cleanup();
  }
});

test('formatReport: a fixed-width row per day, a window total row and the targets line', async () => {
  const f = fixture();
  try {
    const r = await buildReport({ root: f.projects, now: NOW, days: 7, prs, usageLog: LOG });
    const lines = formatReport(r).split('\n');
    assert.match(lines[0], /^Usage 2026-10-04 to 2026-10-10 \(7 days/);
    assert.match(lines[1], /^Day +Sess +Startup/);
    assert.equal(lines.slice(2, 9).length, 7);
    assert.ok(lines[2].startsWith('2026-10-04'));
    assert.ok(lines[9].startsWith('-----'));
    assert.ok(lines[10].startsWith('Window'));
    assert.ok(lines[11].startsWith('Targets (D-122)'));
    const widths = new Set([lines[1], ...lines.slice(2, 9), lines[10]].map(l => l.length));
    assert.equal(widths.size, 1);
    assert.match(lines[10], /50%|\b45k\b/);
  } finally {
    f.cleanup();
  }
});

test('main --json prints the raw numbers; the text form ends with the run time', async () => {
  const f = fixture();
  try {
    const env = {
      USAGE_WEEK_ROOT: f.projects,
      USAGE_WEEK_VAULT: f.vault,
      USAGE_WEEK_NOW: NOW.toISOString(),
      USAGE_WEEK_GH: 'off',
    };
    let buf = '';
    const out = { write: s => (buf += s) };
    await main(['--json'], env, out);
    const j = JSON.parse(buf);
    assert.equal(j.days.length, 7);
    assert.equal(j.total.sessions, 2);
    assert.equal(j.total.weeklyPoints, 40);
    assert.equal(j.total.prs, null);
    assert.equal(j.targets.length, 5);
    assert.ok(j.notes.some(n => /merged PRs skipped/.test(n)));
    assert.equal(typeof j.runMs, 'number');
    assert.equal(dayKey(NOW), '2026-10-10');

    buf = '';
    await main(['--days', '3'], env, out);
    assert.match(buf, /\(3 days/);
    assert.match(buf, /Note: merged PRs skipped/);
    assert.match(buf, /\(\d+ files, \d+ responses, [\d.]+ s\)\n$/);

    buf = '';
    await main(['--json'], { ...env, USAGE_WEEK_VAULT: path.join(f.root, 'no-vault') }, out);
    const noVault = JSON.parse(buf);
    assert.equal(noVault.total.weeklyPoints, null);
    assert.ok(noVault.notes.some(n => /weekly limit use unavailable/.test(n)));
  } finally {
    f.cleanup();
  }
});

test('a forked file that repeats the parent message ids keeps its own first turn for the startup', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'usage-week-fork-'));
  try {
    const dir = path.join(root, PROJECT_DIR);
    mkdirSync(dir, { recursive: true });
    const model = 'claude-sonnet-5-5';
    const parent = [
      resp('p1', at(9, 9), model, 40_000),
      resp('p2', at(9, 10), model, 50_000),
      resp('p3', at(9, 11), model, 60_000),
    ];
    const fork = [
      ...parent, // copied turns: same ids, same timestamps
      resp('f1', at(10, 9), model, 70_000),
      resp('f2', at(10, 10), model, 80_000),
    ];
    writeFileSync(path.join(dir, 'a-fork.jsonl'), `${fork.join('\n')}\n`); // read first
    writeFileSync(path.join(dir, 'p-parent.jsonl'), `${parent.join('\n')}\n`);
    const r = await buildReport({ root, now: NOW, days: 7 });
    assert.equal(r.total.sessions, 2);
    assert.equal(r.total.startup, 40_000); // not 70k, the first turn the global dedupe leaves
    assert.ok(Math.abs(r.total.share - (40_000 * 3 + 40_000 * 5) / (150_000 + 300_000)) < 1e-9);
    assert.equal(r.total.tokens, 150_000 + 150_000); // tokens still count each response once
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
