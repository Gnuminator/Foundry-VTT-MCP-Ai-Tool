import { freeText } from '@gnuminator/shared';
import { z } from 'zod';

import { DRAFT_KINDS, MAX_DRAFT_TEXT, type DraftsStore } from '../drafts/store.js';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * `draft-player-text` (I-069): Claude puts text meant for players in the GM's draft tray. Direct
 * write to the bridge vault only; nothing reaches chat from here. Publishing is never a tool, so
 * a draft cannot publish itself.
 */
export class DraftsTools {
  constructor(private readonly drafts: Pick<DraftsStore, 'list' | 'add' | 'edit' | 'remove'>) {}

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'draft-player-text',
        description: `Direct write. GM ONLY. Put text meant for players in the GM's draft tray (read-aloud, NPC line, letter, recap), up to ${MAX_DRAFT_TEXT} characters. Only writes the tray; the GM edits, publishes to chat or discards it in the dashboard, with the secret-terms check shown. Use instead of send-chat-message for anything players will read. No spoilers.`,
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['add', 'edit', 'remove', 'list'] },
            kind: { type: 'string', enum: [...DRAFT_KINDS], description: 'add: the kind.' },
            text: { type: 'string', description: 'add or edit: the text.' },
            speaker: {
              type: 'string',
              description: 'NPC line: the speaker. Letter: who it is from.',
            },
            whisperTo: {
              type: 'string',
              description: 'Foundry user name (not a character); without it, posts to all.',
            },
            id: { type: 'string', ...freeText('A draft id from action list') },
          },
          required: ['action'],
        },
      },
    ];
  }

  async handleDraftPlayerText(args: unknown): Promise<unknown> {
    const p = z
      .object({
        action: z.enum(['add', 'edit', 'remove', 'list']),
        kind: z.string().optional(),
        text: z.string().optional(),
        speaker: z.string().optional(),
        whisperTo: z.string().optional(),
        id: z.string().optional(),
      })
      .parse(args ?? {});
    switch (p.action) {
      case 'list': {
        const { drafts } = await this.drafts.list();
        return {
          drafts: drafts.map(d => ({
            id: d.id,
            kind: d.kind,
            status: d.status,
            ...(d.status === 'draft' ? { text: d.text } : {}),
            ...(d.secretTerms ? { secretTerms: d.secretTerms } : {}),
          })),
        };
      }
      case 'add': {
        const { id, draft } = await this.drafts.add(p);
        return {
          id,
          status: draft.status,
          ...(draft.secretTerms ? { secretTerms: draft.secretTerms } : {}),
        };
      }
      case 'edit': {
        if (!p.id) throw new Error('edit needs id');
        const draft = await this.drafts.edit(p.id, p);
        return {
          id: p.id,
          status: draft.status,
          ...(draft.secretTerms ? { secretTerms: draft.secretTerms } : {}),
        };
      }
      case 'remove':
        if (!p.id) throw new Error('remove needs id');
        await this.drafts.remove(p.id);
        return { removed: p.id };
    }
  }
}
