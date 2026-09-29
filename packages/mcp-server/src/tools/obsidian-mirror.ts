/**
 * Obsidian mirror tools (docs/design/OBSIDIAN-O4-DESIGN.md sections 1.8 and 9; chunk C6).
 *
 * `get-obsidian-mirror` reads the mirror's settings and status. The settings
 * live in the bridge vault (`gm/obsidian-mirror.json`) and change only through
 * `plan-obsidian-mirror`, a vault-only guarded plan under the `obsidian-mirror`
 * feature: the GM confirms it with `apply-planned-change` (which needs the
 * module's "AI Tool: Obsidian mirror (writes)" switch on) and can undo it.
 * Nothing here ever reads or writes page text; a plan summary names ids and
 * counts only.
 */
import { toolRef } from '@gnuminator/shared';
import { z } from 'zod';

import type { GuardedWriteService, PlanView, VaultOp } from '../guarded-write/service.js';
import type { Logger } from '../logger.js';
import { MIRROR_KINDS, type MirrorSettings, type MirrorStatus } from '../obsidian/mirror-common.js';
import {
  DEFAULT_OPEN_BASE,
  DEFAULT_POLL_MS,
  DOCUMENT_ID,
  ITEM_TYPE,
  MAX_IDS,
  MAX_ITEM_TYPES,
  MIRROR_FEATURE,
  MIRROR_SETTINGS_FILE,
  normalizeMirrorSettings,
  readMirrorSettings,
} from '../obsidian/mirror-settings.js';
import type { VaultStore } from '../vault/store.js';
import type { WorldIdResolver } from '../vault/world-id.js';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** What the backend knows from its environment, fixed at start. */
export interface ObsidianMirrorEnv {
  /** `FOUNDRY_AI_OBSIDIAN_DIR` is set: without it the mirror writes nothing. */
  vaultDirSet: boolean;
  /** Validated `FOUNDRY_AI_OPEN_BASE` origin. */
  openBase: string;
  /** `FOUNDRY_AI_MIRROR_POLL_MS`. */
  pollMs: number;
}

export interface ObsidianMirrorToolsOptions {
  store: VaultStore;
  worldIds: Pick<WorldIdResolver, 'current'>;
  guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  /** The pump's current status, or null while no pump runs. */
  status: () => MirrorStatus | null;
  env?: ObsidianMirrorEnv;
  logger: Logger;
}

export interface ObsidianMirrorView extends ObsidianMirrorEnv {
  settings: MirrorSettings;
  /** Changes whenever the settings do; the pump reconciles on a change. */
  hash: string;
  status: MirrorStatus | null;
}

const DEFAULT_ENV: ObsidianMirrorEnv = {
  vaultDirSet: false,
  openBase: DEFAULT_OPEN_BASE,
  pollMs: DEFAULT_POLL_MS,
};

/** A list of ids or names for a plan summary: the first few, then a count. */
function listValues(values: readonly string[]): string {
  if (values.length === 0) return 'none';
  const shown = values.slice(0, 5).join(', ');
  return values.length > 5 ? `${shown} and ${values.length - 5} more` : shown;
}

/** What changes in one list setting, or null when it stays as it is. */
function describeListChange(
  label: string,
  before: readonly string[],
  after: readonly string[]
): string | null {
  const wasThere = new Set(before);
  const isThere = new Set(after);
  const added = after.filter(value => !wasThere.has(value));
  const removed = before.filter(value => !isThere.has(value));
  if (added.length === 0 && removed.length === 0) {
    return before.join('\n') === after.join('\n') ? null : `${label}: reordered`;
  }
  const parts: string[] = [];
  if (added.length > 0) parts.push(`add ${listValues(added)}`);
  if (removed.length > 0) parts.push(`remove ${listValues(removed)}`);
  return `${label}: ${parts.join(' and ')} (now ${after.length})`;
}

