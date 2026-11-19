/**
 * Slice 4 plumbing: t.browser, t.attachFile, file attachments in the report and the page of a console
 * error. No Edge is launched; pages and contexts are fakes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createKitBrowser, redact } from '../lib/dashboard-browser.mjs';
import { runScenarios, runScenariosDetailed } from '../lib/runner.mjs';
import { groupConsoleErrors } from '../lib/console-errors.mjs';
import { makeReport, renderHtml, renderMarkdown } from '../lib/report.mjs';

function scenario(over = {}) {
  return {
    id: 'Demo Shots',
    title: 'Demo',
    sizes: ['smoke'],
    tags: ['dashboard'],
    needs: [],
    tools: [],
    run: async () => {},
    ...over,
  };
}

const stubDashboard = () => ({
  tool: async () => ({}),
  planApply: async () => ({}),
  undo: async () => ({}),
  http: async () => ({ status: 200, data: {} }),
});

/** A page that records what was done to it and can emit console events. */
function fakePage(log, name) {
  const handlers = {};
  return {
    name,
    closed: false,
    on(ev, fn) {
      handlers[ev] = fn;
    },
    emit(ev, arg) {
      return handlers[ev]?.(arg);
    },
    async setViewportSize(v) {
      log.push(['viewport', name, v]);
    },
    async goto(url, o) {
      log.push(['goto', name, url, o]);
    },
    async close() {
      this.closed = true;
      log.push(['close', name]);
      if (this.failClose) throw new Error('close failed');
    },
  };
}

function fakeContext(log, label) {
  const pages = [];
  return {
    pages,
    async newPage() {
      const p = fakePage(log, `${label}${pages.length + 1}`);
      pages.push(p);
      return p;
    },
  };
}

const consoleMsg = (text, url = 'http://x/a.js', lineNumber = 3) => ({
  type: () => 'error',
  text: () => text,
  location: () => ({ url, lineNumber }),
});

// --- createKitBrowser ---------------------------------------------------------

test('open makes a page in the GM context, sets the viewport and goes to the dashboard path', async () => {
  const log = [];
  const context = fakeContext(log, 'gm');
  const sink = [];
  const { browser } = createKitBrowser({
    dashboardUrl: 'http://localhost:3100/',
    context,
    scenarioId: 's1',
    sink,
  });
  assert.equal(browser.dashboardUrl, 'http://localhost:3100');
  const page = await browser.open('/player', { viewport: { width: 390, height: 800 } });
  assert.equal(page, context.pages[0]);
  assert.deepEqual(log, [
    ['viewport', 'gm1', { width: 390, height: 800 }],
    ['goto', 'gm1', 'http://localhost:3100/player', { waitUntil: 'load' }],
  ]);
  await browser.open();
  assert.equal(log.at(-1)[2], 'http://localhost:3100/');
});

test('console and page errors are recorded per page, with the page kind, and go into the sink', async () => {
  const log = [];
  const context = fakeContext(log, 'gm');
  const sink = [];
  const { browser } = createKitBrowser({
    dashboardUrl: 'http://d',
    context,
    scenarioId: 's1',
    sink,
  });
  const dash = await browser.open('/');
  const player = await browser.open('/player/x');
  dash.emit('console', consoleMsg('boom'));
  dash.emit('console', { type: () => 'log', text: () => 'fine', location: () => ({}) });
  player.emit('pageerror', new Error('bad'));
  const all = browser.consoleErrors();
  assert.equal(all.length, 2);
  assert.deepEqual(
    browser.consoleErrors(dash).map(e => [e.message, e.source, e.page]),
    [['boom', 'http://x/a.js:3', 'dashboard']]
  );
  assert.equal(browser.consoleErrors(player)[0].page, 'player');
  assert.equal(browser.consoleErrors(player)[0].source, 'pageerror');
  assert.deepEqual(
    sink.map(e => [e.scenario, e.page]),
    [
      ['s1', 'dashboard'],
      ['s1', 'player'],
    ]
  );
  // A page the scenario expects to fail keeps its errors in its own list, out of the sink.
  const noToken = await browser.open('/', { expectErrors: true });
  noToken.emit('console', consoleMsg('401'));
  assert.deepEqual(
    browser.consoleErrors(noToken).map(e => e.message),
    ['401']
  );
  assert.equal(sink.length, 2);
  // copies: changing a returned entry changes nothing
  browser.consoleErrors(dash)[0].message = 'changed';
  assert.equal(browser.consoleErrors(dash)[0].message, 'boom');
});

