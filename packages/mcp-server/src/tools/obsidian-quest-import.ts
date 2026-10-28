/**
 * `plan-obsidian-quest-import` (O6, D-094 lane; docs/design/OBSIDIAN-PLAN.md section 10). This is
 * NOT an MCP tool: it has no definition and is in no tool set (the sets are at their size
 * budgets), so Claude cannot call it. Only the dashboard's GM proxy reaches it, through the
 * dashboard-only route added in `backend.ts`, for the Obsidian plugin's "Import this quest prep note". Plan a
 * GM-only quest journal in Foundry from one quest prep note in the GM's Obsidian vault. A guarded
 * plan under the `obsidian-import` feature (module switch "AI Tool: Obsidian import (writes)",
 * off by default): nothing changes until the GM confirms with `apply-planned-change`, and
 * `undo-change` removes the journal again. Foundry never reads Obsidian by itself and the journal
 * is GM-only: handing the quest out stays the existing reveal flow. The note's text goes into the
 * plan the GM sees; it is the GM's own text, never player-facing here.
 */
import { createHash } from 'node:crypto';

import { type GuardedOp, MODULE_ID, unwrapBridgeReply } from '@gnuminator/shared';
import { z } from 'zod';

import type { FoundryClient } from '../foundry-client.js';
import type { GuardedWriteService, PlanView } from '../guarded-write/service.js';
import type { Logger } from '../logger.js';
import { readQuestNote } from '../obsidian/quest-import.js';
import type { WorldIdResolver } from '../vault/world-id.js';

export const QUEST_IMPORT_FEATURE = 'obsidian-import';
/** The journal folder the imported quests go into. */
export const QUEST_IMPORT_FOLDER = 'Obsidian import';

const HTML_FORMAT = 1;
const NONE = 0;

export interface ObsidianQuestImportToolsOptions {
  /** `FOUNDRY_AI_OBSIDIAN_DIR`, or null when unset (then the tool refuses). */
  vaultDir: string | null;
  worldIds: Pick<WorldIdResolver, 'current'>;
  guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  foundry: Pick<FoundryClient, 'query'>;
  logger: Logger;
}

const planParams = z.object({ notePath: z.string().min(1).max(400) }).strict();

/** A Foundry document id (16 letters and digits) that is the same for the same seed. */
export function stableQuestId(seed: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const digest = createHash('sha256').update(seed).digest();
  let id = '';
  for (let i = 0; i < 16; i++) id += alphabet[(digest[i] ?? 0) % alphabet.length];
  return id;
}

export class ObsidianQuestImportTools {
  private readonly options: ObsidianQuestImportToolsOptions;
  private readonly logger: Logger;

  constructor(options: ObsidianQuestImportToolsOptions) {
    this.options = options;
    this.logger = options.logger.child({ component: 'ObsidianQuestImportTools' });
  }

  async handlePlanObsidianQuestImport(args: unknown): Promise<PlanView> {
    const { notePath } = planParams.parse(args ?? {});
    if (!this.options.vaultDir) {
      throw new Error(
        'FOUNDRY_AI_OBSIDIAN_DIR is not set on the backend, so there is no vault to import from.'
      );
    }
    try {
      const worldId = await this.options.worldIds.current();
      const note = await readQuestNote(this.options.vaultDir, worldId, notePath);
      const folder = unwrapBridgeReply(
        await this.options.foundry.query('foundry-mcp-bridge.ensureJournalFolder', {
          name: QUEST_IMPORT_FOLDER,
        }),
        'Journal folder refused'
      );
      if (typeof folder?.folderId !== 'string') {
        throw new Error(`Foundry did not give the "${QUEST_IMPORT_FOLDER}" folder`);
      }
      // The id comes from the note's path, so a second import of the same note meets the first
      // journal (an "id already exists" refusal when applying) instead of making a copy.
      const entryId = stableQuestId(`obsidian-quest:${worldId}:${note.notePath.toLowerCase()}`);
      const pageId = stableQuestId(`obsidian-quest-page:${worldId}:${note.notePath.toLowerCase()}`);
      const op: GuardedOp = {
        kind: 'create',
        documentName: 'JournalEntry',
        keepId: true,
        data: {
          _id: entryId,
          name: note.title,
          folder: folder.folderId,
          ownership: { default: NONE },
          flags: { [MODULE_ID]: { obsidianImport: true, notePath: note.notePath } },
          pages: [
            {
              _id: pageId,
              name: 'Quest Details',
              type: 'text',
              sort: 100_000,
              text: { content: note.html, format: HTML_FORMAT },
            },
          ],
        },
      };
      return await this.options.guardedWrites.createPlan({
        feature: QUEST_IMPORT_FEATURE,
        summary: `Create the GM-only quest journal "${note.title}" in "${QUEST_IMPORT_FOLDER}" from the Obsidian note ${note.notePath}`,
        ops: [op],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('Obsidian quest import plan not created', { error: message });
      throw error;
    }
  }
}
