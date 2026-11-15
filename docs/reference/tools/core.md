---
description: Every tool in the Core set with its description and parameters. Generated from the tool catalog.
---

<!-- Generated from the tool catalog by packages/mcp-server/src/tool-reference.ts. Do not edit by hand: run `npm run docs:tools` after changing a tool. CI fails when this page is stale. -->

# Core tools

Look things up (world, characters, scenes, journals, compendiums, combat) and review, apply or undo planned changes. Always on. Part of the [tool reference](../tools.md); [Tool sets](../TOOL-SETS.md) explains how Claude Desktop loads the sets. Claude Desktop entry: `foundry-mcp`.

## get-character

Retrieve character information optimized for minimal token usage. Returns: full stats (abilities, skills, saves, AC, HP), action names, active effects/conditions (name only), and ALL items with minimal metadata (name, type, equipped status, attunement status) without descriptions. Perfect for filtering (e.g., equipped weapons, prepared spells), checking equipment, or identifying what to investigate further. Use get-character-entity to fetch full details for specific items, actions, spells, or effects.

Kind: read-only. Title: Get character.

Parameters:

- `identifier` (string, required): Character name or ID to look up

## get-character-entity

Retrieve full details for one item or effect of a character. Items (spells, weapons, equipment, features) come with their dnd5e details (spell level, rarity, quantity, equipped, attunement, uses left) and their activities (attacks with to-hit, saves with DC, damage formulas, activation, range, target), plus the complete description and system data. Effects come with duration and changes. Use this after get-character when you need detailed information about a specific entity.

Kind: read-only. Title: Get character item or effect.

Parameters:

- `characterIdentifier` (string, required): Character name or ID
- `entityIdentifier` (string, required): Item or effect name or ID (a spell, weapon, feature or effect)

## list-characters

List all available characters with basic information

Kind: read-only. Title: List characters.

Parameters:

- `type` (string): Optional filter by character type (e.g., "character", "npc")

## search-character-items

Search within a character's items, spells, actions, and effects. More token-efficient than get-character when you need specific items. Supports text search (name/description) and type filtering. Returns matching items with full details including targeting info for spells. Use this to find specific spells, equipment, feats, or abilities without loading the entire character.

Kind: read-only. Title: Search character items.

Parameters:

- `characterIdentifier` (string, required): Character name or ID to search within
- `query` (string): Text to search for in item names and descriptions (case-insensitive). Leave empty to return all items of specified type.
- `type` (string): Filter by dnd5e item type: "spell", "weapon", "equipment" (armor and shields too), "consumable", "tool", "loot", "container", "feat" (features), "class", "subclass", "background", "race" (species), or "effect" for active effects. Leave empty to search all types.
- `category` (string): Additional category filter. For spells: "cantrip" or "prepared". For weapons and equipment: "equipped".
- `limit` (number): Maximum number of results to return (default: 20)

## search-compendium

Search through compendium packs by name. IMPORTANT LIMITATIONS: (1) Text search only matches entity NAMES - descriptions and traits are NOT searchable. (2) Filters use name heuristics only (not actual system data) and only work on Actor packs - challengeRating and creatureType filters search for keywords like "ancient", "legendary", "humanoid", etc. in entity names. For accurate filtering by level/CR, traits, or rarity, use list-creatures-by-criteria (Build) instead. For best results, use broad name-based searches (e.g., "dragon", "knight") and inspect individual items with get-compendium-item.

Kind: read-only. Title: Search compendiums.

Parameters:

- `query` (string, required): Search query to find items in compendiums by name only. Use broad, simple terms (e.g., "dragon", "sword", "feat"). Descriptions and traits are NOT searchable.
- `packType` (string): Optional filter by pack type (e.g., "Item", "Actor", "JournalEntry")
- `filters` (object): LIMITED FUNCTIONALITY: Only works on Actor packs using name-based heuristics. challengeRating searches for keywords like "ancient" (CR 15+), "adult" (CR 10+), "captain" (CR 5+). creatureType searches for type keywords in names. Does NOT check actual system data. For accurate filtering, use list-creatures-by-criteria (Build) instead.
  - `challengeRating` (number or object)
  - `creatureType` (string): Creature type (e.g., "humanoid", "dragon", "beast", "undead", "fey", "fiend", "celestial", "construct", "elemental", "giant", "monstrosity", "ooze", "plant"). One of: `humanoid`, `dragon`, `beast`, `undead`, `fey`, `fiend`, `celestial`, `construct`, `elemental`, `giant`, `monstrosity`, `ooze`, `plant`, `aberration`.
  - `size` (string): Creature size (e.g., "medium", "large", "huge"; dnd5e keys such as "med" also work). One of: `tiny`, `small`, `medium`, `large`, `huge`, `gargantuan`, `sm`, `med`, `lg`, `grg`.
  - `alignment` (string): Creature alignment (e.g., "lawful good", "chaotic evil", "neutral")
  - `hasLegendaryActions` (boolean): Filter for creatures with legendary actions
  - `spellcaster` (boolean): Filter for creatures that can cast spells (D&D 5e)
