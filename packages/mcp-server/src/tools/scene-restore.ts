import { z } from 'zod';
import { stat } from 'node:fs/promises';
import {
  SCENE_RESTORE_FEATURE_ID,
  SCENE_RESTORE_PARTS,
  toolRef,
  unwrapBridgeReply,
  type SceneRestorePart,
} from '@gnuminator/shared';
import { FoundryClient } from '../foundry-client.js';
import type { GuardedWriteService, PlanView } from '../guarded-write/service.js';
import { Logger } from '../logger.js';
import {
  defaultFoundryAppDirs,
  levelOpenerFromFoundry,
  readBackupScene,
  type LevelOpener,
} from '../scene-restore/backup-reader.js';
import { buildRestoreDiff, describePart, type PartCounts } from '../scene-restore/diff.js';

export interface SceneRestoreToolsOptions {
  foundryClient: Pick<FoundryClient, 'query'>;
  guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  worldIds: { current(): Promise<string> };
  logger: Logger;
  /** Tests supply a fake; production opens the copy with Foundry's own classic-level. */
  openLevel?: LevelOpener;
  env?: NodeJS.ProcessEnv;
}

const planParams = z.object({
  scene: z.string().min(1).optional(),
  backupPath: z.string().min(1).optional(),
  parts: z.array(z.enum(SCENE_RESTORE_PARTS)).min(1).optional(),
});

/** What `plan-scene-restore` returns beside the guarded plan. */
export interface SceneRestorePlanResult extends PlanView {
  scene: { id: string; name: string };
  backup: { path: string; takenAt: string; ageHours: number };
  counts: Record<SceneRestorePart, PartCounts>;
  /** Names of tokens that would be put back / taken off the map. */
  tokens: { added: string[]; removed: string[] };
  autoApply: false;
}

/** Where a copy of the world is looked for when the caller names no path. */
function defaultBackupPath(env: NodeJS.ProcessEnv, worldId: string): string {
  const fromEnv = env.FOUNDRY_AI_SCENE_BACKUP_DIR;
  if (fromEnv) return fromEnv;
  return `C:\\FoundryPlanB\\data\\Data\\worlds\\${worldId}`;
}

/**
 * Scene restore (I-128). `plan-scene-restore` compares a scene's walls, lights, tiles and tokens
 * with a copy of the world (the Pi's nightly backup restored by `scripts/plan-b/restore.ps1`) and
 * plans the difference as one guarded change (feature `scene-restore`, off by default): created
 * back, deleted, or updated. Apply it with apply-planned-change, revert it with undo-change.
 */
export class SceneRestoreTools {
  private readonly foundryClient: Pick<FoundryClient, 'query'>;
  private readonly guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  private readonly worldIds: { current(): Promise<string> };
  private readonly logger: Logger;
  private readonly env: NodeJS.ProcessEnv;
  private readonly openLevel: LevelOpener;

  constructor(options: SceneRestoreToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.guardedWrites = options.guardedWrites;
    this.worldIds = options.worldIds;
    this.logger = options.logger.child({ component: 'SceneRestoreTools' });
    this.env = options.env ?? process.env;
    this.openLevel = options.openLevel ?? levelOpenerFromFoundry(defaultFoundryAppDirs(this.env));
  }

  getToolDefinitions(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> {
    return [
      {
        name: 'plan-scene-restore',
        description:
          'Plan putting a scene\'s walls, lights, tiles and tokens back from a backup copy of the world, after the map was broken by hand. Counts what is added back, removed, moved or changed. Apply with apply-planned-change, revert with undo-change. Needs the module switch "Scene restore" on (off by default).',
        inputSchema: {
          type: 'object',
          properties: {
            scene: {
              type: 'string',
              description: 'Default: the viewed scene.',
              ...toolRef('scene', 'id'),
            },
            backupPath: {
              type: 'string',
              description: 'Restored world folder. Default: the Plan B folder.',
            },
            parts: {
              type: 'array',
              items: { type: 'string', enum: [...SCENE_RESTORE_PARTS] },
            },
          },
        },
      },
    ];
  }

  async handleToolCall(name: string, args: unknown): Promise<SceneRestorePlanResult> {
    try {
      switch (name) {
        case 'plan-scene-restore':
          return await this.planSceneRestore(args);
        default:
          throw new Error(`Unknown scene restore tool: ${name}`);
      }
    } catch (error) {
      this.logger.error(`Error in scene restore tool ${name}:`, error);
      throw error;
    }
  }

  private async planSceneRestore(args: unknown): Promise<SceneRestorePlanResult> {
    const params = planParams.parse(args ?? {});
    const parts = [...new Set(params.parts ?? SCENE_RESTORE_PARTS)];

    // Fail early and plainly while the switch is off (the module would refuse the apply anyway).
    const features = unwrapBridgeReply(
      await this.foundryClient.query('foundry-mcp-bridge.listGuardedFeatures'),
      'Feature list refused'
    );
    const feature = features.find(f => f.id === SCENE_RESTORE_FEATURE_ID);
    if (!feature?.enabled) {
      throw new Error(
        'Scene restore is switched off. In Foundry, open Game Settings, Configure Settings, AI Tool and turn on "AI Tool: Scene restore (writes)".'
      );
    }

    const live = unwrapBridgeReply(
      await this.foundryClient.query('foundry-mcp-bridge.getSceneState', {
        ...(params.scene ? { sceneId: params.scene } : {}),
      }),
      'Could not read the scene'
    );
    const worldId = await this.worldIds.current();
    const backupPath = params.backupPath ?? defaultBackupPath(this.env, worldId);
    try {
      await stat(backupPath);
    } catch {
      throw new Error(
        `No backup copy at ${backupPath}. Restore the Pi's backup first (scripts/plan-b/restore.ps1) or give backupPath.`
      );
    }
    const backup = await readBackupScene({
      backupPath,
      sceneId: live.sceneId,
      worldId,
      open: this.openLevel,
    });

    const diff = buildRestoreDiff(live.sceneId, parts, live, backup);
    if (diff.ops.length === 0) {
      throw new Error(
        `Nothing to restore: ${live.name} already matches the backup (${parts.join(', ')}).`
      );
    }
    const lines = parts
      .map(p => [p, describePart(p, diff.counts[p])] as const)
      .filter(([, text]) => text.length > 0)
      .map(([, text]) => text);
    const takenAt = new Date(backup.modifiedMs).toISOString();
    const ageHours = Math.round((Date.now() - backup.modifiedMs) / 3_600_000);
    const plan = await this.guardedWrites.createPlan({
      feature: SCENE_RESTORE_FEATURE_ID,
      summary: `Restore ${live.name} from the backup of ${takenAt.slice(0, 16).replace('T', ' ')}: ${lines.join('; ')}`,
      ops: diff.ops,
    });
    return {
      ...plan,
      scene: { id: live.sceneId, name: live.name },
      backup: { path: backup.scenesDir, takenAt, ageHours },
      counts: diff.counts,
      tokens: diff.tokenNames,
      autoApply: false,
    };
  }
}
