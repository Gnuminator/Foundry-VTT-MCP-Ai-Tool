import { freeText, toolRef } from '@gnuminator/shared';
import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';
import type { RulesCheckTools } from './rules-check.js';
import type { DiceRollBridgeReply, DiceRollToolDefinition } from './types/dice-roll-types.js';

interface DiceRollToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
  /** Advisory rules pre-check for attack requests (never blocks). */
  rulesCheck?: Pick<RulesCheckTools, 'tryCheck'>;
}

/**
 * The optional GM choice every d20 roll tool takes; absent lets dnd5e decide from conditions, and
 * a choice combines with them. No description: the Play tool-set size budget is tight.
 */
const advantageChoice = { type: 'string', enum: ['advantage', 'disadvantage'] } as const;

export class DiceRollTools {
  private foundryClient: FoundryClient;
  private logger: Logger;
  private rulesCheck: Pick<RulesCheckTools, 'tryCheck'> | null;

  constructor(options: DiceRollToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.logger = options.logger;
    this.rulesCheck = options.rulesCheck ?? null;
  }

  getToolDefinitions(): DiceRollToolDefinition[] {
    return [
      {
        name: 'request-player-rolls',
        description:
          'Direct write. Request dice rolls from players: posts roll buttons in Foundry chat that players click. Ask the user first whether the roll is public (everyone sees it) or private (player and GM only) unless they already said. Finds the player from the character; falls back to the GM.',
        inputSchema: {
          type: 'object',
          properties: {
            rollType: {
              type: 'string',
              description:
                'Type of roll to request (ability, skill, save, attack, initiative, custom)',
              enum: ['ability', 'skill', 'save', 'attack', 'initiative', 'custom'],
            },
            rollTarget: {
              type: 'string',
              description:
                'An ability (str, dex, con, int, wis, cha), a skill (perception, stealth, ...) or a custom roll formula',
              ...toolRef(['ability', 'skill'], 'id'),
            },
            targetPlayer: {
              type: 'string',
              description: 'Player name or character name to request the roll from',
              ...toolRef(['user', 'actor'], 'name', {
                filter: { role: 'player', playerOwned: true },
              }),
            },
            isPublic: {
              type: 'boolean',
              description:
                'true: everyone sees the roll. false: only the target player and GM.',
            },
            userConfirmedVisibility: {
              type: 'boolean',
              const: true,
              description:
                'Must be true. Set it only when the user said "public" or "private" or answered your question about it.',
            },
            rollModifier: {
              type: 'string',
              description: 'Optional modifier to add to the roll (e.g., "+2", "-1", "+1d4")',
              default: '',
            },
            flavor: {
              type: 'string',
              description: 'Optional flavor text to describe the roll context',
              default: '',
            },
            // No description: the play tool set is at its size budget; the name says it.
            dc: { type: 'integer' },
            advantage: advantageChoice,
          },
          required: [
            'rollType',
            'rollTarget',
            'targetPlayer',
            'isPublic',
            'userConfirmedVisibility',
          ],
        },
      },
      {
        name: 'request-ability-check',
        description:
          'Direct write. Request an ability check from a player, posting a clickable roll button to their chat. Shows the DC when provided. Use for checks like "Perception check to notice the ambush".',
        inputSchema: {
          type: 'object',
          properties: {
            targetPlayer: {
              type: 'string',
              description: 'Player name or character name to request the roll from.',
              ...toolRef(['user', 'actor'], 'name', {
                filter: { role: 'player', playerOwned: true },
              }),
            },
            ability: {
              type: 'string',
              description: 'Ability to check.',
              enum: ['str', 'dex', 'con', 'int', 'wis', 'cha'],
            },
            dc: {
              type: 'integer',
              description: 'Optional difficulty class to display with the request.',
            },
            isPublic: {
              type: 'boolean',
              description:
                'Whether the roll is public (visible to all) or private (target player + GM only).',
            },
            reason: {
              type: 'string',
              description: 'Context for the check, e.g. "Perception check to notice the ambush".',
            },
            advantage: advantageChoice,
          },
          required: ['targetPlayer', 'ability', 'isPublic'],
        },
      },
      {
        name: 'request-attack-roll',
        description:
          'Direct write. Request an attack roll for a specific weapon or spell from a player, posting a clickable roll button to their chat.',
        inputSchema: {
          type: 'object',
          properties: {
            targetPlayer: {
              type: 'string',
              description: 'Player name or character name to request the roll from.',
              ...toolRef(['user', 'actor'], 'name', {
                filter: { role: 'player', playerOwned: true },
              }),
            },
            weaponOrSpellName: {
              type: 'string',
              description: 'Name of the weapon or spell attack.',
              ...freeText(
                'Label text for the roll button: the attack is a plain 1d20 and the item is never looked up'
              ),
            },
            isPublic: {
              type: 'boolean',
              description:
                'Whether the roll is public (visible to all) or private (target player + GM only).',
            },
            advantage: advantageChoice,
          },
          required: ['targetPlayer', 'weaponOrSpellName', 'isPublic'],
        },
      },
      {
        name: 'roll-npc-check',
        description:
          'Direct write. Roll for an NPC actor with no player prompt and post the result to chat: ability check, saving throw, skill check or attack.',
        inputSchema: {
          type: 'object',
          properties: {
            actorName: {
              type: 'string',
              description: 'NPC actor name or ID.',
              ...toolRef('actor', 'id', { filter: { types: ['npc'] } }),
            },
            rollType: {
              type: 'string',
              description: 'Type of roll.',
              enum: ['ability', 'save', 'skill', 'attack'],
            },
            rollTarget: {
              type: 'string',
              description:
                'Target for the roll: ability (str/dex/...), skill name (perception, stealth, ...), or weapon/attack name.',
              ...toolRef(['ability', 'skill'], 'id'),
            },
            isPublic: {
              type: 'boolean',
              description: 'Whether the result is public (true) or whispered to the GM (false).',
            },
            advantage: advantageChoice,
          },
          required: ['actorName', 'rollType', 'rollTarget', 'isPublic'],
        },
      },
    ];
  }

