import { z } from 'zod';
import { AT_THE_TABLE, toolRef } from '@gnuminator/shared';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

interface ResourceToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

/**
 * 3C: Limited-use resource tracking — spell slots, class resources (Sorcery
 * Points, Ki, Rages, etc.), item charges, concentration, hit dice, death saves.
 */
export class ResourceTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor(options: ResourceToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.logger = options.logger.child({ component: 'ResourceTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'get-character-resources',
        description:
          "Get a clean, structured view of a character's limited-use resources: spell slots per level (max/current/expended), class resources (Sorcery Points, Ki, Rages, Bardic Inspiration, Channel Divinity, Superiority Dice, etc.), item charges, current concentration (and on which spell), hit dice, and death save successes/failures when at 0 HP.",
        inputSchema: {
          type: 'object',
          properties: {
            identifier: {
              type: 'string',
              description: 'Character name or actor ID.',
              ...toolRef('actor', 'id', { filter: AT_THE_TABLE }),
            },
          },
          required: ['identifier'],
        },
      },
    ];
  }

  async handleGetCharacterResources(args: any) {
    const schema = z.object({ identifier: z.string() });
    try {
      const params = schema.parse(args ?? {});
      const response = await this.foundryClient.query(
        'foundry-mcp-bridge.getCharacterResources',
        params
      );
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to get character resources');
      }
      return response;
    } catch (error) {
      this.logger.error('Error getting character resources', error);
      throw error;
    }
  }
}
