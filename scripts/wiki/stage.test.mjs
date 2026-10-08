import assert from 'node:assert/strict';
import { test } from 'node:test';
import { navOrder, rewriteLinks } from './stage.mjs';

const GH = 'https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool';

test('links between staged pages stay relative, with their anchors', () => {
  const images = new Set();
  const out = rewriteLinks(
    'See [the dashboard](dashboard.md#combat-tracker) and [joining](../player/join.md).',
    'docs/gm/before-session.md',
    images
  );
  assert.equal(
    out,
    'See [the dashboard](dashboard.md#combat-tracker) and [joining](../player/join.md).'
  );
});

test('the home page links into the sections from the site root', () => {
  const out = rewriteLinks('[GM guides](../gm/README.md)', 'docs/wiki/index.md', new Set());
  assert.equal(out, '[GM guides](gm/README.md)');
});

test('links to the rest of the repo become GitHub links', () => {
  const out = rewriteLinks(
    '[install](../../README.md#installation) and [Pi](../dev/PI-SETUP.md) and [scripts](../../scripts)',
    'docs/gm/getting-started.md',
    new Set()
  );
  assert.equal(
    out,
    `[install](${GH}/blob/main/README.md#installation) and [Pi](${GH}/blob/main/docs/dev/PI-SETUP.md) and [scripts](${GH}/tree/main/scripts)`
  );
});

test('images from docs/images are collected and point into the staged images folder', () => {
  const images = new Set();
  const out = rewriteLinks(
    '![Logo](../images/brand/logo.svg "The logo")',
    'docs/gm/README.md',
    images
  );
  assert.equal(out, '![Logo](../images/brand/logo.svg "The logo")');
  assert.deepEqual([...images], ['docs/images/brand/logo.svg']);
});

test('web links, anchors and code fences are left alone', () => {
  const text = [
    '[Foundry](https://foundryvtt.com/article/users/) [here](#a-heading)',
    '```markdown',
    '[x](../../README.md)',
    '```',
  ].join('\n');
  assert.equal(rewriteLinks(text, 'docs/gm/README.md', new Set()), text);
});

test('the nav follows the README links, then the rest A to Z', () => {
  const readme =
    'Start with [b](b.md) then [a](a.md#x), [b again](b.md) and [web](https://x.test/c.md).';
  assert.deepEqual(navOrder(readme, ['a.md', 'README.md', 'b.md', 'd.md', 'c.md']), [
    'README.md',
    'b.md',
    'a.md',
    'c.md',
    'd.md',
  ]);
});
