import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASE, buildSidebar, insideCodeSpan, navOrder, pageUrl, rewriteLinks, toSite } from './stage.mjs';

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

test('a link shown in inline code is an example and stays as written', () => {
  const text = 'Write `[x](nowhere.md)` like this, see [dash](dashboard.md).';
  assert.equal(rewriteLinks(text, 'docs/gm/before-session.md', new Set()), text);
  assert.equal(
    toSite(text, 'gm/before-session.md'),
    'Write `[x](nowhere.md)` like this, see [dash](/Foundry-VTT-MCP-Ai-Tool/gm/dashboard/).'
  );
});

test('a time in a heading becomes a chip and the heading text stays', () => {
  const out = toSite('## 1. The screen (15 minutes)\n## Add it (once, about 5 minutes)', 'gm/x.md');
  assert.equal(
    out,
    '## 1. The screen <span class="chip">(15 minutes)</span>\n## Add it (once, about 5 minutes)'
  );
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

test('a link to a missing guide page or image fails the stage instead of becoming a GitHub link', () => {
  assert.throws(
    () => rewriteLinks('[x](before-sesion.md)', 'docs/gm/README.md', new Set()),
    /before-sesion\.md.*does not exist/
  );
  assert.throws(() => rewriteLinks('![x](../images/nope.png)', 'docs/gm/README.md', new Set()), /does not exist/);
});

test('page URLs keep the old /gm/ and /gm/page/ shapes under the base', () => {
  assert.equal(pageUrl('index.md'), `${BASE}/`);
  assert.equal(pageUrl('gm/README.md'), `${BASE}/gm/`);
  assert.equal(pageUrl('gm/first-hour.md'), `${BASE}/gm/first-hour/`);
});

test('toSite makes site URLs, keeps anchors, shows clips as video and drops the first H1', () => {
  const text = [
    '---',
    'title: T',
    '---',
    '',
    '# T',
    '',
    'See [the dashboard](dashboard.md#combat) and [join](../player/join.md).',
    '![Shot](../images/guides/a.png "t")',
    '![The clip](../images/foundry/a.mp4)',
    '[zip](downloads/foundry-gm-coach.zip) [web](https://x.test/a.md) [here](#x)',
    '```',
    '# not a heading, [x](a.md)',
    '```',
  ].join('\n');
  const out = toSite(text, 'gm/first-hour.md');
  assert.equal(
    out,
    [
      '---',
      'title: T',
      '---',
      '',
      '<a id="t"></a>',
      '',
      `See [the dashboard](${BASE}/gm/dashboard/#combat) and [join](${BASE}/player/join/).`,
      `![Shot](${BASE}/images/guides/a.png "t")`,
      `<video src="${BASE}/images/foundry/a.mp4" controls muted loop playsinline preload="metadata" aria-label="The clip"></video>`,
      `[zip](${BASE}/gm/downloads/foundry-gm-coach.zip) [web](https://x.test/a.md) [here](#x)`,
      '```',
      '# not a heading, [x](a.md)',
      '```',
    ].join('\n')
  );
});

test('the sidebar groups pages, puts a section README first and catches unknown pages last', () => {
  const slugs = ['index', 'gm', 'gm/first-hour', 'gm/dashboard', 'gm/new-page', 'player', 'player/join'];
  const sidebar = buildSidebar(slugs, { player: ['player', 'player/join'] });
  assert.deepEqual(
    sidebar.map(g => g.label),
    ['Home', 'Start here', 'The tool', 'For players', 'More guides']
  );
  assert.deepEqual(sidebar[1].items.map(i => i.slug), ['gm', 'gm/first-hour']);
  assert.deepEqual(sidebar[3].items.map(i => i.slug), ['player', 'player/join']);
  assert.deepEqual(sidebar[4].items.map(i => i.slug), ['gm/new-page']);
});

test('rewriteLinks: a double-backtick span holding a link or a single backtick stays as written', () => {
  const out = rewriteLinks(
    'Write ``[a](b.md) and `c` `` then [real](../../CHANGELOG.md).',
    'docs/gm/a.md',
    new Set()
  );
  assert.ok(out.includes('``[a](b.md) and `c` ``'));
  assert.ok(!out.includes('[real](../../CHANGELOG.md)'));
});

test('insideCodeSpan: delimiter runs, escapes and unclosed runs', () => {
  assert.equal(insideCodeSpan('a `x` b', 3), true);
  assert.equal(insideCodeSpan('a `x` b', 6), false);
  assert.equal(insideCodeSpan('`` `x` `` b', 4), true);
  assert.equal(insideCodeSpan('`` `x` `` b', 10), false);
  assert.equal(insideCodeSpan('a \\` b', 5), false);
  assert.equal(insideCodeSpan('a ` b', 4), false);
  // A backslash inside a span is no escape (a Windows path), so the link after it is outside.
  assert.equal(insideCodeSpan('a `C:\\x\\` [l](y.md)', 13), false);
  assert.equal(insideCodeSpan('a `C:\\x\\` [l](y.md)', 5), true);
});
