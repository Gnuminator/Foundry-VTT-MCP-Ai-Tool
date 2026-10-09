/**
 * The tool result size guard (D-109, round C Q11): one cap for every tool
 * result Claude receives, cut with a note that says how to fetch the next
 * page. Checked on the guard itself and on the tools whose results grow with
 * the world.
 */
import { stripToolRefs } from '@gnuminator/shared';
import { describe, expect, it } from 'vitest';

import { stubToolRouterDeps } from './test-support/stub-tool-deps.js';
import {
  TOOL_RESULT_MAX_CHARS,
  capToolResult,
  collectToolDefinitions,
  type ToolResultLike,
} from './tool-router.js';

const tools = stripToolRefs(collectToolDefinitions(stubToolRouterDeps()));
const byName = new Map(tools.map(t => [t.name, t]));

function textResult(...texts: string[]): ToolResultLike {
  return { content: texts.map(text => ({ type: 'text', text })) };
}

function allText(result: ToolResultLike): string {
  return result.content.map(p => p.text ?? '').join('');
}

describe('capToolResult', () => {
  it('returns a result within the cap unchanged (the same object)', () => {
    const small = textResult('x'.repeat(10));
    expect(capToolResult(small, 'get-world-info')).toBe(small);
    const exact = textResult('x'.repeat(TOOL_RESULT_MAX_CHARS));
    expect(capToolResult(exact, 'get-world-info')).toBe(exact);
  });

  it('cuts a result over the cap and adds a note with the sizes', () => {
    const big = textResult('a'.repeat(250_000));
    const out = capToolResult(big, 'get-chat-log', byName.get('get-chat-log'));
    expect(out).not.toBe(big);
    expect(out.content[0]?.text).toHaveLength(TOOL_RESULT_MAX_CHARS);
    const note = out.content.at(-1)?.text ?? '';
    expect(note).toContain('showing the first 100,000 of 250,000 characters');
    expect(note).toContain('The JSON above is incomplete');
    expect(note).toContain(
      'To see less or a different part, call get-chat-log again with: limit, sinceTimestamp'
    );
    // The original is not changed.
    expect(big.content[0]?.text).toHaveLength(250_000);
  });

  it('counts every text part together and keeps the order', () => {
    const out = capToolResult(textResult('a'.repeat(60), 'b'.repeat(60)), 'x', undefined, 100);
    expect(out.content.map(p => p.text?.length)).toEqual([60, 40, expect.any(Number)]);
    expect(allText(out).startsWith('a'.repeat(60) + 'b'.repeat(40))).toBe(true);
  });

  it('drops text parts the cap emptied', () => {
    const out = capToolResult(textResult('a'.repeat(20), 'b'.repeat(20)), 'x', undefined, 10);
    expect(out.content.map(p => p.text?.slice(0, 1))).toEqual(['a', '[']);
  });

  it('keeps isError and parts without text', () => {
    const result = {
      content: [{ type: 'image' }, { type: 'text', text: 'e'.repeat(50) }],
      isError: true,
    };
    const out = capToolResult(result, 'x', undefined, 10);
    expect(out.isError).toBe(true);
    expect(out.content[0]).toEqual({ type: 'image' });
    expect(out.content[1]?.text).toBe('e'.repeat(10));
  });

  it('never splits a surrogate pair', () => {
    const out = capToolResult(textResult(`${'a'.repeat(9)}\u{1F409}tail`), 'x', undefined, 10);
    expect(out.content[0]?.text).toBe('a'.repeat(9));
  });

  it('names the tool parameters for a smaller part, narrowing ones first', () => {
    const out = capToolResult(
      textResult('a'.repeat(20)),
      'list-changes',
      byName.get('list-changes'),
      10
    );
    expect(out.content.at(-1)?.text).toMatch(/again with: limit, since, /);
  });

  it('says so when a tool has no parameters to ask for less', () => {
    const tool = byName.get('get-combat-play-by-play');
    const out = capToolResult(textResult('a'.repeat(20)), 'get-combat-play-by-play', tool, 10);
    expect(out.content.at(-1)?.text).toContain('has no parameters to ask for less');
  });

  it('falls back to a general hint for a tool it was not given', () => {
    const out = capToolResult(textResult('a'.repeat(20)), 'mystery', undefined, 10);
    expect(out.content.at(-1)?.text).toContain('call mystery again with narrower arguments');
  });

  it('leaves a malformed result alone', () => {
    const odd = { content: 'nope' } as unknown as ToolResultLike;
    expect(capToolResult(odd, 'x')).toBe(odd);
  });
});

describe('the biggest tools', () => {
  // Results that grow with the world, the play log or the compendiums.
  const BIGGEST: Record<string, string> = {
    'get-chat-log': 'limit',
    'get-session-log': 'limit',
    'get-recent-events': 'limit',
    'list-changes': 'limit',
    'search-compendium': 'limit',
    'list-creatures-by-criteria': 'limit',
    'list-ref-choices': 'limit',
    'list-journals': 'journalId',
  };

  it('each offers a parameter to fetch less, and the cut note names it', () => {
    for (const [name, param] of Object.entries(BIGGEST)) {
      const tool = byName.get(name);
      expect(tool, name).toBeDefined();
      const properties = (tool?.inputSchema as { properties?: Record<string, unknown> }).properties;
      expect(Object.keys(properties ?? {}), name).toContain(param);

      const out = capToolResult(textResult('{"x":1}'.repeat(60_000)), name, tool);
      expect(allText(out).length, name).toBeLessThan(TOOL_RESULT_MAX_CHARS + 500);
      expect(out.content.at(-1)?.text, name).toMatch(new RegExp(`again with: (.*, )?${param}[,.]`));
    }
  });
});
