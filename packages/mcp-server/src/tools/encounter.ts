import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

interface EncounterToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

/**
 * Encounter tooling: XP-budget encounter planning. (AoE templates are part of
 * `plan-scene-change`, I-112.)
 */
export class EncounterTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor(options: EncounterToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.logger = options.logger.child({ component: 'EncounterTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'suggest-balanced-encounter',
        description:
          "Compute the party's XP budget for an encounter difficulty and suggest creature CRs to fill it (uses dnd5e's 2024 encounter math when available, else the 2014 DMG thresholds). Returns the budget and CR suggestions; follow up with list-creatures-by-criteria / search-compendium to pick actual creatures. D&D 5e only.",
        inputSchema: {
          type: 'object',
          properties: {
            partyLevels: {
              type: 'array',
              items: { type: 'integer' },
              description: 'Character levels. If omitted, derived from the player characters.',
            },
            difficulty: {
              type: 'string',
              enum: ['low', 'moderate', 'high'],
              description: 'Encounter difficulty (default "moderate").',
            },
          },
        },
      },
    ];
  }

  async handleSuggestBalancedEncounter(args: any) {
    const schema = z.object({
      partyLevels: z.array(z.number().int()).optional(),
      difficulty: z.enum(['low', 'moderate', 'high']).optional(),
    });
    try {
      const params = schema.parse(args ?? {});
      const response = await this.foundryClient.query(
        'foundry-mcp-bridge.suggestBalancedEncounter',
        params
      );
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to suggest encounter');
      }
      return response;
    } catch (error) {
      this.logger.error('Error suggesting encounter', error);
      throw error;
    }
  }
}
