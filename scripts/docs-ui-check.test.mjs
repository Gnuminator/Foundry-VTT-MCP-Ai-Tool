/**
 * scripts/docs-ui-check.mjs and scripts/docs-kit.mjs: the doc checks against throwaway trees.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  boldNames,
  check,
  inCorpus,
  normalize,
  sourceStrings,
  stripSourceComments,
} from './docs-ui-check.mjs';
import { replaceBlock } from './docs-kit.mjs';

function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-ui-'));
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), text);
  }
  return root;
}

test('normalize drops emoji, arrows and case', () => {
  assert.equal(normalize('✈ Pre-flight'), 'pre-flight');
  assert.equal(normalize('Advanced ▾'), 'advanced');
});

test('boldNames finds names next to UI words and verbs, not labels or code', () => {
  const text = [
    'Click **Start session** now. The **Tarokka** drawer opens.',
    '**Tip:** use `**Fake** button` carefully.',
    '```',
    'click **In a fence**',
    '```',
  ].join('\n');
  assert.deepEqual(
    boldNames(text).map(b => b.name),
    ['Tarokka', 'Start session']
  );
});

test('boldNames reads the Danish twins too', () => {
  const names = boldNames(
    'Tryk på **Start session**, åbn fanen **Handouts** og knappen **Undo**.'
  ).map(b => b.name);
  assert.deepEqual(names.sort(), ['Handouts', 'Start session', 'Undo']);
});

test('boldNames joins hard-wrapped lines and reads tick and åbn', () => {
  const text =
    'First press\n**Reveal next** now.\n\n- tick\n  **Show cards**\n- Åbn **Handouts**\n\nThe **Open\nJournal** button.';
  // The line of the name itself, not of the block it sits in.
  assert.deepEqual(boldNames(text), [
    { name: 'Reveal next', line: 2 },
    { name: 'Show cards', line: 5 },
    { name: 'Handouts', line: 6 },
    { name: 'Open Journal', line: 8 },
  ]);
});

test('boldNames reads a bold name written as code, and skips bold inside code', () => {
  assert.deepEqual(boldNames('Press **`Undo`** or the `**Fake** button`.').map(b => b.name), ['Undo']);
});

test('sourceStrings skips comments and identifier-like words', () => {
  const s = sourceStrings(
    "/** the 'Reveal next' button */\n// a \"Hidden label\" note\nconst k = 'tarokka'; const l = 'Start session'; type T = 'drawer-open' | 'x';\n"
  );
  assert.deepEqual(s.filter(x => x.trim()).map(x => x.trim()), ['Start session']);
  assert.equal(stripSourceComments('a <!-- b --> c').includes('b'), false);
  assert.ok(stripSourceComments('const u = "http://x.y/z";').includes('http://x.y/z'));
});

test('a slash-star inside a string is no comment opener', () => {
  const s = sourceStrings(
    "const r = { '/api/help/*': 1 }; const a = 'image/*'; const g = '**/*.md'; const b = 'Start session'; /* gone: 'Hidden' */ const c = 'Shown';\n"
  );
  assert.ok(s.includes('Start session') && s.includes('Shown'));
  assert.ok(!s.some(x => x.includes('Hidden')));
});

test('check fails when a doc folder, the checklist or all names are missing', () => {
  const root = tree({
    'packages/cogm-dashboard/web/src/App.tsx': 'export const A = () => <button>Begin</button>;\n',
    'docs/gm/page.md': 'No bold controls here.\n',
  });
  const text = check(root).problems.join('\n');
  assert.match(text, /docs\/da\/gm: no pages found/);
  assert.match(text, /docs\/player: no pages found/);
  assert.match(text, /docs\/dev\/SMOKE-TEST\.md: checklist not found/);
  assert.match(text, /no bold control names found/);
  assert.match(check(tree({ 'docs/gm/p.md': 'Press **X** button\n' })).problems.join('\n'), /no dashboard strings found/);
});

test('sourceStrings reads literals, template text and tag text', () => {
  const s = sourceStrings(
    "const a = 'Start session'; const b = `Start combat with ${n}`; <button>End session</button>"
  );
  assert.ok(s.includes('Start session') && s.includes('End session'));
  assert.ok(s.some(x => x.trim() === 'Start combat with'));
});