  async handleRequestAbilityCheck(
    args: unknown
  ): Promise<string | DiceRollBridgeReply | undefined> {
    const schema = z.object({
      targetPlayer: z.string(),
      ability: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']),
      dc: z.number().int().optional(),
      isPublic: z.boolean(),
      reason: z.string().optional(),
      advantage: z.enum(['advantage', 'disadvantage']).optional(),
    });
    try {
      const params = schema.parse(args);
      const response = (await this.foundryClient.query(
        'foundry-mcp-bridge.requestAbilityCheck',
        params
      )) as DiceRollBridgeReply | undefined;
      if (response?.success) {
        return `Ability check requested. ${response.message}`;
      }
      throw new Error(response?.error || 'Failed to request ability check');
    } catch (error: unknown) {
      this.logger.error('Error requesting ability check', error);
      if (error instanceof z.ZodError) {
        return `Parameter error: ${error.errors.map(e => e.message).join(', ')}`;
      }
      throw error;
    }
  }

  async handleRequestAttackRoll(args: unknown): Promise<string | DiceRollBridgeReply | undefined> {
    const schema = z.object({
      targetPlayer: z.string(),
      weaponOrSpellName: z.string(),
      isPublic: z.boolean(),
      advantage: z.enum(['advantage', 'disadvantage']).optional(),
    });
    try {
      const params = schema.parse(args);
      const check = await this.rulesCheck?.tryCheck({
        actor: params.targetPlayer,
        item: params.weaponOrSpellName,
      });
      const response = (await this.foundryClient.query(
        'foundry-mcp-bridge.requestAttackRoll',
        params
      )) as DiceRollBridgeReply | undefined;
      if (response?.success) {
        const note = check && check.verdict !== 'legal' ? ` Rules check: ${check.summary}` : '';
        return `Attack roll requested. ${response.message}${note}`;
      }
      throw new Error(response?.error || 'Failed to request attack roll');
    } catch (error: unknown) {
      this.logger.error('Error requesting attack roll', error);
      if (error instanceof z.ZodError) {
        return `Parameter error: ${error.errors.map(e => e.message).join(', ')}`;
      }
      throw error;
    }
  }

