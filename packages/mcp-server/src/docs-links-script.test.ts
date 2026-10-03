/**
 * `scripts/check-links.mjs` on fixture repos (it takes `--root` and reads
 * `git ls-files`). That the real docs have no broken internal links is checked
 * by CI (`npm run docs:links`).
 */
import { spawnSync } from 'child_process';
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const script = path.join(repoRoot, 'scripts', 'check-links.mjs');

let root: string;

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'check-links-'));
  spawnSync('git', ['init', '-q'], { cwd: root });
});

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

async function put(rel: string, text: string): Promise<void> {
  const full = path.join(root, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, text, 'utf8');
  spawnSync('git', ['add', rel], { cwd: root });
}

function run(): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('check-links script', () => {
  it('passes links to files, folders, headings, repeated headings and HTML anchors', async () => {
    await put(
      'docs/guide.md',
      [
        '---',
        'title: Guide',
        '---',
        '',
        '# Guide',
        '',
        '## Tool sets: which switches to turn on',
        '',
        '## Notes',
        '',
        '## Notes',
        '',
        '<a id="custom-spot"></a>',
        '',
        'See [the top](#guide), [sets](#tool-sets-which-switches-to-turn-on), [second](#notes-1),',
        '[spot](#custom-spot), [other](other%20page.md#the-end), [folder](../docs) and',
        '[readme](/README.md). ![logo](img/logo.png) [site](https://example.com/x)',
        '',
        '[ref]: other%20page.md',
      ].join('\n')
    );
    await put('docs/other page.md', '# Other\n\n## The `end`!\n');
    await put('docs/img/logo.png', 'png');
    await put('README.md', '# Readme\n');
    const r = run();
    expect(r.out).toContain('check-links: OK');
    expect(r.status).toBe(0);
  });

  it('reports a missing file and a missing anchor with file and line', async () => {
    await put('docs/a.md', '# A\n\n[gone](missing.md)\n\n[bad](b.md#nowhere)\n');
    await put('docs/b.md', '# B\n');
    const r = run();
    expect(r.status).toBe(1);
    expect(r.out).toContain('docs/a.md:3: missing.md (no such file)');
    expect(r.out).toContain('docs/a.md:5: b.md#nowhere (no heading or anchor "#nowhere")');
  });

  it('skips code blocks, code spans, history and untracked files', async () => {
    await put('docs/a.md', '# A\n\n```md\n[x](missing.md)\n```\n\nRun `[y](gone.md)` here.\n');
    await put('docs/history/old.md', '[x](missing.md)\n');
    await fsp.writeFile(path.join(root, 'untracked.md'), '[x](missing.md)\n');
    const r = run();
    expect(r.out).toContain('check-links: OK');
    expect(r.status).toBe(0);
  });
});
