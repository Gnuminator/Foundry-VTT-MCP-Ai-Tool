import {
  LIVE_PLAY_FEATURE_ID,
  SCENE_CHANGE_ACTIONS,
  SCENE_PLAN_QUERY,
  SCENE_TEMPLATE_SHAPES,
  toolRef,
  type SceneChangePlan,
  type SceneChangePlanResult,
  type SceneChangeRequest,
} from '@gnuminator/shared';
import { z } from 'zod';

import type { FoundryClient } from '../foundry-client.js';
import type { GuardedWriteService, PlanView } from '../guarded-write/service.js';
import type { Logger } from '../logger.js';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface SceneChangeToolsOptions {
  foundryClient: Pick<FoundryClient, 'query'>;
  guardedWrites: Pick<GuardedWriteService, 'createPlan' | 'autoApplyEnabled'>;
  logger: Logger;
}

const planParams = z.object({
  action: z.enum(SCENE_CHANGE_ACTIONS),
  shape: z.enum(SCENE_TEMPLATE_SHAPES).optional(),
  distance: z.number().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  originTokenName: z.string().optional(),
  direction: z.number().optional(),
  angle: z.number().optional(),
  width: z.number().optional(),
  fillColor: z.string().optional(),
  templateId: z.string().optional(),
  all: z.boolean().optional(),
  darkness: z.number().min(0).max(1).optional(),
  globalLight: z.boolean().optional(),
  text: z.string().optional(),
  tokenName: z.string().optional(),
  journalName: z.string().optional(),
  entryId: z.string().optional(),
  icon: z.string().optional(),
  iconSize: z.number().int().optional(),
  noteId: z.string().optional(),
  targetCharacter: z.string().optional(),
  // Awards only: a negative amount would silently take coins away (P-060).
  currency: z.record(z.string(), z.number().int().min(0)).optional(),
  itemUuids: z.array(z.string()).optional(),
  announce: z.boolean().optional(),
});

const playlistParams = z.object({
  playlistName: z.string().min(1),
  action: z.enum(['play', 'stop']).optional(),
});

function unwrap<T>(response: unknown, what: string): T {
  const r = response as { success?: unknown; error?: unknown } | null | undefined;
  if (r && typeof r === 'object' && r.success === false) {
    throw new Error(`${what}: ${typeof r.error === 'string' ? r.error : 'refused by Foundry'}`);
  }
  return response as T;
}

/**
 * Scene dressing with undo (I-112): `plan-scene-change` plans AoE templates,
 * clearing them, darkness and global light, map notes and loot as one guarded
 * change (feature "live-play", the switch damage and conditions use). The module
 * builds the ops in Foundry (`planSceneChange`), the bridge stores the plan,
 * `apply-planned-change` applies it and `undo-change` reverts it, so each change
 * shows in Recent Changes. With the GM's "apply without confirming" switch on,
 * the result says `autoApply: true` and the caller applies it at once, except for
 * a plan that deletes something (clearing a template, removing a note).
 * Replaces place-measured-template, delete-measured-template, set-scene-mood
 * (darkness and light), add-map-note, delete-map-note and drop-loot.
 *
 * `play-playlist` stays direct: music leaves nothing to undo.
 */
export class SceneChangeTools {
  private readonly options: SceneChangeToolsOptions;
  private readonly logger: Logger;