  async handleRollNpcCheck(args: unknown): Promise<string | DiceRollBridgeReply | undefined> {
    const schema = z.object({
      actorName: z.string(),
      rollType: z.enum(['ability', 'save', 'skill', 'attack']),
      rollTarget: z.string(),
      isPublic: z.boolean(),
      advantage: z.enum(['advantage', 'disadvantage']).optional(),
    });
    try {
      const params = schema.parse(args);
      const response = (await this.foundryClient.query(
        'foundry-mcp-bridge.rollNpcCheck',
        params
      )) as DiceRollBridgeReply | undefined;
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to roll NPC check');
      }
      return response;
    } catch (error: unknown) {
      this.logger.error('Error rolling NPC check', error);
      if (error instanceof z.ZodError) {
        return `Parameter error: ${error.errors.map(e => e.message).join(', ')}`;
      }
      throw error;
    }
  }

  async handleRequestPlayerRolls(args: unknown): Promise<string | DiceRollBridgeReply | undefined> {
    const schema = z.object({
      rollType: z.enum(['ability', 'skill', 'save', 'attack', 'initiative', 'custom']),
      rollTarget: z.string(),
      targetPlayer: z.string(),
      isPublic: z.boolean(),
      userConfirmedVisibility: z.literal(true),
      rollModifier: z.string().default(''),
      flavor: z.string().default(''),
      dc: z.number().int().min(1).max(99).optional(),
      advantage: z.enum(['advantage', 'disadvantage']).optional(),
    });

    try {
      const params = schema.parse(args);

      // Validation should be handled by schema, but add extra safety checks
      if (typeof params.isPublic !== 'boolean') {
        return 'Please specify whether you want this to be a PUBLIC roll (visible to all players) or PRIVATE roll (visible only to the target player and GM). You must provide either "true" for public or "false" for private.';
      }

      if (params.userConfirmedVisibility !== true) {
        return 'You must determine the roll visibility before calling this function. Either: 1) The user already specified "public" or "private" in their request, or 2) You need to ask: "Do you want this to be a PUBLIC roll or PRIVATE roll?" Set userConfirmedVisibility to true only when you are confident about the visibility preference.';
      }

      // The module keeps the DC off the card unless it is in the flavor (request-ability-check does
      // the same fold); the dashboard already sends "DC n", so only add it when it is missing.
      const dcText = params.dc === undefined ? '' : `DC ${params.dc}`;
      const flavor =
        dcText === '' || new RegExp(`\\b${dcText}\\b`).test(params.flavor)
          ? params.flavor
          : [params.flavor, dcText].filter(Boolean).join(', ');

      const response = (await this.foundryClient.query('foundry-mcp-bridge.request-player-rolls', {
        ...params,
        flavor,
      })) as DiceRollBridgeReply;

      if (response.success) {
        return `Roll request sent successfully! ${response.message}`;
      } else {
        throw new Error(response.error || 'Failed to request player rolls');
      }
    } catch (error: unknown) {
      this.logger.error('Error requesting player rolls', error);
      if (error instanceof z.ZodError) {
        const messages = error.errors.map(e => {
          if (e.path.includes('isPublic')) {
            return 'You must specify whether the roll should be PUBLIC (visible to all players) or PRIVATE (visible only to target player and GM). Check if the user already specified this in their request, or ask them to clarify.';
          }
          return e.message;
        });
        return `Parameter error: ${messages.join(', ')}`;
      }
      throw error;
    }
  }
}