- `limit` (number): Maximum number of results to return (default: 50 for discovery searches, max: 50). Range: 1 to 50.

## search-rules

Full-text rules search over rulebook journal pages and item, spell and feature descriptions, in the allowlisted rules packs only. Returns ids and an excerpt; a whole journal is large, so prefer a bigger excerptChars to opening it with get-compendium-item (itemId = documentId) or, for world journals, list-journals.

Kind: read-only. Title: Search rules.

Parameters:

- `query` (string, required): Rule or term in plain words, e.g. "grapple". Filler words are ignored.
- `limit` (number): Maximum hits, 1 to 25 (default 10).
- `excerptChars` (number): Excerpt length per hit, 80 to 4000 (default 240). Raise it to read a rule.
- `includeWorld` (boolean): Also search world journals (adventure text). Off by default.
- `includeOtherBooks` (boolean): Also search packs outside the rules allowlist. Off by default.

## get-compendium-item

Use this to read one item, spell or creature; for a full stat block to build an NPC from, use get-compendium-entry-full (Build). Compact mode is lighter.

Kind: read-only. Title: Get compendium item.

Parameters:

- `packId` (string, required): ID of the compendium pack containing the item
- `itemId` (string, required): ID of the specific item to retrieve
- `compact` (boolean): Return condensed stat block (recommended for UI performance). Includes key stats, abilities, and actions but omits lengthy descriptions and technical data. Default: `false`.

## list-compendium-packs

List all available compendium packs

Kind: read-only. Title: List compendium packs.

Parameters:

- `type` (string): Optional filter by pack type

## get-current-scene

Get information about the currently active scene, including tokens and layout

Kind: read-only. Title: Get current scene.

Parameters:

- `includeTokens` (boolean): Whether to include detailed token information (default: true). Default: `true`.
- `includeHidden` (boolean): Whether to include hidden tokens and elements (default: false). Default: `false`.

## get-world-info

Get basic information about the Foundry world and system

Kind: read-only. Title: Get world info.

No parameters.

## list-scenes

List all available Foundry VTT scenes with their details

Kind: read-only. Title: List scenes.

Parameters:

- `filter` (string): Optional filter to search scene names (case-insensitive). Default: `""`.
- `include_active_only` (boolean): Only return the currently active scene. Default: `false`.

## list-journals

List all journal entries, or read a specific journal/page. Without parameters: lists all journals with their pages (id, name, type). With journalId: reads the journal's first text page content and shows all available pages. With journalId + pageId: reads a specific page's full content.

Kind: read-only. Title: List or read journals.

Parameters:

- `filterQuests` (boolean): Only show journals that appear to be quest-related (default: false)
- `includeContent` (boolean): Include journal content preview (default: false)
- `journalId` (string): If provided, read this journal's content instead of listing all journals. Returns full page content and a list of all pages in the journal.
- `pageId` (string): If provided with journalId, read this specific page's content. Get page IDs from the pages array returned when listing journals or reading a journal.

## search-journals

Search through all pages of all journal entries for specific content or keywords. Returns which specific page matched, so you can read it with list-journals using journalId + pageId.

Kind: read-only. Title: Search journals.

Parameters:

- `searchQuery` (string, required): Text to search for in journal entries
- `searchType` (string): Where to search (default: both). One of: `title`, `content`, `both`.

## get-level-up-options

Advice only, changes nothing: what a character's next class level grants, the choices still open (hit points, ASI or feat, subclass, spells, items), and earlier advancement left unfinished.

Kind: read-only. Title: Get level-up options.

Parameters:

- `identifier` (string, required): Character name or actor ID.
- `className` (string)

## get-combat-state

Get the full current combat state: whether combat is active, the round number, whose turn it is (with their initiative, HP, and conditions), and the complete initiative order. For each combatant: name, initiative, current/max HP, conditions, whether they are a player character or NPC/enemy, and whether they have acted this round. Combatants at 0 HP include their death save status.

Kind: read-only. Title: Get combat state.

No parameters.

## get-token-positions

Use this to see where all tokens are on a scene (default: active): name, actor ID, token ID, x/y and grid cell, elevation, category (pc/npc/enemy), hidden or visible, HP, conditions. For full data on one token use get-token-details (Play).

Kind: read-only. Title: Get token positions.

