/**
 * Tool sets (PB-12): the tools split into five groups, so a Claude Desktop
 * conversation carries only the tool definitions it needs (all of them together
 * are a lot of JSON before anyone types). The current counts and sizes are in
 * docs/reference/TOOL-SETS.md, which the tool catalog test keeps true.
 *
 * Each Claude Desktop entry runs the stdio wrapper (`index.ts`) with
 * `FOUNDRY_AI_TOOL_SETS` naming its sets; Claude Desktop then shows one switch
 * per entry, so the GM turns sets on and off per conversation. All entries share
 * one bridge backend. The dashboard reads the control channel and always sees
 * every tool.
 *
 * Every tool belongs to exactly one set (the tool catalog test checks this).
 * A new tool goes into a set here, and a new feature gets one tool with an
 * `action` parameter rather than several small tools.
 *
 * Pure: no SDK, no I/O.
 */

export const TOOL_SET_NAMES = ['core', 'play', 'prep', 'build', 'admin'] as const;

export type ToolSetName = (typeof TOOL_SET_NAMES)[number];

export interface ToolSetSpec {
  /** Short label, for docs and the server instructions. */
  title: string;
  /** One sentence: what the set is for. */
  purpose: string;
  tools: readonly string[];
}

export const TOOL_SETS: Readonly<Record<ToolSetName, ToolSetSpec>> = {
  core: {
    title: 'Core',
    purpose:
      'Look things up (world, characters, scenes, journals, compendiums, combat) and review, apply or undo planned changes. Always on.',
    tools: [
      'get-world-info',
      'list-characters',
      'get-character',
      'get-character-entity',
      'search-character-items',
      'list-scenes',
      'get-current-scene',
      'get-token-positions',
      'get-combat-state',
      'list-journals',
      'search-journals',
      'search-compendium',
      'get-compendium-item',
      'list-compendium-packs',
      'get-planned-change',
      'apply-planned-change',
      'list-recent-changes',
      'list-changes',
      'plan-undo-changes',
      'undo-change',
      'open-in-foundry',
      'check-secret-terms',
    ],
  },
  play: {
    title: 'Play',
    purpose:
      'Run the table live: tokens, combat turns, rolls, damage, conditions, resources, chat, scene mood, map notes and loot.',
    tools: [
      'switch-scene',
      'use-item',
      'request-player-rolls',
      'request-ability-check',
      'request-attack-roll',
      'roll-npc-check',
      'get-token-details',
      'get-available-conditions',
      'get-chat-log',
      'get-combat-play-by-play',
      'send-chat-message',
      'get-character-resources',
      'get-active-effects',
      'advance-combat-turn',
      'set-initiative',
      'roll-initiative-for-npcs',
      'measure-distance',
      'get-targets',
      'get-recent-events',
      'plan-actor-change',
      'plan-token-change',
      'roll-saving-throws',
      'use-npc-activity',
      'manage-rest',
      'get-party',
      'plan-party-change',
      'plan-scene-change',
      'play-playlist',
      'mark-play-session',
    ],
  },
  prep: {
    title: 'Prep',
    purpose:
      'Prepare sessions and write recaps: quests and journals, encounter budgets, the Tarokka reading, handouts, the session log, play stats and the pre-flight check.',
    tools: [
      'create-quest-journal',
      'update-quest-journal',
      'link-quest-to-npc',
      'create-campaign-dashboard',
      'suggest-balanced-encounter',
      'get-tarokka-reading',
      'plan-tarokka-import',
      'suggest-tarokka-links',
      'plan-tarokka-links',
      'plan-tarokka-reveal',
      'get-player-visibility',
      'list-revealed-pages',
      'get-player-handouts',
      'plan-page-reveal',
      'list-ref-choices',
      'get-session-log',
      'get-play-session',
      'get-play-stats',
      'get-preflight',
      'get-prep-digest',
    ],
  },
  build: {
    title: 'Build',
    purpose:
      'Make and change NPCs, monsters and items: from a compendium or from scratch, with features, attacks and spells.',
    tools: [
      'list-creatures-by-criteria',
      'get-compendium-entry-full',
      'create-actor-from-compendium',
      'dnd5e-create-npc',
      'dnd5e-add-feature',
      'dnd5e-add-features-from-compendium',
      'manage-world-items',
    ],
  },
  admin: {
    title: 'Admin',
    purpose:
      'Set up and troubleshoot: installed modules and their errors, who owns which actor, and the Obsidian mirror settings.',
    tools: [
      'get-modules',
      'get-module-errors',
      'clear-module-errors',
      'get-module-manifest',
      'list-actor-ownership',
      'plan-ownership-change',
      'get-obsidian-mirror',
      'plan-obsidian-mirror',
    ],
  },
};

