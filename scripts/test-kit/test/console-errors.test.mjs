import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  consoleCounts,
  consoleErrorId,
  consoleSummaryLines,
  groupConsoleErrors,
  loadKnownConsole,
  normalizeMessage,
  normalizeSource,
} from '../lib/console-errors.mjs';
import { makeReport, renderHtml, renderMarkdown } from '../lib/report.mjs';
import { keepChatNotificationsQuiet, quietChatNotifications } from '../lib/gm.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Raw console errors shaped like a full run's (messages only, no book text). */
const fixture = () =>
  JSON.parse(readFileSync(path.join(here, 'fixtures', 'console-errors.json'), 'utf8'));

/** The two console findings of upstream Actor Studio 2.10.5; the fork fixed them, so they are on the list on disk with fixedIn. */
const KNOWN = [
  {
    id: 'console:gas.captureAdvancement',
    kind: 'STUDIO',
    why: 'Actor Studio 2.10.5 throws a jQuery selector error on every advancement dialog',
  },
  {
    id: 'console:black-parchment.webp',
    kind: 'STUDIO',
    why: 'Actor Studio asks for an asset under a doubled path (404)',
  },
];

const target = {
  name: 'local',
  dashboard: 'http://127.0.0.1:3100',
  foundry: 'http://127.0.0.1:30001',
  world: 'ai-tool-kit-srd',
};

test('ids, hosts and line numbers are stripped; a page error keeps the function it came from', () => {
  assert.equal(
    normalizeMessage('Texture Ab3dEf7890123456 failed', 'http://x/y.js:3'),
    'Texture <id> failed'
  );
  // 16 letters of one case are a word, not an id
  assert.equal(normalizeMessage('abcdefghijklmnop failed', 'core'), 'abcdefghijklmnop failed');
  assert.equal(
    normalizeMessage(
      'TypeError: x\n    at #postNotification (http://127.0.0.1:30001/scripts/foundry.mjs:9:2)',
      'pageerror'
    ),
    'TypeError: x (in #postNotification)'
  );
  assert.equal(
    normalizeSource('http://127.0.0.1:30001/modules/a/dist/b.js:35'),
    '/modules/a/dist/b.js'
  );
  assert.equal(normalizeSource('pageerror'), 'pageerror');
  assert.equal(normalizeSource(''), 'console');
});

test('finding ids: a hook, a file, or the function of a page error', () => {
  const [a, b, c, d] = fixture().filter((e, i) => [0, 4, 7, 11].includes(i));
  assert.equal(consoleErrorId(a), 'console:pageerror:postnotification');
  assert.equal(consoleErrorId(b), 'console:gas.captureAdvancement');
  assert.equal(consoleErrorId(c), 'console:black-parchment.webp');
  assert.equal(consoleErrorId(d), 'console:pageerror:error-boom');
});

test('the known console list is version-aware: both findings on upstream 2.10.5, none on the fork', () => {
  assert.deepEqual(
    loadKnownConsole(undefined, '2.10.5').map(e => e.id),
    KNOWN.map(e => e.id)
  );
  assert.deepEqual(loadKnownConsole(undefined, '2.10.5-aitool.1'), []);
  // an unknown version gets the upstream list
  assert.equal(loadKnownConsole(undefined, '9.9.9').length, 2);
});

test('groups count, time and scenarios; the new ones come first', () => {
  const groups = groupConsoleErrors(fixture(), { known: KNOWN });
  assert.equal(groups.length, 5);
  assert.deepEqual(
    groups.map(g => [g.id, g.count, g.known]),
    [
      // new first, by count
      ['console:pageerror:postnotification', 4, false],
      ['console:foundry.mjs', 2, false],
      ['console:pageerror:error-boom', 1, false],
      ['console:gas.captureAdvancement', 3, true],
      ['console:black-parchment.webp', 2, true],
    ]
  );
  const a = groups[0];
  assert.equal(a.first, '2026-10-06T01:06:31.000Z');
  assert.equal(a.last, '2026-10-06T01:07:11.000Z');
  assert.deepEqual(a.scenarios, ['heroes-features-use', 'heroes-features-deep']);
  assert.equal(groups[1].message, 'Texture <id> failed to load');
  const b = groups.find(g => g.id === 'console:gas.captureAdvancement');
  assert.equal(b?.kind, 'STUDIO');
  assert.match(b?.why ?? '', /jQuery selector/);
  assert.deepEqual(consoleCounts(groups), {
    errors: 12,
    groups: 5,
    knownErrors: 5,
    knownGroups: 2,
    newErrors: 7,
    newGroups: 3,
  });
});

