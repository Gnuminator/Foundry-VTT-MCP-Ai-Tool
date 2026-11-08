/**
 * Player set canaries (D-136, design section 5): the backend half. The module's playerRead holds
 * the pack and actor scope (foundry-module/src/player-read.test.ts); here the fake bridge answers
 * with the worst case (a Strahd excerpt, a Tarokka card name, an oversize entry) and the last-line
 * filter, the caps and the "user id comes from the message only" rule are checked.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { buildToolRouter, collectToolDefinitions } from '../tool-router.js';
import { stubToolRouterDeps } from '../test-support/stub-tool-deps.js';
import {
  PLAYER_TOOL_SET,
  TOOL_SETS,
  filterToolsBySets,
  resolveToolSets,
  splitPlayerTools,
} from '../tool-sets.js';
import {
  PLAYER_ENTRY_CHARS,
  PLAYER_EXCERPT_CHARS,
  PlayerTools,
  handlePlayerTool,
  readExtraDenyTerms,
} from './player.js';

const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
logger.child = (): unknown => logger;

function make(
  reply: unknown,
  opts: { secret?: string[]; extra?: string[] } = {}
): { tools: PlayerTools; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn(() => Promise.resolve(reply));
  const tools = new PlayerTools({
    foundryClient: { query } as any,
    logger,
    secretTerms: {
      findSecretTermsInMany: vi.fn((_world: string, texts: readonly string[]) =>
        Promise.resolve(
          texts.map(t =>
            (opts.secret ?? [])
              .filter(s => t.toLowerCase().includes(s.toLowerCase()))
              .map(term => ({ category: 'tarokka-card', term }))
          )
        )
      ),
    },
    worldIds: { current: (): Promise<string> => Promise.resolve('w') },
    extraDenyTerms: (): string[] => opts.extra ?? [],
  });
  return { tools, query };
}

describe('the player set is never served on stdio and has no call_tool route', () => {
  const deps = stubToolRouterDeps();
  const names = TOOL_SETS[PLAYER_TOOL_SET].tools;

  it('resolveToolSets drops "player" and "all" excludes it', () => {
    const named = resolveToolSets('player');
    expect(named.sets).not.toContain('player');
    expect(named.warnings.join(' ')).toContain('unknown tool set "player"');
    expect(resolveToolSets('all').sets).not.toContain('player');
    expect(resolveToolSets('core,player').sets).toEqual(['core']);
  });

  it('filterToolsBySets never lists a player tool, even with every set', () => {
    const all = names.map(name => ({ name }));
    for (const raw of [undefined, 'all', 'core', 'core,player', 'player'])
      expect(filterToolsBySets(all, resolveToolSets(raw))).toEqual([]);
  });

  it('list_tools leaves them out; list_player_tools carries exactly the five', () => {
    const { listed, player } = splitPlayerTools(collectToolDefinitions(deps));
    expect(listed.map(t => t.name)).not.toEqual(expect.arrayContaining([names[0]]));
    for (const name of names) expect(listed.map(t => t.name)).not.toContain(name);
    expect(player.map(t => t.name).sort()).toEqual([...names].sort());
  });

  it('call_tool has no route for them (the dashboard path is player_tool only)', () => {
    const router = buildToolRouter(deps);
    for (const name of names) expect(Object.keys(router)).not.toContain(name);
  });
});

describe('player_tool refuses everything that is not a player tool, or has no identity', () => {
  it.each([
    'apply-planned-change',
    'session_switches',
    'getCharacterInfo',
    'search-rules',
    'get-character',
    'constructor',
  ])('refuses %s', async tool => {
    const { tools, query } = make({});
    const r = await handlePlayerTool(tools, { tool, args: {}, userId: 'u1' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Not a player tool');
    expect(query).not.toHaveBeenCalled();
  });

  it.each([undefined, '', '   ', 42, null])('refuses a missing identity (%s)', async userId => {
    const { tools, query } = make({});
    const r = await handlePlayerTool(tools, { tool: 'get-my-character', args: {}, userId });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('No player identity');
    expect(query).not.toHaveBeenCalled();
  });

  it('names the bad argument in a sentence, not as a raw schema dump', async () => {
    const { tools, query } = make({});
    const r = await handlePlayerTool(tools, {
      tool: 'search-books',
      args: { query: 'a' },
      userId: 'u1',
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/^Error: Check the arguments: query /);
    expect(r.content[0].text).not.toContain('"code"');
    expect(query).not.toHaveBeenCalled();
  });

  it('answers an error payload, never throws, for a malformed message', async () => {
    const { tools } = make({});
    for (const params of [undefined, null, 'x', 7, []]) {
      const r = await handlePlayerTool(tools, params);
      expect(r.isError).toBe(true);
    }
  });
});

describe('the user id comes from the message only', () => {
  it('ignores userId, includeWorld and includeOtherBooks in the tool arguments', async () => {
    const { tools, query } = make({ results: [] });
    await tools.run(
      'search-books',
      { query: 'grappling', userId: 'EVIL', includeWorld: true, includeOtherBooks: true },
      'real-user'
    );
    expect(query).toHaveBeenCalledTimes(1);
    const [method, data] = query.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(method).toBe('foundry-mcp-bridge.playerRead');
    expect(data.userId).toBe('real-user');
    expect(data).not.toHaveProperty('includeWorld');
    expect(data).not.toHaveProperty('includeOtherBooks');
    expect(JSON.stringify(data)).not.toContain('EVIL');
  });

  it('does not pass a client identifier through for the character tools', async () => {
    const { tools, query } = make({ sheets: [] });
    await tools.run(
      'get-my-character',
      { name: 'Ana', identifier: 'someone-else', userId: 'X' },
      'u1'
    );
    await tools.run(
      'get-my-level-up-options',
      { name: 'Ana', identifier: 'a1', userId: 'X' },
      'u1'
    );
    for (const call of query.mock.calls as unknown as Array<[string, Record<string, unknown>]>) {
      expect(call[1].userId).toBe('u1');
      expect(call[1]).not.toHaveProperty('identifier');
    }
  });
});

describe('the last-line term filter', () => {
  const hit = (
    snippet: string,
    name = 'Rules'
  ): { packId: string; documentId: string; name: string; snippet: string } => ({
    packId: 'p',
    documentId: 'd',
    name,
    snippet,
  });

  it.each(['Strahd', 'Barovia', 'Ravenloft', 'Tarokka', 'Ireena', 'Vallaki'])(
    'drops a search result that mentions %s and counts it',
    async term => {
      const { tools } = make({
        results: [
          hit(`CANARY the ${term.toLowerCase()} text`),
          hit('Grappling needs a free hand.'),
        ],
      });
      const out = (await tools.run('search-books', { query: 'grapple' }, 'u')) as any;
      expect(JSON.stringify(out)).not.toContain('CANARY');
      expect(out.results).toHaveLength(1);
      expect(out.note).toBe('1 result hidden');
    }
  );

  it('drops a result named by a live Tarokka card or a configured extra term', async () => {
    const { tools } = make(
      { results: [hit('The Raven Keeper waits', 'Card'), hit('CANARY-X lore'), hit('plain')] },
      { secret: ['Raven Keeper'], extra: ['canary-x'] }
    );
    const out = (await tools.run('search-books', { query: 'anything' }, 'u')) as any;
    expect(out.results).toHaveLength(1);
    expect(out.note).toBe('2 results hidden');
  });

  it('hides find-book-entries names and a get-book-entry description alike', async () => {
    const found = make({ results: [{ name: 'Strahd Cape' }, { name: 'Cloak of Elvenkind' }] });
    const f = (await found.tools.run('find-book-entries', { query: 'c' }, 'u')) as any;
    expect(f.results).toEqual([{ name: 'Cloak of Elvenkind' }]);

    const entry = make({ name: 'Lore', description: 'Barovia is a valley.' });
    const e = (await entry.tools.run('get-book-entry', { packId: 'p', entryId: 'e' }, 'u')) as any;
    expect(e).toEqual({ note: '1 result hidden' });
  });

  it('does not filter the player’s own character (a backstory may name Barovia)', async () => {
    const sheet = { sheets: [{ name: 'Ana', personality: { traits: 'Born in Barovia' } }] };
    const { tools } = make(sheet);
    const out = await tools.run('get-my-character', {}, 'u');
    expect(JSON.stringify(out)).toContain('Barovia');
  });

  it('still applies the base terms when the secret-terms service fails', async () => {
    const tools = new PlayerTools({
      foundryClient: {
        query: () => Promise.resolve({ results: [hit('Strahd'), hit('fine')] }),
      } as any,
      logger,
      secretTerms: {
        findSecretTermsInMany: (): Promise<never> => Promise.reject(new Error('no vault')),
      },
      worldIds: { current: (): Promise<never> => Promise.reject(new Error('no world')) },
    });
    const out = (await tools.run('search-books', { query: 'xx' }, 'u')) as any;
    expect(out.results).toHaveLength(1);
  });
});

describe('caps', () => {
  it('cuts an oversize excerpt and an oversize entry, and bounds the request', async () => {
    const long = 'a'.repeat(PLAYER_ENTRY_CHARS * 2);
    const search = make({ results: [{ name: 'n', snippet: long }] });
    const s = (await search.tools.run('search-books', { query: 'aa', limit: 10 }, 'u')) as any;
    expect(s.results[0].snippet.length).toBeLessThanOrEqual(PLAYER_EXCERPT_CHARS + 1);
    const sent = search.query.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(sent[1].excerptChars).toBe(PLAYER_EXCERPT_CHARS);
    expect(sent[1].limit).toBe(10);

    const entry = make({ name: 'Big', description: long });
    const e = (await entry.tools.run('get-book-entry', { packId: 'p', entryId: 'e' }, 'u')) as any;
    expect(e.description.length).toBeLessThanOrEqual(PLAYER_ENTRY_CHARS + 1);
    expect(e.truncated).toBe(true);
  });

  it('refuses a limit above the cap instead of passing it on', async () => {
    const { tools, query } = make({ results: [] });
    await expect(tools.run('search-books', { query: 'aa', limit: 500 }, 'u')).rejects.toThrow();
    await expect(tools.run('find-book-entries', { limit: 500 }, 'u')).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('answers with at most the cap even if the module returns more results', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ name: `n${i}`, snippet: 's' }));
    const { tools } = make({ results: many });
    const s = (await tools.run('search-books', { query: 'aa' }, 'u')) as any;
    expect(s.results).toHaveLength(10);
  });
});

describe('readExtraDenyTerms', () => {
  it('reads denyTerms from the Pi config and tolerates a missing or bad file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'player-cfg-'));
    try {
      const good = join(dir, 'player-connector.json');
      writeFileSync(good, JSON.stringify({ denyTerms: ['Krezk', 7, 'Argynvostholt'], tokens: {} }));
      expect(readExtraDenyTerms(good)).toEqual(['Krezk', 'Argynvostholt']);
      const bad = join(dir, 'bad.json');
      writeFileSync(bad, '{"players":[{"clientSecret":"s3cr3t-value-zzz" nope');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      expect(readExtraDenyTerms(bad)).toEqual([]);
      // The parse error quotes the file; the log line must not (the file holds Client Secrets).
      expect(JSON.stringify(warn.mock.calls)).not.toContain('s3cr3t-value-zzz');
      warn.mockRestore();
      expect(readExtraDenyTerms(join(dir, 'missing.json'))).toEqual([]);
      expect(readExtraDenyTerms(undefined)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
