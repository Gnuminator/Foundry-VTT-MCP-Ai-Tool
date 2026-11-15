/**
 * docs/reference/tools.md (the index) and docs/reference/tools/<set>.md (one page per
 * set) are generated from the tool catalog (I-081, P-061): this test fails when a
 * committed page differs from what renderToolReference() makes of the current tools,
 * so a changed tool description or parameter cannot leave a page behind.
 *
 * `npm run docs:tools` rewrites the pages (it runs this file with
 * UPDATE_TOOL_REFERENCE=1).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripToolRefs } from '@gnuminator/shared';
import { describe, expect, it } from 'vitest';

import { stubToolRouterDeps } from './test-support/stub-tool-deps.js';
import { renderToolReference } from './tool-reference.js';
import { collectToolDefinitions } from './tool-router.js';

const REFERENCE_DIR = fileURLToPath(new URL('../../../docs/reference/', import.meta.url));
const EM_DASH = String.fromCharCode(0x2014);
const UPDATE = process.env.UPDATE_TOOL_REFERENCE === '1';

const tools = stripToolRefs(collectToolDefinitions(stubToolRouterDeps()));
const files = renderToolReference(tools);
const setPages = Object.entries(files).filter(([file]) => file !== 'tools.md');

describe('tool reference pages', () => {
  if (UPDATE) {
    mkdirSync(join(REFERENCE_DIR, 'tools'), { recursive: true });
    for (const [file, text] of Object.entries(files))
      writeFileSync(join(REFERENCE_DIR, file), text);
  }

  it.each(Object.keys(files))('docs/reference/%s matches the tool catalog', file => {
    const page = join(REFERENCE_DIR, file);
    const committed = existsSync(page) ? readFileSync(page, 'utf8').replace(/\r\n/g, '\n') : '';
    const rendered = files[file] ?? '';
    if (committed !== rendered) {
      const a = committed.split('\n');
      const b = rendered.split('\n');
      const line = a.findIndex((text, i) => text !== b[i]);
      const at = line === -1 ? Math.min(a.length, b.length) : line;
      expect.fail(
        `docs/reference/${file} is stale (first difference at line ${at + 1}: ` +
          `${JSON.stringify(a[at] ?? '')} vs ${JSON.stringify(b[at] ?? '')}). Run \`npm run docs:tools\`.`
      );
    }
  });

  it('docs/reference/tools/ holds no page that is not a set page', () => {
    const expected = setPages.map(([file]) => file.replace('tools/', '')).sort();
    const found = readdirSync(join(REFERENCE_DIR, 'tools')).sort();
    expect(found).toEqual(expected);
  });

  it('lists every tool once, under its set', () => {
    const all = setPages.flatMap(([, text]) => text.split('\n'));
    for (const tool of tools) {
      expect(
        all.filter(line => line === `## ${tool.name}`),
        tool.name
      ).toHaveLength(1);
    }
  });

  it('links the index to every set page', () => {
    for (const [file] of setPages) expect(files['tools.md']).toContain(`](${file})`);
  });

  it('has no em dashes (tool descriptions are project text too)', () => {
    for (const [file, text] of Object.entries(files)) {
      expect(text.includes(EM_DASH), file).toBe(false);
    }
  });

  it('shows HTML examples in descriptions as text, outside code spans', () => {
    const outsideCode = setPages
      .flatMap(([, text]) => text.split('\n'))
      .filter(line => !line.startsWith('<!--') && !line.startsWith('|'))
      .map(line =>
        line
          .split('`')
          .filter((_, i) => i % 2 === 0)
          .join('')
      )
      .join('\n');
    expect(outsideCode).not.toMatch(/<[a-z/]/i);
  });

  it('escapes a backslash before a star, so the star stays text', () => {
    const [first, ...rest] = tools;
    const pages = renderToolReference([
      { ...first, description: 'Path C:\\x\\*y and **bold** and `a\\*b`' },
      ...rest,
    ]);
    const text = Object.values(pages).join('\n');
    expect(text).toContain('Path C:\\\\x\\\\\\*y and \\*\\*bold\\*\\* and `a\\*b`');
  });
});