test('an injected list decides what is known; nothing known makes everything new', () => {
  const groups = groupConsoleErrors(fixture(), {
    known: [{ id: 'console:pageerror:postnotification', kind: 'SYSTEM', why: 'race' }],
  });
  assert.equal(groups.filter(g => g.known).length, 1);
  assert.equal(groups.at(-1)?.id, 'console:pageerror:postnotification');
  assert.equal(groupConsoleErrors([], { known: [] }).length, 0);
});

test('the summary lines name every new group and say none when quiet', () => {
  const lines = consoleSummaryLines(groupConsoleErrors(fixture(), { known: KNOWN }));
  assert.match(lines[0], /12 in 5 groups \(5 known in 2, 7 NEW in 3\)/);
  assert.equal(lines.length, 4);
  assert.match(lines[1], /NEW x4 \[heroes-features-use, heroes-features-deep\] TypeError/);
  assert.deepEqual(consoleSummaryLines([]), ['console errors: none']);
});

test('the report keeps the raw list, adds the groups and warns about new ones', () => {
  const report = makeReport({
    size: 'full',
    target,
    startedAt: new Date('2026-10-06T01:00:00Z'),
    results: [],
    consoleErrors: fixture(),
    knownConsole: KNOWN,
  });
  assert.equal(report.consoleErrors.length, 12);
  assert.equal(report.consoleGroups?.length, 5);
  const md = renderMarkdown(report);
  assert.match(md, /\*\*WARNING: 3 new console error groups\*\*/);
  assert.match(md, /12 errors in 5 groups: 5 known \(2 groups\), \*\*7 new \(3 groups\)\*\*/);
  assert.match(md, /\| 4 \| NEW \| console:pageerror:postnotification \|/);
  assert.match(md, /\| 3 \| known \(STUDIO\) \| console:gas.captureAdvancement \|/);
  assert.ok(md.split('\n').length < 60, 'a handful of lines, not one per error');
  const html = renderHtml(report);
  assert.match(html, /WARNING: 3 new console error groups/);
  assert.match(html, /<tr class="fresh"><td>4<\/td>/);
  assert.match(html, /<tr class="known"><td>3<\/td>/);
});

test('a report with only known console errors has no warning', () => {
  const known = fixture().filter(e => e.scenario === 'heroes-studio');
  const report = makeReport({
    size: 'full',
    target,
    startedAt: new Date(),
    results: [],
    consoleErrors: known,
    knownConsole: KNOWN,
  });
  assert.ok(!renderMarkdown(report).includes('WARNING'));
  assert.ok(!renderHtml(report).includes('WARNING'));
  // an old report without groups is grouped again against the list on disk (empty since the fork)
  const old = { ...report, consoleGroups: undefined };
  assert.match(renderMarkdown(old), /5 errors in 2 groups/);
});

test('quietChatNotifications turns the pop-ups off, or says the chat log is missing', async () => {
  const run = async ui => {
    const saved = globalThis.ui;
    globalThis.ui = ui;
    try {
      return await quietChatNotifications({ evaluate: async fn => fn() });
    } finally {
      globalThis.ui = saved;
    }
  };
  let toggled = 0;
  const chat = { _shouldShowNotifications: () => true, _toggleNotifications: () => (toggled += 1) };
  assert.equal(await run({ chat }), true);
  assert.equal(chat._shouldShowNotifications(), false);
  assert.equal(toggled, 1);
  assert.equal(await run({}), false);
  assert.equal(await run(undefined), false);
});

test('keepChatNotificationsQuiet registers a script for every new page document', async () => {
  let script;
  await keepChatNotificationsQuiet({ addInitScript: async fn => (script = fn) });
  assert.equal(typeof script, 'function');
  // Run it the way a new document would: the chat log shows up after the script started.
  const saved = { ui: globalThis.ui, setInterval: globalThis.setInterval };
  const clearSaved = globalThis.clearInterval;
  let tick;
  let cleared = false;
  globalThis.setInterval = fn => ((tick = fn), 1);
  globalThis.clearInterval = () => (cleared = true);
  try {
    globalThis.ui = undefined;
    script();
    tick();
    assert.equal(cleared, false, 'waits while there is no chat log');
    const chat = { _shouldShowNotifications: () => true };
    globalThis.ui = { chat };
    tick();
    assert.equal(cleared, true);
    assert.equal(chat._shouldShowNotifications(), false);
  } finally {
    globalThis.ui = saved.ui;
    globalThis.setInterval = saved.setInterval;
    globalThis.clearInterval = clearSaved;
  }
});
