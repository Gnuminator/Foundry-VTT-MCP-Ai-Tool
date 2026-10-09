import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  makeReport,
  newRunDir,
  renderHtml,
  renderMarkdown,
  summarize,
  writeReport,
} from '../lib/report.mjs';

const target = {
  name: 'local',
  dashboard: 'http://127.0.0.1:3100',
  foundry: 'http://127.0.0.1:30001',
  world: 'ai-tool-kit-srd',
};

function results() {
  return [
    {
      id: 'ok-one',
      title: 'Fine',
      file: 'a.scenario.mjs',
      licensed: false,
      tags: ['bridge'],
      status: 'pass',
      durationMs: 120,
      steps: [{ label: 'step a', status: 'pass', durationMs: 100 }],
      logs: [],
      attachments: [],
    },
    {
      id: 'bad-one',
      title: 'Broken <b>title</b> \\| pipe',
      file: 'b.scenario.mjs',
      licensed: false,
      tags: ['module', 'player'],
      status: 'fail',
      durationMs: 2500,
      steps: [
        {
          label: 'step <script>alert(1)</script>',
          status: 'fail',
          durationMs: 50,
          error: {
            message: 'bad <script>x</script> thing',
            kind: 'validation',
            reply: { ok: false, error: '<img src=x onerror=1>' },
          },
        },
      ],
      logs: ['a log <line>'],
      attachments: [{ name: 'att', data: { k: '<v>' } }],
    },
    {
      id: 'skip-one',
      title: 'Skipped',
      file: 'c.scenario.mjs',
      licensed: false,
      tags: ['vault'],
      status: 'skip',
      durationMs: 5,
      steps: [],
      logs: [],
      attachments: [],
    },
    {
      id: 'err-one',
      title: 'Threw',
      file: 'd.scenario.mjs',
      licensed: false,
      tags: ['bridge'],
      status: 'error',
      durationMs: 9,
      steps: [],
      logs: [],
      attachments: [],
    },
  ];
}

function report() {
  return makeReport({
    size: 'smoke',
    target,
    startedAt: new Date('2026-10-05T10:00:00Z'),
    finishedAt: new Date('2026-10-05T10:00:03Z'),
    gitSha: 'abc1234',
    results: results(),
    consoleErrors: [{ at: 't', message: 'oops <b>', source: 'core' }],
  });
}

test('summarize counts fail and error as failed', () => {
  assert.deepEqual(summarize(results()), { passed: 1, failed: 2, skipped: 1, total: 4 });
});

test('makeReport has the KitReport shape', () => {
  const r = report();
  assert.equal(r.version, 2);
  assert.equal(r.run.durationMs, 3000);
  assert.equal(r.run.gitSha, 'abc1234');
  assert.equal(r.run.node, process.version);
  assert.equal(r.build, null);
  assert.equal(r.scenarios.length, 4);
});

test('writeReport writes json, md and html', () => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), 'kit-report-')), 'sub');
  const files = writeReport(report(), dir);
  for (const f of Object.values(files)) assert.ok(existsSync(f), f);
  const parsed = JSON.parse(readFileSync(files.json, 'utf8'));
  assert.equal(parsed.summary.total, 4);
});

test('html escapes text and has no external resources', () => {
  const html = renderHtml(report());
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<b>title</b>'));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal((html.match(/<script>/g) || []).length, 1); // only our own filter script
  assert.ok(!/(src|href)="https?:/.test(html));
  assert.ok(html.includes('prefers-color-scheme:dark'));
  assert.ok(html.includes('<details>'));
  assert.ok(html.includes('data-status="fail"'));
  assert.ok(html.includes('id="f-tag"'));
});

test('markdown has the table, the failure details and the console errors', () => {
  const md = renderMarkdown(report());
  assert.match(md, /\*\*1 passed, 2 failed, 1 skipped\*\* of 4/);
  assert.match(md, /\| Scenario \| Tags \| Status \| Time \|/);
  assert.match(md, /\| ok-one: Fine \| bridge \| PASS \| 120 ms \|/);
  // The backslash before the pipe is escaped too, so it cannot cancel the pipe's escape.
  assert.match(md, /Broken <b>title<\/b> \\\\\\\| pipe/);
  assert.match(md, /### bad-one: .* \(FAIL\)/);
  assert.match(md, /FAIL step <script>/);
  assert.match(md, /"error": "<img src=x onerror=1>"/);
  assert.match(md, /Git: abc1234/);
  assert.match(md, /oops <b>/);
  assert.ok(!md.includes('### ok-one'));
});

test('newRunDir creates <kitHome>/reports/<stamp>-<size>', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'kit-home-'));
  const now = new Date(2026, 9, 5, 14, 7, 9);
  const dir = newRunDir(home, 'full', now);
  assert.equal(path.basename(dir), '20261005-140709-full');
  assert.ok(existsSync(dir));
  const again = newRunDir(home, 'full', now);
  assert.notEqual(again, dir);
  assert.ok(existsSync(again));
});

/** A report with a build manifest that has coverage and build console errors. */
function reportWithBuild() {
  const r = report();
  r.build = /** @type {any} */ ({
    version: 2,
    world: 'ai-tool-kit-srd',
    profile: 'srd',
    heroes: [{ name: 'a' }, { name: 'b', buildError: 'broke' }],
    coverage: {
      classes: { found: 12, built: 12 },
      subclasses: { found: 16, built: 15, failed: ['Some <Path>'] },
      heroes: 63,
    },
    consoleErrors: [{ at: 't1', message: 'canvas <oops>', source: 'foundry.mjs:1' }],
  });
  return r;
}

test('the report shows the profile, a Coverage section and the build console errors', () => {
  const md = renderMarkdown(reportWithBuild());
  assert.match(md, /- Profile: srd/);
  assert.match(md, /## Coverage/);
  assert.match(md, /- Classes: 12 built of 12 found/);
  assert.match(md, /- Subclasses: 15 built of 16 found/);
  assert.match(md, /- Subclasses that failed: Some <Path>/);
  assert.match(md, /- Heroes: 63 built, 1 failed/);
  assert.match(
    md,
    /## Build console errors\n\n1 errors in 1 groups: 0 known \(0 groups\), \*\*1 new/
  );
  assert.match(
    md,
    /\| 1 \| NEW \| console:foundry.mjs \| canvas <oops> \| foundry.mjs \| build \|/
  );
  const html = renderHtml(reportWithBuild());
  assert.match(html, /<span>Profile srd<\/span>/);
  assert.match(html, /<h2>Coverage<\/h2><table>/);
  assert.match(html, /<th>Classes<\/th><td>12 built of 12 found<\/td>/);
  assert.match(html, /<h2>Build console errors<\/h2><p>1 errors in 1 groups/);
  assert.match(html, /<td>canvas &lt;oops&gt;<\/td>/);
  assert.ok(!html.includes('canvas <oops>'));
});

test('a report without a build has no Coverage or Profile line', () => {
  const md = renderMarkdown(report());
  assert.ok(!md.includes('## Coverage'));
  assert.ok(!md.includes('- Profile:'));
  assert.ok(!renderHtml(report()).includes('<h2>Coverage</h2>'));
  const quiet = reportWithBuild();
  /** @type {any} */ (quiet.build).consoleErrors = [];
  assert.match(renderMarkdown(quiet), /## Build console errors\n\nNone reported\./);
});
