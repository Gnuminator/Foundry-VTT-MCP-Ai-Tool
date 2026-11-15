/**
 * The skill guides: what the thin uploaded Claude skills (tools/gm-coach/stub and friends) fetch
 * through `get-skill-guide` and `get-player-skill-guide`. The content is the full skill
 * (SKILL.md plus reference pages), embedded at build time by scripts/skill-guides.mjs, so a backend
 * deploy updates it and nobody uploads a zip again. Read-only; no Foundry call.
 *
 * Which skill a caller may read is fixed by the tool, never by an argument it could widen: the GM
 * tool serves `gm-coach` and `dnd-helper`, the player tool serves `dnd-helper-player` only.
 */
import {
  TOOL_VERSION,
  type SkillName,
  isSkillStubBehind,
  skillStubNotice,
} from '@gnuminator/shared';
import { SKILL_GUIDES } from './skill-guides.generated.js';

export const GM_SKILLS = ['gm-coach', 'dnd-helper'] as const satisfies readonly SkillName[];
export const PLAYER_SKILL = 'dnd-helper-player' as const satisfies SkillName;

/** The skill's own text without its front matter. */
function body(text: string): string {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, '');
}

export interface SkillGuideRequest {
  skill: SkillName;
  /** A page path from the guide (`references/gm/dashboard.md`); omit for the guide itself. */
  page?: string | undefined;
  /** The revision the uploaded stub reports (`SKILL_STUB_REVISION` when it was built). */
  stubRevision?: unknown;
}

export interface SkillGuideAnswer {
  text: string;
  isError: boolean;
}

/** The text a tool returns: the guide, one page, or an error naming the pages. */
export function serveSkillGuide(
  req: SkillGuideRequest,
  guides: Readonly<Record<string, Readonly<Record<string, string>>>> = SKILL_GUIDES,
  current: string = TOOL_VERSION
): SkillGuideAnswer {
  const files = Object.hasOwn(guides, req.skill) ? guides[req.skill] : undefined;
  if (!files || Object.keys(files).length === 0) {
    return {
      isError: true,
      text: 'The skill guide is not built into this server. Ask the person who runs the table to update it.',
    };
  }
  // A page name never touches the file system: it is looked up as a key of the embedded map.
  const pages = Object.keys(files).filter(name => name !== 'SKILL.md');
  const notice = isSkillStubBehind(req.stubRevision)
    ? `\n\n${skillStubNotice(req.skill, current)}`
    : '';
  if (req.page === undefined || req.page === '' || req.page === 'SKILL.md') {
    const list = pages.map(p => `- ${p}`).join('\n');
    return {
      isError: false,
      text:
        `${body(files['SKILL.md'] ?? '')}\n\n## Pages you can open\n\n` +
        `Call this tool again with \`page\` set to one of these paths:\n\n${list}${notice}`,
    };
  }
  const page = Object.hasOwn(files, req.page) ? files[req.page] : undefined;
  if (page === undefined) {
    return {
      isError: true,
      text: `No such page: ${req.page.slice(0, 120)}. Pages: ${pages.join(', ')}${notice}`,
    };
  }
  return { isError: false, text: `${page}${notice}` };
}
