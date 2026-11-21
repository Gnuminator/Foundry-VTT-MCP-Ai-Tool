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
          'Direct write. The one tool to ask a player to roll: ability check, skill, save, attack, initiative or custom formula. Posts a roll button in Foundry chat (DC shown when given; for an attack put the weapon or spell name in rollTarget). Public by default; pass isPublic false only when the user asks for a private roll. Finds the player from the character; falls back to the GM.',
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
            actor: {
              type: 'string',
              description: 'Player name or character name to request the roll from',
              ...toolRef(['user', 'actor'], 'name', {
                filter: { role: 'player', playerOwned: true },
              }),
            },
            isPublic: {
              type: 'boolean',
              default: true,
              description:
                'Default true: everyone sees the roll. false only when asked: just the target player and GM.',
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
            dc: { type: 'integer', minimum: 1, maximum: 99 },
            advantage: advantageChoice,
          },
          required: ['rollType', 'rollTarget', 'actor'],
        },
      },
      {
        name: 'request-ability-check',
        description:
          'Direct write. Old name: use request-player-rolls with rollType ability. Requests an ability check from a player (clickable roll button, DC shown when given).',
        inputSchema: {
          type: 'object',
          properties: {
            actor: {
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
              minimum: 1,
              maximum: 99,
              description: 'Optional difficulty class to display with the request.',
            },
            isPublic: {
              type: 'boolean',
              default: true,
              description:
                'Default true: visible to all. false only when asked: target player + GM only.',
            },
            reason: {
              type: 'string',
              description: 'Context for the check, e.g. "Perception check to notice the ambush".',
            },
            advantage: advantageChoice,
          },
          required: ['actor', 'ability'],
        },
      },
      {
        name: 'request-attack-roll',
        description:
          'Direct write. Old name: use request-player-rolls with rollType attack. Requests an attack roll for a weapon or spell from a player (clickable roll button).',
        inputSchema: {
          type: 'object',
          properties: {
            actor: {
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
              default: true,
              description:
                'Default true: visible to all. false only when asked: target player + GM only.',
            },
            advantage: advantageChoice,
          },
          required: ['actor', 'weaponOrSpellName'],
        },
      },
      {
        name: 'roll-npc-check',
        description:
          'Direct write. Roll for an NPC actor with no player prompt and post the result to chat: ability check, saving throw, skill check or attack.',
        inputSchema: {
          type: 'object',
          properties: {
            actor: {
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
          required: ['actor', 'rollType', 'rollTarget', 'isPublic'],
        },
      },
    ];
  }

  async handleRequestAbilityCheck(
    args: unknown
  ): Promise<string | DiceRollBridgeReply | undefined> {
    const schema = z.object({
      actor: z.string(),
      ability: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']),
      dc: z.number().int().min(1).max(99).optional(),
      isPublic: z.boolean().default(true),
      reason: z.string().optional(),
      advantage: z.enum(['advantage', 'disadvantage']).optional(),
    });
    // Alias for one release: maps onto request-player-rolls.
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(`Parameter error: ${parsed.error.issues.map(e => e.message).join(', ')}`, {
        cause: parsed.error,
      });
    }
    const { ability, reason, ...rest } = parsed.data;
    return this.handleRequestPlayerRolls({
      ...rest,
      rollType: 'ability',
      rollTarget: ability,
      flavor: reason ?? '',
    });
  }

  async handleRequestAttackRoll(args: unknown): Promise<string | DiceRollBridgeReply | undefined> {
    const schema = z.object({
      actor: z.string(),
      weaponOrSpellName: z.string(),
      isPublic: z.boolean().default(true),
      advantage: z.enum(['advantage', 'disadvantage']).optional(),
    });
    // Alias for one release: maps onto request-player-rolls.
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(`Parameter error: ${parsed.error.issues.map(e => e.message).join(', ')}`, {
        cause: parsed.error,
      });
    }
    const { weaponOrSpellName, ...rest } = parsed.data;
    return this.handleRequestPlayerRolls({
      ...rest,
      rollType: 'attack',
      rollTarget: weaponOrSpellName,
    });
  }

  async handleRollNpcCheck(args: unknown): Promise<string | DiceRollBridgeReply | undefined> {
    const schema = z.object({
      actor: z.string(),
      rollType: z.enum(['ability', 'save', 'skill', 'attack']),
      rollTarget: z.string(),
      isPublic: z.boolean(),
      advantage: z.enum(['advantage', 'disadvantage']).optional(),
    });
    try {
      const params = schema.parse(args);
      const { actor, ...rest } = params;
      const response = (await this.foundryClient.query('foundry-mcp-bridge.rollNpcCheck', {
        actorName: actor,
        ...rest,
      })) as DiceRollBridgeReply | undefined;
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to roll NPC check');
      }
      return response;
    } catch (error: unknown) {
      this.logger.error('Error rolling NPC check', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Parameter error: ${error.issues.map(e => e.message).join(', ')}`, {
          cause: error,
        });
      }
      throw error;
    }
  }

  async handleRequestPlayerRolls(args: unknown): Promise<string | DiceRollBridgeReply | undefined> {
    const schema = z.object({
      rollType: z.enum(['ability', 'skill', 'save', 'attack', 'initiative', 'custom']),
      rollTarget: z.string(),
      actor: z.string(),
      isPublic: z.boolean().default(true),
      // An old client may still send userConfirmedVisibility: zod drops it (removed from the schema).
      rollModifier: z.string().default(''),
      flavor: z.string().default(''),
      dc: z.number().int().min(1).max(99).optional(),
      advantage: z.enum(['advantage', 'disadvantage']).optional(),
    });

    try {
      const params = schema.parse(args);

      const isAttack = params.rollType === 'attack';
      const check = isAttack
        ? await this.rulesCheck?.tryCheck({ actor: params.actor, item: params.rollTarget })
        : undefined;
      // An attack with no flavor gets the card text the old request-attack-roll gave.
      const baseFlavor = params.flavor || (isAttack ? `${params.rollTarget} attack` : '');

      // The module keeps the DC off the card unless it is in the flavor; the dashboard already
      // sends "DC n", so only add it when it is missing.
      const dcText = params.dc === undefined ? '' : `DC ${params.dc}`;
      const cardFlavor =
        dcText === '' || new RegExp(`\\b${dcText}\\b`).test(baseFlavor)
          ? baseFlavor
          : [baseFlavor, dcText].filter(Boolean).join(', ');

      const { actor, ...rest } = params;
      const response = (await this.foundryClient.query('foundry-mcp-bridge.request-player-rolls', {
        ...rest,
        targetPlayer: actor,
        flavor: cardFlavor,
      })) as DiceRollBridgeReply;

      if (response.success) {
        const note = check && check.verdict !== 'legal' ? ` Rules check: ${check.summary}` : '';
        return `Roll request sent successfully! ${response.message}${note}`;
      } else {
        throw new Error(response.error || 'Failed to request player rolls');
      }
    } catch (error: unknown) {
      this.logger.error('Error requesting player rolls', error);
      if (error instanceof z.ZodError) {
        const messages = error.issues.map(e => {
          if (e.path.includes('isPublic')) {
            return 'isPublic must be true or false (default true).';
          }
          return e.message;
        });
        throw new Error(`Parameter error: ${messages.join(', ')}`, { cause: error });
      }
      throw error;
    }
  }
}
