import type { PromptDefinition, ResolvedPromptArguments } from './types.js';
import {
  RULE_GM_ONLY,
  RULE_HONEST,
  RULE_HONEST_PLAYER_SAFE,
  RULE_PARAPHRASE,
  RULE_PLAIN,
  RULE_PLAN,
  RULE_READ_ONLY,
  assemble,
} from './text.js';

/**
 * The only tools the players version may name. Everything else holds GM-only
 * data (journals, chat log, compendiums, actors, Tarokka, Obsidian), so a new
 * tool in this recap must be a deliberate change (prompts.test.ts checks it).
 */
export const PLAYER_RECAP_TOOLS: readonly string[] = [
  'get-play-session',
  'get-play-stats',
  'get-session-log',
  'list-revealed-pages',
  'check-secret-terms',
];

/** The session-log event types the players' page shows; the players recap keeps only these. */
const PLAYER_EVENT_TYPES =
  'combat-start, combat-end, damage, healing, death, stabilize, condition-applied, condition-removed, resource-spent, scene-change, roll, damage-roll';

function sessionLabel(session: string): string {
  return session === 'latest' ? 'the latest session' : `session number ${session}`;
}

function statsStep(session: string, scope: string): string {
  const how =
    session === 'latest'
      ? 'with no `session` (it defaults to the latest session)'
      : `with \`session\` set to ${session}`;
  return `Call \`get-play-stats\` ${how}. ${scope}`;
}

function gmSteps(session: string): string[] {
  return [
    'Call `get-play-session`. If a session is open right now, the recap is "so far".',
    statsStep(
      session,
      'Take the numbers for each character: damage, healing, downs, kills, spells, resources, loot and XP.'
    ),
    'Call `get-session-log` with `limit` set to 500 for the story beats. It only holds events since my Foundry window last loaded and it does not know session numbers, so use it only if its timestamps fall inside the session you are recapping. If it does not, say the story part is missing and recap from the numbers alone. Do not invent the story.',
    'Call `list-recent-changes` for the AI changes applied around then.',
    'If the log names scenes, NPCs or places you need context for, call `search-journals` with `searchQuery` and read the page with `list-journals` (`journalId`, `pageId`). Use notes only to explain, never to add events that did not happen.',
    'Write the recap under these headings: "What happened" (5 to 8 beats, in order), "Fights" (per fight: who, how many rounds, who went down), "Per character" (one line each, from the numbers), "Open threads", "Changes the AI made". Keep it under 500 words.',
    'Show it to me here. Do not send it anywhere.',
  ];
}

function playerSteps(session: string): string[] {
  return [
    'Call `get-play-session`. If a session is open right now, the recap is "so far".',
    statsStep(
      session,
      'Use only the numbers of player characters (damage, healing, downs, spells, resources, loot, XP). Ignore every monster or NPC name in the result.'
    ),
    `Call \`get-session-log\` with \`limit\` set to 500. Keep only these event types: ${PLAYER_EVENT_TYPES}. Drop everything else, above all gm-roll, journal-created and journal-updated. It only holds events since my Foundry window last loaded and it does not know session numbers, so use it only if its timestamps fall inside the session you are recapping.`,
    'For every event you keep, read its "visibility" block. Name a player character by its "playerName". Name anything else only when its subject is npc and "tokenVisible" is true, and then only by "playerName"; otherwise say "a creature". Take scene names only from "sceneName" and conditions only from "statuses". Never use the "actorName" of anything that is not a player character. For a non-player creature give no hit point numbers: only that it was hit or went down. For spell slots, mention only a player character using a slot of some level.',
    'Call `list-revealed-pages` for the handouts I already gave the players. Mention titles only, never what the pages say.',
    'Write the recap in a friendly story voice under these headings: "What happened" (5 to 8 beats, in the order the scenes and fights happened), "How the party did" (one short line per character from the numbers), "What is on the table" (the handout titles). Include only what the characters saw and did. No monster names they have not learned, no secrets, no reasons behind events, nothing about what comes next. If in doubt, leave it out.',
    'Call `check-secret-terms` with `text` set to the finished recap (at most 5000 characters; check a long recap in pieces). Remove or reword every sentence it matches, then check again.',
    'Show me the recap as a draft labelled "For the players". Do not send it anywhere; I decide where it goes.',
  ];
}

export const sessionRecap: PromptDefinition = {
  name: 'session-recap',
  title: 'Session recap',
  description:
    'Write a recap of a session from the play log. The players version uses only what the players may know.',
  arguments: [
    {
      name: 'audience',
      description:
        'Who the recap is for: gm (default, everything I know) or players (spoiler-safe, only what the players saw).',
      required: false,
      maxLength: 10,
      oneOf: ['gm', 'players'],
      default: 'gm',
    },
    {
      name: 'session',
      description:
        'Which session: a number (1 is the first, as in the Obsidian session notes) or latest (default).',
      required: false,
      maxLength: 10,
      default: 'latest',
      check: value =>
        /^(latest|[1-9]\d{0,3})$/i.test(value)
          ? null
          : 'must be a session number like 3, or "latest".',
      normalize: value => value.toLowerCase(),
    },
  ],
  build: (args: ResolvedPromptArguments) => {
    const audience = args.audience === 'players' ? 'players' : 'gm';
    const session = args.session ?? 'latest';
    if (audience === 'players') {
      return assemble({
        goal: `Write a spoiler-free recap of ${sessionLabel(session)} for my players. I will read it out or post it myself.`,
        steps: playerSteps(session),
        rules: [
          RULE_PLAIN,
          RULE_HONEST_PLAYER_SAFE,
          'Spoilers are the one thing to avoid. Use only the tools named in the steps above. Do not read journals, the chat log, compendiums, actors, Tarokka readings or Obsidian notes for this recap: they hold things the players must not know.',
          RULE_READ_ONLY,
        ],
      });
    }
    return assemble({
      goal: `Write a recap of ${sessionLabel(session)} for me. This one is for me, the GM, and can include what the players do not know.`,
      steps: gmSteps(session),
      rules: [RULE_PLAIN, RULE_HONEST, RULE_PARAPHRASE, RULE_GM_ONLY, RULE_PLAN],
    });
  },
};
