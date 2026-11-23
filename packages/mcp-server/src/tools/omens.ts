import { freeText, toolRef } from '@gnuminator/shared';
import { z } from 'zod';

import { MAX_OMEN_TEXT, type OmensStore } from '../omens/store.js';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface OmensToolsOptions {
  omens: Pick<OmensStore, 'list' | 'add' | 'edit' | 'remove'>;
}

/**
 * `draft-omens` (I-181): Claude drafts a short private text per player for the GM to approve in
 * the dashboard. Direct write to the bridge vault only; nothing is sent from here. Approving and
 * sending are never tools, so a draft cannot approve itself.
 */
export class OmensTools {
  private readonly omens: OmensToolsOptions['omens'];

  constructor(options: OmensToolsOptions) {
    this.omens = options.omens;
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'draft-omens',
        description: `Direct write. GM ONLY. Omens by post: draft a short private text (dream, letter, rumor) for ONE player, up to ${MAX_OMEN_TEXT} characters; edit, remove or list drafts. Only writes the vault's omens list; the GM approves each in the dashboard and only approved texts go to that player on Discord. No spoilers: nothing unrevealed, no secret names.`,
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['add', 'edit', 'remove', 'list'] },
            userId: {
              type: 'string',
              description: 'add: the player.',
              ...toolRef('user', 'id'),
            },
            text: { type: 'string', description: 'add or edit: the text.' },
            id: { type: 'string', ...freeText('An omen id from action list') },
          },
          required: ['action'],
        },
      },
    ];
  }

  async handleDraftOmens(args: unknown): Promise<unknown> {
    const p = z
      .object({
        action: z.enum(['add', 'edit', 'remove', 'list']),
        userId: z.string().optional(),
        text: z.string().optional(),
        id: z.string().optional(),
      })
      .parse(args ?? {});
    switch (p.action) {
      case 'list': {
        // The text of an approved or sent omen is not needed to draft the next round.
        const { omens, players } = await this.omens.list();
        return {
          omens: omens.map(o => ({
            id: o.id,
            userId: o.userId,
            status: o.status,
            ...(o.status === 'draft' || o.status === 'rejected' ? { text: o.text } : {}),
            ...(o.secretTerms ? { secretTerms: o.secretTerms } : {}),
          })),
          playersWithDiscord: Object.keys(players),
        };
      }
      case 'add': {
        const { id, omen } = await this.omens.add(p.userId, p.text);
        return {
          id,
          status: omen.status,
          ...(omen.secretTerms ? { secretTerms: omen.secretTerms } : {}),
        };
      }
      case 'edit': {
        if (!p.id) throw new Error('edit needs id');
        const omen = await this.omens.edit(p.id, p.text);
        return {
          id: p.id,
          status: omen.status,
          ...(omen.secretTerms ? { secretTerms: omen.secretTerms } : {}),
        };
      }
      case 'remove':
        if (!p.id) throw new Error('remove needs id');
        await this.omens.remove(p.id);
        return { removed: p.id };
    }
  }
}
