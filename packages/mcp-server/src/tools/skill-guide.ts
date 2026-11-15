import { z } from 'zod';
import { GM_SKILLS, serveSkillGuide } from '../skill-guide.js';

/**
 * `get-skill-guide`: the changing content of the uploaded GM coach and D&D helper skills, served
 * from this backend so a deploy updates it. Read-only, no Foundry call. The player edition has its
 * own tool in the player set (`get-player-skill-guide`), so this one never serves player-set
 * content the other way round and a player's connector never lists it.
 */
const args = z.object({
  skill: z.enum(GM_SKILLS),
  page: z.string().max(200).optional(),
  stubRevision: z.number().int().min(0).max(1000).optional(),
});

export class SkillGuideTools {
  getToolDefinitions(): Array<{ name: string; description: string; inputSchema: object }> {
    return [
      {
        name: 'get-skill-guide',
        description:
          'Current guide of an uploaded skill (GM coach or D&D helper) and its pages. Skills call it; omit page for the guide.',
        inputSchema: {
          type: 'object',
          properties: {
            skill: { type: 'string', enum: [...GM_SKILLS] },
            page: { type: 'string', description: 'Page path from the guide.' },
            stubRevision: { type: 'integer', description: 'Number in the skill stub.' },
          },
          required: ['skill'],
        },
      },
    ];
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- a route returns a promise
  async handleGetSkillGuide(raw: unknown): Promise<string> {
    const a = args.parse(raw ?? {});
    const answer = serveSkillGuide({
      skill: a.skill,
      page: a.page,
      stubRevision: a.stubRevision,
    });
    if (answer.isError) throw new Error(answer.text);
    return answer.text;
  }
}