const response = (status, url, { method = 'POST', postData = null, body = '' } = {}) => ({
  status: () => status,
  url: () => url,
  text: async () => body,
  request: () => ({ method: () => method, postData: () => postData }),
});

test('a failed /api/ request is recorded once, with its tool and error, never its arguments', async () => {
  const sink = [];
  const { browser } = createKitBrowser({
    dashboardUrl: 'http://d',
    context: fakeContext([], 'gm'),
    scenarioId: 's1',
    sink,
  });
  const dash = await browser.open('/');
  const api = 'http://d/api/tool';
  // the browser's own line for it is left out: the response listener says more
  dash.emit('console', consoleMsg('Failed to load resource: the server responded with a status of 422', api));
  await dash.emit(
    'response',
    response(422, api, {
      postData: JSON.stringify({ name: 'undo-change', args: { changeId: 'secret-arg' } }),
      body: JSON.stringify({ ok: false, error: 'No change with id x' }),
    })
  );
  await dash.emit('response', response(200, api));
  await dash.emit('response', response(404, 'http://d/missing.png', { method: 'GET' }));
  dash.emit('console', consoleMsg('Failed to load resource: 404', 'http://d/missing.png'));
  await dash.emit('response', response(401, 'http://d/api/state', { method: 'GET', body: 'nope' }));
  assert.deepEqual(
    browser.consoleErrors(dash).map(e => [e.message, e.source]),
    [
      ['HTTP 422 POST /api/tool undo-change: No change with id x', 'response'],
      ['Failed to load resource: 404', 'http://d/missing.png:3'],
      ['HTTP 401 GET /api/state: nope', 'response'],
    ]
  );
  assert.ok(!JSON.stringify(sink).includes('secret-arg'));
});

test('fresh opens one separate Edge per scenario; close closes pages and it, never the GM context', async () => {
  const log = [];
  const context = fakeContext(log, 'gm');
  const fresh = fakeContext(log, 'fresh');
  let launches = 0;
  let freshClosed = 0;
  const { browser, close } = createKitBrowser({
    dashboardUrl: 'http://d',
    context,
    scenarioId: 's1',
    sink: [],
    launchFresh: async () => {
      launches += 1;
      return { context: fresh, page: null, close: async () => void (freshClosed += 1) };
    },
  });
  await browser.open('/');
  assert.equal(launches, 0);
  await browser.open('/', { fresh: true });
  await browser.open('/player', { fresh: true });
  assert.equal(launches, 1);
  assert.equal(fresh.pages.length, 2);
  assert.equal(context.pages.length, 1);
  context.pages[0].failClose = true; // a failing close is swallowed
  await close();
  assert.equal(freshClosed, 1);
  assert.ok(context.pages[0].closed);
  assert.ok(fresh.pages.every(p => p.closed));
  assert.equal(context.close, undefined, 'the GM context has no close call to make');
  await close(); // a second close does nothing
  assert.equal(freshClosed, 1);
});

// --- runner: t.browser and t.attachFile ---------------------------------------

async function run1(sc, opts = {}) {
  const [r] = await runScenarios([{ scenario: sc, file: 'demo.scenario.mjs' }], {
    dashboard: stubDashboard(),
    manifest: { world: 'w' },
    ...opts,
  });
  return r;
}

test('t.browser is null without a factory', async () => {
  let seen = 'unset';
  await run1(
    scenario({
      async run(t) {
        seen = t.browser;
      },
    })
  );
  assert.equal(seen, null);
});

