/**
 * MCP tool annotations (I-124): every tool carries a title and read/write
 * hints, so Claude Desktop can group the look-ups as read-only (the GM allows
 * them once) and keep its prompt on the tools that change something. The
 * tool-pick test counted 0.6 to 0.8 "allow" clicks per request without them.
 *
 * Kinds:
 * - `read`: changes nothing in Foundry, the bridge vault or the logs. The
 *   `plan-*` tools count as reads: a plan only stages a change (it expires
 *   after 15 minutes); `apply-planned-change` makes it, so the prompt stays on
 *   the apply. Opening a sheet on the GM's screen changes nothing either.
 * - `write`: adds to the world, the bridge vault or a log and changes nothing
 *   already there beyond moving play along (chat messages, rolls, the combat
 *   turn, new documents, a session marker).
 * - `destructive`: can delete something or overwrite stored values (MCP:
 *   destructiveHint false means additive only): applying a plan (plans may
 *   delete), undo, using an item (spends charges, can delete a spent
 *   consumable), setting initiative, rests (reset HP and resources), journal
 *   page updates, world item updates, clearing the error buffer.
 *
 * `openWorldHint` and `idempotentHint` are left out: I-124 asks for these
 * three, and core and prep sit close to their size budgets.
 *
 * Read and write stay separate tools: a tool that writes on any action is a
 * write. Every tool has exactly one entry (the tool catalog test checks this,
 * and that no tool named like a write is marked read-only).
 *
 * Pure: no SDK, no I/O.
 */

export type ToolKind = 'read' | 'write' | 'destructive';

export interface ToolHintSpec {
  /** Short human title Claude Desktop shows instead of the tool name. */
  title: string;
  kind: ToolKind;
}

/** MCP `ToolAnnotations`, as this bridge sets them. */
export interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  /** Set on writes only (the MCP spec ignores it on read-only tools). */
  destructiveHint?: boolean;
}

