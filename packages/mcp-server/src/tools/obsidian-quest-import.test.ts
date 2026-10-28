import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ObsidianQuestImportTools,
  QUEST_IMPORT_FEATURE,
  stableQuestId,
} from './obsidian-quest-import.js';
import { rmTmp } from '../test-support/rm-tmp.js';

const logger = { child: () => logger, warn: vi.fn(), info: vi.fn(), error: vi.fn() } as never;
const NOTE = '---\ntype: quest-prep\nfvtt_uuid:\nsecret: CANARY\n---\nFind the Sunsword.\n';
let vaultDir: string;

function tools(dir: string | null): {
  instance: ObsidianQuestImportTools;
  createPlan: ReturnType<typeof vi.fn>;
} {
  const createPlan = vi.fn(async (input: unknown): Promise<unknown> => ({ planId: 'p1', input }));
  const instance = new ObsidianQuestImportTools({
    vaultDir: dir,
    worldIds: { current: async (): Promise<string> => 'w1' },
    guardedWrites: { createPlan } as never,
    logger,
  });
  return { instance, createPlan };
}

beforeEach(async () => {
  vaultDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'quest-tool-'));
  const full = path.join(vaultDir, 'Campaigns/w1/Prep/Quests/Sunsword.md');
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, NOTE, 'utf8');
});

afterEach(async () => {
  await rmTmp(vaultDir);
});

describe('plan-obsidian-quest-import', () => {
  it('plans one GM-only journal create under the obsidian-import feature, with a stable id', async () => {
    const { instance, createPlan } = tools(vaultDir);
    await instance.handlePlanObsidianQuestImport({
      notePath: 'Campaigns/w1/Prep/Quests/Sunsword.md',
    });
    const input = createPlan.mock.calls[0]?.[0] as {
      feature: string;
      ops: Array<{ kind: string; documentName: string; data: Record<string, unknown> }>;
    };
    expect(input.feature).toBe(QUEST_IMPORT_FEATURE);
    expect(input.ops).toHaveLength(1);
    const op = input.ops[0];
    expect(op?.kind).toBe('create');
    expect(op?.documentName).toBe('JournalEntry');
    expect(op?.data.ownership).toEqual({ default: 0 });
    // Planning writes nothing to Foundry: no folder is made or referenced.
    expect(op?.data).not.toHaveProperty('folder');
    expect(op?.data._id).toBe(
      stableQuestId('obsidian-quest:w1:campaigns/w1/prep/quests/sunsword.md')
    );
    expect(JSON.stringify(input)).not.toContain('CANARY');
  });

  it('refuses without a vault dir, a bad path and extra arguments', async () => {
    await expect(
      tools(null).instance.handlePlanObsidianQuestImport({ notePath: 'Campaigns/w1/Prep/a.md' })
    ).rejects.toThrow(/FOUNDRY_AI_OBSIDIAN_DIR/);
    const { instance, createPlan } = tools(vaultDir);
    await expect(
      instance.handlePlanObsidianQuestImport({ notePath: 'Campaigns/w1/AI Tool/a.md' })
    ).rejects.toThrow(/Only notes under/);
    await expect(
      instance.handlePlanObsidianQuestImport({ notePath: 'x.md', extra: 1 })
    ).rejects.toThrow();
    expect(createPlan).not.toHaveBeenCalled();
  });
});
