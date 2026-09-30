/**
 * The GM and player docs stay true (I-083): every `kebab-case` name in
 * backticks in docs/gm, docs/player and the README must be a tool, a prompt,
 * a Claude Desktop entry, or one of the few other names listed below. A doc
 * that names a renamed or removed tool fails here, so a recipe never tells the
 * GM to ask for something that no longer exists.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PROMPTS } from './prompts/index.js';
import { stubToolRouterDeps } from './test-support/stub-tool-deps.js';
import { collectToolDefinitions } from './tool-router.js';
import { TOOL_SET_NAMES } from './tool-sets.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Backticked names that are not tools, prompts or entries, each with where it comes from. */
const OTHER_NAMES: Readonly<Record<string, string>> = {
  'foundry-mcp-bridge': 'the Foundry module id',
  'tarokka-reading': 'the Foundry module the Tarokka import reads',
  'gm-roll': 'a dashboard feed line type',
  'gm-change': 'a dashboard feed line type',
  'host-not-allowed': 'a dashboard error code',
  'obsidian-mirror': 'a guarded-write feature id',
};

function markdownFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory()
      ? markdownFiles(join(dir, entry.name))
      : entry.name.endsWith('.md')
        ? [join(dir, entry.name)]
        : []
  );
}

const KEBAB = /`([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`/g;

describe('docs name only real tools and prompts', () => {
  const tools = new Set(collectToolDefinitions(stubToolRouterDeps()).map(t => t.name));
  const prompts = new Set(PROMPTS.map(p => p.name));
  const entries = new Set(
    TOOL_SET_NAMES.map(set => (set === 'core' ? 'foundry-mcp' : `foundry-mcp-${set}`))
  );
  const known = (name: string): boolean =>
    tools.has(name) || prompts.has(name) || entries.has(name) || name in OTHER_NAMES;

  const files = [...markdownFiles('docs/gm'), ...markdownFiles('docs/player'), 'README.md'];

  it('scans the GM docs, the player docs and the README', () => {
    expect(files.some(f => f.includes('cookbook'))).toBe(true);
  });

  for (const file of files) {
    it(`${file.replace(/\\/g, '/')} names no unknown tool`, () => {
      const text = readFileSync(join(ROOT, file), 'utf8');
      const unknown = [...text.matchAll(KEBAB)].map(m => m[1]).filter(name => !known(name));
      expect([...new Set(unknown)]).toEqual([]);
    });
  }

  it('lists no stale extra names', () => {
    const all = files.map(f => readFileSync(join(ROOT, f), 'utf8')).join('\n');
    const unused = Object.keys(OTHER_NAMES).filter(name => !all.includes(`\`${name}\``));
    expect(unused).toEqual([]);
  });
});
