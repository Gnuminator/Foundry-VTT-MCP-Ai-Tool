import { toolRef } from '@gnuminator/shared';
import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';
import type { MovementReply } from './types/movement-types.js';

interface MovementToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface MovementToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

/**
 * 3F: Movement and token positioning.
 */
export class MovementTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor(options: MovementToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.logger = options.logger.child({ component: 'MovementTools' });
  }

  getToolDefinitions(): MovementToolDefinition[] {
    return [
      {
        name: 'get-token-positions',
        description:
          'Use this to see where all tokens are on a scene (default: active): name, actor ID, token ID, x/y and grid cell, elevation, level (the floor, on a scene with more than one Scene Level), category (pc/npc/enemy), hidden or visible, HP, conditions.',
        inputSchema: {
          type: 'object',
          properties: {
            sceneId: {
              type: 'string',
              description: 'Optional scene ID; defaults to the active scene.',
              ...toolRef('scene', 'id'),
            },
          },
        },
      },
      {
        name: 'measure-distance',
        description:
          "Measure the distance in the scene's grid units (e.g. feet) between two tokens on the active scene, using the scene's grid configuration. On a scene with more than one Scene Level (a castle with floors) the distance counts height too and the reply names the level of each token (fromLevel, toLevel) with the horizontal and vertical parts.",
        inputSchema: {
          type: 'object',
          properties: {
            fromTokenName: {
              type: 'string',
              description: 'Name of the first token.',
              ...toolRef('token', 'name'),
            },
            toTokenName: {
              type: 'string',
              description: 'Name of the second token.',
              ...toolRef('token', 'name'),
            },
          },
          required: ['fromTokenName', 'toTokenName'],
        },
      },
      {
        name: 'get-targets',
        description:
          "Return the tokens the GM currently has targeted in Foundry, with each target's AC and HP. Useful before use-npc-activity so an attack can resolve hit/miss against the actual target's AC.",
        inputSchema: { type: 'object', properties: {} },
      },
    ];
  }

  async handleGetTargets(_args: unknown): Promise<MovementReply | undefined> {
    try {
      const response = (await this.foundryClient.query('foundry-mcp-bridge.getTargets')) as
        | MovementReply
        | undefined;
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to get targets');
      }
      return response;
    } catch (error) {
      this.logger.error('Error getting targets', error);
      throw error;
    }
  }

  async handleGetTokenPositions(args: unknown): Promise<MovementReply | undefined> {
    const schema = z.object({ sceneId: z.string().optional() });
    try {
      const params = schema.parse(args ?? {});
      const response = (await this.foundryClient.query(
        'foundry-mcp-bridge.getTokenPositions',
        params
      )) as MovementReply | undefined;
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to get token positions');
      }
      return response;
    } catch (error) {
      this.logger.error('Error getting token positions', error);
      throw error;
    }
  }

  async handleMeasureDistance(args: unknown): Promise<MovementReply | string | undefined> {
    const schema = z.object({
      fromTokenName: z.string(),
      toTokenName: z.string(),
    });
    try {
      const params = schema.parse(args ?? {});
      const response = (await this.foundryClient.query(
        'foundry-mcp-bridge.measureDistance',
        params
      )) as MovementReply | undefined;
      if (response?.success === false) {
        throw new Error(response.error || 'Failed to measure distance');
      }
      return response;
    } catch (error) {
      this.logger.error('Error measuring distance', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Parameter error: ${error.issues.map(e => e.message).join(', ')}`, {
          cause: error,
        });
      }
      throw error;
    }
  }
}
