import { beforeEach, describe, expect, it, vi } from 'vitest';

import { QuestCreationTools } from './quest-creation.js';

/**
 * Characterization test suite for QuestCreationTools.
 *
 * Covers all 5 public handlers:
 *   - handleCreateQuestJournal
 *   - handleLinkQuestToNPC
 *   - handleUpdateQuestJournal
 *   - handleListJournals
 *   - handleSearchJournals
 *
 * Pattern: validate args (zod) → dispatch correct `foundry-mcp-bridge.*` query →
 * propagate foundry-side failures (always throws via ErrorHandler.handleToolError) →
 * shape the returned result object (including HTML content generation).
 *
 * Note: All handlers route failures through ErrorHandler.handleToolError which
 * always re-throws as a new Error. Zod failures are caught by the same catch block
 * and also throw.
 */

function makeTools(queryImpl?: (method: string, data: unknown) => unknown) {
  const query = vi.fn(queryImpl ?? (() => ({ success: true })));
  const foundryClient = { query } as any;
  // Minimal Logger stub: `.child()` returns itself; level methods are no-ops.
  const logger: any = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
  logger.child = () => logger;
  return { tools: new QuestCreationTools({ foundryClient, logger }), query, logger };
}

// ---------------------------------------------------------------------------
// getToolDefinitions
// ---------------------------------------------------------------------------

describe('QuestCreationTools.getToolDefinitions', () => {
  it('exposes exactly five tools', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect(defs).toHaveLength(5);
  });

  it('has the correct tool names in order', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual([
      'create-quest-journal',
      'link-quest-to-npc',
      'update-quest-journal',
      'list-journals',
      'search-journals',
    ]);
  });

  it('all tools have object input schemas', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    for (const d of defs) {
      expect((d.inputSchema as any).type).toBe('object');
    }
  });

  it('create-quest-journal requires questTitle and questDescription', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'create-quest-journal')!;
    expect((def.inputSchema as any).required).toEqual(['questTitle', 'questDescription']);
  });

  it('create-quest-journal questType property enumerates the eight quest types', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'create-quest-journal')!;
    const questTypeProp = (def.inputSchema as any).properties.questType;
    expect(questTypeProp.enum).toEqual([
      'main',
      'side',
      'personal',
      'mystery',
      'fetch',
      'escort',
      'kill',
      'collection',
    ]);
  });

  it('create-quest-journal difficulty property enumerates the four difficulty levels', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'create-quest-journal')!;
    const difficultyProp = (def.inputSchema as any).properties.difficulty;
    expect(difficultyProp.enum).toEqual(['easy', 'medium', 'hard', 'deadly']);
  });

  it('link-quest-to-npc requires journalId, npcName, and relationship', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'link-quest-to-npc')!;
    expect((def.inputSchema as any).required).toEqual(['journalId', 'npcName', 'relationship']);
  });

  it('link-quest-to-npc relationship enumerates the five relationship types', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'link-quest-to-npc')!;
    const relProp = (def.inputSchema as any).properties.relationship;
    expect(relProp.enum).toEqual(['quest_giver', 'target', 'ally', 'enemy', 'contact']);
  });

  it('update-quest-journal requires journalId, newContent, and updateType', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'update-quest-journal')!;
    expect((def.inputSchema as any).required).toEqual(['journalId', 'newContent', 'updateType']);
  });

  it('update-quest-journal updateType enumerates the four update types', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'update-quest-journal')!;
    const updateTypeProp = (def.inputSchema as any).properties.updateType;
    expect(updateTypeProp.enum).toEqual(['progress', 'completion', 'failure', 'modification']);
  });

  it('list-journals has no required fields', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'list-journals')!;
    expect((def.inputSchema as any).required).toBeUndefined();
  });

  it('search-journals requires searchQuery', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'search-journals')!;
    expect((def.inputSchema as any).required).toEqual(['searchQuery']);
  });

  it('search-journals searchType property enumerates the three search types', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'search-journals')!;
    const searchTypeProp = (def.inputSchema as any).properties.searchType;
    expect(searchTypeProp.enum).toEqual(['title', 'content', 'both']);
  });
});

// ---------------------------------------------------------------------------
// handleCreateQuestJournal
// ---------------------------------------------------------------------------

