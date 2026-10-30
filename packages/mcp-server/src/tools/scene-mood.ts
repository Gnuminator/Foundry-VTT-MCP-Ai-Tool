import { z } from 'zod';
import {
  SCENE_MOOD_ACTIONS,
  SCENE_MOOD_FEATURE_ID,
  SCENE_MUSIC_MODES,
  toolRef,
  unwrapBridgeReply,
  type SceneMoodPlanRequest,
  type SceneMoodPlanResult,
  type SceneMoodsReply,
} from '@gnuminator/shared';
import type { FoundryClient } from '../foundry-client.js';
import type { GuardedWriteService, PlanView } from '../guarded-write/service.js';
import type { Logger } from '../logger.js';

export interface SceneMoodToolsOptions {
  foundryClient: Pick<FoundryClient, 'query'>;
  guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  logger: Logger;
}

const planParams = z.object({
  action: z.enum(SCENE_MOOD_ACTIONS),
  preset: z.string().min(1).optional(),
  fromCurrent: z.boolean().optional(),
  darkness: z.number().min(0).max(1).optional(),
  globalLight: z.boolean().optional(),
  weather: z.string().optional(),
  playlist: z.string().min(1).optional(),
  mode: z.enum(SCENE_MUSIC_MODES).optional(),
});

const SWITCH_OFF =
  'Scene mood and music is switched off. In Foundry, open the Settings tab, Game Settings, AI Tool and turn on "AI Tool: Scene mood and music (writes)".';

/**
 * Scene mood presets and scene music (I-034, I-129). `plan-scene-mood` plans a mood (darkness,
 * global light, weather, playlist), saving or applying a named preset of the viewed scene, or
 * starting, stopping or switching a playlist, as one guarded change (feature `scene-mood`, off by
 * default). Apply it with apply-planned-change, revert it with undo-change. `list-scene-moods`
 * reads the presets, the playlists and what plays.
 */
export class SceneMoodTools {
  private readonly foundryClient: Pick<FoundryClient, 'query'>;
  private readonly guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  private readonly logger: Logger;

  constructor(options: SceneMoodToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.guardedWrites = options.guardedWrites;
    this.logger = options.logger.child({ component: 'SceneMoodTools' });
  }

  getToolDefinitions(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> {
    return [
      {
        name: 'plan-scene-mood',
        description:
          'Plan the viewed scene\'s mood and music: set darkness/light/weather/playlist, save or apply a named preset ("save" with fromCurrent copies the scene as it is), remove-preset, or music (play, stop or switch a playlist). Apply with apply-planned-change, revert with undo-change (music undo is refused once a sequential or shuffle playlist has moved on to its next track by itself: undo soon after, or stop the music with a new plan). Off until the module switch "Scene mood and music" is on.',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: [...SCENE_MOOD_ACTIONS] },
            preset: { type: 'string', description: 'Preset name.' },
            fromCurrent: { type: 'boolean', description: 'save: copy the current look and music.' },
            darkness: { type: 'number', description: '0 bright to 1 dark.' },
            globalLight: { type: 'boolean' },
            weather: { type: 'string', description: 'Effect id (rain, snow, fog) or "none".' },
            playlist: {
              type: 'string',
              description: 'Playlist ("none" stops all music); set, save and music.',
              ...toolRef('playlist', 'name'),
            },
            mode: {
              type: 'string',
              enum: [...SCENE_MUSIC_MODES],
              description: 'music: play adds, switch (default) stops the others first.',
            },
          },
          required: ['action'],
        },
      },
      {
        name: 'list-scene-moods',
        description:
          "List the scene's mood presets, its look now and the playlists with what plays.",
        inputSchema: { type: 'object', properties: {} },
      },
    ];
  }

  async handleToolCall(
    name: string,
    args: unknown
  ): Promise<(PlanView & SceneMoodPlanResult) | SceneMoodsReply> {
    try {
      switch (name) {
        case 'plan-scene-mood':
          return await this.planSceneMood(args);
        case 'list-scene-moods':
          return unwrapBridgeReply(
            await this.foundryClient.query('foundry-mcp-bridge.getSceneMoods'),
            'Could not read the moods'
          );
        default:
          throw new Error(`Unknown scene mood tool: ${name}`);
      }
    } catch (error) {
      this.logger.error(`Error in scene mood tool ${name}:`, error);
      throw error;
    }
  }

  private async planSceneMood(args: unknown): Promise<PlanView & SceneMoodPlanResult> {
    const params = planParams.parse(args ?? {});
    const features = unwrapBridgeReply(
      await this.foundryClient.query('foundry-mcp-bridge.listGuardedFeatures'),
      'Feature list refused'
    );
    if (!features.find(f => f.id === SCENE_MOOD_FEATURE_ID)?.enabled) {
      throw new Error(SWITCH_OFF);
    }
    const request = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined)
    ) as unknown as SceneMoodPlanRequest;
    const built = unwrapBridgeReply(
      await this.foundryClient.query('foundry-mcp-bridge.planSceneMood', request),
      'Could not plan the mood'
    );
    const plan = await this.guardedWrites.createPlan({
      feature: SCENE_MOOD_FEATURE_ID,
      summary: built.summary,
      ops: built.ops,
    });
    return { ...plan, autoApply: false };
  }
}
