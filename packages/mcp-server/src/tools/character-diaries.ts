import { z } from 'zod';
import { CHARACTER_DIARY_FEATURE_ID, toolRef, type GuardedOp } from '@gnuminator/shared';
import { FoundryClient } from '../foundry-client.js';
import type { GuardedWriteService, PlanView } from '../guarded-write/service.js';
import { Logger } from '../logger.js';
import type { SecretTermsService } from '../secret-terms.js';
import { newDocumentId } from '../tarokka/service.js';
import type { WorldIdResolver } from '../vault/world-id.js';

interface PlayerCharacterDiaryDraft {
  actorId: string;
  actorName: string;
  ownerIds: string[];
  ownerNames: string[];
  text: string;
}

export interface CharacterDiaryToolsOptions {
  foundryClient: Pick<FoundryClient, 'query'>;
  guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  secretTerms: Pick<SecretTermsService, 'findSecretTerms'>;
  worldIds: Pick<WorldIdResolver, 'current'>;
  logger: Logger;
}

const MAX_DIARIES = 8;
const TEXT_MAX = 2000;

const params = z
  .object({
    diaries: z
      .array(
        z
          .object({ actor: z.string().trim().min(1), text: z.string().trim().min(1).max(TEXT_MAX) })
          .strict()
      )
      .min(1)
      .max(MAX_DIARIES),
    session: z.string().trim().max(60).optional(),
  })
  .strict();

interface OwnershipEntry {
  id: string;
  name: string;
  type: string;
  ownership: Array<{ userId: string; userName: string; numericPermission: number }>;
}

const OWNER = 3;

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Blank line = new paragraph; single line breaks stay as breaks. */
function toHtml(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map(p => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * `plan-character-diaries` (I-183, route B): one hidden diary journal per player character, owned
 * by that character's player and (as always) the GM; the default access is none, so no other
 * player can open it. One guarded plan (feature `character-diary`, off by default, never
 * auto-applied); undo-change deletes the journals again. Claude writes the drafts from the
 * revealed recap and the play stats only; the text is checked against the secret terms here.
 */
export class CharacterDiaryTools {
  constructor(private readonly options: CharacterDiaryToolsOptions) {}

  getToolDefinitions(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> {
    return [
      {
        name: 'plan-character-diaries',
        description:
          'After a marked session: plan one diary draft (about 150 words, first person) per player character as a private journal, visible only to that character\'s player and the GM. Use only facts the recap or handouts revealed. Apply with apply-planned-change, undo with undo-change. Needs the "AI Tool: Character diaries (writes)" switch.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            diaries: {
              type: 'array',
              minItems: 1,
              maxItems: MAX_DIARIES,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  actor: {
                    type: 'string',
                    description: 'The player character: name or id.',
                    ...toolRef('actor', 'name', {
                      filter: { types: ['character'], playerOwned: true },
                    }),
                  },
                  text: { type: 'string', description: 'The diary entry.' },
                },
                required: ['actor', 'text'],
              },
            },
            session: { type: 'string', description: 'Label, e.g. "Session 1".' },
          },
          required: ['diaries'],
        },
      },
    ];
  }

  async handleToolCall(name: string, args: unknown): Promise<PlanView & Record<string, unknown>> {
    if (name !== 'plan-character-diaries') throw new Error(`Unknown diary tool: ${name}`);
    const p = params.parse(args ?? {});

    // Spoiler check first: nothing is planned for text that names a secret.
    const worldId = await this.options.worldIds.current();
    const { matches } = await this.options.secretTerms.findSecretTerms(
      worldId,
      p.diaries.map(d => d.text).join('\n')
    );
    if (matches.length > 0) {
      throw new Error(
        `The diaries name ${matches.map(m => `"${m.term}" (${m.category})`).join(', ')}, which players must not see yet. Reword them.`
      );
    }

    const actors = (await this.options.foundryClient.query('foundry-mcp-bridge.getActorOwnership', {
      actorIdentifier: 'all',
    })) as OwnershipEntry[];
    const characters = (Array.isArray(actors) ? actors : []).filter(a => a.type === 'character');

    const drafts: PlayerCharacterDiaryDraft[] = [];
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const d of p.diaries) {
      const wanted = d.actor.toLowerCase();
      const actor =
        characters.find(a => a.id === d.actor) ??
        characters.find(a => a.name.toLowerCase() === wanted);
      if (!actor) {
        problems.push(`"${d.actor}" is not a character in this world`);
        continue;
      }
      if (seen.has(actor.id)) {
        problems.push(`${actor.name} appears twice`);
        continue;
      }
      seen.add(actor.id);
      const owners = actor.ownership.filter(o => o.numericPermission >= OWNER);
      if (owners.length === 0) {
        problems.push(`${actor.name} has no player owner, so nobody could read the diary`);
        continue;
      }
      drafts.push({
        actorId: actor.id,
        actorName: actor.name,
        ownerIds: owners.map(o => o.userId),
        ownerNames: owners.map(o => o.userName),
        text: d.text,
      });
    }
    if (problems.length > 0) throw new Error(`No plan made: ${problems.join('; ')}.`);

    const label = p.session ? ` (${p.session})` : '';
    const ops: GuardedOp[] = drafts.map(d => {
      const ownership: Record<string, number> = { default: 0 };
      for (const id of d.ownerIds) ownership[id] = OWNER;
      return {
        kind: 'create',
        documentName: 'JournalEntry',
        keepId: true,
        data: {
          _id: newDocumentId(),
          name: `Diary: ${d.actorName}${label}`,
          ownership,
          pages: [
            {
              _id: newDocumentId(),
              name: 'Diary',
              type: 'text',
              text: { format: 1, content: toHtml(d.text) },
            },
          ],
        },
      };
    });
    const plan = await this.options.guardedWrites.createPlan({
      feature: CHARACTER_DIARY_FEATURE_ID,
      summary: `Diary drafts${label}: ${drafts.map(d => d.actorName).join(', ')}`,
      ops,
    });
    return {
      ...plan,
      drafts: drafts.map(d => ({
        actor: d.actorName,
        visibleTo: d.ownerNames,
        words: d.text.split(/\s+/).length,
      })),
      note: 'Apply to create the journals. Each is visible only to its owner and the GM; undo-change removes them.',
    };
  }
}
