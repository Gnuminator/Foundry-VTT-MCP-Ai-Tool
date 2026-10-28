/**
 * The quest import plan through the real guarded-write service against FakeFoundry: plan, apply,
 * a second plan refused, undo, plan again (the review's M1 on #581).
 */
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GuardedWriteService } from '../guarded-write/service.js';
import { FakeFoundry } from '../test-support/fake-foundry.js';
import { rmTmp } from '../test-support/rm-tmp.js';
import { AuditLog } from '../vault/audit.js';
import { VaultStore } from '../vault/store.js';
import { ObsidianQuestImportTools, QUEST_IMPORT_FEATURE } from './obsidian-quest-import.js';

const WORLD = 'w1';
const NOTE_PATH = 'Campaigns/w1/Prep/Quests/Sunsword.md';
let dataDir: string;
let vaultDir: string;
let foundry: FakeFoundry;
let guarded: GuardedWriteService;
let tools: ObsidianQuestImportTools;

function setSwitch(enabled: boolean): void {
  foundry.features = [
    {
      id: QUEST_IMPORT_FEATURE,
      name: 'AI Tool: Obsidian import (writes)',
      hint: '',
      enabled,
      writesAllowed: true,
    },
    {
      id: 'change-undo',
      name: 'AI Tool: Undo for everything',
      hint: '',
      enabled: true,
      writesAllowed: true,
    },
  ];
}

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'quest-svc-data-'));
  vaultDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'quest-svc-vault-'));
  const full = path.join(vaultDir, NOTE_PATH);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(
    full,
    '---\ntype: quest-prep\nfvtt_uuid:\nstakes: The village starves\n---\nFind the Sunsword.\n',
    'utf8'
  );
  foundry = new FakeFoundry();
  foundry.worldId = WORLD;
  setSwitch(true);
  const logger: any = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  logger.child = (): unknown => logger;
  const store = new VaultStore({ dataDir });
  const worldIds = { current: (): Promise<string> => Promise.resolve(WORLD) };
  guarded = new GuardedWriteService({
    foundryClient: foundry,
    worldIds,
    store,
    audit: new AuditLog(store),
    logger,
  });
  tools = new ObsidianQuestImportTools({
    vaultDir,
    worldIds,
    guardedWrites: guarded,
    logger,
  });
});

afterEach(async () => {
  await rmTmp(dataDir);
  await rmTmp(vaultDir);
});

describe('plan-obsidian-quest-import with the real guarded-write service', () => {
  it('writes nothing while planning, creates one GM-only journal on apply, refuses a second plan, undoes', async () => {
    const plan = await tools.handlePlanObsidianQuestImport({ notePath: NOTE_PATH });
    expect(foundry.docs.size).toBe(0);
    expect(foundry.calls.map(([method]) => method)).not.toContain(
      'foundry-mcp-bridge.ensureJournalFolder'
    );

    const applied = await guarded.applyPlan(plan.planId, { confirm: true });
    expect(applied.changeId).toBeTruthy();
    const journals = [...foundry.docs.values()].filter(d => d.documentName === 'JournalEntry');
    expect(journals).toHaveLength(1);
    expect(journals[0]?.source.name).toBe('Sunsword');
    expect(journals[0]?.source.ownership).toEqual({ default: 0 });

    await expect(tools.handlePlanObsidianQuestImport({ notePath: NOTE_PATH })).rejects.toThrow(
      /already exists/
    );

    await guarded.undo(applied.changeId, { confirm: true });
    expect([...foundry.docs.values()].filter(d => d.documentName === 'JournalEntry')).toHaveLength(
      0
    );
    // After an undo the same note can be imported again.
    await expect(
      tools.handlePlanObsidianQuestImport({ notePath: NOTE_PATH })
    ).resolves.toHaveProperty('planId');
  });

  it('refuses to apply a plan while the switch is off', async () => {
    const plan = await tools.handlePlanObsidianQuestImport({ notePath: NOTE_PATH });
    setSwitch(false);
    await expect(guarded.applyPlan(plan.planId, { confirm: true })).rejects.toThrow(/switched off/);
    expect(foundry.docs.size).toBe(0);
  });
});
