import { freeText } from '@gnuminator/shared';
import { z } from 'zod';

import { knownByLine, type LedgerStore } from '../ledger/store.js';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown> };
}

interface SecretLedgerToolsOptions {
  ledger: Pick<LedgerStore, 'query'>;
}

/**
 * `get-secret-ledger`: who knows which secret. Read only; the ledger is written by the GM in the
 * dashboard and by the whisper desk, never by a tool, so Claude can answer "what does Jorr know
 * about the amulet?" but cannot change who knows what.
 */
export class SecretLedgerTools {
  private readonly ledger: SecretLedgerToolsOptions['ledger'];

  constructor(options: SecretLedgerToolsOptions) {
    this.ledger = options.ledger;
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'get-secret-ledger',
        description:
          'GM ONLY. Who knows which secret: whispers the GM sent, private backstories, rumours held by one player. Filter by a player name (who), a journal page id (pageId) or a word in the text. Read only. Never repeat it to players.',
        inputSchema: {
          type: 'object',
          properties: {
            who: { type: 'string', ...freeText('A player name: only what they know.') },
            pageId: { type: 'string', ...freeText('A journal page id.') },
            text: { type: 'string', ...freeText('A word the secret mentions.') },
          },
        },
      },
    ];
  }

  async handleGetSecretLedger(args: unknown): Promise<unknown> {
    const p = z
      .object({
        who: z.string().optional(),
        pageId: z.string().optional(),
        text: z.string().optional(),
      })
      .parse(args ?? {});
    const entries = await this.ledger.query({
      ...(p.who ? { who: p.who } : {}),
      ...(p.pageId ? { pageId: p.pageId } : {}),
      ...(p.text ? { text: p.text } : {}),
    });
    return {
      entries: entries.map(e => ({
        id: e.id,
        kind: e.kind,
        text: e.text,
        knownBy: e.knownBy.map(k => k.name),
        line: knownByLine(e.knownBy),
        ...(e.pageName ? { pageName: e.pageName } : {}),
        at: e.at,
      })),
    };
  }
}
