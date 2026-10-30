// The help builder (scripts/build-help.mjs), run as a child process on a fixture tree (one gm
// page, one foundry page) through BUILD_HELP_REPO and BUILD_HELP_OUT: cross-folder links, the
// broken-link check, callouts, code spans and the page-key collision check.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'build-help.mjs');
const roots = [];

/** Build a fixture repo from `{ 'gm/a.md': text, ... }` (relative to docs/) and run the builder. */
function build(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'build-help-'));
  roots.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(root, 'docs', rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text, 'utf8');
  }
  const out = path.join(root, 'help.json');
  const run = spawnSync(process.execPath, [script], {
    env: { ...process.env, BUILD_HELP_REPO: root, BUILD_HELP_OUT: out },
    encoding: 'utf8',
  });
  const pages = run.status === 0 ? JSON.parse(readFileSync(out, 'utf8')).pages : null;
  return { status: run.status, stderr: run.stderr, pages };
}

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe('build-help', () => {
  it('keys docs/foundry pages as foundry-<name> and links across folders', () => {
    const { status, pages } = build({
      'gm/x.md': '# X\n\nSee [the y page](../foundry/y.md#a).\n',
      'foundry/y.md': '# Y\n\n## A\n\nBack to [x](../gm/x.md).\n',
    });
    expect(status).toBe(0);
    expect(Object.keys(pages).sort()).toEqual(['foundry-y', 'x']);
    expect(pages.x.html).toContain('data-help="foundry-y#a"');
    expect(pages['foundry-y'].html).toContain('data-help="x#"');
  });

  it('fails on a link to a missing guide page or anchor', () => {
    const missingPage = build({ 'gm/x.md': '# X\n\n[no](../gm/nope.md)\n' });
    expect(missingPage.status).toBe(1);
    expect(missingPage.stderr).toContain('broken link ../gm/nope.md');
    const missingAnchor = build({ 'gm/x.md': '# X\n\n[no](#nowhere)\n' });
    expect(missingAnchor.status).toBe(1);
    expect(missingAnchor.stderr).toContain('missing anchor #nowhere');
  });

  it('renders a callout block as an aside', () => {
    const { pages } = build({ 'gm/x.md': '# X\n\n:::tip\nA **tip**.\n:::\n' });
    expect(pages.x.html).toContain('<aside class="callout callout-tip">');
    expect(pages.x.html).toContain('<strong>tip</strong>');
  });

  it('keeps a link shown inside a double-backtick code span as code', () => {
    const { pages } = build({ 'gm/x.md': '# X\n\nWrite ``[a](b.md) and `c` `` to link.\n' });
    expect(pages.x.html).toContain('<code>[a](b.md) and `c` </code>');
    expect(pages.x.html).not.toContain('data-help');
  });

  it('fails when a gm page and a foundry page map to the same key', () => {
    const { status, stderr } = build({
      'gm/foundry-y.md': '# One\n',
      'foundry/y.md': '# Two\n',
    });
    expect(status).toBe(1);
    expect(stderr).toContain('page key foundry-y is used by');
  });
});
