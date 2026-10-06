import { toolRef } from '@gnuminator/shared';
import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

interface CombatResolutionToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

/**
 * D&D 5e combat-resolution tools: apply damage/healing, roll NPC saves/checks,
 * use an NPC attack/activity, and run rests. These let the AI co-GM actually
 * resolve a combat round rather than only observe it. dnd5e only.
 */
export class CombatResolutionTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor(options: CombatResolutionToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.logger = options.logger.child({ component: 'CombatResolutionTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'roll-saving-throws',
        description:
          'Roll saving throws (or ability checks / skill checks) for one or more NPC actors using dnd5e system rules, optionally against a DC, reporting each total and pass/fail. Use for "all the goblins roll a DEX save vs DC 15". D&D 5e only.',
        inputSchema: {
          type: 'object',
          properties: {
            targets: {
              type: 'array',
              items: { type: 'string' },
              description: 'Token names (preferred) or actor names/IDs to roll for.',
              ...toolRef(['token', 'actor'], 'id'),
            },
            rollType: { type: 'string', enum: ['save', 'check', 'skill'] },
            ability: {
              type: 'string',
              description: 'Ability key for save/check (str/dex/con/int/wis/cha).',
              ...toolRef('ability', 'id'),
            },
            skill: {
              type: 'string',
              description:
                'dnd5e skill key for skill rolls: acr, ani, arc, ath, dec, his, ins, itm, inv, med, nat, prc, prf, per, rel, slt, ste, sur (e.g. "ste" for Stealth, "prc" for Perception).',
              ...toolRef('skill', 'id'),
            },
            dc: { type: 'integer', description: 'Optional difficulty class to test against.' },
            isPublic: {
              type: 'boolean',
              description:
                'Public roll (true) or whispered to the GM only (false or omitted, the default).',
            },
          },
          required: ['targets', 'rollType'],
        },
      },
      {
        name: 'use-npc-activity',
        description:
          "Trigger an NPC's attack (or other item activity) and report the attack roll total, hit/miss vs an AC, critical, and damage. Use for running the monster side of combat. D&D 5e only.",
        inputSchema: {
          type: 'object',
          properties: {
            actorName: {
              type: 'string',
              description:
                'NPC actor name or ID. A token on the current scene with this name or ID (or the only token made from this actor) is used first, so an unlinked token spends its own uses.',
              ...toolRef('actor', 'id', { filter: { types: ['npc'] } }),
            },
            itemName: {
              type: 'string',
              description: 'Name of the weapon/feature/spell to use (e.g. "Scimitar").',
              ...toolRef('actor-item', 'id', { parent: 'actorName' }),
            },
            targetAC: {
              type: 'integer',
              description: 'Optional target AC to compute hit/miss against.',
            },
            isPublic: {
              type: 'boolean',
              description:
                'Public roll (true or omitted, the default) or whispered to the GM only (false).',
            },
          },
          required: ['actorName', 'itemName'],
        },
      },
      {
        name: 'manage-rest',
        description:
          'Run a short or long rest for one or more characters, restoring HP, hit dice, spell slots, and limited-use features per 5e rules, without opening dialogs. D&D 5e only.',
        inputSchema: {
          type: 'object',
          properties: {
            targets: {
              type: 'array',
              items: { type: 'string' },
              description: 'Character names or IDs to rest.',
              ...toolRef('actor', 'id', { filter: { types: ['character'] } }),
            },
            restType: { type: 'string', enum: ['short', 'long'] },
            newDay: {
              type: 'boolean',
              description:
                'Whether this rest starts a new day (resets daily uses). Defaults true for long rests.',
            },
          },
          required: ['targets', 'restType'],
        },
      },
    ];
  }

  private async query(method: string, params: any, failMsg: string) {
    const response = await this.foundryClient.query(`foundry-mcp-bridge.${method}`, params);
    if (response?.success === false) {
      throw new Error(response.error || failMsg);
    }
    return response;
  }

  async handleRollSavingThrows(args: any) {
    const schema = z.object({
      targets: z.array(z.string()).min(1),
      rollType: z.enum(['save', 'check', 'skill']),
      ability: z.string().optional(),
      skill: z.string().optional(),
      dc: z.number().int().optional(),
      isPublic: z.boolean().optional(),
    });
    try {
      return await this.query(
        'rollSavingThrows',
        schema.parse(args),
        'Failed to roll saving throws'
      );
    } catch (error) {
      this.logger.error('Error rolling saving throws', error);
      if (error instanceof z.ZodError) {
        return `Parameter error: ${error.errors.map(e => e.message).join(', ')}`;
      }
      throw error;
    }
  }

  async handleUseNpcActivity(args: any) {
    const schema = z.object({
      actorName: z.string(),
      itemName: z.string(),
      targetAC: z.number().int().optional(),
      isPublic: z.boolean().optional(),
    });
    try {
      return await this.query('useNpcActivity', schema.parse(args), 'Failed to use NPC activity');
    } catch (error) {
      this.logger.error('Error using NPC activity', error);
      if (error instanceof z.ZodError) {
        return `Parameter error: ${error.errors.map(e => e.message).join(', ')}`;
      }
      throw error;
    }
  }

  async handleManageRest(args: any) {
    const schema = z.object({
      targets: z.array(z.string()).min(1),
      restType: z.enum(['short', 'long']),
      newDay: z.boolean().optional(),
    });
    try {
      return await this.query('manageRest', schema.parse(args), 'Failed to manage rest');
    } catch (error) {
      this.logger.error('Error managing rest', error);
      if (error instanceof z.ZodError) {
        return `Parameter error: ${error.errors.map(e => e.message).join(', ')}`;
      }
      throw error;
    }
  }
}
