/**
 * docs/reference/tools.md is generated from the tool catalog (I-081, P-061):
 * this test fails when the committed page differs from what
 * renderToolReference() makes of the current tools, so a changed tool
 * description or parameter cannot leave the page behind.
 *
 * `npm run docs:tools` rewrites the page (it runs this file with
 * UPDATE_TOOL_REFERENCE=1).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { stripToolRefs } from '@gnuminator/shared';
import { describe, expect, it } from 'vitest';

import { stubToolRouterDeps } from './test-support/stub-tool-deps.js';
import { renderToolReference } from './tool-reference.js';
import { collectToolDefinitions } from './tool-router.js';

const PAGE = fileURLToPath(new URL('../../../docs/reference/tools.md', import.meta.url));
const EM_DASH = String.fromCharCode(0x2014);

const tools = stripToolRefs(collectToolDefinitions(stubToolRouterDeps()));
const rendered = renderToolReference(tools);

describe('tool reference page', () => {
  it('docs/reference/tools.md matches the tool catalog', () => {
    if (process.env.UPDATE_TOOL_REFERENCE === '1') writeFileSync(PAGE, rendered);
    const committed = existsSync(PAGE) ? readFileSync(PAGE, 'utf8').replace(/\r\n/g, '\n') : '';
    if (committed !== rendered) {
      const a = committed.split('\n');
      const b = rendered.split('\n');
      const line = a.findIndex((text, i) => text !== b[i]);
      const at = line === -1 ? Math.min(a.length, b.length) : line;
      expect.fail(
        `docs/reference/tools.md is stale (first difference at line ${at + 1}: ` +
          `${JSON.stringify(a[at] ?? '')} vs ${JSON.stringify(b[at] ?? '')}). Run \`npm run docs:tools\`.`
      );
    }
  });

  it('lists every tool once, under its set', () => {
    for (const tool of tools) {
      expect(
        rendered.split('\n').filter(line => line === `### ${tool.name}`),
        tool.name
      ).toHaveLength(1);
    }
  });

  it('has no em dashes (tool descriptions are project text too)', () => {
    expect(rendered.includes(EM_DASH)).toBe(false);
  });

  it('shows HTML examples in descriptions as text, outside code spans', () => {
    const outsideCode = rendered
      .split('\n')
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
});