/** The environment variable a Claude Desktop entry sets, e.g. `core` or `prep,admin`. */
export const TOOL_SETS_ENV = 'FOUNDRY_AI_TOOL_SETS';

const SET_OF_TOOL: ReadonlyMap<string, ToolSetName> = new Map(
  TOOL_SET_NAMES.flatMap(set => TOOL_SETS[set].tools.map(tool => [tool, set] as const))
);

/** The set a tool belongs to, or undefined for a name no set lists. */
export function toolSetOf(toolName: string): ToolSetName | undefined {
  return SET_OF_TOOL.get(toolName);
}

export interface ToolSetSelection {
  /** The sets this wrapper serves, in canonical order. All four when nothing narrows it. */
  sets: readonly ToolSetName[];
  /** True when every tool is served (unset, blank, `all`, or nothing valid named). */
  all: boolean;
  /** Problems with the value, for the wrapper log. */
  warnings: string[];
}

function isToolSetName(value: string): value is ToolSetName {
  return (TOOL_SET_NAMES as readonly string[]).includes(value);
}

/**
 * Read `FOUNDRY_AI_TOOL_SETS`: set names separated by commas or spaces, any
 * case. Unset, blank or `all` serves every tool, so a config written before the
 * sets existed keeps working. Unknown names are ignored with a warning; if no
 * valid name is left, every tool is served (a Claude Desktop entry with no tools
 * would be harder to notice than one with too many).
 */
export function resolveToolSets(raw: string | undefined): ToolSetSelection {
  const everything = { sets: TOOL_SET_NAMES, all: true };
  const words = (raw ?? '')
    .split(/[\s,]+/)
    .map(w => w.trim().toLowerCase())
    .filter(Boolean);
  if (words.length === 0 || words.includes('all')) return { ...everything, warnings: [] };

  const unknown = words.filter(w => !isToolSetName(w));
  const warnings = unknown.map(
    w =>
      `${TOOL_SETS_ENV}: unknown tool set "${w}" ignored (sets: ${TOOL_SET_NAMES.join(', ')}, all)`
  );
  const chosen = TOOL_SET_NAMES.filter(set => words.includes(set));
  if (chosen.length === 0) {
    warnings.push(`${TOOL_SETS_ENV}: no valid tool set named, serving every tool`);
    return { ...everything, warnings };
  }
  return { sets: chosen, all: chosen.length === TOOL_SET_NAMES.length, warnings };
}

/**
 * The tools a selection serves. With `all`, every tool, including any a set
 * does not list yet; otherwise only the listed tools of the chosen sets.
 */
export function filterToolsBySets<T extends { name: string }>(
  tools: readonly T[],
  selection: Pick<ToolSetSelection, 'sets' | 'all'>
): T[] {
  if (selection.all) return [...tools];
  return tools.filter(t => {
    const set = toolSetOf(t.name);
    return set !== undefined && selection.sets.includes(set);
  });
}

/**
 * Reply-language line for every connector's instructions (D-114, the tool-pick
 * test's v4a wording). Naming both languages keeps Danish replies out of
 * Norwegian and Swedish without turning English requests into Danish ones.
 */
const LANGUAGE_LINE =
  "Answer in the same language as the user's latest message: English gets English, Danish gets Danish (not Norwegian or Swedish). Keep the English game terms (attack, saving throw, hit points, token).";

/**
 * The MCP `instructions` for a wrapper serving part of the tools: which sets
 * this connector holds and which other connectors hold the rest, so Claude can
 * tell the GM which switch to turn on instead of guessing with the wrong tool.
 */
export function toolSetInstructions(selection: Pick<ToolSetSelection, 'sets' | 'all'>): string {
  const intro =
    'Foundry AI Tool: access to the Foundry VTT game (D&D 5e). Writes go through plan, confirm and undo.';
  // Serving every set: no other connector to name, so no switch-first text.
  if (selection.all) return `${intro} This connector serves every tool set.\n${LANGUAGE_LINE}`;
  const lines = [intro, 'This connector serves:'];
  for (const set of selection.sets)
    lines.push(`- ${TOOL_SETS[set].title}: ${TOOL_SETS[set].purpose}`);
  const others = TOOL_SET_NAMES.filter(set => !selection.sets.includes(set));
  if (others.length > 0) {
    lines.push(
      'Other Foundry AI Tool sets (each is its own connector; the GM switches them on in the Search and tools menu, and some may be on already):'
    );
    for (const set of others) lines.push(`- ${TOOL_SETS[set].title}: ${TOOL_SETS[set].purpose}`);
    lines.push(
      'If a request needs a tool that is not in your tool list, first say which set to switch on, before looking anything up. Do not stand in for it with other tools; after naming the set you may offer what the sets that are on can show.'
    );
  }
  lines.push(LANGUAGE_LINE);
  return lines.join('\n');
}
