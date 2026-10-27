import { z } from 'zod';
import { freeText, toolRef } from '@gnuminator/shared';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

interface LevelUpToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

/**
 * D&D helper (I-152 step 4): read-only level-up advice. Advise only: the player finishes the
 * level-up in Foundry's own advancement dialog.
 */
export class LevelUpTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor(options: LevelUpToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.logger = options.logger.child({ component: 'LevelUpTools' });
  }

  getToolDefinitions(): Array<{ name: string; description: string; inputSchema: object }> {
    return [
      {
        name: 'get-level-up-options',
        description:
          "Advice only, changes nothing: what a character's next class level grants, the choices still open (hit points, ASI or feat, subclass, spells, items), and earlier advancement left unfinished.",
        inputSchema: {
          type: 'object',
          properties: {
            identifier: {
              type: 'string',
              description: 'Character name or actor ID.',
              ...toolRef('actor', 'id'),
            },
            className: {
              type: 'string',
              ...freeText('A class name such as "wizard"; omit for every class.'),
            },
          },
          required: ['identifier'],
        },
      },
    ];
  }

  async handleGetLevelUpOptions(args: unknown): Promise<unknown> {
    const schema = z.object({ identifier: z.string(), className: z.string().optional() });
    try {
      const params = schema.parse(args ?? {});
      const response = (await this.foundryClient.query(
        'foundry-mcp-bridge.getLevelUpOptions',
        params
      )) as { success?: boolean; error?: string } | undefined;
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to get level-up options');
      }
      return response;
    } catch (error) {
      this.logger.error('Error getting level-up options', error);
      throw error;
    }
  }
}