Parameters:

- `sceneId` (string): Optional scene ID; defaults to the active scene.

## get-planned-change

Show a pending planned change (from a plan-\* tool): what it will change as a readable diff, its risk ("write" or "destructive") and when it expires (15 minutes). Without planId, lists all pending plans. Read-only.

Kind: read-only. Title: Show planned change.

Parameters:

- `planId` (string): The planId returned by a plan-\* tool.

## apply-planned-change

Apply a pending planned change after the GM has seen its diff and agreed. Needs confirm: true, plus confirmDestructive: true for a "destructive" plan (it deletes, reveals Tarokka cards or undoes a whole span). If the plan says autoApply: true, or the GM said "go ahead", apply a "write" plan in the same turn; a "destructive" plan waits for the GM to say yes to that plan. Writes nothing if the documents changed since the plan, or "Allow Write Operations" or the feature is switched off. A showNow popup shows shown: { ok } or { ok: false, error }, and undo does not recall it. A handout reveal also posts a chat notice (noticed: { ok }); undo keeps it.

Kind: changes something and can delete or overwrite. Title: Apply planned change.

Parameters:

- `planId` (string, required): The planId to apply.
- `confirm` (boolean, required): Must be true: the GM confirmed this change.
- `confirmDestructive` (boolean): Must be true for a destructive plan: the GM confirmed the deletion.

## list-recent-changes

Applied plans only, newest first: summary, diff, when, still undoable. Use this to find one for undo-change; for direct writes and changes by players or the GM use list-changes. Read-only.

Kind: read-only. Title: List applied plans.

Parameters:

- `limit` (integer): Maximum number of changes to return (default 20, max 500). Default: `20`.

## undo-change

Use this to undo an applied plan (changeId from list-recent-changes), restoring the previous values; for a direct write or a change by a player or the GM use plan-undo-changes. Needs confirm: true. Refuses if the documents were edited since.

Kind: changes something and can delete or overwrite. Title: Undo change.

Parameters:

- `changeId` (string, required): The changeId to undo.
- `confirm` (boolean, required): Must be true: the GM confirmed the undo.

## open-in-foundry

Open a document (journal page, scene, actor, item) on a GM's Foundry screen, by uuid. Only the GM sees it; nothing is changed. Opening on another GM's client needs Foundry 14.352 or newer.

Kind: read-only. Title: Open in Foundry.

Parameters:

- `uuid` (string, required): Document uuid, e.g. JournalEntry.abc.JournalEntryPage.def
- `userId` (string): The GM user whose screen to use (default: the bridge's own client).
- `pan` (boolean): With a token uuid (Scene.x.Token.y): pan the GM's Foundry view to that token and select it instead of opening its sheet. Only that GM's screen moves, not the players'.

## list-changes

Use this to see what anyone changed (players, GM, AI) in the last 7 days, newest first: who, what, when, e.g. "Ilvara: HP 10 -> 5". Filter by person, thing (document uuid) or AI/human. Read-only. Undo with plan-undo-changes, or undo-change for an AI change.

Kind: read-only. Title: List all recent changes.

Parameters:

- `limit` (integer): Maximum number of changes to return (default 30, max 200). Default: `30`.
- `person` (string): Only changes by this person: a Foundry user id or user name (not case sensitive).
- `thing` (string): Only changes to this document uuid (an actor, token, scene, ...) and anything on it, such as its items and effects.
- `source` (string): Which changes to list: all (default), only the AI's, or only people's. One of: `all`, `ai`, `human`. Default: `all`.
- `since` (string): Only changes at or after this time (ISO 8601, e.g. 2026-10-06T19:00:00Z).

## plan-undo-changes

Use this to undo a change by anyone (id from list-changes); for an AI change undo-change is simpler. Can also undo everything since it on the same thing. Scope just-this (default) keeps what changed after it and lists those later changes; everything-since also undoes later changes to the same thing; world-since rewinds the whole table and needs rewindTable. Apply with apply-planned-change; undoing that change again is the redo.

Kind: read-only. Title: Plan undoing changes.

Parameters:

- `id` (string, required): The change to undo: its id from list-changes.
- `scope` (string): just-this (default), everything-since or world-since. One of: `just-this`, `everything-since`, `world-since`. Default: `just-this`.
- `rewindTable` (boolean): Must be true for world-since: rewind everything at the table.

## check-secret-terms

Check free text for whole-phrase, case-insensitive matches against known secret terms (currently the dealt Tarokka cards' names and the GM's name overrides for them). Use before sending a whisper or any GM-typed text toward players. Read-only.

Kind: read-only. Title: Check secret terms.

Parameters:

- `text` (string, required): The text to check (1-5000 characters).