test('the runner closes the browser after the scenario, also when it fails, and after the cleanups', async () => {
  for (const failing of [false, true]) {
    const order = [];
    let factoryArgs = null;
    const r = await run1(
      scenario({
        async run(t) {
          assert.equal(t.browser.dashboardUrl, 'http://d');
          t.cleanup(async () => void order.push('cleanup'));
          await t.step('s', async () => {
            if (failing) throw new Error('nope');
          });
        },
      }),
      {
        browserFactory: (id, sink) => {
          factoryArgs = [id, sink];
          return {
            browser: { dashboardUrl: 'http://d', open: async () => null, consoleErrors: () => [] },
            close: async () => void order.push('close'),
          };
        },
      }
    );
    assert.equal(r.status, failing ? 'fail' : 'pass');
    assert.deepEqual(order, ['cleanup', 'close']);
    assert.equal(factoryArgs[0], 'Demo Shots');
  }
});

test('a close that throws does not break the run', async () => {
  const r = await run1(scenario(), {
    browserFactory: () => ({
      browser: { dashboardUrl: 'http://d', open: async () => null, consoleErrors: () => [] },
      close: async () => {
        throw new Error('close broke');
      },
    }),
  });
  assert.equal(r.status, 'pass');
});

test('dashboard errors reach the run result through the sink', async () => {
  const { consoleErrors } = await runScenariosDetailed(
    [{ scenario: scenario(), file: 'demo.scenario.mjs' }],
    {
      dashboard: stubDashboard(),
      manifest: null,
      browserFactory: (id, sink) => {
        sink.push({
          at: '2026-10-06T10:00:00.000Z',
          message: 'x',
          source: 'pageerror',
          page: 'dashboard',
          scenario: id,
        });
        return { browser: {}, close: async () => {} };
      },
    }
  );
  assert.equal(consoleErrors.length, 1);
  assert.equal(consoleErrors[0].page, 'dashboard');
});

test('t.attachFile writes the file, cleans the name and records the attachment', async () => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), 'kit-att-')), 'files');
  let written = null;
  const r = await run1(
    scenario({
      async run(t) {
        written = t.attachFile('Home Page (390).PNG', Buffer.from([1, 2, 3]));
        t.attachFile('notes.txt', 'hello', { type: 'text/plain' });
      },
    }),
    { filesDir: dir }
  );
  const expected = path.join(dir, 'demo-shots', 'home-page--390-.png');
  assert.equal(written, expected);
  assert.deepEqual([...readFileSync(expected)], [1, 2, 3]);
  assert.equal(readFileSync(path.join(dir, 'demo-shots', 'notes.txt'), 'utf8'), 'hello');
  assert.deepEqual(r.attachments, [
    {
      name: 'home-page--390-.png',
      file: 'files/demo-shots/home-page--390-.png',
      type: 'image/png',
    },
    { name: 'notes.txt', file: 'files/demo-shots/notes.txt', type: 'text/plain' },
  ]);
  assert.ok(!r.attachments[0].file.includes('\\'));
});

test('t.attachFile returns null and writes nothing without a filesDir or after a timeout', async () => {
  let none = 'unset';
  const r = await run1(
    scenario({
      async run(t) {
        none = t.attachFile('a.png', Buffer.from([1]));
      },
    })
  );
  assert.equal(none, null);
  assert.deepEqual(r.attachments, []);

  const dir = path.join(mkdtempSync(path.join(tmpdir(), 'kit-att-')), 'files');
  let late;
  const slow = await run1(
    scenario({
      timeoutMs: 20,
      async run(t) {
        await new Promise(res =>
          setTimeout(() => {
            late = t.attachFile('late.png', Buffer.from([1]));
            res();
          }, 80)
        );
      },
    }),
    { filesDir: dir }
  );
  assert.equal(slow.status, 'error');
  await new Promise(res => setTimeout(res, 120));
  assert.equal(late, null);
  assert.equal(existsSync(path.join(dir, 'demo-shots', 'late.png')), false);
});

