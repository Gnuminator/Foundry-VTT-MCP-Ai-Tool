import { z } from 'zod';
import { AT_THE_TABLE, toolRef } from '@gnuminator/shared';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

interface EffectsToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

/**
 * 3D: Condition / status effect management (read + clear).
 */
export class EffectsTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor(options: EffectsToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.logger = options.logger.child({ component: 'EffectsTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'get-active-effects',
        description:
          'List all active effects on an actor: name and icon, whether each is a condition (Blinded, Poisoned, etc.) vs a buff/debuff (Mage Armor, Haste, etc.), remaining duration (rounds/turns/seconds) where tracked, which attributes it modifies and by how much, and whether it requires concentration.',
        inputSchema: {
          type: 'object',
          properties: {
            identifier: {
              type: 'string',
              description: 'Actor name or ID.',
              ...toolRef('actor', 'id', { filter: AT_THE_TABLE }),
            },
          },
          required: ['identifier'],
        },
      },
    ];
  }

  async handleGetActiveEffects(args: any) {
    const schema = z.object({ identifier: z.string() });
    try {
      const params = schema.parse(args ?? {});
      const response = await this.foundryClient.query(
        'foundry-mcp-bridge.getActiveEffects',
        params
      );
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to get active effects');
      }
      return response;
    } catch (error) {
      this.logger.error('Error getting active effects', error);
      throw error;
    }
  }
}
