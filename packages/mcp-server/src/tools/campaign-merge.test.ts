import { describe, expect, it, vi } from 'vitest';

import { journalId } from '../campaign/model.js';
import { makeLogger } from '../test-support/make-tool-harness.js';
import type { AuditEntry } from '../vault/audit.js';
import { CampaignMergeTools } from './campaign-merge.js';

type Guard = (worldId: string, entry: AuditEntry) => Promise<string | null>;

function toolsWith(options: { enabled: boolean; pages?: Array<{ id: string; name: string }> }): {
  tools: CampaignMergeTools;
  query: ReturnType<typeof vi.fn>;
  createPlan: ReturnType<typeof vi.fn>;
  guard: () => Guard;
} {
  const query = vi.fn(async (method: string) => {
    if (method === 'foundry-mcp-bridge.listGuardedFeatures') {
      return [{ id: 'campaign-merge', enabled: options.enabled }];
    }
    if (method === 'foundry-mcp-bridge.getJournalContent') {
      if (!options.pages) throw new Error('journal not found');
      return { allPages: options.pages };
    }
    if (method === 'foundry-mcp-bridge.ensureJournalFolder') {
      return { folderId: 'FOLDER' };
    }
    throw new Error(`unexpected query ${method}`);
  });
  const createPlan = vi.fn(async () => ({
    planId: 'p1',
    risk: 'write',
    feature: 'campaign-merge',
  }));
  let guard: Guard | undefined;
  const logger = makeLogger();
  const tools = new CampaignMergeTools({
    foundryClient: { query } as never,
    guardedWrites: {
      createPlan,
      autoApplyEnabled: async () => false,
      setUndoGuard: (_feature: string, g: Guard) => {
        guard = g;
      },
    } as never,
    logger: logger as never,
  });
  return { tools, query, createPlan, guard: () => guard! };
}

describe('plan-campaign-merge tool', () => {
  it('refuses markSeen together with entries (it would overwrite what they change)', async () => {
    const { tools } = toolsWith({ enabled: true });
    await expect(
      tools.handlePlanCampaignMerge({ markSeen: true, entries: [{ kind: 'npcs', name: 'Aldo' }] })
    ).rejects.toThrow(/markSeen runs on its own/);
  });

  it('makes no folder while the campaign switch is off', async () => {
    const { tools, query } = toolsWith({ enabled: false });
    await expect(tools.handlePlanCampaignMerge({ setup: true })).rejects.toThrow(/switched off/);
    expect(query).not.toHaveBeenCalledWith(
      'foundry-mcp-bridge.ensureJournalFolder',
      expect.anything()
    );
  });

  it('refuses to undo a journal create while the journal holds pages that change did not make', async () => {
    const jid = `JournalEntry.${journalId('npcs')}`;
    const { guard } = toolsWith({
      enabled: true,
      pages: [
        { id: 'MADE', name: 'Aldo' },
        { id: 'LATER', name: 'Bram' },
      ],
    });
    const entry = {
      mode: 'apply',
      results: [{ uuid: jid }, { uuid: `${jid}.JournalEntryPage.MADE` }],
    } as unknown as AuditEntry;
    expect(await guard()('w', entry)).toMatch(/Bram/);
    const same = toolsWith({ enabled: true, pages: [{ id: 'MADE', name: 'Aldo' }] });
    expect(await same.guard()('w', entry)).toBeNull();
  });
});
