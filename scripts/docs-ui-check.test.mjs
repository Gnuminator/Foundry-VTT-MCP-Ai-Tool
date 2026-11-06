/**
 * scripts/docs-ui-check.mjs and scripts/docs-kit.mjs: the doc checks against throwaway trees.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { boldNames, check, inCorpus, normalize, sourceStrings } from './docs-ui-check.mjs';
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

test('replaceBlock swaps only the generated block', () => {
  const page = 'a\n<!-- kit-scenarios:start (x) -->\nold\n<!-- kit-scenarios:end -->\nb\n';
  const next = replaceBlock(
    page,
    '<!-- kit-scenarios:start (x) -->\nnew\n<!-- kit-scenarios:end -->'
  );
  assert.equal(next, 'a\n<!-- kit-scenarios:start (x) -->\nnew\n<!-- kit-scenarios:end -->\nb\n');
  assert.throws(() => replaceBlock('no markers', 'x'));
});