test('inCorpus matches whole labels, a placeholder N, and not a long sentence', () => {
  const corpus = [
    'start combat with',
    'end session',
    'this sentence mentions the tarokka drawer and more words here',
  ];
  assert.ok(inCorpus('Start combat with N', corpus));
  assert.ok(inCorpus('End session', corpus));
  assert.ok(!inCorpus('Tarokka', corpus));
  assert.ok(!inCorpus('End', ['the end of days is here']));
});

test('check fails on a renamed button and passes with an exception', () => {
  const files = {
    'packages/cogm-dashboard/web/src/App.tsx':
      'export const A = () => <button>Begin session</button>;\n',
    'docs/gm/page.md': 'Press the **Start session** button.\n',
    // The other scanned folders and the checklist must exist, or the check says so.
    'docs/da/gm/page.md': 'x\n',
    'docs/player/page.md': 'x\n',
    'docs/da/player/page.md': 'x\n',
    'docs/dev/SMOKE-TEST.md': 'x\n',
  };
  const root = tree(files);
  const bad = check(root);
  assert.equal(bad.problems.length, 1);
  assert.match(bad.problems[0], /docs\/gm\/page\.md:1: "Start session"/);

  const ok = tree({
    ...files,
    'scripts/docs-ui-exceptions.json': JSON.stringify({
      names: [{ name: 'Start session', reason: 'Foundry button' }],
    }),
  });
  assert.deepEqual(check(ok).problems, []);

  const stale = tree({
    ...files,
    'docs/gm/page.md': 'Press the **Begin session** button.\n',
    'scripts/docs-ui-exceptions.json': JSON.stringify({
      names: [{ name: 'Begin session', reason: 'now in the source' }],
    }),
  });
  assert.match(check(stale).problems[0], /remove the exception/);
});

// ---- docs-kit --check against a tiny fake kit (--root) ----

const KIT_START = '<!-- kit-scenarios:start (generated by scripts/docs-kit.mjs; edit the scenario file, not this block) -->';
const KIT_END = '<!-- kit-scenarios:end -->';
const kitTree = page =>
  tree({
    'scripts/test-kit/lib/contract.mjs':
      "export const KIT_SIZES = ['smoke', 'full']; export const KIT_WORLDS = ['ai-tool-kit-a'];\n",
    'scripts/test-kit/lib/loader.mjs':
      "export async function loadScenarios() { return { problems: [], scenarios: [{ scenario: { id: 'one', sizes: ['smoke', 'full'], tags: ['t'], title: 'It works' } }] }; }\n",
    'docs/dev/TEST-KIT.md': page,
  });
const runKit = (root, ...args) =>
  spawnSync(process.execPath, [path.join(import.meta.dirname, 'docs-kit.mjs'), '--root', root, ...args], {
    encoding: 'utf8',
  });

test('docs-kit --check passes on a current table, fails on a stale one, and a rewrite fixes it', () => {
  const root = kitTree(`intro\n${KIT_START}\nold\n${KIT_END}\n`);
  const stale = runKit(root, '--check');
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /stale/);
  const written = runKit(root);
  assert.equal(written.status, 0, written.stderr);
  const page = fs.readFileSync(path.join(root, 'docs/dev/TEST-KIT.md'), 'utf8');
  assert.match(page, /1 scenarios ship in the repo \(1 in `smoke`, 1 in `full`\)/);
  assert.match(page, /`one`/);
  assert.equal(runKit(root, '--check').status, 0);
});

test('docs-kit fails when the page has no markers', () => {
  const root = kitTree('no markers here\n');
  const r = runKit(root, '--check');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no kit-scenarios markers/);
});

test('replaceBlock swaps only the generated block', () => {
  const page = 'a\n<!-- kit-scenarios:start (x) -->\nold\n<!-- kit-scenarios:end -->\nb\n';
  const next = replaceBlock(
    page,
    '<!-- kit-scenarios:start (x) -->\nnew\n<!-- kit-scenarios:end -->'
  );
  assert.equal(next, 'a\n<!-- kit-scenarios:start (x) -->\nnew\n<!-- kit-scenarios:end -->\nb\n');
  assert.throws(() => replaceBlock('no markers', 'x'));
});
