import { toolRef } from '@gnuminator/shared';
import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';
import type {
  AvailableConditionsReply,
  TokenDetailsReply,
} from './types/token-manipulation-types.js';

interface TokenToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface TokenManipulationToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

export class TokenManipulationTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: TokenManipulationToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'TokenManipulationTools' });
  }

  /**
   * Tool definitions for token manipulation operations
   */
  getToolDefinitions(): TokenToolDefinition[] {
    return [
      {
        name: 'get-token-details',
        description:
          'Get detailed information about a specific token including all properties and linked actor data',
        inputSchema: {
          type: 'object',
          properties: {
            tokenId: {
              type: 'string',
              description: 'The ID of the token to get details for',
              ...toolRef('token', 'id'),
            },
          },
          required: ['tokenId'],
        },
      },
      {
        name: 'get-available-conditions',
        description:
          'Get a list of all available status effects/conditions that can be applied to tokens in the current game system',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ];
  }

  async handleGetTokenDetails(args: unknown): Promise<Record<string, unknown>> {
    const schema = z.object({
      tokenId: z.string(),
    });

    const { tokenId } = schema.parse(args);

    this.logger.info('Getting token details', { tokenId });

    try {
      const tokenData = (await this.foundryClient.query('foundry-mcp-bridge.get-token-details', {
        tokenId,
      })) as TokenDetailsReply;

      this.logger.debug('Retrieved token details', {
        tokenId,
        hasActorData: !!tokenData.actorData,
      });

      return this.formatTokenDetails(tokenData);
    } catch (error) {
      this.logger.error('Failed to get token details', error);
      throw new Error(
        `Failed to get token details: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error }
      );
    }
  }

  private formatTokenDetails(tokenData: TokenDetailsReply): Record<string, unknown> {
    return {
      id: tokenData.id,
      name: tokenData.name,
      position: {
        x: tokenData.x,
        y: tokenData.y,
      },
      size: {
        width: tokenData.width,
        height: tokenData.height,
      },
      appearance: {
        rotation: tokenData.rotation,
        scale: tokenData.scale,
        alpha: tokenData.alpha,
        hidden: tokenData.hidden,
        img: tokenData.img,
      },
      behavior: {
        disposition: this.getDispositionName(tokenData.disposition),
        elevation: tokenData.elevation,
        lockRotation: tokenData.lockRotation,
      },
      actor: tokenData.actorData
        ? {
            id: tokenData.actorId,
            name: tokenData.actorData.name,
            type: tokenData.actorData.type,
            img: tokenData.actorData.img,
            isLinked: tokenData.actorLink,
          }
        : null,
    };
  }

  private getDispositionName(disposition: unknown): string {
    switch (disposition) {
      case -2:
        return 'secret';
      case -1:
        return 'hostile';
      case 0:
        return 'neutral';
      case 1:
        return 'friendly';
      default:
        return 'unknown';
    }
  }

  async handleGetAvailableConditions(_args: unknown): Promise<Record<string, unknown>> {
    this.logger.info('Getting available conditions');

    try {
      const result = (await this.foundryClient.query(
        'foundry-mcp-bridge.get-available-conditions',
        {}
      )) as AvailableConditionsReply;

      this.logger.debug('Retrieved available conditions', { count: result.conditions?.length });

      return {
        success: true,
        conditions: result.conditions,
        gameSystem: result.gameSystem,
      };
    } catch (error) {
      this.logger.error('Failed to get available conditions', error);
      throw new Error(
        `Failed to get available conditions: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error }
      );
    }
  }
}