  constructor(options: SceneChangeToolsOptions) {
    this.options = options;
    this.logger = options.logger.child({ component: 'SceneChangeTools' });
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'plan-scene-change',
        description:
          'Plan scene dressing on the current scene: an area-of-effect template ("template"), clearing templates ("clear-templates"), darkness and global light ("mood"), a map pin ("note", "remove-note") or loot for a character ("loot"). Apply it with apply-planned-change, revert it with undo-change; the GM sees every change in Recent Changes. If the result says autoApply: true, the GM chose to skip confirming: apply it at once. If the GM\'s request says "go ahead", apply it in the same turn (removing something still needs the destructive confirm). A template result lists tokensInside; a loot result lists skippedItems that did not resolve.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: [...SCENE_CHANGE_ACTIONS],
              description:
                'template, clear-templates, mood (darkness and global light), note, remove-note or loot.',
            },
            shape: {
              type: 'string',
              enum: [...SCENE_TEMPLATE_SHAPES],
              description: 'template: the shape (required).',
            },
            distance: {
              type: 'number',
              description:
                'template: size in grid distance units (radius for circle, length for cone/ray/rect; required).',
            },
            x: {
              type: 'number',
              description:
                'template: origin X in pixels (or originTokenName). note: X in pixels (or tokenName).',
            },
            y: {
              type: 'number',
              description:
                'template: origin Y in pixels (or originTokenName). note: Y in pixels (or tokenName).',
            },
            originTokenName: {
              type: 'string',
              description: 'template: center it on this token instead of x/y.',
              ...toolRef('token', 'id'),
            },
            direction: {
              type: 'number',
              description: 'template: facing in degrees (cone/ray/rect).',
            },
            angle: {
              type: 'number',
              description: 'template cone: angle in degrees (default ~53).',
            },
            width: {
              type: 'number',
              description: 'template ray: width in grid units (default 5).',
            },
            fillColor: { type: 'string', description: 'template: hex color, e.g. "#ff0000".' },
            templateId: {
              type: 'string',
              description: 'clear-templates: the template to remove.',
              ...toolRef('template', 'id'),
            },
            all: {
              type: 'boolean',
              description:
                "clear-templates: remove all of this tool's own templates (never a hand-made GM region on Foundry 14).",
            },
            darkness: {
              type: 'number',
              description: 'mood: darkness level 0 (bright) to 1 (dark).',
            },
            globalLight: {
              type: 'boolean',
              description: 'mood: enable or disable global illumination.',
            },
            text: {
              type: 'string',
              description:
                'note: the label. remove-note: remove the pins whose label is exactly this text.',
            },
            tokenName: {
              type: 'string',
              description: 'note: place the pin at this token instead of x/y.',
              ...toolRef('token', 'id'),
            },
            journalName: {
              type: 'string',
              description: 'note: link the pin to an existing journal entry by name.',
              ...toolRef('journal', 'name'),
            },
            entryId: {
              type: 'string',
              description: 'note: link to a journal entry by id (alternative).',
              ...toolRef('journal', 'id'),
            },
            icon: { type: 'string', description: 'note: icon path (default icons/svg/book.svg).' },
            iconSize: { type: 'integer', description: 'note: icon size in px (default 40).' },
            noteId: {
              type: 'string',
              description: 'remove-note: the pin to remove.',
              ...toolRef('note', 'id'),
            },
            targetCharacter: {
              type: 'string',
              description: 'loot: the character to receive it. Omit to only announce in chat.',
              ...toolRef('actor', 'id', { filter: { types: ['character'] } }),
            },
            currency: {
              type: 'object',
              description: 'loot: coins to add, e.g. { "gp": 50, "sp": 25 }.',
              properties: {
                pp: { type: 'integer', minimum: 0 },
                gp: { type: 'integer', minimum: 0 },
                ep: { type: 'integer', minimum: 0 },
                sp: { type: 'integer', minimum: 0 },
                cp: { type: 'integer', minimum: 0 },
              },
            },
            itemUuids: {
              type: 'array',
              items: { type: 'string' },
              description: 'loot: compendium item UUIDs to add (from search-compendium).',
              ...toolRef(['compendium-entry', 'document'], 'uuid', {
                filter: { documentName: 'Item' },
              }),
            },
            announce: {
              type: 'boolean',
              description: 'loot: post a loot summary to chat (default true).',
            },
          },
          required: ['action'],
        },
      },
      {
        name: 'play-playlist',
        description:
          'Play (default) or stop a playlist by name. Direct, with nothing to undo. Use to change the music as the story moves.',
        inputSchema: {
          type: 'object',
          properties: {
            playlistName: {
              type: 'string',
              description: 'Playlist to control by name.',
              ...toolRef('playlist', 'name'),
            },
            action: {
              type: 'string',
              enum: ['play', 'stop'],
              description: 'Play (default) or stop the playlist.',
            },
          },
          required: ['playlistName'],
        },
      },
    ];
  }

  async handlePlanSceneChange(args: unknown): Promise<PlanView & SceneChangePlanResult> {
    const params = planParams.parse(args ?? {});
    const request = stripUndefined(params) as unknown as SceneChangeRequest;
    try {
      const built = unwrap<SceneChangePlan>(
        await this.options.foundryClient.query(`foundry-mcp-bridge.${SCENE_PLAN_QUERY}`, request),
        'Could not plan the change'
      );
      const plan = await this.options.guardedWrites.createPlan({
        feature: LIVE_PLAY_FEATURE_ID,
        summary: built.summary,
        ops: built.ops,
      });
      const autoApply =
        plan.risk === 'write' && (await this.options.guardedWrites.autoApplyEnabled(plan.feature));
      return {
        ...plan,
        ...(built.tokensInside ? { tokensInside: built.tokensInside } : {}),
        ...(built.skippedItems ? { skippedItems: built.skippedItems } : {}),
        autoApply,
      };
    } catch (error) {
      this.logger.warn('Scene plan not created', {
        action: params.action,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async handlePlayPlaylist(args: unknown): Promise<unknown> {
    const params = playlistParams.parse(args ?? {});
    try {
      return unwrap<unknown>(
        await this.options.foundryClient.query(
          'foundry-mcp-bridge.playPlaylist',
          stripUndefined(params)
        ),
        'Could not change the playlist'
      );
    } catch (error) {
      this.logger.warn('Playlist not changed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

/** Drop absent optional keys (JSON has no `undefined`). */
function stripUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}
