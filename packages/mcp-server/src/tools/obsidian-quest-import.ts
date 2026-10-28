/**
 * `plan-obsidian-quest-import` (O6, D-094 lane; docs/design/OBSIDIAN-PLAN.md section 10). Not
 * listed to Claude: it has no tool definition and is in no tool set (the sets are at their size
 * budgets). The dashboard's GM proxy calls it through the route added in `backend.ts`, for the
 * Obsidian plugin's "Import this quest prep note". It is not walled off from a client that sends
 * the name to the backend, so it must stay harmless on its own: planning writes nothing to Foundry
 * (no folder is made), and applying needs the GM's confirm and the module switch.
 *
 * Plans a GM-only quest journal from one quest prep note in the GM's Obsidian vault, under the
 * `obsidian-import` feature (module switch "AI Tool: Obsidian import (writes)", off by default).
 * `undo-change` removes the journal again. The journal is GM-only: handing the quest out stays the
 * existing reveal flow. The plan the GM sees names the title and the note path, not the text.
 */
import { createHash } from 'node:crypto';

import { type GuardedOp, MODULE_ID } from '@gnuminator/shared';
import { z } from 'zod';

import type { GuardedWriteService, PlanView } from '../guarded-write/service.js';
import type { Logger } from '../logger.js';
import { readQuestNote } from '../obsidian/quest-import.js';
import type { WorldIdResolver } from '../vault/world-id.js';

export const QUEST_IMPORT_FEATURE = 'obsidian-import';

const HTML_FORMAT = 1;
const NONE = 0;

export interface ObsidianQuestImportToolsOptions {
  /** `FOUNDRY_AI_OBSIDIAN_DIR`, or null when unset (then the tool refuses). */
  vaultDir: string | null;
  worldIds: Pick<WorldIdResolver, 'current'>;
  guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
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
      // The id comes from the note's path, so a second import of the same note meets the first
      // journal (an "id already exists" refusal) instead of making a copy.
      const seed = `${worldId}:${note.notePath.toLowerCase()}`;
      const op: GuardedOp = {
        kind: 'create',
        documentName: 'JournalEntry',
        keepId: true,
        data: {
          _id: stableQuestId(`obsidian-quest:${seed}`),
          name: note.title,
          ownership: { default: NONE },
          flags: { [MODULE_ID]: { obsidianImport: true, notePath: note.notePath } },
          pages: [
            {
              _id: stableQuestId(`obsidian-quest-page:${seed}`),
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
        summary: `Create the GM-only quest journal "${note.title}" from the Obsidian note ${note.notePath}. Undo removes it. To import it again, undo it or delete the journal first.`,
        ops: [op],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('Obsidian quest import plan not created', { error: message });
      throw error;
    }
  }
}
