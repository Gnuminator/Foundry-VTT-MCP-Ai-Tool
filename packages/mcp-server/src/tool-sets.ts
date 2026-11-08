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

/**
 * The five sets a stdio wrapper (a Claude Desktop entry) can serve. The sixth set, `player`
 * (D-136), is never served on stdio: its tools need a verified Foundry user id, which only the
 * dashboard's `/mcp/player` route (control message `player_tool`) can supply. `resolveToolSets`
 * drops it, `all` excludes it and `filterToolsBySets` never lists its tools.
 */
export const TOOL_SET_NAMES = ['core', 'play', 'prep', 'build', 'admin'] as const;

/** The set only `/mcp/player` serves. */
export const PLAYER_TOOL_SET = 'player' as const;

/** Every set the catalog knows, the player set last. */
export const ALL_TOOL_SET_NAMES = [...TOOL_SET_NAMES, PLAYER_TOOL_SET] as const;

export type ToolSetName = (typeof ALL_TOOL_SET_NAMES)[number];

/** The sets a stdio wrapper may serve (everything but `player`). */
export type ServedToolSetName = (typeof TOOL_SET_NAMES)[number];

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
      'get-level-up-options',
      'list-scenes',
      'get-current-scene',
      'get-token-positions',
      'get-combat-state',
      'list-journals',
      'search-journals',
      'search-compendium',
      'search-rules',
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
      'wait-for-game-event',
      'plan-actor-change',
      'plan-token-change',
      'roll-saving-throws',
      'use-npc-activity',
      'manage-rest',
      'get-party',
      'plan-party-change',
      'plan-combat-change',
      'plan-scene-change',
      'plan-scene-restore',
      'plan-npc-turn',
      'plan-paper-sync',
      'plan-scene-mood',
      'list-scene-moods',
      'play-playlist',
      'mark-play-session',
      'check-action',
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
      'Make and change NPCs, monsters and items: from a compendium or from scratch, with features, attacks and spells. Set up rooms: teleports and tokens in a room.',
    tools: [
      'list-creatures-by-criteria',
      'get-compendium-entry-full',
      'create-actor-from-compendium',
      'dnd5e-create-npc',
      'dnd5e-add-feature',
      'dnd5e-add-features-from-compendium',
      'manage-world-items',
      'plan-room-setup',
    ],
  },
  admin: {
    title: 'Admin',
    purpose:
      'Set up and troubleshoot: installed modules and their errors, Foundry settings, modules on or off, user roles, who can open a compendium pack, a journal or a scene, who owns which actor, round token rings for all actors, and the Obsidian mirror settings.',
    tools: [
      'get-modules',
      'get-module-errors',
      'clear-module-errors',
      'get-module-manifest',
      'list-actor-ownership',
      'plan-ownership-change',
      'plan-table-viewer',
      'plan-foundry-setup',
      'plan-token-rings',
      'get-obsidian-mirror',
      'plan-obsidian-mirror',
    ],
  },
  player: {
    title: 'Player',
    purpose:
      "A player's own read-only view: their character sheet, what their next level grants, and short passages from the books their Foundry user can see. Served only on /mcp/player, never on stdio.",
    tools: [
      'get-my-character',
      'get-my-level-up-options',
      'search-books',
      'find-book-entries',
      'get-book-entry',
    ],
  },
};

/** The environment variable a Claude Desktop entry sets, e.g. `core` or `prep,admin`. */
export const TOOL_SETS_ENV = 'FOUNDRY_AI_TOOL_SETS';

const SET_OF_TOOL: ReadonlyMap<string, ToolSetName> = new Map(
  ALL_TOOL_SET_NAMES.flatMap(set => TOOL_SETS[set].tools.map(tool => [tool, set] as const))
);

/**
 * Splits a tool list into the tools every control client may list (`list_tools`) and the player
 * tools, which only the control message `list_player_tools` returns: an installed wrapper from
 * before the player set would otherwise list them in its core entry and fail every call.
 */
export function splitPlayerTools<T extends { name: string }>(
  tools: readonly T[]
): { listed: T[]; player: T[] } {
  const player = TOOL_SETS[PLAYER_TOOL_SET].tools;
  return {
    listed: tools.filter(t => !player.includes(t.name)),
    player: tools.filter(t => player.includes(t.name)),
  };
}

/** The set a tool belongs to, or undefined for a name no set lists. */
export function toolSetOf(toolName: string): ToolSetName | undefined {
  return SET_OF_TOOL.get(toolName);
}

export interface ToolSetSelection {
  /** The sets this wrapper serves, in canonical order. All four when nothing narrows it. */
  sets: readonly ServedToolSetName[];
  /** True when every tool is served (unset, blank, `all`, or nothing valid named). */
  all: boolean;
  /** Problems with the value, for the wrapper log. */
  warnings: string[];
}

function isToolSetName(value: string): value is ServedToolSetName {
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
 * does not list yet; otherwise only the listed tools of the chosen sets. A tool no
 * set lists (the backend is newer than this wrapper) passes through in the entry
 * that serves core, so a wrapper behind the backend never hides a tool.
 */
export function filterToolsBySets<T extends { name: string }>(
  tools: readonly T[],
  selection: Pick<ToolSetSelection, 'sets' | 'all'>
): T[] {
  // The player tools need a verified user id; no stdio wrapper lists them, whatever it is told.
  const served = tools.filter(t => toolSetOf(t.name) !== PLAYER_TOOL_SET);
  if (selection.all) return served;
  return served.filter(t => {
    const set = toolSetOf(t.name);
    return selection.sets.includes((set ?? 'core') as ServedToolSetName);
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
    'Foundry AI Tool: access to the Foundry VTT game (D&D 5e). Tools named plan-* only prepare a change; it happens when apply-planned-change runs, and undo-change takes it back. A tool whose description starts "Direct write." acts at once, with no plan. A change it makes to Foundry documents is recorded in the change journal (listed as the GM\'s own change) and can be taken back with list-changes and plan-undo-changes while the journal is on. The journal covers actors, items, effects, tokens, scenes, combat and journals; it does not record music (playlists), folders, chat messages or rolls, so plan-undo-changes cannot take those back (an AI music change still undoes with undo-change). plan-undo-changes needs the "AI Tool: Undo for everything" switch and "AI Tool: Allow Write Operations" turned on in Foundry; undo-change needs only the latter. Records are kept for 7 days.';
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
