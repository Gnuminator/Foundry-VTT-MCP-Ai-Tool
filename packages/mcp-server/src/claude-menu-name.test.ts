/**
 * One name for the Claude Desktop menu that holds the connector switches: the + menu, then
 * Plugins (checked on the app 2026-11-21). The server instructions use the constant; every doc,
 * stub and installer text must not use the old spellings ("Search and tools", "+ ... Connectors").
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CLAUDE_CONNECTOR_MENU, toolSetInstructions } from './tool-sets.js';

const root = join(__dirname, '..', '..', '..');
const SKIP =
  /^(docs\/history\/|CHANGELOG\.md|changelog\.d\/|packages\/mcp-server\/src\/(claude-menu-name\.test|skill-guides\.generated)\.)/;
const TEXT = /\.(md|txt|nsi|ts|json)$/;
const OLD_SPELLINGS: Array<[string, RegExp]> = [
  ['Search and tools', /search and tools/i],
  ['+ menu then Connectors', /\*\*\+\*\*[^.\n]{0,60}\*\*Connectors\*\*/],
  ['+ menu then Connectors (plain)', /\+ menu, (then )?Connectors/i],
];

describe('Claude Desktop connector menu name', () => {
  it('the server instructions name the menu with the constant', () => {
    expect(toolSetInstructions({ all: false, sets: ['core'] })).toContain(CLAUDE_CONNECTOR_MENU);
  });

  it('no tracked doc, stub or installer text uses another spelling', () => {
    const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
      .split('\n')
      .filter(f => f && TEXT.test(f) && !SKIP.test(f));
    const hits: string[] = [];
    for (const f of files) {
      let text: string;
      try {
        text = readFileSync(join(root, f), 'utf8');
      } catch {
        continue;
      }
      for (const [label, re] of OLD_SPELLINGS) if (re.test(text)) hits.push(`${f}: ${label}`);
    }
    expect(hits).toEqual([]);
  });
});