// --- report -------------------------------------------------------------------

const target = { name: 'local', dashboard: 'http://d', foundry: 'http://f', world: 'w' };

function reportWithFile() {
  return makeReport({
    size: 'smoke',
    target,
    startedAt: new Date(),
    results: [
      {
        id: 'shots',
        title: 'Shots',
        file: 's.mjs',
        licensed: false,
        tags: [],
        status: 'pass',
        durationMs: 10,
        steps: [],
        logs: [],
        attachments: [
          { name: 'home.png', file: 'files/shots/home.png', type: 'image/png' },
          { name: 'a<b>.txt', file: 'files/shots/a b.txt', type: 'text/plain' },
          { name: 'json', data: { a: 1 } },
        ],
      },
    ],
    consoleErrors: [],
  });
}

test('report.md links file attachments', () => {
  const md = renderMarkdown(reportWithFile());
  assert.match(md, /## Attachments/);
  assert.match(md, /\[home\.png\]\(files\/shots\/home\.png\)/);
  assert.match(md, /\(files\/shots\/a%20b\.txt\)/);
});

test('report.html shows image attachments as lazy images and other files as links, escaped', () => {
  const html = renderHtml(reportWithFile());
  assert.match(
    html,
    /<img src="files\/shots\/home\.png" alt="home\.png" loading="lazy" style="max-width:100%">/
  );
  assert.match(html, /<a href="files\/shots\/a%20b\.txt">a&lt;b&gt;\.txt<\/a>/);
  assert.ok(!html.includes('a<b>'));
  assert.match(html, /<pre>\{\s+&quot;a&quot;: 1\s+\}<\/pre>/); // a JSON attachment is unchanged
});

test('console errors with a page show the page in the report', () => {
  const report = makeReport({
    size: 'smoke',
    target,
    startedAt: new Date(),
    results: [],
    consoleErrors: [
      {
        at: '2026-10-06T10:00:00.000Z',
        message: 'Oops',
        source: 'pageerror',
        page: 'player',
        scenario: 'a',
      },
    ],
  });
  assert.match(renderMarkdown(report), /player: pageerror/);
  assert.match(renderHtml(report), /player: pageerror/);
});

// --- grouping -----------------------------------------------------------------

test('a dashboard error is not merged with a Foundry error of the same text', () => {
  const same = {
    at: '2026-10-06T10:00:00.000Z',
    message: 'Failed to load x',
    source: 'http://h/a.js:1:2',
  };
  const groups = groupConsoleErrors(
    [
      { ...same, scenario: 'a' },
      { ...same, scenario: 'b', page: 'dashboard' },
      { ...same, scenario: 'c', page: 'player' },
      { ...same, scenario: 'd', page: 'dashboard' },
    ],
    { known: [] }
  );
  assert.equal(groups.length, 3);
  const foundry = groups.find(g => !g.page);
  assert.equal(foundry.count, 1);
  assert.equal(groups.find(g => g.page === 'dashboard').count, 2);
  assert.deepEqual(groups.find(g => g.page === 'dashboard').scenarios, ['b', 'd']);
  assert.notEqual(foundry.id, groups.find(g => g.page === 'dashboard').id);
});

test('a Foundry error keeps its id and group shape without a page', () => {
  const [g] = groupConsoleErrors(
    [{ at: '2026-10-06T10:00:00.000Z', message: 'Failed to load x', source: 'http://h/a.js:1:2' }],
    { known: [] }
  );
  assert.ok(!('page' in g));
  assert.ok(g.id.startsWith('console:'));
  assert.ok(!g.id.startsWith('console:dashboard'));
});

test('redact takes dashboard tokens out of console lines', () => {
  assert.equal(
    redact('GET http://localhost:3100/api/state?token=abc123&x=1 401'),
    'GET http://localhost:3100/api/state?token=<token>&x=1 401'
  );
  assert.equal(redact('/player?cogm_token=zz9'), '/player?cogm_token=<token>');
  assert.equal(redact('no token here'), 'no token here');
});