export const TOOL_HINTS: Readonly<Record<string, ToolHintSpec>> = {
  // core
  'get-world-info': { title: 'Get world info', kind: 'read' },
  'list-characters': { title: 'List characters', kind: 'read' },
  'get-character': { title: 'Get character', kind: 'read' },
  'get-character-entity': { title: 'Get character item or effect', kind: 'read' },
  'search-character-items': { title: 'Search character items', kind: 'read' },
  'list-scenes': { title: 'List scenes', kind: 'read' },
  'get-current-scene': { title: 'Get current scene', kind: 'read' },
  'get-token-positions': { title: 'Get token positions', kind: 'read' },
  'get-combat-state': { title: 'Get combat state', kind: 'read' },
  'list-journals': { title: 'List or read journals', kind: 'read' },
  'search-journals': { title: 'Search journals', kind: 'read' },
  'search-compendium': { title: 'Search compendiums', kind: 'read' },
  'get-compendium-item': { title: 'Get compendium item', kind: 'read' },
  'list-compendium-packs': { title: 'List compendium packs', kind: 'read' },
  'get-planned-change': { title: 'Show planned change', kind: 'read' },
  'apply-planned-change': { title: 'Apply planned change', kind: 'destructive' },
  'list-recent-changes': { title: 'List recent AI changes', kind: 'read' },
  'list-changes': { title: 'List all recent changes', kind: 'read' },
  'plan-undo-changes': { title: 'Plan undoing changes', kind: 'read' },
  'undo-change': { title: 'Undo change', kind: 'destructive' },
  'open-in-foundry': { title: 'Open in Foundry', kind: 'read' },
  'check-secret-terms': { title: 'Check secret terms', kind: 'read' },
  // play
  'switch-scene': { title: 'Switch scene', kind: 'write' },
  'use-item': { title: 'Use item', kind: 'destructive' },
  'request-player-rolls': { title: 'Request player rolls', kind: 'write' },
  'request-ability-check': { title: 'Request ability check', kind: 'write' },
  'request-attack-roll': { title: 'Request attack roll', kind: 'write' },
  'roll-npc-check': { title: 'Roll NPC check', kind: 'write' },
  'get-token-details': { title: 'Get token details', kind: 'read' },
  'get-available-conditions': { title: 'List conditions', kind: 'read' },
  'get-chat-log': { title: 'Get chat log', kind: 'read' },
  'get-combat-play-by-play': { title: 'Get combat play-by-play', kind: 'read' },
  'send-chat-message': { title: 'Send chat message', kind: 'write' },
  'get-character-resources': { title: 'Get character resources', kind: 'read' },
  'get-active-effects': { title: 'Get active effects', kind: 'read' },
  'advance-combat-turn': { title: 'Advance combat turn', kind: 'write' },
  'set-initiative': { title: 'Set initiative', kind: 'destructive' },
  'roll-initiative-for-npcs': { title: 'Roll initiative', kind: 'write' },
  'measure-distance': { title: 'Measure distance', kind: 'read' },
  'get-targets': { title: 'Get GM targets', kind: 'read' },
  'get-recent-events': { title: 'Get recent events', kind: 'read' },
  'plan-actor-change': { title: 'Plan damage, healing or conditions', kind: 'read' },
  'plan-token-change': { title: 'Plan token change', kind: 'read' },
  'roll-saving-throws': { title: 'Roll NPC saving throws', kind: 'write' },
  'use-npc-activity': { title: 'Use NPC attack or activity', kind: 'write' },
  'manage-rest': { title: 'Run a rest', kind: 'destructive' },
  'get-party': { title: 'Get party', kind: 'read' },
  'plan-party-change': { title: 'Plan party change', kind: 'read' },
  'plan-scene-change': { title: 'Plan scene dressing', kind: 'read' },
  'play-playlist': { title: 'Play or stop playlist', kind: 'write' },
  'mark-play-session': { title: 'Mark play session start or end', kind: 'write' },
  // prep
  'create-quest-journal': { title: 'Create quest journal', kind: 'write' },
  'update-quest-journal': { title: 'Update quest journal', kind: 'destructive' },
  'link-quest-to-npc': { title: 'Link quest to NPC', kind: 'write' },
  'create-campaign-dashboard': { title: 'Create campaign dashboard', kind: 'write' },
  'suggest-balanced-encounter': { title: 'Suggest balanced encounter', kind: 'read' },
  'get-tarokka-reading': { title: 'Get Tarokka reading', kind: 'read' },
  'plan-tarokka-import': { title: 'Plan Tarokka reading import', kind: 'read' },
  'suggest-tarokka-links': { title: 'Suggest Tarokka links', kind: 'read' },
  'plan-tarokka-links': { title: 'Plan Tarokka links', kind: 'read' },
  'plan-tarokka-reveal': { title: 'Plan Tarokka reveal', kind: 'read' },
  'get-player-visibility': { title: 'Get player visibility', kind: 'read' },
  'list-revealed-pages': { title: 'List revealed pages', kind: 'read' },
  'get-player-handouts': { title: 'Get player handouts', kind: 'read' },
  'plan-page-reveal': { title: 'Plan page reveal', kind: 'read' },
  'list-ref-choices': { title: 'List parameter choices', kind: 'read' },
  'get-session-log': { title: 'Get session log', kind: 'read' },
  'get-play-session': { title: 'Get play session state', kind: 'read' },
  'get-play-stats': { title: 'Get play stats', kind: 'read' },
  'get-preflight': { title: 'Run pre-flight check', kind: 'read' },
  'get-prep-digest': { title: 'Get prep digest', kind: 'read' },
  // build
  'list-creatures-by-criteria': { title: 'List creatures by criteria', kind: 'read' },
  'get-compendium-entry-full': { title: 'Get full compendium entry', kind: 'read' },
  'create-actor-from-compendium': { title: 'Create actor from compendium', kind: 'write' },
  'dnd5e-create-npc': { title: 'Create NPC', kind: 'write' },
  'dnd5e-add-feature': { title: 'Add feature to actor', kind: 'write' },
  'dnd5e-add-features-from-compendium': {
    title: 'Add compendium features to actor',
    kind: 'write',
  },
  'manage-world-items': { title: 'Manage world items', kind: 'destructive' },
  // admin
  'get-modules': { title: 'List modules', kind: 'read' },
  'get-module-errors': { title: 'Get module errors', kind: 'read' },
  'clear-module-errors': { title: 'Clear module errors', kind: 'destructive' },
  'get-module-manifest': { title: 'Get module manifest', kind: 'read' },
  'list-actor-ownership': { title: 'List actor ownership', kind: 'read' },
  'plan-ownership-change': { title: 'Plan ownership change', kind: 'read' },
  'get-obsidian-mirror': { title: 'Get Obsidian mirror settings', kind: 'read' },
  'plan-obsidian-mirror': { title: 'Plan Obsidian mirror change', kind: 'read' },
};

/** The annotations for one tool, or undefined for a name with no entry. */
export function toolAnnotations(name: string): ToolAnnotations | undefined {
  const spec = Object.hasOwn(TOOL_HINTS, name) ? TOOL_HINTS[name] : undefined;
  if (!spec) return undefined;
  if (spec.kind === 'read') return { title: spec.title, readOnlyHint: true };
  return {
    title: spec.title,
    readOnlyHint: false,
    destructiveHint: spec.kind === 'destructive',
  };
}

/** The tools with their annotations attached (a tool with no entry is left as it is). */
export function withToolHints<T extends { name: string }>(
  tools: readonly T[]
): (T & { annotations?: ToolAnnotations })[] {
  return tools.map(tool => {
    const annotations = toolAnnotations(tool.name);
    return annotations ? { ...tool, annotations } : tool;
  });
}
