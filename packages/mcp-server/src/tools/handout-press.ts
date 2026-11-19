import {
  HANDOUT_PRESS_TEMPLATES,
  UPLOAD_HANDOUT_IMAGE_QUERY,
  unwrapBridgeReply,
} from '@gnuminator/shared';
import { z } from 'zod';

import type { FoundryClient } from '../foundry-client.js';
import type { HandoutsService } from '../handouts/service.js';
import { PRESS_LIMITS, renderPress, type PressContent } from '../handouts/press.js';
import type { Logger } from '../logger.js';
import type { SecretTermsService } from '../secret-terms.js';
import type { WorldIdResolver } from '../vault/world-id.js';

export interface HandoutPressToolsOptions {
  handouts: Pick<HandoutsService, 'planPressedPage'>;
  secretTerms: Pick<SecretTermsService, 'findSecretTerms'>;
  foundryClient: Pick<FoundryClient, 'query'>;
  worldIds: Pick<WorldIdResolver, 'current'>;
  logger: Logger;
  /** The renderer (default: the local Edge or Chrome); tests pass a stand-in. */
  render?: typeof renderPress;
}

const params = z.object({
  template: z.enum(HANDOUT_PRESS_TEMPLATES),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1),
  footer: z.string().trim().max(PRESS_LIMITS.footer).optional(),
});

const MAX_PNG_BYTES = 5 * 1024 * 1024;

/**
 * `plan-handout-press`: render supplied text as a letter, notice or card picture on this PC and
 * plan a hidden image page for it in the "Handouts" journal. Revealing goes through the queue
 * (plan-page-reveal); undo removes the page.
 */
export class HandoutPressTools {
  private readonly render: typeof renderPress;

  constructor(private readonly options: HandoutPressToolsOptions) {
    this.render = options.render ?? renderPress;
  }

  getToolDefinitions(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> {
    return [
      {
        name: 'plan-handout-press',
        description:
          'Render text as a handout picture (letter, notice or card) and plan a hidden page for it in Handouts; queue and reveal it with plan-page-reveal. Refuses secret terms. Limits: body letter 1200, notice 700, card 400 characters; title letter 120, notice 60, card 30.',
        inputSchema: {
          type: 'object',
          properties: {
            template: { type: 'string', enum: [...HANDOUT_PRESS_TEMPLATES] },
            title: { type: 'string' },
            body: { type: 'string', description: 'Blank line = new paragraph.' },
            footer: { type: 'string', description: 'Signature or caption.' },
          },
          required: ['template', 'title', 'body'],
        },
      },
    ];
  }

  async handleToolCall(name: string, args: unknown): Promise<Record<string, unknown>> {
    if (name !== 'plan-handout-press') throw new Error(`Unknown handout press tool: ${name}`);
    const p = params.parse(args ?? {});
    const bodyLimit = PRESS_LIMITS.body[p.template];
    if (p.body.length > bodyLimit) {
      throw new Error(
        `A ${p.template} holds at most ${bodyLimit} characters of text; this has ${p.body.length}. Shorten it, or use the letter for longer text.`
      );
    }
    const titleLimit = PRESS_LIMITS.title[p.template];
    if (p.title.length > titleLimit) {
      throw new Error(
        `A ${p.template} title holds at most ${titleLimit} characters; this has ${p.title.length}. Shorten it.`
      );
    }
    const content: PressContent = {
      title: p.title,
      body: p.body,
      ...(p.footer ? { footer: p.footer } : {}),
    };

    // The spoiler check first: nothing is rendered or stored for text that names a secret.
    const worldId = await this.options.worldIds.current();
    const { matches } = await this.options.secretTerms.findSecretTerms(
      worldId,
      [p.title, p.body, p.footer ?? ''].join('\n')
    );
    if (matches.length > 0) {
      throw new Error(
        `The text names ${matches.map(m => `"${m.term}" (${m.category})`).join(', ')}, which players must not see yet. Reword it.`
      );
    }

    // The switch next, so a world with handouts off does not start a browser first.
    const features = unwrapBridgeReply(
      await this.options.foundryClient.query('foundry-mcp-bridge.listGuardedFeatures'),
      'Feature list refused'
    );
    if (!features.find(f => f.id === 'handouts')?.enabled) {
      throw new Error(
        'Handouts are switched off. Ask the GM to turn on "AI Tool: Handouts (writes)" in Foundry.'
      );
    }

    const png = await this.render(p.template, content);
    if (png.length > MAX_PNG_BYTES) {
      throw new Error('The rendered picture is too big (over 5 MB). Shorten the text.');
    }
    const reply = unwrapBridgeReply(
      await this.options.foundryClient.query(
        `foundry-mcp-bridge.${UPLOAD_HANDOUT_IMAGE_QUERY}`,
        { data: Buffer.from(png).toString('base64') },
        { timeoutMs: 60_000 }
      ),
      'Could not store the picture'
    );
    if (reply.success !== true || !reply.path) {
      throw new Error(reply.error || 'Could not store the picture.');
    }
    const plan = await this.options.handouts.planPressedPage({
      name: p.title,
      src: reply.path,
    });
    return {
      ...plan,
      template: p.template,
      path: reply.path,
      note: 'Apply to create the hidden page. Then queue it (plan-page-reveal, action "queue") and reveal it when the moment comes.',
    };
  }
}