describe('QuestCreationTools.handleCreateQuestJournal — dispatch', () => {
  it('dispatches foundry-mcp-bridge.createJournalEntry with questTitle as name', async () => {
    const { tools, query } = makeTools(() => ({
      success: true,
      id: 'journal-abc',
      name: 'Rescue the Merchant',
      pageCount: 1,
    }));
    await tools.handleCreateQuestJournal({
      questTitle: 'Rescue the Merchant',
      questDescription: 'The merchant has been kidnapped by bandits.',
    });
    expect(query).toHaveBeenCalledOnce();
    const [method, params] = query.mock.calls[0] as [string, any];
    expect(method).toBe('foundry-mcp-bridge.createJournalEntry');
    expect(params.name).toBe('Rescue the Merchant');
    expect(typeof params.content).toBe('string');
    expect(params.content.length).toBeGreaterThan(0);
  });

  it('passes folderName when provided', async () => {
    const { tools, query } = makeTools(() => ({
      id: 'j1',
      name: 'Test Quest',
      pageCount: 1,
    }));
    await tools.handleCreateQuestJournal({
      questTitle: 'Test Quest',
      questDescription: 'A quest in a folder.',
      folderName: 'Side Quests',
    });
    const [, params] = query.mock.calls[0] as [string, any];
    expect(params.folderName).toBe('Side Quests');
  });

  it('does NOT pass folderName when not provided', async () => {
    const { tools, query } = makeTools(() => ({
      id: 'j1',
      name: 'Test Quest',
      pageCount: 1,
    }));
    await tools.handleCreateQuestJournal({
      questTitle: 'Test Quest',
      questDescription: 'No folder here.',
    });
    const [, params] = query.mock.calls[0] as [string, any];
    expect(params).not.toHaveProperty('folderName');
  });

  it('passes additionalPages when provided', async () => {
    const { tools, query } = makeTools(() => ({
      id: 'j1',
      name: 'Multipage Quest',
      pageCount: 2,
    }));
    const additionalPages = [{ name: 'GM Notes', content: '<p>Secret info</p>' }];
    await tools.handleCreateQuestJournal({
      questTitle: 'Multipage Quest',
      questDescription: 'A quest with multiple pages.',
      additionalPages,
    });
    const [, params] = query.mock.calls[0] as [string, any];
    expect(params.additionalPages).toEqual(additionalPages);
  });

  it('returns success:true with journalId, journalName, pageCount, content, and message', async () => {
    const { tools } = makeTools(() => ({
      id: 'journal-abc',
      name: 'Rescue the Merchant',
      pageCount: 1,
    }));
    const result = await tools.handleCreateQuestJournal({
      questTitle: 'Rescue the Merchant',
      questDescription: 'The merchant has been kidnapped.',
    });
    expect(result.success).toBe(true);
    expect(result.journalId).toBe('journal-abc');
    expect(result.journalName).toBe('Rescue the Merchant');
    expect(result.pageCount).toBe(1);
    expect(typeof result.content).toBe('string');
    expect(result.message).toContain('Rescue the Merchant');
  });

  it('defaults pageCount to 1 when not returned by Foundry', async () => {
    const { tools } = makeTools(() => ({ id: 'j2', name: 'Quest X' }));
    const result = await tools.handleCreateQuestJournal({
      questTitle: 'Quest X',
      questDescription: 'Desc.',
    });
    expect(result.pageCount).toBe(1);
  });
});

describe('QuestCreationTools.handleCreateQuestJournal — result shaping (HTML generation)', () => {
  it('generated content contains the quest title in an h1 tag', async () => {
    const { tools } = makeTools(() => ({
      id: 'j3',
      name: 'The Dark Forest',
      pageCount: 1,
    }));
    const result = await tools.handleCreateQuestJournal({
      questTitle: 'The Dark Forest',
      questDescription: 'Investigate the mysterious dark forest.',
    });
    expect(result.content).toContain('The Dark Forest');
    expect(result.content).toContain('<h1>');
  });

  it('generated content is wrapped in mcp-journal section', async () => {
    const { tools } = makeTools(() => ({ id: 'j3', name: 'Q', pageCount: 1 }));
    const result = await tools.handleCreateQuestJournal({
      questTitle: 'Q',
      questDescription: 'Some description.',
    });
    expect(result.content).toContain('mcp-journal');
    expect(result.content).toContain('<section');
  });

  it('generated content includes the quest description as lead paragraph', async () => {
    const { tools } = makeTools(() => ({ id: 'j4', name: 'Q', pageCount: 1 }));
    const result = await tools.handleCreateQuestJournal({
      questTitle: 'Q',
      questDescription: 'Investigate the crystal caves.',
    });
    expect(result.content).toContain('Investigate the crystal caves.');
  });

  it('generated content includes Background section when location is provided', async () => {
    const { tools } = makeTools(() => ({ id: 'j5', name: 'Q', pageCount: 1 }));
    const result = await tools.handleCreateQuestJournal({
      questTitle: 'Q',
      questDescription: 'A quest in the forest.',
      location: 'Thornwood Forest',
    });
    expect(result.content).toContain('Background');
    expect(result.content).toContain('Thornwood Forest');
  });

  it('generated content includes quest type in details when provided', async () => {
    const { tools } = makeTools(() => ({ id: 'j6', name: 'Q', pageCount: 1 }));
    const result = await tools.handleCreateQuestJournal({
      questTitle: 'Q',
      questDescription: 'Fetch the artifact.',
      questType: 'fetch',
      difficulty: 'hard',
    });
    expect(result.content).toContain('Fetch');
    expect(result.content).toContain('Hard');
  });

  it('generated content includes Adventure Hook section', async () => {
    const { tools } = makeTools(() => ({ id: 'j7', name: 'Q', pageCount: 1 }));
    const result = await tools.handleCreateQuestJournal({
      questTitle: 'Q',
      questDescription: 'Escort the princess.',
      questGiver: 'King Aldor',
    });
    expect(result.content).toContain('Adventure Hook');
    expect(result.content).toContain('King Aldor');
  });

  it('generated content includes Quest Objectives section', async () => {
    const { tools } = makeTools(() => ({ id: 'j8', name: 'Q', pageCount: 1 }));
    const result = await tools.handleCreateQuestJournal({
      questTitle: 'Q',
      questDescription: 'Stop the bandit leader.',
    });
    expect(result.content).toContain('Quest Objectives');
  });

  it('generated content includes Progress Notes section', async () => {
    const { tools } = makeTools(() => ({ id: 'j9', name: 'Q', pageCount: 1 }));
    const result = await tools.handleCreateQuestJournal({
      questTitle: 'Q',
      questDescription: 'Track the thief.',
    });
    expect(result.content).toContain('Progress Notes');
  });

  it('generated content includes rewards when provided', async () => {
    const { tools } = makeTools(() => ({ id: 'j10', name: 'Q', pageCount: 1 }));
    const result = await tools.handleCreateQuestJournal({
      questTitle: 'Q',
      questDescription: 'Complete the dungeon.',
      rewards: '500 gold and a magic sword',
    });
    expect(result.content).toContain('500 gold and a magic sword');
  });
});