/** The readable summary of a settings change: names what changes, never page text. */
function describeChange(before: MirrorSettings, after: MirrorSettings): string {
  const changes: string[] = [];
  if (before.enabled !== after.enabled) {
    changes.push(after.enabled ? 'switch the mirror ON' : 'switch the mirror OFF');
  }
  if (before.kinds.join(',') !== after.kinds.join(',')) {
    changes.push(`mirrored kinds: ${listValues(after.kinds)} (was ${listValues(before.kinds)})`);
  }
  const optional = [
    describeListChange('page text folders', before.text.folderIds, after.text.folderIds),
    describeListChange('page text journals', before.text.journalIds, after.text.journalIds),
    describeListChange('excluded folders', before.excludeFolderIds, after.excludeFolderIds),
    describeListChange('story item types', before.storyItemTypes, after.storyItemTypes),
  ];
  for (const change of optional) if (change !== null) changes.push(change);
  return `Obsidian mirror settings: ${changes.join('; ')}`;
}

function sameSettings(a: MirrorSettings, b: MirrorSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const documentIds = (what: string): z.ZodOptional<z.ZodArray<z.ZodString>> =>
  z
    .array(z.string().regex(DOCUMENT_ID, `${what} must be 16-character Foundry ids`))
    .max(MAX_IDS)
    .optional();

const planParams = z
  .object({
    enabled: z.boolean().optional(),
    kinds: z
      .array(
        z.string().refine(kind => (MIRROR_KINDS as readonly string[]).includes(kind), {
          message: `kinds must be from: ${MIRROR_KINDS.join(', ')}`,
        })
      )
      .max(MIRROR_KINDS.length)
      .optional(),
    textFolderIds: documentIds('textFolderIds'),
    textJournalIds: documentIds('textJournalIds'),
    excludeFolderIds: documentIds('excludeFolderIds'),
    storyItemTypes: z
      .array(
        z
          .string()
          .regex(ITEM_TYPE, 'storyItemTypes must be item type keys such as "weapon" or "loot"')
      )
      .max(MAX_ITEM_TYPES)
      .optional(),
  })
  .strict();

/**
 * The Obsidian mirror's tools. `get-obsidian-mirror` is read-only;
 * `plan-obsidian-mirror` only creates a plan (nothing changes until
 * `apply-planned-change`).
 */
export class ObsidianMirrorTools {
  private readonly store: VaultStore;
  private readonly worldIds: ObsidianMirrorToolsOptions['worldIds'];
  private readonly guardedWrites: ObsidianMirrorToolsOptions['guardedWrites'];
  private readonly status: ObsidianMirrorToolsOptions['status'];
  private readonly env: ObsidianMirrorEnv;
  private readonly logger: Logger;

  constructor(options: ObsidianMirrorToolsOptions) {
    this.store = options.store;
    this.worldIds = options.worldIds;
    this.guardedWrites = options.guardedWrites;
    this.status = options.status;
    this.env = options.env ?? DEFAULT_ENV;
    this.logger = options.logger.child({ component: 'ObsidianMirrorTools' });
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'get-obsidian-mirror',
        description:
          'GM ONLY. The Obsidian mirror\'s settings (enabled, mirrored kinds, journals whose page text is mirrored, excluded folders, story item types), their hash, the backend environment (whether FOUNDRY_AI_OBSIDIAN_DIR is set, the "Open in Foundry" base FOUNDRY_AI_OPEN_BASE, the poll interval) and the mirror\'s live status (last cycle, note counts per type, notes it skipped because the GM edited them, errors). The mirror writes notes only when FOUNDRY_AI_OBSIDIAN_DIR is set AND settings.enabled is true. Settings change only through plan-obsidian-mirror. Read-only.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'plan-obsidian-mirror',
        description:
          'Plan a change to the Obsidian mirror\'s settings; nothing changes until apply-planned-change (the GM confirms, and the module\'s "AI Tool: Obsidian mirror (writes)" switch must be on). Every argument is optional and a missing one keeps its current value. "enabled" turns the mirror on or off (it also needs FOUNDRY_AI_OBSIDIAN_DIR); "kinds" picks what is mirrored; "textFolderIds" and "textJournalIds" name the journals whose page text is mirrored (default: none, page text stays in Foundry); "excludeFolderIds" are folders that are never mirrored, subfolders included; "storyItemTypes" are the item types that count as story items. Refused when nothing would change. The summary names ids and counts, never page text. Returns a planId for apply-planned-change; undo-change restores the previous settings.',
        inputSchema: {
          type: 'object',
          properties: {
            enabled: {
              type: 'boolean',
              description:
                'True starts the mirror (needs FOUNDRY_AI_OBSIDIAN_DIR), false stops it. Notes already written stay in the vault.',
            },
            kinds: {
              type: 'array',
              items: { type: 'string', enum: [...MIRROR_KINDS] },
              description:
                'Which kinds get notes: pc (player characters), npc, scene, journal, item (story items). The full list replaces the current one; an empty list mirrors nothing.',
            },
            textFolderIds: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Journal folders whose page text is mirrored (the full list replaces the current one; subfolders included). The page text is copied into the Obsidian vault of the GM.',
              ...toolRef('folder', 'id', { filter: { documentName: 'JournalEntry' } }),
            },
            textJournalIds: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Journals whose page text is mirrored (the full list replaces the current one).',
              ...toolRef('journal', 'id'),
            },
            excludeFolderIds: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Folders (any document type) whose contents are never mirrored, subfolders included. The full list replaces the current one.',
              ...toolRef('folder', 'id'),
            },
            storyItemTypes: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Item types that get a story-item note when the item is in the mirrored set (for example weapon, equipment, consumable, tool, loot, container). The full list replaces the current one.',
            },
          },
        },
      },
    ];
  }

  async handleGetObsidianMirror(_args: unknown): Promise<ObsidianMirrorView> {
    const worldId = await this.worldIds.current();
    const { settings, hash } = await readMirrorSettings(this.store, worldId);
    return {
      settings,
      hash,
      vaultDirSet: this.env.vaultDirSet,
      openBase: this.env.openBase,
      pollMs: this.env.pollMs,
      status: this.status(),
    };
  }

  async handlePlanObsidianMirror(args: unknown): Promise<PlanView & { warnings?: string[] }> {
    const params = planParams.parse(args ?? {});
    try {
      const worldId = await this.worldIds.current();
      const { settings: current } = await readMirrorSettings(this.store, worldId);
      const next = normalizeMirrorSettings({
        enabled: params.enabled ?? current.enabled,
        kinds: params.kinds ?? current.kinds,
        text: {
          folderIds: params.textFolderIds ?? current.text.folderIds,
          journalIds: params.textJournalIds ?? current.text.journalIds,
        },
        excludeFolderIds: params.excludeFolderIds ?? current.excludeFolderIds,
        storyItemTypes: params.storyItemTypes ?? current.storyItemTypes,
      });
      if (sameSettings(current, next)) {
        throw new Error(
          'Nothing to change: the mirror settings already have these values (or the arguments are empty)'
        );
      }
      const vaultOps: VaultOp[] = [
        { kind: 'vault-set', file: MIRROR_SETTINGS_FILE, path: 'settings', value: next },
      ];
      const plan = await this.guardedWrites.createPlan({
        feature: MIRROR_FEATURE,
        summary: describeChange(current, next),
        vaultOps,
      });
      const warnings: string[] = [];
      if (next.enabled && !this.env.vaultDirSet) {
        warnings.push(
          'FOUNDRY_AI_OBSIDIAN_DIR is not set on the backend, so the mirror writes nothing until it is.'
        );
      }
      return warnings.length > 0 ? { ...plan, warnings } : plan;
    } catch (error) {
      this.logger.warn('Obsidian mirror plan not created', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
