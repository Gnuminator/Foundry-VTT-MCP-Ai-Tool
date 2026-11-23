/**
 * `plan-character-diaries` (I-183 route B): the tool plans one journal per player character,
 * visible only to its owner (default access none); the plan applies and undoes as one change.
 */
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GuardedWriteService } from '../guarded-write/service.js';
import { FakeFoundry } from '../test-support/fake-foundry.js';
import { makeLogger } from '../test-support/stub-tool-deps.js';
import { AuditLog } from '../vault/audit.js';
import { VaultStore } from '../vault/store.js';
import { CharacterDiaryTools } from './character-diaries.js';

let dataDir: string;
let foundry: FakeFoundry;
let service: GuardedWriteService;
let tools: CharacterDiaryTools;
let secretMatches: Array<{ term: string; category: string }>;
let seenInputs: Array<{ ops?: unknown[] }>;

const entry = (id: string, name: string, owners: Array<[string, string, number]>): unknown => ({
  id,
  name,
  type: 'character',
  ownership: owners.map(([userId, userName, numericPermission]) => ({
    userId,
    userName,
    numericPermission,
  })),
});

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'char-diary-'));
  foundry = new FakeFoundry();
  foundry.features = [
    { id: 'character-diary', name: 'Diaries', hint: '', enabled: true, writesAllowed: true },
  ];
  foundry.handlers['foundry-mcp-bridge.getActorOwnership'] = (): unknown => [
    entry('ebbe1', 'Ebbe', [
      ['userEbbe', 'Player A', 3],
      ['userOther', 'Player B', 1],
    ]),
    entry('mira1', 'Mira', [['userMira', 'Player B', 3]]),
    entry('twin1', 'Twin', [['userEbbe', 'Player A', 3]]),
    entry('twin2', 'Twin', [['userMira', 'Player B', 3]]),
    entry('shared', 'Shared', [
      ['userEbbe', 'Player A', 3],
      ['userMira', 'Player B', 3],
    ]),
    entry('orphan', 'Orphan', [['userEbbe', 'Player A', 1]]),
    { id: 'npc1', name: 'Goblin', type: 'npc', ownership: [] },
  ];
  const store = new VaultStore({ dataDir });
  const worldIds = {
    current: async (): Promise<string> =>
      (await foundry.query('foundry-mcp-bridge.getWorldInfo')).id,
  };
  service = new GuardedWriteService({
    foundryClient: foundry,
    worldIds,
    store,
    audit: new AuditLog(store),
    logger: makeLogger(),
  });
  secretMatches = [];
  seenInputs = [];
  tools = new CharacterDiaryTools({
    foundryClient: foundry,
    guardedWrites: {
      createPlan: async (
        input: Parameters<GuardedWriteService['createPlan']>[0]
      ): ReturnType<GuardedWriteService['createPlan']> => {
        seenInputs.push(input);
        return await service.createPlan(input);
      },
    },
    secretTerms: {
      findSecretTerms: (): Promise<{ matches: Array<{ term: string; category: string }> }> =>
        Promise.resolve({ matches: secretMatches }),
    },
    worldIds,
    logger: makeLogger(),
  });
});

afterEach(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true });
});

describe('plan-character-diaries', () => {
  it('plans one private journal per character, owner OWNER and everyone else none', async () => {
    const plan = await tools.handleToolCall('plan-character-diaries', {
      diaries: [
        { actor: 'Ebbe', text: 'Dear diary.\n\nToday <b>we</b> hit twice.' },
        { actor: 'mira1', text: 'Mira writes.' },
      ],
      session: 'Session 0',
    });
    expect((plan as any).drafts).toEqual([
      { actor: 'Ebbe', visibleTo: ['Player A'], words: 6 },
      { actor: 'Mira', visibleTo: ['Player B'], words: 2 },
    ]);
    const ops = (seenInputs[0]?.ops ?? []) as any[];
    expect(ops).toHaveLength(2);
    expect(ops[0].data.name).toBe('Diary: Ebbe (Session 0)');
    expect(ops[0].data.ownership).toEqual({ default: 0, userEbbe: 3 });
    expect(ops[0].data.pages[0].text.content).toBe(
      '<p>Dear diary.</p><p>Today &lt;b&gt;we&lt;/b&gt; hit twice.</p>'
    );
    expect(ops[1].data.ownership).toEqual({ default: 0, userMira: 3 });
  });

  it('applies and undoes as one change', async () => {
    const plan = await tools.handleToolCall('plan-character-diaries', {
      diaries: [{ actor: 'Ebbe', text: 'Hello.' }],
    });
    const applied = await service.applyPlan(plan.planId, { confirm: true });
    const created = [...foundry.docs.keys()].filter(k => /^JournalEntry\.[^.]+$/.test(k));
    expect(created).toHaveLength(1);
    await service.undo(applied.changeId, { confirm: true });
    expect([...foundry.docs.keys()].filter(k => /^JournalEntry\.[^.]+$/.test(k))).toHaveLength(0);
  });

  it('refuses text that names a secret term and plans nothing', async () => {
    secretMatches = [{ term: 'Strahd', category: 'villain' }];
    await expect(
      tools.handleToolCall('plan-character-diaries', {
        diaries: [{ actor: 'Ebbe', text: 'Strahd waits.' }],
      })
    ).rejects.toThrow(/Strahd/);
  });

  it('refuses unknown characters, NPCs, duplicates and characters with no player owner', async () => {
    await expect(
      tools.handleToolCall('plan-character-diaries', {
        diaries: [
          { actor: 'Goblin', text: 'x' },
          { actor: 'Ebbe', text: 'x' },
          { actor: 'ebbe', text: 'y' },
          { actor: 'Orphan', text: 'z' },
        ],
      })
    ).rejects.toThrow(
      /"Goblin" is not a character.*Ebbe appears twice.*Orphan has no player owner/
    );
  });

  it('refuses an ambiguous name and a character with several owners', async () => {
    await expect(
      tools.handleToolCall('plan-character-diaries', {
        diaries: [
          { actor: 'Twin', text: 'x' },
          { actor: 'Shared', text: 'y' },
        ],
      })
    ).rejects.toThrow(/"Twin" matches 2 characters.*Shared has 2 owners/);
    const ok = await tools.handleToolCall('plan-character-diaries', {
      diaries: [{ actor: 'twin2', text: 'x' }],
    });
    expect((ok as any).drafts[0].visibleTo).toEqual(['Player B']);
  });

  it('says plainly that the switch is off', async () => {
    foundry.features = [
      { id: 'character-diary', name: 'Diaries', hint: '', enabled: false, writesAllowed: true },
    ];
    await expect(
      tools.handleToolCall('plan-character-diaries', { diaries: [{ actor: 'Ebbe', text: 'x' }] })
    ).rejects.toThrow(/Character diaries/);
  });

  it('has a strict schema and rejects unknown keys', async () => {
    const [def] = tools.getToolDefinitions();
    expect((def?.inputSchema as any).additionalProperties).toBe(false);
    await expect(
      tools.handleToolCall('plan-character-diaries', {
        diaries: [{ actor: 'Ebbe', text: 'x' }],
        ownership: 'all',
      })
    ).rejects.toThrow();
  });
});