describe('QuestCreationTools.handleCreateQuestJournal — failure handling', () => {
  let consoleErr: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('throws when Foundry returns an error field', async () => {
    const { tools } = makeTools(() => ({ error: 'Failed to create journal' }));
    await expect(
      tools.handleCreateQuestJournal({
        questTitle: 'Quest',
        questDescription: 'Desc.',
      })
    ).rejects.toThrow();
    consoleErr.mockRestore();
  });

  it('throws when Foundry returns null', async () => {
    const { tools } = makeTools(() => null);
    await expect(
      tools.handleCreateQuestJournal({
        questTitle: 'Quest',
        questDescription: 'Desc.',
      })
    ).rejects.toThrow();
    consoleErr.mockRestore();
  });

  it('throws when query itself rejects', async () => {
    const { tools } = makeTools(() => {
      throw new Error('connection refused');
    });
    await expect(
      tools.handleCreateQuestJournal({
        questTitle: 'Quest',
        questDescription: 'Desc.',
      })
    ).rejects.toThrow();
    consoleErr.mockRestore();
  });

  it('throws (not returns string) on missing questTitle — query not called', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleCreateQuestJournal({ questDescription: 'Desc.' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it('throws (not returns string) on missing questDescription — query not called', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleCreateQuestJournal({ questTitle: 'Quest' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it('throws on empty questTitle — query not called', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleCreateQuestJournal({ questTitle: '', questDescription: 'Desc.' })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it('throws on invalid questType enum — query not called', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleCreateQuestJournal({
        questTitle: 'Quest',
        questDescription: 'Desc.',
        questType: 'invalid-type',
      })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it('throws on invalid difficulty enum — query not called', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleCreateQuestJournal({
        questTitle: 'Quest',
        questDescription: 'Desc.',
        difficulty: 'extreme',
      })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// handleLinkQuestToNPC
// ---------------------------------------------------------------------------

describe('QuestCreationTools.handleLinkQuestToNPC — dispatch', () => {
  // Content must contain the exact string '</ul></div></div>' so addNPCLinkToJournal can inject into
  // the Rewards & Status column. Build it without extra whitespace between the closing tags.
  const JOURNAL_CONTENT =
    '<section class="mcp-journal"><div class="wrap"><h1>Test Quest</h1>' +
    '<div class="grid-2"><div><h3>Quest Details</h3><ul></ul></div>' +
    '<div><h3>Rewards & Status</h3><ul><li><strong>Status:</strong> Active</li></ul></div></div>' +
    '</div></section>';

  function makeLinker(content = JOURNAL_CONTENT) {
    const queryImpl = (method: string, _data: unknown) => {
      if (method === 'foundry-mcp-bridge.getJournalContent') {
        return { content, name: 'Test Quest', success: true };
      }
      if (method === 'foundry-mcp-bridge.updateJournalContent') {
        return { success: true };
      }
      return { success: true };
    };
    return makeTools(queryImpl);
  }

  it('first dispatches getJournalContent then updateJournalContent', async () => {
    const { tools, query } = makeLinker();
    await tools.handleLinkQuestToNPC({
      journalId: 'journal-abc',
      npcName: 'Grim Darkthorn',
      relationship: 'enemy',
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toBe('foundry-mcp-bridge.getJournalContent');
    expect(query.mock.calls[0][1]).toMatchObject({ journalId: 'journal-abc' });
    expect(query.mock.calls[1][0]).toBe('foundry-mcp-bridge.updateJournalContent');
    expect(query.mock.calls[1][1]).toMatchObject({ journalId: 'journal-abc' });
  });

  it('the updateJournalContent call includes content containing the NPC name', async () => {
    const { tools, query } = makeLinker();
    await tools.handleLinkQuestToNPC({
      journalId: 'journal-abc',
      npcName: 'Grim Darkthorn',
      relationship: 'enemy',
    });
    const [, updateParams] = query.mock.calls[1] as [string, any];
    expect(updateParams.content).toContain('Grim Darkthorn');
  });

  it('returns success:true and a message containing the NPC name and relationship', async () => {
    const { tools } = makeLinker();
    const result = await tools.handleLinkQuestToNPC({
      journalId: 'journal-abc',
      npcName: 'Grim Darkthorn',
      relationship: 'quest_giver',
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain('Grim Darkthorn');
    expect(result.message).toContain('quest giver');
  });

  it('replaces underscore with space in relationship in message', async () => {
    const { tools } = makeLinker();
    const result = await tools.handleLinkQuestToNPC({
      journalId: 'journal-abc',
      npcName: 'Someone',
      relationship: 'quest_giver',
    });
    expect(result.message).not.toContain('quest_giver');
    expect(result.message).toContain('quest giver');
  });
});

describe('QuestCreationTools.handleLinkQuestToNPC — failure handling', () => {
  let consoleErr: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('throws when getJournalContent returns error', async () => {
    const { tools } = makeTools(() => ({ error: 'journal not found' }));
    await expect(
      tools.handleLinkQuestToNPC({
        journalId: 'bad-id',
        npcName: 'NPC',
        relationship: 'enemy',
      })
    ).rejects.toThrow();
    consoleErr.mockRestore();
  });

  it('throws when getJournalContent returns null', async () => {
    const { tools } = makeTools(() => null);
    await expect(
      tools.handleLinkQuestToNPC({
        journalId: 'j1',
        npcName: 'NPC',
        relationship: 'ally',
      })
    ).rejects.toThrow();
    consoleErr.mockRestore();
  });

  it('throws when updateJournalContent returns error', async () => {
    let callCount = 0;
    const { tools } = makeTools(() => {
      callCount++;
      if (callCount === 1)
        return { content: '<section class="mcp-journal"></div></section>', success: true };
      return { error: 'Failed to update' };
    });
    await expect(
      tools.handleLinkQuestToNPC({
        journalId: 'j1',
        npcName: 'NPC',
        relationship: 'target',
      })
    ).rejects.toThrow();
    consoleErr.mockRestore();
  });

  it('throws on missing journalId — query not called', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleLinkQuestToNPC({ npcName: 'NPC', relationship: 'ally' })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it('throws on missing npcName — query not called', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleLinkQuestToNPC({ journalId: 'j1', relationship: 'ally' })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it('throws on missing relationship — query not called', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleLinkQuestToNPC({ journalId: 'j1', npcName: 'NPC' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it('throws on invalid relationship enum — query not called', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleLinkQuestToNPC({ journalId: 'j1', npcName: 'NPC', relationship: 'sidekick' })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// handleUpdateQuestJournal
// ---------------------------------------------------------------------------

describe('QuestCreationTools.handleUpdateQuestJournal — newPageName path (no read cycle)', () => {
  it('dispatches only one updateJournalContent call with newPageName', async () => {
    const { tools, query } = makeTools(() => ({
      success: true,
      pageId: 'page-new',
      pageName: 'Session 2 Notes',
    }));
    await tools.handleUpdateQuestJournal({
      journalId: 'j1',
      newContent: 'The party arrived.',
      updateType: 'progress',
      newPageName: 'Session 2 Notes',
    });
    expect(query).toHaveBeenCalledOnce();
    const [method, params] = query.mock.calls[0] as [string, any];
    expect(method).toBe('foundry-mcp-bridge.updateJournalContent');
    expect(params.journalId).toBe('j1');
    expect(params.newPageName).toBe('Session 2 Notes');
  });

  it('returns success:true with pageId, pageName, and verified:true', async () => {
    const { tools } = makeTools(() => ({
      success: true,
      pageId: 'page-new',
      pageName: 'Session 2 Notes',
    }));
    const result = await tools.handleUpdateQuestJournal({
      journalId: 'j1',
      newContent: 'New page content.',
      updateType: 'progress',
      newPageName: 'Session 2 Notes',
    });
    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.pageId).toBe('page-new');
    expect(result.pageName).toBe('Session 2 Notes');
  });

  it('newPageName content is wrapped in section tag with appropriate heading for progress', async () => {
    const { tools, query } = makeTools(() => ({
      success: true,
      pageId: 'p1',
      pageName: 'P',
    }));
    await tools.handleUpdateQuestJournal({
      journalId: 'j1',
      newContent: 'Party explored the cave.',
      updateType: 'progress',
      newPageName: 'Cave Exploration',
    });
    const [, params] = query.mock.calls[0] as [string, any];
    expect(params.content).toContain('Progress Update');
    expect(params.content).toContain('mcp-journal');
  });
});

describe('QuestCreationTools.handleUpdateQuestJournal — pageId path (targeted page update)', () => {
  const ORIGINAL_CONTENT = '<p>Original page content.</p>';
  const VERIFY_CONTENT = '<p>Original page content.</p><p>New info here.</p>';

  function makePageUpdater() {
    let callCount = 0;
    const queryImpl = (method: string, _data: unknown) => {
      callCount++;
      if (method === 'foundry-mcp-bridge.getJournalPageContent' && callCount === 1) {
        return { content: ORIGINAL_CONTENT, success: true };
      }
      if (method === 'foundry-mcp-bridge.updateJournalContent') {
        return { success: true, pageId: 'page-123', pageName: 'Test Page' };
      }
      if (method === 'foundry-mcp-bridge.getJournalPageContent' && callCount > 2) {
        return { content: VERIFY_CONTENT, success: true };
      }
      return { content: VERIFY_CONTENT, success: true };
    };
    return makeTools(queryImpl);
  }

  it('reads page first with getJournalPageContent then updates then verifies', async () => {
    const { tools, query } = makePageUpdater();
    await tools.handleUpdateQuestJournal({
      journalId: 'j1',
      pageId: 'page-123',
      newContent: 'New info here.',
      updateType: 'progress',
    });
    // Should have: getJournalPageContent, updateJournalContent, getJournalPageContent (verify)
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0][0]).toBe('foundry-mcp-bridge.getJournalPageContent');
    expect(query.mock.calls[1][0]).toBe('foundry-mcp-bridge.updateJournalContent');
    expect(query.mock.calls[2][0]).toBe('foundry-mcp-bridge.getJournalPageContent');
  });

  it('passes pageId to getJournalPageContent', async () => {
    const { tools, query } = makePageUpdater();
    await tools.handleUpdateQuestJournal({
      journalId: 'j1',
      pageId: 'page-123',
      newContent: 'Info.',
      updateType: 'modification',
    });
    expect(query.mock.calls[0][1]).toMatchObject({ journalId: 'j1', pageId: 'page-123' });
  });

  it('passes pageId to updateJournalContent', async () => {
    const { tools, query } = makePageUpdater();
    await tools.handleUpdateQuestJournal({
      journalId: 'j1',
      pageId: 'page-123',
      newContent: 'Info.',
      updateType: 'modification',
    });
    expect(query.mock.calls[1][1]).toMatchObject({ journalId: 'j1', pageId: 'page-123' });
  });

  it('returns success:true, verified:true, details string, and updatedContent', async () => {
    const { tools } = makePageUpdater();
    const result = await tools.handleUpdateQuestJournal({
      journalId: 'j1',
      pageId: 'page-123',
      newContent: 'New info here.',
      updateType: 'progress',
    });
    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    expect(typeof result.details).toBe('string');
    expect(typeof result.updatedContent).toBe('string');
  });
});

describe('QuestCreationTools.handleUpdateQuestJournal — no-pageId path (first page update)', () => {
  const EXISTING_CONTENT = `<section class="mcp-journal"><div class="wrap"><h1>Quest</h1><li><strong>Status:</strong> Active</li></div>\n    </section>`;
  const VERIFY_CONTENT = `<section class="mcp-journal"><div class="wrap"><h1>Quest</h1><li><strong>Status:</strong> Completed</li></div>\n    </section><h2 class="spaced">Quest Completed`;

  function makeFirstPageUpdater(
    existingContent = EXISTING_CONTENT,
    verifyContent = VERIFY_CONTENT
  ) {
    let callCount = 0;
    const queryImpl = (method: string, _data: unknown) => {
      callCount++;
      if (method === 'foundry-mcp-bridge.getJournalContent' && callCount === 1) {
        return { content: existingContent, success: true };
      }
      if (method === 'foundry-mcp-bridge.updateJournalContent') {
        return { success: true, pageId: 'p1', pageName: 'Quest' };
      }
      // verify call
      return { content: verifyContent, success: true };
    };
    return makeTools(queryImpl);
  }

  it('reads journal first with getJournalContent then updates then verifies', async () => {
    const { tools, query } = makeFirstPageUpdater();
    await tools.handleUpdateQuestJournal({
      journalId: 'j1',
      newContent: 'Quest is done!',
      updateType: 'completion',
    });
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0][0]).toBe('foundry-mcp-bridge.getJournalContent');
    expect(query.mock.calls[1][0]).toBe('foundry-mcp-bridge.updateJournalContent');
    expect(query.mock.calls[2][0]).toBe('foundry-mcp-bridge.getJournalContent');
  });

  it('update type completion adds Quest Complete marker to updated content', async () => {
    const { tools, query } = makeFirstPageUpdater();
    await tools.handleUpdateQuestJournal({
      journalId: 'j1',
      newContent: 'Quest is done!',
      updateType: 'completion',
    });
    const [, updateParams] = query.mock.calls[1] as [string, any];
    expect(updateParams.content).toContain('Quest Completed');
  });

  it('update type progress adds Progress Update marker to updated content', async () => {
    const progressContent = `${EXISTING_CONTENT}<h2 class="spaced">Progress Update`;
    const { tools, query } = makeFirstPageUpdater(EXISTING_CONTENT, progressContent);
    await tools.handleUpdateQuestJournal({
      journalId: 'j1',
      newContent: 'Made some headway.',
      updateType: 'progress',
    });
    const [, updateParams] = query.mock.calls[1] as [string, any];
    expect(updateParams.content).toContain('Progress Update');
  });

  it('update type failure adds Quest Failed marker to updated content', async () => {
    const failContent = `${EXISTING_CONTENT}<h2 class="spaced">Quest Failed`;
    const { tools, query } = makeFirstPageUpdater(EXISTING_CONTENT, failContent);
    await tools.handleUpdateQuestJournal({
      journalId: 'j1',
      newContent: 'The party failed.',
      updateType: 'failure',
    });
    const [, updateParams] = query.mock.calls[1] as [string, any];
    expect(updateParams.content).toContain('Quest Failed');
  });

  it('returns success:true, updateType, and verified:true on success', async () => {
    const { tools } = makeFirstPageUpdater();
    const result = await tools.handleUpdateQuestJournal({
      journalId: 'j1',
      newContent: 'Done!',
      updateType: 'completion',
    });
    expect(result.success).toBe(true);
    expect(result.updateType).toBe('completion');
    expect(result.verified).toBe(true);
  });

  it('strips markdown bold markers from newContent (convertMarkdownToPlainText)', async () => {
    const { tools, query, logger } = makeFirstPageUpdater();
    await tools.handleUpdateQuestJournal({
      journalId: 'j1',
      newContent: '**Bold text** and *italic* and # Heading',
      updateType: 'modification',
    });
    const [, updateParams] = query.mock.calls[1] as [string, any];
    // Markdown should have been converted
    expect(updateParams.content).not.toContain('**');
    expect(updateParams.content).not.toContain('*italic*');
    // logger.warn should be called for markdown detection
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('QuestCreationTools.handleUpdateQuestJournal — failure handling', () => {
  let consoleErr: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('throws when getJournalContent returns error (no pageId path)', async () => {
    const { tools } = makeTools(() => ({ error: 'journal not found' }));
    await expect(
      tools.handleUpdateQuestJournal({
        journalId: 'bad-id',
        newContent: 'Update.',
        updateType: 'progress',
      })
    ).rejects.toThrow();
    consoleErr.mockRestore();
  });

  it('throws when getJournalPageContent returns error (pageId path)', async () => {
    const { tools } = makeTools(() => ({ error: 'page not found' }));
    await expect(
      tools.handleUpdateQuestJournal({
        journalId: 'j1',
        pageId: 'bad-page',
        newContent: 'Update.',
        updateType: 'progress',
      })
    ).rejects.toThrow();
    consoleErr.mockRestore();
  });

  it('throws when updateJournalContent returns null', async () => {
    let callCount = 0;
    const { tools } = makeTools(() => {
      callCount++;
      if (callCount === 1)
        return { content: '<section class="mcp-journal"></div>\n    </section>', success: true };
      return null;
    });
    await expect(
      tools.handleUpdateQuestJournal({
        journalId: 'j1',
        newContent: 'Update.',
        updateType: 'progress',
      })
    ).rejects.toThrow();
    consoleErr.mockRestore();
  });

  it('throws when updateJournalContent returns error field', async () => {
    let callCount = 0;
    const { tools } = makeTools(() => {
      callCount++;
      if (callCount === 1)
        return { content: '<section class="mcp-journal"></div>\n    </section>', success: true };
      return { error: 'disk full' };
    });
    await expect(
      tools.handleUpdateQuestJournal({
        journalId: 'j1',
        newContent: 'Update.',
        updateType: 'progress',
      })
    ).rejects.toThrow();
    consoleErr.mockRestore();
  });

  it('throws when newPageName update returns success:false', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'page create failed' }));
    await expect(
      tools.handleUpdateQuestJournal({
        journalId: 'j1',
        newContent: 'Content.',
        updateType: 'progress',
        newPageName: 'New Page',
      })
    ).rejects.toThrow();
    consoleErr.mockRestore();
  });

  it('throws on missing journalId — query not called', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleUpdateQuestJournal({ newContent: 'Content.', updateType: 'progress' })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it('throws on missing newContent — query not called', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleUpdateQuestJournal({ journalId: 'j1', updateType: 'progress' })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it('throws on missing updateType — query not called', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleUpdateQuestJournal({ journalId: 'j1', newContent: 'Content.' })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it('throws on invalid updateType enum — query not called', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleUpdateQuestJournal({
        journalId: 'j1',
        newContent: 'Content.',
        updateType: 'archive',
      })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// handleListJournals
// ---------------------------------------------------------------------------

describe('QuestCreationTools.handleListJournals — page mode (journalId + pageId)', () => {
  it('dispatches getJournalPageContent with journalId and pageId', async () => {
    const pagePayload = { id: 'page-1', name: 'Quest Overview', content: '<p>Content</p>' };
    const { tools, query } = makeTools(() => pagePayload);
    await tools.handleListJournals({ journalId: 'j1', pageId: 'page-1' });
    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getJournalPageContent', {
      journalId: 'j1',
      pageId: 'page-1',
    });
  });

  it('returns mode:"page" with journalId and page data', async () => {
    const pagePayload = { id: 'page-1', name: 'Quest Overview', content: '<p>Content</p>' };
    const { tools } = makeTools(() => pagePayload);
    const result = await tools.handleListJournals({ journalId: 'j1', pageId: 'page-1' });
    expect(result.success).toBe(true);
    expect(result.mode).toBe('page');
    expect(result.journalId).toBe('j1');
    expect(result.page).toEqual(pagePayload);
  });
});

describe('QuestCreationTools.handleListJournals — journal mode (journalId only)', () => {
  it('dispatches getJournalContent with journalId', async () => {
    const journalPayload = {
      content: '<p>Quest content</p>',
      currentPage: { id: 'p1', name: 'Overview' },
      allPages: [{ id: 'p1', name: 'Overview' }],
      pageCount: 1,
    };
    const { tools, query } = makeTools(() => journalPayload);
    await tools.handleListJournals({ journalId: 'j1' });
    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getJournalContent', { journalId: 'j1' });
  });

  it('returns mode:"journal" with content, currentPage, allPages, and pageCount', async () => {
    const journalPayload = {
      content: '<p>Quest content</p>',
      currentPage: { id: 'p1', name: 'Overview' },
      allPages: [{ id: 'p1', name: 'Overview' }],
      pageCount: 1,
      note: 'Showing first text page',
    };
    const { tools } = makeTools(() => journalPayload);
    const result = await tools.handleListJournals({ journalId: 'j1' });
    expect(result.success).toBe(true);
    expect(result.mode).toBe('journal');
    expect(result.journalId).toBe('j1');
    expect(result.content).toBe('<p>Quest content</p>');
    expect(result.currentPage).toEqual({ id: 'p1', name: 'Overview' });
    expect(result.allPages).toHaveLength(1);
    expect(result.pageCount).toBe(1);
  });
});

describe('QuestCreationTools.handleListJournals — list mode (no journalId)', () => {
  const JOURNALS = [
    { id: 'j1', name: 'The Main Quest', pages: [] },
    { id: 'j2', name: 'Side Mission: Find the Key', pages: [] },
    { id: 'j3', name: 'Random Notes', pages: [] },
  ];

  it('dispatches listJournals with empty object when no journalId', async () => {
    const { tools, query } = makeTools(() => JOURNALS);
    await tools.handleListJournals({});
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.listJournals', {});
  });

  it('returns mode:"list" with journals array and total count', async () => {
    const { tools } = makeTools(() => JOURNALS);
    const result = await tools.handleListJournals({});
    expect(result.success).toBe(true);
    expect(result.mode).toBe('list');
    expect(result.journals).toHaveLength(3);
    expect(result.total).toBe(3);
    expect(result.filtered).toBe(false);
  });

  it('filters quest-related journals when filterQuests:true', async () => {
    const { tools } = makeTools(() => JOURNALS);
    const result = await tools.handleListJournals({ filterQuests: true });
    // Only journals with quest keywords: 'The Main Quest' (has 'quest'), 'Side Mission...' (no keyword), 'Random Notes' (no keyword)
    // questKeywords = ['quest', 'mission', 'task', 'adventure', 'job', 'contract']
    // 'The Main Quest' -> 'quest' -> yes
    // 'Side Mission: Find the Key' -> 'mission' -> yes
    // 'Random Notes' -> no keyword -> no
    expect(result.filtered).toBe(true);
    expect(result.total).toBe(2);
    expect(result.journals.map((j: any) => j.id)).toEqual(['j1', 'j2']);
  });

  it('includes contentPreview when includeContent:true (makes additional getJournalContent calls)', async () => {
    const { tools, query } = makeTools((method: string, _data: unknown) => {
      if (method === 'foundry-mcp-bridge.listJournals') {
        return [{ id: 'j1', name: 'The Quest', pages: [] }];
      }
      if (method === 'foundry-mcp-bridge.getJournalContent') {
        return { content: 'A '.repeat(100), success: true };
      }
      return { success: true };
    });
    const result = await tools.handleListJournals({ includeContent: true });
    // Should call listJournals + getJournalContent for each journal
    expect(query).toHaveBeenCalledTimes(2);
    expect(result.journals[0].contentPreview).toBeDefined();
    expect(result.journals[0].contentPreview).toContain('...');
  });
});

describe('QuestCreationTools.handleListJournals — failure handling', () => {
  let consoleErr: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('throws when getJournalPageContent returns error (page mode)', async () => {
    const { tools } = makeTools(() => ({ error: 'page not found' }));
    await expect(
      tools.handleListJournals({ journalId: 'j1', pageId: 'bad-page' })
    ).rejects.toThrow();
    consoleErr.mockRestore();
  });

  it('throws when getJournalContent returns error (journal mode)', async () => {
    const { tools } = makeTools(() => ({ error: 'journal not found' }));
    await expect(tools.handleListJournals({ journalId: 'bad-j' })).rejects.toThrow();
    consoleErr.mockRestore();
  });

  it('throws when listJournals returns error (list mode)', async () => {
    const { tools } = makeTools(() => ({ error: 'database error' }));
    await expect(tools.handleListJournals({})).rejects.toThrow();
    consoleErr.mockRestore();
  });

  it('throws when listJournals returns null', async () => {
    const { tools } = makeTools(() => null);
    await expect(tools.handleListJournals({})).rejects.toThrow();
    consoleErr.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// handleSearchJournals
// ---------------------------------------------------------------------------

describe('QuestCreationTools.handleSearchJournals — dispatch and result shaping', () => {
  const JOURNALS_WITH_PAGES = [
    {
      id: 'j1',
      name: 'The Dragon Quest',
      pageCount: 2,
      pages: [
        { id: 'p1', name: 'Overview', type: 'text' },
        { id: 'p2', name: 'GM Notes', type: 'text' },
      ],
    },
    {
      id: 'j2',
      name: 'Session Notes',
      pageCount: 1,
      pages: [{ id: 'p3', name: 'Notes', type: 'text' }],
    },
  ];

  function makeSearcher(pageContent = 'The party slew the dragon and found treasure.') {
    const queryImpl = (method: string, _data: any) => {
      if (method === 'foundry-mcp-bridge.listJournals') {
        return JOURNALS_WITH_PAGES;
      }
      if (method === 'foundry-mcp-bridge.getJournalPageContent') {
        return { content: pageContent, success: true };
      }
      return { success: true };
    };
    return makeTools(queryImpl);
  }

  it('dispatches listJournals first then getJournalPageContent for each text page', async () => {
    const { tools, query } = makeSearcher();
    await tools.handleSearchJournals({ searchQuery: 'dragon' });
    // 1 listJournals + 3 page content calls (p1, p2, p3)
    expect(query.mock.calls[0][0]).toBe('foundry-mcp-bridge.listJournals');
    const pageCalls = query.mock.calls.slice(1);
    expect(
      pageCalls.every(([m]: [string]) => m === 'foundry-mcp-bridge.getJournalPageContent')
    ).toBe(true);
  });

  it('returns success:true with searchQuery, searchType, results, and totalMatches', async () => {
    const { tools } = makeSearcher();
    const result = await tools.handleSearchJournals({ searchQuery: 'dragon' });
    expect(result.success).toBe(true);
    expect(result.searchQuery).toBe('dragon');
    expect(result.searchType).toBe('both'); // default
    expect(Array.isArray(result.results)).toBe(true);
    expect(typeof result.totalMatches).toBe('number');
  });

  it('matches by title when searchType is "title"', async () => {
    const { tools } = makeSearcher();
    const result = await tools.handleSearchJournals({
      searchQuery: 'Dragon',
      searchType: 'title',
    });
    // 'The Dragon Quest' matches title, 'Session Notes' does not
    expect(result.totalMatches).toBe(1);
    expect(result.results[0].id).toBe('j1');
    expect(result.results[0].matchType).toContain('title');
  });

  it('title search does not call getJournalPageContent', async () => {
    const { tools, query } = makeSearcher();
    await tools.handleSearchJournals({ searchQuery: 'dragon', searchType: 'title' });
    const pageCalls = query.mock.calls.filter(
      ([m]: [string]) => m === 'foundry-mcp-bridge.getJournalPageContent'
    );
    expect(pageCalls).toHaveLength(0);
  });

  it('matches by content when searchType is "content"', async () => {
    const { tools } = makeSearcher('The party found the ancient dragon scroll here.');
    const result = await tools.handleSearchJournals({
      searchQuery: 'ancient dragon',
      searchType: 'content',
    });
    expect(result.totalMatches).toBeGreaterThan(0);
    expect(result.results[0].matchType).toContain('content');
  });

  it('content match includes matchedPages with pageId, pageName, and contentSnippet', async () => {
    const { tools } = makeSearcher('The party found the ancient dragon scroll here.');
    const result = await tools.handleSearchJournals({
      searchQuery: 'ancient dragon',
      searchType: 'content',
    });
    expect(result.results[0].matchedPages.length).toBeGreaterThan(0);
    expect(result.results[0].matchedPages[0]).toHaveProperty('pageId');
    expect(result.results[0].matchedPages[0]).toHaveProperty('pageName');
    expect(result.results[0].matchedPages[0]).toHaveProperty('contentSnippet');
  });

  it('content snippet contains "..." prefix and suffix', async () => {
    const { tools } = makeSearcher('The party found the ancient dragon scroll here.');
    const result = await tools.handleSearchJournals({
      searchQuery: 'ancient dragon',
      searchType: 'content',
    });
    const snippet = result.results[0].matchedPages[0].contentSnippet;
    expect(snippet).toMatch(/^\.\.\./);
    expect(snippet).toMatch(/\.\.\.$/);
  });

  it('does not include non-text pages in content search', async () => {
    const journalsWithImagePage = [
      {
        id: 'j1',
        name: 'Journal',
        pageCount: 2,
        pages: [
          { id: 'p1', name: 'Image', type: 'image' },
          { id: 'p2', name: 'Text', type: 'text' },
        ],
      },
    ];
    const { tools, query } = makeTools((method: string, _data: unknown) => {
      if (method === 'foundry-mcp-bridge.listJournals') {
        return journalsWithImagePage;
      }
      if (method === 'foundry-mcp-bridge.getJournalPageContent') {
        return { content: 'text page content', success: true };
      }
      return { success: true };
    });
    await tools.handleSearchJournals({ searchQuery: 'text', searchType: 'content' });
    // Only 1 page content call for the text page, not the image page
    const pageCalls = query.mock.calls.filter(
      ([m]: [string]) => m === 'foundry-mcp-bridge.getJournalPageContent'
    );
    expect(pageCalls).toHaveLength(1);
  });

  it('both mode matches title and content — result has both matchTypes', async () => {
    const { tools } = makeSearcher('The party fought the dragon.');
    const result = await tools.handleSearchJournals({ searchQuery: 'dragon', searchType: 'both' });
    // j1 "The Dragon Quest" matches title AND content
    const j1Result = result.results.find((r: any) => r.id === 'j1');
    expect(j1Result).toBeDefined();
    expect(j1Result.matchType).toContain('title');
    expect(j1Result.matchType).toContain('content');
  });

  it('returns empty results when nothing matches', async () => {
    const { tools } = makeSearcher('no keywords here');
    const result = await tools.handleSearchJournals({ searchQuery: 'xyzzy-no-match' });
    expect(result.totalMatches).toBe(0);
    expect(result.results).toHaveLength(0);
  });

  it('search is case-insensitive', async () => {
    const { tools } = makeSearcher();
    const result = await tools.handleSearchJournals({
      searchQuery: 'DRAGON',
      searchType: 'title',
    });
    // 'The Dragon Quest' should match even with uppercase query
    expect(result.totalMatches).toBe(1);
  });
});

describe('QuestCreationTools.handleSearchJournals — failure handling', () => {
  let consoleErr: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('throws when listJournals returns error', async () => {
    const { tools } = makeTools(() => ({ error: 'database error' }));
    await expect(tools.handleSearchJournals({ searchQuery: 'dragon' })).rejects.toThrow();
    consoleErr.mockRestore();
  });

  it('throws when listJournals returns null', async () => {
    const { tools } = makeTools(() => null);
    await expect(tools.handleSearchJournals({ searchQuery: 'dragon' })).rejects.toThrow();
    consoleErr.mockRestore();
  });

  it('throws on missing searchQuery — query not called', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleSearchJournals({})).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it('throws on empty searchQuery string — query not called', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleSearchJournals({ searchQuery: '' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it('throws on invalid searchType enum — query not called', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleSearchJournals({ searchQuery: 'dragon', searchType: 'everywhere' })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it('skips pages that error during content fetch (no throw)', async () => {
    const { tools } = makeTools((method: string, _data: unknown) => {
      if (method === 'foundry-mcp-bridge.listJournals') {
        return [
          {
            id: 'j1',
            name: 'Journal',
            pageCount: 1,
            pages: [{ id: 'p1', name: 'Page', type: 'text' }],
          },
        ];
      }
      if (method === 'foundry-mcp-bridge.getJournalPageContent') {
        throw new Error('page read error');
      }
      return { success: true };
    });
    // Should not throw — bad page is silently skipped
    const result = await tools.handleSearchJournals({ searchQuery: 'anything' });
    expect(result.success).toBe(true);
    expect(result.totalMatches).toBe(0);
    consoleErr.mockRestore();
  });
});
