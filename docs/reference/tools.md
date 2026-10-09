---
description: Every tool the bridge serves, by tool set, with its description and parameters. Generated from the tool catalog.
---

<!-- Generated from the tool catalog by packages/mcp-server/src/tool-reference.ts. Do not edit by hand: run `npm run docs:tools` after changing a tool. CI fails when this page is stale. -->

# Tool reference

The bridge serves 86 tools in five sets. [Tool sets](TOOL-SETS.md) explains the sets and how Claude Desktop loads them; this page lists every tool with the description and parameters Claude reads.

| Set | Claude Desktop entry | Tools | For |
| --- | --- | --- | --- |
| [Core](#core) | `foundry-mcp` | 22 | Look things up (world, characters, scenes, journals, compendiums, combat) and review, apply or undo planned changes. Always on. |
| [Play](#play) | `foundry-mcp-play` | 29 | Run the table live: tokens, combat turns, rolls, damage, conditions, resources, chat, scene mood, map notes and loot. |
| [Prep](#prep) | `foundry-mcp-prep` | 20 | Prepare sessions and write recaps: quests and journals, encounter budgets, the Tarokka reading, handouts, the session log, play stats and the pre-flight check. |
| [Build](#build) | `foundry-mcp-build` | 7 | Make and change NPCs, monsters and items: from a compendium or from scratch, with features, attacks and spells. |
| [Admin](#admin) | `foundry-mcp-admin` | 8 | Set up and troubleshoot: installed modules and their errors, who owns which actor, and the Obsidian mirror settings. |

## Core

Look things up (world, characters, scenes, journals, compendiums, combat) and review, apply or undo planned changes. Always on.

### get-world-info

Get basic information about the Foundry world and system

Kind: read-only. Title: Get world info.

No parameters.

### list-characters

List all available characters with basic information

Kind: read-only. Title: List characters.

Parameters:

- `type` (string): Optional filter by character type (e.g., "character", "npc")

### get-character

Retrieve character information optimized for minimal token usage. Returns: full stats (abilities, skills, saves, AC, HP), action names, active effects/conditions (name only), and ALL items with minimal metadata (name, type, equipped status, attunement status) without descriptions. Perfect for filtering (e.g., equipped weapons, prepared spells), checking equipment, or identifying what to investigate further. Use get-character-entity to fetch full details for specific items, actions, spells, or effects.

Kind: read-only. Title: Get character.

Parameters:

- `identifier` (string, required): Character name or ID to look up

### get-character-entity

Retrieve full details for a specific entity from a character. Works for items (feats, equipment, spells), actions (strikes, special abilities), or effects/conditions. Returns complete description and all system data. Use this after get-character when you need detailed information about a specific entity.

Kind: read-only. Title: Get character item or effect.

Parameters:

- `characterIdentifier` (string, required): Character name or ID
- `entityIdentifier` (string, required): Entity name or ID (can be item ID, action name, spell name, or effect name)

### search-character-items

Search within a character's items, spells, actions, and effects. More token-efficient than get-character when you need specific items. Supports text search (name/description) and type filtering. Returns matching items with full details including targeting info for spells. Use this to find specific spells, equipment, feats, or abilities without loading the entire character.

Kind: read-only. Title: Search character items.

Parameters:

- `characterIdentifier` (string, required): Character name or ID to search within
- `query` (string): Text to search for in item names and descriptions (case-insensitive). Leave empty to return all items of specified type.
- `type` (string): Filter by dnd5e item type: "spell", "weapon", "equipment" (armor and shields too), "consumable", "tool", "loot", "container", "feat" (features), "class", "subclass", "background", "race" (species), or "effect" for active effects. Leave empty to search all types.
- `category` (string): Additional category filter. For spells: "cantrip" or "prepared". For weapons and equipment: "equipped".
- `limit` (number): Maximum number of results to return (default: 20)

### list-scenes

List all available Foundry VTT scenes with their details

Kind: read-only. Title: List scenes.

Parameters:

- `filter` (string): Optional filter to search scene names (case-insensitive). Default: `""`.
- `include_active_only` (boolean): Only return the currently active scene. Default: `false`.

### get-current-scene

Get information about the currently active scene, including tokens and layout

Kind: read-only. Title: Get current scene.

Parameters:

- `includeTokens` (boolean): Whether to include detailed token information (default: true). Default: `true`.
- `includeHidden` (boolean): Whether to include hidden tokens and elements (default: false). Default: `false`.

### get-token-positions

List all tokens on a scene with their positions and status. For each token: name, actor ID, token ID, grid coordinates (x/y and grid cell), elevation, category (player character / npc / enemy), visibility (hidden or visible), current HP, and conditions. Defaults to the active scene.

Kind: read-only. Title: Get token positions.

Parameters:

- `sceneId` (string): Optional scene ID; defaults to the active scene.

### get-combat-state

Get the full current combat state: whether combat is active, the round number, whose turn it is (with their initiative, HP, and conditions), and the complete initiative order. For each combatant: name, initiative, current/max HP, conditions, whether they are a player character or NPC/enemy, and whether they have acted this round. Combatants at 0 HP include their death save status.

Kind: read-only. Title: Get combat state.

No parameters.

### list-journals

List all journal entries, or read a specific journal/page. Without parameters: lists all journals with their pages (id, name, type). With journalId: reads the journal's first text page content and shows all available pages. With journalId + pageId: reads a specific page's full content.

Kind: read-only. Title: List or read journals.

Parameters:

- `filterQuests` (boolean): Only show journals that appear to be quest-related (default: false)
- `includeContent` (boolean): Include journal content preview (default: false)
- `journalId` (string): If provided, read this journal's content instead of listing all journals. Returns full page content and a list of all pages in the journal.
- `pageId` (string): If provided with journalId, read this specific page's content. Get page IDs from the pages array returned when listing journals or reading a journal.

### search-journals

Search through all pages of all journal entries for specific content or keywords. Returns which specific page matched, so you can read it with list-journals using journalId + pageId.

Kind: read-only. Title: Search journals.

Parameters:

- `searchQuery` (string, required): Text to search for in journal entries
- `searchType` (string): Where to search (default: both). One of: `title`, `content`, `both`.

### search-compendium

Search through compendium packs by name. IMPORTANT LIMITATIONS: (1) Text search only matches entity NAMES - descriptions and traits are NOT searchable. (2) Filters use name heuristics only (not actual system data) and only work on Actor packs - challengeRating and creatureType filters search for keywords like "ancient", "legendary", "humanoid", etc. in entity names. For accurate filtering by level/CR, traits, or rarity, use list-creatures-by-criteria instead. For best results, use broad name-based searches (e.g., "dragon", "knight") and inspect individual items with get-compendium-item.

Kind: read-only. Title: Search compendiums.

Parameters:

- `query` (string, required): Search query to find items in compendiums by name only. Use broad, simple terms (e.g., "dragon", "sword", "feat"). Descriptions and traits are NOT searchable.
- `packType` (string): Optional filter by pack type (e.g., "Item", "Actor", "JournalEntry")
- `filters` (object): LIMITED FUNCTIONALITY: Only works on Actor packs using name-based heuristics. challengeRating searches for keywords like "ancient" (CR 15+), "adult" (CR 10+), "captain" (CR 5+). creatureType searches for type keywords in names. Does NOT check actual system data. For accurate filtering, use list-creatures-by-criteria instead.
  - `challengeRating` (number or object)
  - `creatureType` (string): Creature type (e.g., "humanoid", "dragon", "beast", "undead", "fey", "fiend", "celestial", "construct", "elemental", "giant", "monstrosity", "ooze", "plant"). One of: `humanoid`, `dragon`, `beast`, `undead`, `fey`, `fiend`, `celestial`, `construct`, `elemental`, `giant`, `monstrosity`, `ooze`, `plant`, `aberration`.
  - `size` (string): Creature size (e.g., "medium", "large", "huge"; dnd5e keys such as "med" also work). One of: `tiny`, `small`, `medium`, `large`, `huge`, `gargantuan`, `sm`, `med`, `lg`, `grg`.
  - `alignment` (string): Creature alignment (e.g., "lawful good", "chaotic evil", "neutral")
  - `hasLegendaryActions` (boolean): Filter for creatures with legendary actions
  - `spellcaster` (boolean): Filter for creatures that can cast spells (D&D 5e)
- `limit` (number): Maximum number of results to return (default: 50 for discovery searches, max: 50). Range: 1 to 50.

### get-compendium-item

Retrieve detailed information about a specific compendium item. Use compact mode for UI performance when full details are not needed.

Kind: read-only. Title: Get compendium item.

Parameters:

- `packId` (string, required): ID of the compendium pack containing the item
- `itemId` (string, required): ID of the specific item to retrieve
- `compact` (boolean): Return condensed stat block (recommended for UI performance). Includes key stats, abilities, and actions but omits lengthy descriptions and technical data. Default: `false`.

### list-compendium-packs

List all available compendium packs

Kind: read-only. Title: List compendium packs.

Parameters:

- `type` (string): Optional filter by pack type

### get-planned-change

Show a pending planned change (from a plan-\* tool): what it will change as a readable diff, its risk ("write" or "destructive") and when it expires (15 minutes). Without planId, lists all pending plans. Read-only.

Kind: read-only. Title: Show planned change.

Parameters:

- `planId` (string): The planId returned by a plan-\* tool.

### apply-planned-change

Apply a pending planned change after the GM has seen its diff and agreed. Requires confirm: true, plus confirmDestructive: true when the plan risk is "destructive" (it deletes something). Fails without writing anything if the affected documents changed since the plan was made, if "Allow Write Operations" or the feature is switched off in the module settings. The change is recorded and can be undone with undo-change. When the plan also pops a page up on the players' screens (showNow), the result has shown: { ok: true } or { ok: false, error }, and undo does not take the popup back.

Kind: changes something and can delete or overwrite. Title: Apply planned change.

Parameters:

- `planId` (string, required): The planId to apply.
- `confirm` (boolean, required): Must be true: the GM confirmed this change.
- `confirmDestructive` (boolean): Must be true for a destructive plan: the GM confirmed the deletion.

### list-recent-changes

List recently applied guarded changes for the current world (newest first): summary, diff, when, and whether each can still be undone. Read-only.

Kind: read-only. Title: List recent AI changes.

Parameters:

- `limit` (integer): Maximum number of changes to return (default 20, max 500). Default: `20`.

### list-changes

List everyone's recent changes in Foundry (players, the GM and the AI) from the last 7 days, newest first: who, what and when, as readable lines such as "Ireena: HP 10 -> 5". Filter by person, by thing (a document uuid) and by AI or human. Read-only. Each change has an id; undo it with plan-undo-changes (anyone's change) or, for an AI change, undo-change.

Kind: read-only. Title: List all recent changes.

Parameters:

- `limit` (integer): Maximum number of changes to return (default 30, max 200). Default: `30`.
- `person` (string): Only changes by this person: a Foundry user id or user name (not case sensitive).
- `thing` (string): Only changes to this document uuid (an actor, token, scene, ...) and anything on it, such as its items and effects.
- `source` (string): Which changes to list: all (default), only the AI's, or only people's. One of: `all`, `ai`, `human`. Default: `all`.
- `since` (string): Only changes at or after this time (ISO 8601, e.g. 2026-10-06T19:00:00Z).

### plan-undo-changes

Plan undoing one change from list-changes (by anyone: a player, the GM or the AI), or everything since it on the same thing. Scope just-this (default) keeps what changed after it and lists those later changes; everything-since also undoes later changes to the same thing; world-since rewinds the whole table and needs rewindTable. Apply with apply-planned-change; undoing that change again is the redo.

Kind: read-only. Title: Plan undoing changes.

Parameters:

- `id` (string, required): The change to undo: its id from list-changes.
- `scope` (string): just-this (default), everything-since or world-since. One of: `just-this`, `everything-since`, `world-since`. Default: `just-this`.
- `rewindTable` (boolean): Must be true for world-since: rewind everything at the table.

### undo-change

Undo an applied change (by changeId from list-recent-changes), restoring the previous values. Requires confirm: true. Refuses instead of overwriting if the documents were edited since the change.

Kind: changes something and can delete or overwrite. Title: Undo change.

Parameters:

- `changeId` (string, required): The changeId to undo.
- `confirm` (boolean, required): Must be true: the GM confirmed the undo.

### open-in-foundry

Open a document (journal page, scene, actor, item) on a GM's Foundry screen, by uuid. Only the GM sees it; nothing is changed. Opening on another GM's client needs Foundry 14.352 or newer.

Kind: read-only. Title: Open in Foundry.

Parameters:

- `uuid` (string, required): Document uuid, e.g. JournalEntry.abc.JournalEntryPage.def
- `userId` (string): The GM user whose screen to use (default: the bridge's own client).

### check-secret-terms

Check free text for whole-phrase, case-insensitive matches against known secret terms (currently the dealt Tarokka cards' names and the GM's name overrides for them). Use before sending a whisper or any GM-typed text toward players. Read-only.

Kind: read-only. Title: Check secret terms.

Parameters:

- `text` (string, required): The text to check (1-5000 characters).

## Play

Run the table live: tokens, combat turns, rolls, damage, conditions, resources, chat, scene mood, map notes and loot.

### switch-scene

Switch to a different Foundry VTT scene by name or ID

Kind: changes something. Title: Switch scene.

Parameters:

- `scene_identifier` (string, required): Scene name or ID to switch to
- `optimize_view` (boolean): Automatically optimize the view for the scene. Default: `true`.

### use-item

Use an item on a character (cast spell, use ability, activate feature, consume item). Opens the item dialog in Foundry VTT for the GM to configure options and confirm. Optionally specify targets by name. Returns immediately with status "initiated" - tell the user to check Foundry for any dialogs. Use get-character or search-character-items first to see available items/spells.

Kind: changes something and can delete or overwrite. Title: Use item.

Parameters:

- `actorIdentifier` (string, required): Character using the item (name or ID)
- `itemIdentifier` (string, required): Item name or ID (spell, feat, equipment, consumable, etc.)
- `targets` (array of string): Target character/token names or IDs. Use ["self"] to target the caster. If omitted, GM selects targets in Foundry.
- `consume` (boolean): Whether to consume charges/uses (default: true)
- `spellLevel` (number): For spells: cast at a higher level than base (D&D 5e upcasting)

### request-player-rolls

Request dice rolls from players with interactive buttons. Creates roll buttons in Foundry chat that players can click. VISIBILITY WORKFLOW: Before calling this function, ensure the user has specified whether they want a public or private roll. If they have already specified "public" or "private" in their request (e.g., "public performance check", "private stealth roll"), you can proceed directly. If the visibility is ambiguous or unspecified, ask: "Do you want this to be a PUBLIC roll (visible to all players) or PRIVATE roll (visible to player and GM only)?" and wait for their answer. Supports character-to-player resolution and GM fallback.

Kind: changes something. Title: Request player rolls.

Parameters:

- `rollType` (string, required): Type of roll to request (ability, skill, save, attack, initiative, custom). One of: `ability`, `skill`, `save`, `attack`, `initiative`, `custom`.
- `rollTarget` (string, required): Target for the roll - can be ability name (str, dex, con, int, wis, cha), skill name (perception, insight, stealth, etc.), or custom roll formula
- `targetPlayer` (string, required): Player name or character name to request the roll from
- `isPublic` (boolean, required): Whether the roll should be public (true = visible to all players) or private (false = visible only to target player and GM).
- `userConfirmedVisibility` (boolean, required): REQUIRED: Must be set to true to confirm the roll visibility has been determined. This can happen in two ways: 1) User explicitly specified "public" or "private" in their original request (e.g., "public stealth check"), or 2) You asked the clarifying question and received their answer. Only set this to true when you are confident about the visibility preference, either from their original request or from a direct answer to your question. Always `true`.
- `rollModifier` (string): Optional modifier to add to the roll (e.g., "+2", "-1", "+1d4"). Default: `""`.
- `flavor` (string): Optional flavor text to describe the roll context. Default: `""`.

### request-ability-check

Request an ability check from a player, posting a clickable roll button to their chat. Shows the DC when provided. Use for checks like "Perception check to notice the ambush".

Kind: changes something. Title: Request ability check.

Parameters:

- `targetPlayer` (string, required): Player name or character name to request the roll from.
- `ability` (string, required): Ability to check. One of: `str`, `dex`, `con`, `int`, `wis`, `cha`.
- `dc` (integer): Optional difficulty class to display with the request.
- `isPublic` (boolean, required): Whether the roll is public (visible to all) or private (target player + GM only).
- `reason` (string): Context for the check, e.g. "Perception check to notice the ambush".

### request-attack-roll

Request an attack roll for a specific weapon or spell from a player, posting a clickable roll button to their chat.

Kind: changes something. Title: Request attack roll.

Parameters:

- `targetPlayer` (string, required): Player name or character name to request the roll from.
- `weaponOrSpellName` (string, required): Name of the weapon or spell attack.
- `isPublic` (boolean, required): Whether the roll is public (visible to all) or private (target player + GM only).

### roll-npc-check

Roll directly for an NPC actor (no player prompt) and post the result to chat. Supports ability checks, saving throws, skill checks, and attacks.

Kind: changes something. Title: Roll NPC check.

Parameters:

- `actorName` (string, required): NPC actor name or ID.
- `rollType` (string, required): Type of roll. One of: `ability`, `save`, `skill`, `attack`.
- `rollTarget` (string, required): Target for the roll: ability (str/dex/...), skill name (perception, stealth, ...), or weapon/attack name.
- `isPublic` (boolean, required): Whether the result is public (true) or whispered to the GM (false).

### get-token-details

Get detailed information about a specific token including all properties and linked actor data

Kind: read-only. Title: Get token details.

Parameters:

- `tokenId` (string, required): The ID of the token to get details for

### get-available-conditions

Get a list of all available status effects/conditions that can be applied to tokens in the current game system

Kind: read-only. Title: List conditions.

No parameters.

### get-chat-log

Retrieve recent Foundry chat messages from the module's in-memory buffer. This is where dice rolls, ability uses, damage events, and combat narration live. Each message includes the speaker, message type, content, flavor text, and, for rolls, the formula, total, individual die results, critical/fumble status, advantage/disadvantage, and any damage total and types. Use this to follow what happened in the game.

Kind: read-only. Title: Get chat log.

Parameters:

- `limit` (integer): Maximum number of messages to return (default 50, max 200). Default: `50`.
- `speakerName` (string): Filter to messages from this actor/speaker name (partial match).
- `messageType` (string): Filter by message type. One of: `roll`, `damage`, `all`. Default: `all`.
- `sinceTimestamp` (string): ISO timestamp; only return messages created after this time.

### get-combat-play-by-play

Return a structured, human-readable summary of the current or most recent combat encounter, reconstructed from the chat-log buffer and the recorded turn timeline. Includes each round broken into turns (who acted and what they did with roll/damage results), significant events (downed/dead/stabilized combatants, conditions applied/removed), and a final summary with total rounds and total damage dealt by each actor.

Kind: read-only. Title: Get combat play-by-play.

No parameters.

### send-chat-message

Post a message to the Foundry chat as a specific character or as the GM/world. Supports in-character (ic), out-of-character (ooc), emote, and whisper message types.

Kind: changes something. Title: Send chat message.

Parameters:

- `message` (string, required): The message text to post.
- `speakerActorId` (string): Actor ID to post as. If omitted (and no name given), posts as the GM/world.
- `speakerActorName` (string): Actor name to post as (alternative to speakerActorId).
- `messageType` (string): Type of message. One of: `ic`, `ooc`, `emote`, `whisper`. Default: `ic`.
- `whisperTargets` (array of string): When messageType is "whisper", the user names to whisper to.

### get-character-resources

Get a clean, structured view of a character's limited-use resources: spell slots per level (max/current/expended), class resources (Sorcery Points, Ki, Rages, Bardic Inspiration, Channel Divinity, Superiority Dice, etc.), item charges, current concentration (and on which spell), hit dice, and death save successes/failures when at 0 HP.

Kind: read-only. Title: Get character resources.

Parameters:

- `identifier` (string, required): Character name or actor ID.

### get-active-effects

List all active effects on an actor: name and icon, whether each is a condition (Blinded, Poisoned, etc.) vs a buff/debuff (Mage Armor, Haste, etc.), remaining duration (rounds/turns/seconds) where tracked, which attributes it modifies and by how much, and whether it requires concentration.

Kind: read-only. Title: Get active effects.

Parameters:

- `identifier` (string, required): Actor name or ID.

### advance-combat-turn

Advance combat to the next combatant's turn. Optionally jump directly to a specific combatant with skipTo (their name or actor ID).

Kind: changes something. Title: Advance combat turn.

Parameters:

- `skipTo` (string): Optional combatant name or actor ID to jump to.

### set-initiative

Set or override a combatant's initiative value in the active combat.

Kind: changes something and can delete or overwrite. Title: Set initiative.

Parameters:

- `combatantName` (string, required): Combatant or actor name.
- `initiative` (number, required): New initiative value.

### roll-initiative-for-npcs

Roll initiative for combatants in the active combat and populate the tracker. scope "npcs" (default) rolls for non-player combatants, "all" rolls for everyone, "missing" only rolls for combatants without an initiative value. Pass combatantIds to roll separate initiative for exactly those combatants (overrides scope). Use this for "roll initiative for the monsters" (the enemies, the goblins; Danish "monstrene"): those words mean the NPC combatants, not a name.

Kind: changes something. Title: Roll initiative.

Parameters:

- `scope` (string): Which combatants to roll for (default "npcs"). One of: `npcs`, `all`, `missing`.
- `combatantIds` (array of string): Optional: roll separate initiative for exactly these combatant ids (overrides scope).

### measure-distance

Measure the distance in the scene's grid units (e.g. feet) between two tokens on the active scene, using the scene's grid configuration.

Kind: read-only. Title: Measure distance.

Parameters:

- `fromTokenName` (string, required): Name of the first token.
- `toTokenName` (string, required): Name of the second token.

### get-targets

Return the tokens the GM currently has targeted in Foundry, with each target's AC and HP. Useful before use-npc-activity so an attack can resolve hit/miss against the actual target's AC.

Kind: read-only. Title: Get GM targets.

No parameters.

### get-recent-events

Low-latency "what happened since timestamp X" delta of session events, for situational awareness during play. Returns the events plus `latestTimestamp`, which you pass back as `sinceTimestamp` next time to poll incrementally for only new events.

Kind: read-only. Title: Get recent events.

Parameters:

- `sinceTimestamp` (string): ISO timestamp; only return events after this time. Omit for the most recent events.
- `limit` (integer): Maximum number of events to return (default 100). Default: `100`.
- `eventType` (string): Optional event type filter.

### plan-actor-change

Plan damage, healing, temp HP, a condition or a resource change for one or more tokens or actors; apply it with apply-planned-change, revert it with undo-change. dnd5e works out resistances, vulnerabilities, immunities and temp HP; the result previews each target ("Wolf 2: 12 fire damage, 6 taken, HP 11 to 5"). If the result says autoApply: true, the GM chose to skip confirming: apply it at once. If the GM's request says "go ahead", apply it in the same turn. D&D 5e only. It does not level up characters: a level-up happens on the character sheet in Foundry, so say that.

Kind: read-only. Title: Plan damage, healing or conditions.

Parameters:

- `action` (string, required): damage, healing, temp-hp, condition (on or off), resource (set a value) or clear-conditions. One of: `damage`, `healing`, `temp-hp`, `condition`, `resource`, `clear-conditions`.
- `targets` (array of string, required): Token names on the current scene (preferred: unlinked NPC tokens have their own HP) or actor names.
- `amount` (integer): damage, healing, temp-hp: the amount.
- `damageType` (string): damage: acid, bludgeoning, cold, fire, force, lightning, necrotic, piercing, poison, psychic, radiant, slashing or thunder. Omit for untyped.
- `multiplier` (number): damage: 2 for a critical, 0.5 for half.
- `ignoreResistance` (boolean): damage: ignore the target's resistances and immunities.
- `condition` (string): condition: the id or name (prone, poisoned, exhaustion...).
- `active` (boolean): condition: false removes it. Default: `true`.
- `level` (integer): condition exhaustion: the level to set.
- `conditions` (array of string): clear-conditions: names to remove; omit to remove expired effects.
- `resource` (string): resource: "spell3", "pact", a class resource (Ki Points, primary) or an item name.
- `value` (integer): resource: the new current value (0 to max).

### plan-token-change

Plan moving, changing or deleting tokens on the current scene; apply it with apply-planned-change, revert it with undo-change. "move": one token to gridX/gridY (a square) or x/y (pixels), or any tokens by dx/dy squares. "update": set the listed fields (vision and light too). "delete": removes the tokens and their place in the encounter (destructive; undo restores both). If the request says "go ahead", apply it in the same turn (a delete still needs the destructive confirm).

Kind: read-only. Title: Plan token change.

Parameters:

- `action` (string, required): move, update or delete. One of: `move`, `update`, `delete`.
- `tokens` (array of string, required): Token names or ids on the current scene.
- `gridX` (integer): move: grid column.
- `gridY` (integer): move: grid row.
- `x` (number): move: pixels from the left.
- `y` (number): move: pixels from the top.
- `dx` (integer): move: squares right (negative: left).
- `dy` (integer): move: squares down (negative: up).
- `name` (string): update: the token name.
- `hidden` (boolean): update: hidden from players.
- `disposition` (integer): update: -2 secret, -1 hostile, 0 neutral, 1 friendly. One of: `-2`, `-1`, `0`, `1`.
- `elevation` (number): update: elevation in scene units (ft).
- `rotation` (number): update: rotation in degrees.
- `lockRotation` (boolean): update: lock the rotation.
- `width` (number): update: width in grid squares.
- `height` (number): update: height in grid squares.
- `sightEnabled` (boolean): update: the token has vision.
- `sightRange` (number): update: vision range (ft).
- `visionMode` (string): update: basic, darkvision...
- `lightDim` (number): update: dim light radius (ft); a torch is 40.
- `lightBright` (number): update: bright light radius (ft); a torch is 20.
- `lightColor` (string): update: light color, "#ff9329".
- `lightAnimation` (string): update: torch, pulse, flame...

### roll-saving-throws

Roll saving throws (or ability checks / skill checks) for one or more NPC actors using dnd5e system rules, optionally against a DC, reporting each total and pass/fail. Use for "all the goblins roll a DEX save vs DC 15". D&D 5e only.

Kind: changes something. Title: Roll NPC saving throws.

Parameters:

- `targets` (array of string, required): Token names (preferred) or actor names/IDs to roll for.
- `rollType` (string, required): One of: `save`, `check`, `skill`.
- `ability` (string): Ability key for save/check (str/dex/con/int/wis/cha).
- `skill` (string): dnd5e skill key for skill rolls: acr, ani, arc, ath, dec, his, ins, itm, inv, med, nat, prc, prf, per, rel, slt, ste, sur (e.g. "ste" for Stealth, "prc" for Perception).
- `dc` (integer): Optional difficulty class to test against.
- `isPublic` (boolean): Public roll (true) or whispered to the GM only (false or omitted, the default).

### use-npc-activity

Trigger an NPC's attack (or other item activity) and report the attack roll total, hit/miss vs an AC, critical, and damage. Use for running the monster side of combat. D&D 5e only.

Kind: changes something. Title: Use NPC attack or activity.

Parameters:

- `actorName` (string, required): NPC actor name or ID. A token on the current scene with this name or ID (or the only token made from this actor) is used first, so an unlinked token spends its own uses.
- `itemName` (string, required): Name of the weapon/feature/spell to use (e.g. "Scimitar").
- `targetAC` (integer): Optional target AC to compute hit/miss against.
- `isPublic` (boolean): Public roll (true or omitted, the default) or whispered to the GM only (false).

### manage-rest

Run a short or long rest for one or more characters, restoring HP, hit dice, spell slots, and limited-use features per 5e rules, without opening dialogs. D&D 5e only.

Kind: changes something and can delete or overwrite. Title: Run a rest.

Parameters:

- `targets` (array of string, required): Character names or IDs to rest.
- `restType` (string, required): One of: `short`, `long`.
- `newDay` (boolean): Whether this rest starts a new day (resets daily uses). Defaults true for long rests.

### get-party

GM ONLY. The dnd5e party (group actors, the primary party first): each member's HP, AC, passive Perception, conditions, exhaustion, hit dice and tokens on the current scene (and whether they are in the encounter), the travel pace and whether a slowed member forces slow pace, plus the current encounter. Read-only.

Kind: read-only. Title: Get party.

No parameters.

### plan-party-change

Plan one party action; nothing changes until apply-planned-change (the GM confirms, and the "AI Tool: Party (writes)" switch must be on). action "pace": set the travel pace ("pace": slow, normal or fast). "add-to-combat": add the members' tokens on the current scene to the encounter (starts one when there is none). "rest-request": post dnd5e's short or long rest request card ("rest"), which each player clicks to rest. "place": put the members who have no token on the scene the GM is viewing onto the free squares nearest a spot: the centre of the GM's view (default), a token or map note ("at" token or note, "target" its name) or a square ("at" grid, gridX, gridY); "hidden" for a surprise entrance. Uses the primary party unless groupId names another group. Returns a planId; undo-change reverts it (a rest request card only while nobody has rested from it).

Kind: read-only. Title: Plan party change.

Parameters:

- `action` (string, required): What to plan: pace, add-to-combat, rest-request or place. One of: `pace`, `add-to-combat`, `rest-request`, `place`.
- `groupId` (string): The group actor id; default the primary party (else the only group).
- `pace` (string): For action "pace": the new travel pace. One of: `slow`, `normal`, `fast`.
- `rest` (string): For action "rest-request": short or long (default long). One of: `short`, `long`.
- `at` (string): For action "place": where (default view: the centre of the GM's view). One of: `view`, `token`, `note`, `grid`.
- `target` (string): For "place" at token or note: the token's name or the map note's label.
- `gridX` (integer): For "place" at grid: the column.
- `gridY` (integer): For "place" at grid: the row.
- `hidden` (boolean): For "place": the new tokens start hidden.

### plan-scene-change

Plan scene dressing on the current scene: an area-of-effect template ("template"), clearing templates ("clear-templates"), darkness and global light ("mood"), a map pin ("note", "remove-note") or loot for a character ("loot"). Apply it with apply-planned-change, revert it with undo-change; the GM sees every change in Recent Changes. If the result says autoApply: true, the GM chose to skip confirming: apply it at once. If the GM's request says "go ahead", apply it in the same turn (removing something still needs the destructive confirm). A template result lists tokensInside; a loot result lists skippedItems that were left out (bad UUID, not an Item, or no target character).

Kind: read-only. Title: Plan scene dressing.

Parameters:

- `action` (string, required): template, clear-templates, mood (darkness and global light), note, remove-note or loot. One of: `template`, `clear-templates`, `mood`, `note`, `remove-note`, `loot`.
- `shape` (string): template: the shape (required). One of: `circle`, `cone`, `ray`, `rect`.
- `distance` (number): template: size in grid distance units (radius for circle, length for cone/ray/rect; required).
- `x` (number): template: origin X in pixels (or originTokenName). note: X in pixels (or tokenName).
- `y` (number): template: origin Y in pixels (or originTokenName). note: Y in pixels (or tokenName).
- `originTokenName` (string): template: center it on this token instead of x/y.
- `direction` (number): template: facing in degrees (cone/ray/rect).
- `angle` (number): template cone: angle in degrees (default ~53).
- `width` (number): template ray: width in grid units (default 5).
- `fillColor` (string): template: hex color, e.g. "#ff0000".
- `templateId` (string): clear-templates: the template to remove.
- `all` (boolean): clear-templates: remove all of this tool's own templates (never a hand-made GM region on Foundry 14).
- `darkness` (number): mood: darkness level 0 (bright) to 1 (dark).
- `globalLight` (boolean): mood: enable or disable global illumination.
- `text` (string): note: the label. remove-note: remove the pins whose label is exactly this text.
- `tokenName` (string): note: place the pin at this token instead of x/y.
- `journalName` (string): note: link the pin to an existing journal entry by name.
- `entryId` (string): note: link to a journal entry by id (alternative).
- `icon` (string): note: icon path (default icons/svg/book.svg).
- `iconSize` (integer): note: icon size in px (default 40).
- `noteId` (string): remove-note: the pin to remove.
- `targetCharacter` (string): loot: the character to receive it. Omit to only announce in chat.
- `currency` (object): loot: coins to add, e.g. { "gp": 50, "sp": 25 }.
  - `pp` (integer): Range: at least 0.
  - `gp` (integer): Range: at least 0.
  - `ep` (integer): Range: at least 0.
  - `sp` (integer): Range: at least 0.
  - `cp` (integer): Range: at least 0.
- `itemUuids` (array of string): loot: compendium item UUIDs to add (from search-compendium).
- `announce` (boolean): loot: post a loot summary to chat (default true).

### play-playlist

Play (default) or stop a playlist by name. Direct, with nothing to undo. Use to change the music as the story moves.

Kind: changes something. Title: Play or stop playlist.

Parameters:

- `playlistName` (string, required): Playlist to control by name.
- `action` (string): Play (default) or stop the playlist. One of: `play`, `stop`.

### mark-play-session

GM ONLY. Mark the start or end of a play session by appending a line to the bridge vault's own session log (sessions/&lt;date>.jsonl). Touches only that log, never game state or Foundry. Used to group session notes and stats.

Kind: changes something. Title: Mark play session start or end.

Parameters:

- `action` (string, required): Mark the table starting or ending a play session. One of: `start`, `end`.
- `note` (string): Optional note kept with the marker (up to 200 characters).

## Prep

Prepare sessions and write recaps: quests and journals, encounter budgets, the Tarokka reading, handouts, the session log, play stats and the pre-flight check.

### create-quest-journal

Create a new quest journal entry with AI-generated content based on natural language description

Kind: changes something. Title: Create quest journal.

Parameters:

- `questTitle` (string, required): The title of the quest
- `questDescription` (string, required): Detailed description of what the quest should accomplish
- `questType` (string): Type of quest (optional). One of: `main`, `side`, `personal`, `mystery`, `fetch`, `escort`, `kill`, `collection`.
- `difficulty` (string): Quest difficulty level (optional). One of: `easy`, `medium`, `hard`, `deadly`.
- `location` (string): Where the quest takes place (optional)
- `questGiver` (string): Name of the NPC who gives this quest to the party (optional)
- `npcName` (string): Name of key NPC this quest involves - could be antagonist, ally, or target (optional)
- `rewards` (string): Quest rewards description (optional)
- `additionalPages` (array of object): Optional additional pages to create alongside the main quest page. Use for multi-page journals with separate sections like Player Handout, GM Notes, etc.
  - `name` (string, required): Page name (e.g. "Player Handout", "GM Notes")
  - `content` (string, required): HTML content for this page
- `folderName` (string): Optional folder name to organize the journal into. The folder is created automatically if it does not exist.

### update-quest-journal

Update an existing quest journal with new progress information. By default updates the FIRST text page. Use pageId to target a specific page, or newPageName to create a new page.

For Foundry VTT v13 ProseMirror editor compatibility:

✅ USE QUEST-STYLE HTML: Match create-quest-journal formatting ✅ OR USE PLAIN TEXT: Will be wrapped in &lt;p> tags with line breaks as &lt;br> ❌ DO NOT USE MARKDOWN: \*\*bold\*\*, \*italic\*, # headers will be stripped to plain text

Quest-style HTML examples:

- Sections: "&lt;h2 class=\\"spaced\\">New Discovery&lt;/h2>"
- GM Notes: "&lt;div class=\\"gmnote\\">&lt;p>GM info here&lt;/p>&lt;/div>"
- Player Info: "&lt;div class=\\"readaloud\\">&lt;p>Player-facing content&lt;/p>&lt;/div>"
- Plain text: "The party discovered the secret chamber"
- Avoid: "\*\*The party\*\* discovered the \*secret chamber\*" (Markdown will be stripped)

Kind: changes something and can delete or overwrite. Title: Update quest journal.

Parameters:

- `journalId` (string, required): ID of the quest journal to update
- `newContent` (string, required): Content to add using quest-style HTML or plain text. Quest HTML classes: &lt;h2 class="spaced">Section&lt;/h2>, &lt;div class="gmnote">&lt;p>GM info&lt;/p>&lt;/div>, &lt;div class="readaloud">&lt;p>Player content&lt;/p>&lt;/div>, &lt;div class="grid-2">Two columns&lt;/div>. Plain text gets wrapped in &lt;p> tags. Markdown will be stripped.
- `updateType` (string, required): Type of update being made. One of: `progress`, `completion`, `failure`, `modification`.
- `pageId` (string): ID of a specific page to update. If omitted, updates the first text page. Get page IDs from list-journals.
- `newPageName` (string): If provided (without pageId), creates a new page with this name instead of updating an existing one.

### link-quest-to-npc

Link an existing quest journal to an NPC in the world

Kind: changes something. Title: Link quest to NPC.

Parameters:

- `journalId` (string, required): ID of the quest journal entry
- `npcName` (string, required): Name of the NPC to link to the quest
- `relationship` (string, required): Relationship between NPC and quest. One of: `quest_giver`, `target`, `ally`, `enemy`, `contact`.

### create-campaign-dashboard

Create a comprehensive campaign dashboard journal with navigation, progress tracking, and part management

Kind: changes something. Title: Create campaign dashboard.

Parameters:

- `campaignTitle` (string, required): Title of the campaign (e.g., "The Whisperstone Conspiracy")
- `campaignDescription` (string, required): Brief description of the campaign theme and scope
- `template` (string, required): Campaign structure template to use. One of: `five-part-adventure`, `dungeon-crawl`, `investigation`, `sandbox`, `custom`.
- `customParts` (array of object): Custom campaign parts when template is "custom"
  - `title` (string, required)
  - `description` (string, required)
  - `type` (string, required): One of: `main_part`, `sub_part`, `chapter`, `session`, `optional`.
  - `levelStart` (number, required): Range: 1 to 20.
  - `levelEnd` (number, required): Range: 1 to 20.
  - `subParts` (array of object)
    - `title` (string, required)
    - `description` (string, required)
- `defaultQuestGiver` (string): Default NPC name for quest giving (optional)
- `defaultLocation` (string): Default campaign location/setting (optional)

### suggest-balanced-encounter

Compute the party's XP budget for an encounter difficulty and suggest creature CRs to fill it (uses dnd5e's 2024 encounter math when available, else the 2014 DMG thresholds). Returns the budget and CR suggestions; follow up with list-creatures-by-criteria / search-compendium to pick actual creatures. D&D 5e only.

Kind: read-only. Title: Suggest balanced encounter.

Parameters:

- `partyLevels` (array of integer): Character levels. If omitted, derived from the player characters.
- `difficulty` (string): Encounter difficulty (default "moderate"). One of: `low`, `moderate`, `high`.

### get-tarokka-reading

GM ONLY. The current Tarokka reading from the bridge vault: each position's card, the GM's note, linked journal page / scene / actor, and whether it was revealed to players. Never share card names or locations with players unless the GM says so.

Kind: read-only. Title: Get Tarokka reading.

No parameters.

### plan-tarokka-import

Plan storing a Tarokka reading in the bridge vault (GM-only, outside Foundry). source "auto" (default) takes the reading dealt in the tarokka-reading module when available, otherwise rolls one; "builtin-roll" always deals a fresh reading (3 common + 2 high cards, crypto random); "tarokka-reading" requires that module. A new reading archives the previous one. Returns a planId: show the diff to the GM, then apply-planned-change.

Kind: read-only. Title: Plan Tarokka reading import.

Parameters:

- `source` (string): One of: `auto`, `builtin-roll`, `tarokka-reading`. Default: `auto`.
- `userId` (string): The GM user who dealt in tarokka-reading, when that is another client than the bridge (Foundry 14.352+).

### suggest-tarokka-links

Search the world's journals, journal pages, scenes and actors by name to find what a Tarokka card should link to. The GM chooses; nothing is changed.

Kind: read-only. Title: Suggest Tarokka links.

Parameters:

- `query` (string, required): Part of a name (2-100 characters).
- `limit` (integer): Maximum results (default 20, max 50).

### plan-tarokka-links

Plan linking a position's card to a journal page, scene and/or actor (uuids), renaming the card, or clearing its links (clear: true, destructive). Links are kept per position and card, so the same card in the same position of a later reading is linked already. Pass cardId to link a card that is not in the current reading. Returns a planId for apply-planned-change.

Kind: read-only. Title: Plan Tarokka links.

Parameters:

- `position` (string, required): Reading position: tome, holySymbol, sunsword (common deck), ally, strahdLocation (high deck). One of: `tome`, `holySymbol`, `sunsword`, `ally`, `strahdLocation`.
- `cardId` (string): Card id, e.g. swords-7 or raven.
- `journalPageUuid` (string)
- `sceneUuid` (string)
- `actorUuid` (string)
- `cardName` (string): Display name for this card.
- `clear` (boolean): Remove this card's links first.

### plan-tarokka-reveal

Plan revealing one position to the players: publishes a page with exactly the text the GM wrote in a journal players can read (created on first use), and marks the position revealed. Destructive class (needs the second confirmation) because a reveal cannot be taken back at the table. Write only what the players may know. Returns a planId for apply-planned-change.

Kind: read-only. Title: Plan Tarokka reveal.

Parameters:

- `position` (string, required): Reading position: tome, holySymbol, sunsword (common deck), ally, strahdLocation (high deck). One of: `tome`, `holySymbol`, `sunsword`, `ally`, `strahdLocation`.
- `text` (string, required): What the players read (1-5000 characters, plain text).
- `title` (string): Page title (default "Card &lt;n>").
- `journalName` (string): Name of the player journal when it is created (default "Tarokka reading").
- `showNow` (boolean): Also pop the page up for the players it is revealed to (Show Players). Off by default. Undo cannot take the popup back.

### get-player-visibility

GM ONLY. What the players currently see, computed on the Foundry client: actor ids at least one player owns, the active scene as players know it (or a generic label), and which tokens on it players can see and by what name. Read-only.

Kind: read-only. Title: Get player visibility.

No parameters.

### list-revealed-pages

GM ONLY. Every journal page on the player reveal allowlist (from any feature: Tarokka reveals, plan-page-reveal), with whether it still exists in Foundry and is currently observable by a player, the chosen players when it was revealed only to some (user ids), and seenBy: who opened it on the player page and when. Also queue: the pages staged with plan-page-reveal action "queue", oldest first, with their scene and players. Titles only, never page content. Read-only.

Kind: read-only. Title: List revealed pages.

No parameters.

### get-player-handouts

GM ONLY. Allowlisted journal pages that exist and are currently observable by a player, with the raw GM HTML exactly as stored in Foundry. This is GM data for the dashboard server to sanitize before any player sees it: it is NOT player-safe by itself and must never be forwarded to a player client unsanitized. Read-only.

Kind: read-only. Title: Get player handouts.

No parameters.

### plan-page-reveal

Plan revealing a journal page to players, or hiding one already revealed. Reveal adds the page to the allowlist and, by default (setOwnership: true), raises its ownership to Observer if players cannot already see it, recording the old ownership for Hide; refused if the page is already allowlisted and still observable. When no player can open the page's journal, the reveal instead COPIES the page into the player journal "Handouts" (created on first use, Observer for players): the copy gets the page's name and content, text without any secret blocks or @Embed enrichers and with links to documents players cannot open turned into plain text, or an image's source and caption; the source page and its journal are never changed. Revealing the same source again updates its copy; only text and image pages can be copied. Destructive class (needs the second confirmation) because a reveal cannot be taken back at the table. Hide removes the page from the allowlist and, by default, restores the ownership recorded at reveal time; for a copied handout (pass the source or the copy) it deletes the copy, the "Handouts" journal stays. Write nothing but a title into the summary. Returns a planId for apply-planned-change (plus copy and note when copying).

Kind: read-only. Title: Plan page reveal.

Parameters:

- `pageUuid` (string): The journal page to reveal, hide, queue or unqueue. Not used by "reveal-next".
- `action` (string, required): "reveal" adds it to the player allowlist; "hide" removes it. "queue" stages the page for later (changes nothing in Foundry, no plan, applies at once) and "unqueue" removes it from the queue. "reveal-next" plans the reveal of the oldest queued page for sceneId (or any), with the players it was queued for; applying it also takes the page off the queue. One of: `reveal`, `hide`, `queue`, `unqueue`, `reveal-next`.
- `players` (array of string): Reveal (or queue) for these players only (Foundry user ids): the rest of the table does not get it. Omit for every player.
- `sceneId` (string): queue: the scene the page belongs to (omit for any scene). reveal-next: take the next page queued for this scene (or for any scene).
- `setOwnership` (boolean): Also change the page ownership (default true). False only changes the allowlist.
- `copy` (boolean): Reveal as a copy in the player journal "Handouts" (secret blocks and embeds left out, the source unchanged). Omit for automatic: copy when no player can open the page's journal, or when the page already has a copy (the copy is updated). True: always copy. False: never copy (raise the page instead; refused while the page has a copy).
- `showNow` (boolean): Also pop the page up for the players it is revealed to (Show Players). Off by default. Undo cannot take the popup back.

### list-ref-choices

List what a tool parameter can name right now, to pick instead of typing ids: tokens on a scene, actors, scenes, journals and pages, world items, an actor's items, combatants, users, folders, compendium packs and entries, playlists, map notes, conditions, modules, dnd5e skills and abilities, any world document by name (kind "document"), pending plans, recorded changes and Tarokka cards. Each row has id, uuid, name, detail and group. Read-only; GM only.

Kind: read-only. Title: List parameter choices.

Parameters:

- `kind` (string, required): What to list. One of: `actor`, `token`, `scene`, `journal`, `journal-page`, `item`, `actor-item`, `combatant`, `user`, `folder`, `compendium-pack`, `compendium-entry`, `playlist`, `note`, `template`, `condition`, `module`, `skill`, `ability`, `document`, `plan`, `change`, `tarokka-card`.
- `filter` (object): Optional narrowing: types (actor/item subtypes), playerOwned (actors), role ("gm" | "player"), documentName (folders, packs, compendium entries, document search), undoable (changes).
- `parent` (string): Narrows by a containing thing: the scene (id or name) for tokens/notes, the pack id for compendium entries, the actor for its items, the journal for its pages, the Tarokka position for cards.
- `query` (string): Text to search in names (case-insensitive).
- `limit` (integer): Maximum rows (default 200, max 500).

### get-session-log

Return the structured event log for the current session: combat start/end, HP changes (damage/healing), deaths and stabilizations, conditions applied/removed, resources expended, scene changes, journal entries created/updated, and dice rolls (public rolls as roll/damage-roll with a full breakdown in details.breakdown; whispered, blind and self rolls as gm-roll). Use this as a session memory layer to recap what has happened.

Kind: read-only. Title: Get session log.

Parameters:

- `limit` (integer): Maximum number of events to return (default 100). Default: `100`.
- `eventType` (string): Optional event type filter (e.g. "combat-start", "combat-end", "damage", "healing", "death", "stabilize", "condition-applied", "condition-removed", "resource-spent", "scene-change", "journal-created", "journal-updated", "roll", "damage-roll", "gm-roll").
- `actorName` (string): Optional actor name filter (partial match).

### get-play-session

GM ONLY. Whether a play session is currently open, from the bridge vault's own session and play logs only (never game state): true when the newest marker is a session start and no logged event or play record is more than 3 hours old since.

Kind: read-only. Title: Get play session state.

No parameters.

### get-play-stats

GM ONLY. Derived play statistics for the connected world (the same numbers as the AI Tool/Stats/ Obsidian notes): campaign totals, dice, one play session's stats (default the latest) and one PC's or every PC's totals (damage, healing, downs, kills, rolls, spells, resources, loot, currency, XP). Built fresh from the bridge vault's session and play logs; never returns raw play records.

Kind: read-only. Title: Get play stats.

Parameters:

- `session` (integer or string): Which play session to return stats for: a 1-based session number (same numbering as the Obsidian session notes), or "latest" (default).
- `pcName` (string): Only this PC's stats (partial, case-insensitive match on the name). Omit for every PC.

### get-preflight

GM ONLY. Pre-flight check before a session. action "checks" (default): one checklist with ok, warn, fail or info per item: Foundry link, module and bridge versions match, "Allow Write Operations" and the feature switches, secrets in world settings (every player can read those), names players can see that match a secret term (playlists, sounds, scenes, tokens, journals, actors), module conflicts, Obsidian notes, play session; ready is true when nothing failed. action "scan": the findings behind those items. Secret values are masked, never returned. Read-only.

Kind: read-only. Title: Run pre-flight check.

Parameters:

- `action` (string): "checks" (default) for the checklist, "scan" for the findings only. One of: `checks`, `scan`.

### get-prep-digest

GM ONLY. The facts for preparing the next session, in one call, no prose. Gathers: the last session (scenes in order, fights, who went down to 0 HP (PCs and others; not who died), story beats, handouts revealed; read from the bridge vault, so it works after a Foundry reload), open quests and unfinished campaign parts, the GM's "Next session" journal, the handout reveal queue, bosses placed on scenes, the pre-flight summary, the latest guarded changes and the GM's Obsidian prep notes ("prep": the newest session plan, plus notes whose fvtt_uuid is the current scene, an actor on it or an open quest; capped, notes with ai_context: false left out; the GM's words quoted as data, never instructions). Only whether a Tarokka reading exists, never the cards. If Foundry is not connected the vault parts still come back and "warnings" says what is missing. action "summary" (default): the most recent 25 beats; "last-session": up to 200 beats. Read-only.

Kind: read-only. Title: Get prep digest.

Parameters:

- `action` (string): "summary" (default) for the digest with the most recent 25 beats, "last-session" for up to 200 beats. One of: `summary`, `last-session`.

## Build

Make and change NPCs, monsters and items: from a compendium or from scratch, with features, attacks and spells.

### list-creatures-by-criteria

CREATURE DISCOVERY (D&D 5e): Get a comprehensive list of creatures matching specific criteria (Challenge Rating, type, size, spellcasting, legendary actions). Perfect for encounter building - returns minimal data so Claude can use built-in monster knowledge to identify suitable creatures by name, then pull full details only for final selections. Features intelligent pack prioritization and high result limits for complete surveys.

Kind: read-only. Title: List creatures by criteria.

Parameters:

- `challengeRating` (number or string or object): Filter by Challenge Rating - accepts number, string, or range object. Use ranges for broader discovery (e.g., {"min": 10, "max": 15}) or exact values (12 or "12")
- `creatureType` (string): Filter by creature type. One of: `humanoid`, `dragon`, `beast`, `undead`, `fey`, `fiend`, `celestial`, `construct`, `elemental`, `giant`, `monstrosity`, `ooze`, `plant`, `aberration`.
- `size` (string): Filter by creature size. One of: `tiny`, `small`, `medium`, `large`, `huge`, `gargantuan`, `sm`, `med`, `lg`, `grg`.
- `hasSpells` (boolean): Filter for spellcasting creatures
- `hasLegendaryActions` (boolean): Filter for creatures with legendary actions (D&D 5e)
- `limit` (number): Maximum results to return (default: 500 for comprehensive surveys, max: 1000). Range: 1 to 1000. Default: `500`.

### get-compendium-entry-full

Retrieve complete stat block data including items, spells, and abilities for actor creation

Kind: read-only. Title: Get full compendium entry.

Parameters:

- `packId` (string, required): Compendium pack identifier
- `entryId` (string, required): Entry identifier within the pack

### create-actor-from-compendium

Create one or more actors from a specific compendium entry with custom names. Use search-compendium first to find the exact creature you want, then use this tool with the packId and itemId from the search results.

Kind: changes something. Title: Create actor from compendium.

Parameters:

- `packId` (string, required): ID of the compendium pack containing the creature (e.g., "dnd5e.monsters")
- `itemId` (string, required): ID of the specific creature entry within the pack (get this from search-compendium results)
- `names` (array of string, required): Custom names for the created actors (e.g., ["Flameheart", "Sneak", "Peek"]). Items: at least 1.
- `quantity` (number): Number of actors to create (default: based on names array length); capped by the GM's Max Actors Per Request setting (1 to 50). Range: 1 to 50.
- `addToScene` (boolean): Whether to add created actors to the current scene as tokens. Default: `false`.
- `placement` (object): Token placement options (only used when addToScene is true)
  - `type` (string, required): Placement strategy. One of: `random`, `grid`, `center`, `coordinates`. Default: `grid`.
  - `coordinates` (array of object): Specific coordinates for each token (required when type is "coordinates")
    - `x` (number, required): X coordinate in pixels
    - `y` (number, required): Y coordinate in pixels

### dnd5e-create-npc

[D&D 5e only] Create a new NPC actor from scratch with a full Level-2 stat block: identity (name, type, size, alignment, CR), ability scores, saving throw proficiencies, HP (average + formula), AC (default or flat), movement speeds, senses, skill proficiencies, damage immunities/resistances/vulnerabilities, condition immunities, languages, and biography. Items, actions, features, and spells are NOT added by this tool; use dnd5e-add-feature (featureType: "passive", "save", "attack", "attack-with-save", "aura", "spellcasting", or "spells") to add them after creation. The actor is placed in the "Foundry MCP Creatures" folder.

Kind: changes something. Title: Create NPC.

Parameters:

- `name` (string, required): Name of the NPC
- `creatureType` (string, required): Creature type. One of: `humanoid`, `undead`, `beast`, `dragon`, `aberration`, `construct`, `elemental`, `fey`, `fiend`, `giant`, `monstrosity`, `ooze`, `plant`, `celestial`, `swarm`.
- `creatureSubtype` (string): Optional subtype (e.g. "Goblinoid", "Shapechanger"). Default: `""`.
- `size` (string, required): Creature size. One of: `tiny`, `small`, `medium`, `large`, `huge`, `gargantuan`.
- `alignment` (string): Alignment string (e.g. "Neutral Evil", "Chaotic Good"). Default: `""`.
- `cr` (string or number, required): Challenge Rating: whole number (0, 1, 5), fraction string ("1/8", "1/4", "1/2"), or decimal number (0.25, 0.5)
- `hpAverage` (number, required): Average (fixed) hit points. Range: at least 1.
- `hpFormula` (string, required): Hit dice formula used for re-rolls (e.g. "2d6", "3d8+9")
- `acMode` (string, required): "default": Foundry calculates AC from equipped items and abilities; "flat": set a fixed AC value via acValue. One of: `default`, `flat`.
- `acValue` (number): Fixed AC value (0–30). Required when acMode is "flat". Range: 0 to 30.
- `abilities` (object, required): The six ability scores (1–30 each)
  - `str` (number, required): Range: 1 to 30.
  - `dex` (number, required): Range: 1 to 30.
  - `con` (number, required): Range: 1 to 30.
  - `int` (number, required): Range: 1 to 30.
  - `wis` (number, required): Range: 1 to 30.
  - `cha` (number, required): Range: 1 to 30.
- `savingThrows` (array of string): Abilities with saving throw proficiency. One of: `str`, `dex`, `con`, `int`, `wis`, `cha`. Default: `[]`.
- `walkSpeed` (number): Walk speed in feet. Range: at least 0. Default: `30`.
- `flySpeed` (number): Fly speed in feet. Range: at least 0. Default: `0`.
- `swimSpeed` (number): Swim speed in feet. Range: at least 0. Default: `0`.
- `climbSpeed` (number): Climb speed in feet. Range: at least 0. Default: `0`.
- `burrowSpeed` (number): Burrow speed in feet. Range: at least 0. Default: `0`.
- `hover` (boolean): Whether the creature hovers (cannot fall). Default: `false`.
- `darkvision` (number): Darkvision range in feet. Range: at least 0. Default: `0`.
- `blindsight` (number): Blindsight range in feet. Range: at least 0. Default: `0`.
- `tremorsense` (number): Tremorsense range in feet. Range: at least 0. Default: `0`.
- `truesight` (number): Truesight range in feet. Range: at least 0. Default: `0`.
- `specialSenses` (string): Any additional senses not covered by the standard fields. Default: `""`.
- `skills` (array of object): Skills with proficiency or expertise. Default: `[]`.
  - `skill` (string, required): One of: `Acrobatics`, `Animal Handling`, `Arcana`, `Athletics`, `Deception`, `History`, `Insight`, `Intimidation`, `Investigation`, `Medicine`, `Nature`, `Perception`, `Performance`, `Persuasion`, `Religion`, `Sleight of Hand`, `Stealth`, `Survival`.
  - `proficiency` (string, required): "proficient" = proficiency bonus once; "expert" = double proficiency. One of: `proficient`, `expert`.
- `damageImmunities` (array of string): Damage types the creature is immune to (e.g. ["necrotic", "poison"]). Canonical values: acid, bludgeoning, cold, fire, force, lightning, necrotic, piercing, poison, psychic, radiant, slashing, thunder. Non-canonical values are accepted with a warning. Default: `[]`.
- `damageResistances` (array of string): Damage types the creature is resistant to. Same canonical set as damageImmunities. Default: `[]`.
- `damageVulnerabilities` (array of string): Damage types the creature is vulnerable to. Same canonical set as damageImmunities. Default: `[]`.
- `conditionImmunities` (array of string): Conditions the creature is immune to (e.g. ["charmed", "frightened"]). Canonical values: blinded, charmed, deafened, exhaustion, frightened, grappled, incapacitated, invisible, paralyzed, petrified, poisoned, prone, restrained, stunned, unconscious. Non-canonical values are accepted with a warning. Default: `[]`.
- `languages` (array of string): Languages the creature speaks (e.g. ["Common", "Goblin"]). Default: `[]`.
- `languagesCustom` (string): Free-text language note (e.g. "telepathy 60 ft."). Default: `""`.
- `biography` (string): HTML biography text shown in the character sheet. Default: `""`.
- `sourceBook` (string): Source book abbreviation (e.g. "MM'14", "VGM"). Default: `""`.
- `sourcePage` (string): Page number in the source book. Default: `""`.
- `sourceRules` (string): Rules edition. One of: `2014`, `2024`. Default: `2014`.

### dnd5e-add-feature

[D&D 5e only] Add a feature, attack, spellcasting setup, or spells to an existing actor. Set featureType to select the mode; each mode uses only its own parameters:

- passive: descriptive trait, no roll (Multiattack, Magic Resistance, Spider Climb).
  - Required: actorIdentifier, featureName
  - Optional: description, sourceRules, sourceBook, sourcePage
- save: feature that forces a saving throw (breath weapon, cone of cold, etc.).
  - Required: actorIdentifier, featureName, saveAbility, saveDC, damageParts
  - Optional: description, activationType, halfOnSave, areaType, areaSize (required if areaType set), areaUnits, affectsType
- attack: weapon attack with to-hit roll (Claw, Bite, Scimitar, etc.).
  - Required: actorIdentifier, featureName, attackType, damageParts
  - Required when ranged: rangeFt
  - Optional: description, activationType, weaponClass, abilityModifier, attackBonus, proficient, equipped, reachFt, longRangeFt, properties, sourceRules, sourceBook, sourcePage
- attack-with-save: attack roll on hit + forced save for bonus damage (e.g. Stinger: piercing hit + CON save or poison damage).
  - Required: actorIdentifier, featureName, attackType, damageParts, saveAbility, saveDC, saveDamageParts
  - Required when ranged: rangeFt
  - Optional: description, activationType, weaponClass, abilityModifier, attackBonus, proficient, equipped, reachFt, longRangeFt, properties, saveOnSave, sourceRules, sourceBook, sourcePage
- aura: automatic-damage area, no to-hit, no save (all creatures in range take damage).
  - Required: actorIdentifier, featureName, damageParts, areaType, areaSize
  - Optional: description, activationType, areaUnits, affectsType, sourceRules, sourceBook, sourcePage
- spellcasting: configure spell slots and casting ability. Run this BEFORE featureType "spells".
  - Required: actorIdentifier, spellcastingClass, spellcastingLevel
  - Optional: spellcastingAbility (default per class: wizard/artificer→INT, cleric/druid/ranger→WIS, sorcerer/warlock/bard/paladin→CHA), sourceRules
- spells: import named spells from compendium. Names must be in English.
  - Required: actorIdentifier, spellNames (max 50)
  - Optional: compendiumPacks (default ["dnd5e.spells"])

Use list-characters or get-character first to find the actorIdentifier.

Kind: changes something. Title: Add feature to actor.

Parameters:

- `featureType` (string, required): Mode selector: determines which parameters are used and which Foundry handler is called. One of: `passive`, `save`, `attack`, `attack-with-save`, `aura`, `spellcasting`, `spells`.
- `actorIdentifier` (string, required): Name or ID of the target actor (partial name match supported). Required for all featureTypes.
- `featureName` (string): Name for the new feature/item; must be unique on the actor. Required for: passive, save, attack, attack-with-save, aura.
- `description` (string): HTML description of the feature (optional). Used by: passive, save, attack, attack-with-save, aura. Default: `""`.
- `activationType` (string): Action economy type. Used by: save, attack, attack-with-save, aura. Default: "action". One of: `action`, `bonus`, `reaction`, `legendary`, `lair`, `special`. Default: `action`.
- `damageParts` (array of object): Damage components. For attack: first entry is base weapon die, extra entries stack on top. For save and aura: all damage dealt on trigger. For attack-with-save: the attack roll damage (on hit). Required for: save, attack, attack-with-save, aura. Items: at least 1.
  - `number` (number, required): Number of dice (e.g. 4). Range: at least 1.
  - `denomination` (number, required): Die size. One of: `4`, `6`, `8`, `10`, `12`, `20`, `100`.
  - `type` (string, required): Damage type (e.g. "fire", "slashing", "cold")
- `saveAbility` (string): Ability used for the saving throw. Required for: save, attack-with-save. One of: `str`, `dex`, `con`, `int`, `wis`, `cha`.
- `saveDC` (number): Saving throw DC (1–30). Required for: save, attack-with-save. Range: 1 to 30.
- `halfOnSave` (boolean): Whether the target takes half damage on a successful save. Used by: save. Default: true. Default: `true`.
- `saveDamageParts` (array of object): Damage dealt by the save effect on a failed save (independent of attack damage). Required for: attack-with-save. Items: at least 1.
  - `number` (number, required): Number of dice (e.g. 4). Range: at least 1.
  - `denomination` (number, required): Die size. One of: `4`, `6`, `8`, `10`, `12`, `20`, `100`.
  - `type` (string, required): Damage type (e.g. "fire", "slashing", "cold")
- `saveOnSave` (string): "none": no damage on a successful save (default). "half": half save damage on a successful save. Used by: attack-with-save. One of: `half`, `none`. Default: `none`.
- `areaType` (string): Area-of-effect template shape. For save: optional (omit or use "" for no template); if set, areaSize is required. For aura: required; use "emanation" or "sphere" for radial auras. One of: `cone`, `cube`, `cylinder`, `emanation`, `line`, `radius`, `sphere`, `""`. Default: `""`.
- `areaSize` (number): Template size in areaUnits (e.g. 30 for a 30 ft cone). Must be > 0. Required for: aura. Required for save when areaType is set. Range: above 0.
- `areaUnits` (string): Units for areaSize. Used by: save, aura. Default: "ft". One of: `ft`, `m`. Default: `ft`.
- `affectsType` (string): What the area targets. Used by: save, aura. Default: "creature". One of: `creature`, `object`, `space`, `""`. Default: `creature`.
- `attackType` (string): "melee" for reach-based attacks; "ranged" for bow/thrown attacks. Required for: attack, attack-with-save. One of: `melee`, `ranged`.
- `weaponClass` (string): Weapon category. Use "natural" for monster attacks (claws, bite, touch). Used by: attack, attack-with-save. Default: "natural". One of: `natural`, `simpleM`, `martialM`, `simpleR`, `martialR`. Default: `natural`.
- `abilityModifier` (string): Ability used for to-hit and damage rolls. Omit to use default: STR for melee, DEX for ranged. Used by: attack, attack-with-save. One of: `str`, `dex`, `con`, `int`, `wis`, `cha`.
- `attackBonus` (number): Flat bonus to the attack roll only, not damage (e.g. 1 for +1 to hit). Used by: attack, attack-with-save. Default: 0. Range: 0 to 10. Default: `0`.
- `proficient` (boolean): Whether the actor is proficient with this weapon (adds proficiency bonus to to-hit). Used by: attack, attack-with-save. Default: true. Default: `true`.
- `equipped` (boolean): Whether the weapon is equipped and available for attack rolls. Used by: attack, attack-with-save. Default: true. Default: `true`.
- `reachFt` (number): Melee reach in feet. Used by: attack, attack-with-save (melee only). Default: 5. Range: at least 5. Default: `5`.
- `rangeFt` (number): Normal range in feet. Used by: attack, attack-with-save. Required when attackType is "ranged". Range: at least 1.
- `longRangeFt` (number): Long range in feet; attacks beyond rangeFt up to this distance are at disadvantage. Must be greater than rangeFt. Used by: attack, attack-with-save (ranged only). Range: at least 1.
- `properties` (array of string): Weapon property codes (e.g. ["fin", "lgt"]). Canonical 2014 codes: ada, amm, fin, fir, foc, hvy, lgt, lod, mgc, rch, ret, spc, thr, two, ver. Used by: attack, attack-with-save. Default: []. Default: `[]`.
- `spellcastingClass` (string): The spellcasting class; determines slot table and default casting ability. Warlock uses Pact Magic. Required for: spellcasting. One of: `artificer`, `bard`, `cleric`, `druid`, `paladin`, `ranger`, `sorcerer`, `warlock`, `wizard`.
- `spellcastingLevel` (number): Class level (1–20). Determines how many slots the actor receives. Required for: spellcasting. Range: 1 to 20.
- `spellcastingAbility` (string): Override the casting ability. Omit to use the class default. Used by: spellcasting. One of: `str`, `dex`, `con`, `int`, `wis`, `cha`.
- `spellNames` (array of string): English spell names to import (exact match, case-insensitive). Max 50 per call. Required for: spells. Items: 1 to 50.
- `compendiumPacks` (array of string): Compendium pack IDs to search, in priority order (first match wins). Default: ["dnd5e.spells"] (SRD 2014). Use "dnd5e.spells24" for 2024 rules. Used by: spells. Default: `["dnd5e.spells"]`.
- `sourceRules` (string): Rules edition. Used by: passive, attack, attack-with-save, aura, spellcasting. Default: "2014". One of: `2014`, `2024`. Default: `2014`.
- `sourceBook` (string): Source book abbreviation (e.g. "MM'14"). Used by: passive, attack, attack-with-save, aura. Default: `""`.
- `sourcePage` (string): Page number in the source book. Used by: passive, attack, attack-with-save, aura. Default: `""`.

### dnd5e-add-features-from-compendium

[D&D 5e only] Import class features and monster features from an official compendium pack onto an actor (NPC or PC). Each feature is looked up by EXACT name (case-insensitive) and embedded onto the actor as-is from the compendium data.

USE THIS TOOL when you need to:

- Add monster features by name (e.g. "Pack Tactics", "Nimble Escape", "Multiattack")
- Add class features to an NPC caster (e.g. "Spellcasting", "Action Surge", "Font of Magic")
- Mix features from monster and class compendiums on a custom NPC
- Example: "add Spellcasting, Font of Magic and Metamagic to this sorcerer NPC"

⚠️ IMPORTANT: feature names must be in English: the compendium uses English names. Translate BEFORE calling if the user provided names in another language.

compendiumPacks controls which pack(s) to search (priority order, first match wins):

- Default ["dnd5e.monsterfeatures", "dnd5e.classfeatures"] → 2014 SRD
- ["dnd5e.monsterfeatures24"]                              → 2024 monster features only
- ["dnd5e.monsterfeatures24", "dnd5e.classfeatures"]       → 2024 monsters + 2014 class

DO NOT USE THIS TOOL for:

- Importing spell items → use dnd5e-add-feature with featureType "spells" instead
- Setting up spellcasting class or spell slots → use dnd5e-add-feature with featureType "spellcasting"
- Importing 2024 class features: they are embedded inside class items in the 2024 edition, not available in a separate compendium pack; this tool cannot import them
- Creating custom/homebrew features from scratch → compendium-only, no homebrew
- Non-dnd5e systems → this tool is dnd5e-exclusive

Returns a detailed report: features added ✅, skipped (already on actor) ⏭️, not found in compendium ❌, and failed during import ⚠️. Use list-characters or get-character first to find the actorIdentifier.

Kind: changes something. Title: Add compendium features to actor.

Parameters:

- `actorIdentifier` (string, required): Name or ID of the target actor (partial name match supported)
- `featureNames` (array of string, required): English feature names to import (exact match, case-insensitive). Maximum 50 per call. Items: 1 to 50.
- `compendiumPacks` (array of string): Compendium pack IDs to search, in priority order (first match wins). Defaults to ["dnd5e.monsterfeatures", "dnd5e.classfeatures"] (SRD 2014). Use "dnd5e.monsterfeatures24" for 2024 monster features. Note: 2024 class features are not available in a separate pack. Default: `["dnd5e.monsterfeatures","dnd5e.classfeatures"]`.

### manage-world-items

Manage Item documents in Foundry VTT. Specify the operation with "action":

- "create": Create world-level Items in the sidebar (not actor-attached). Good for reusable libraries. GM-only.
- "list": List world-level Items with optional type/folder/name filters.
- "update": Update existing world-level Items by ID. GM-only.
- "add-to-actor": Create and attach Items directly to an existing actor. GM-only.

Kind: changes something and can delete or overwrite. Title: Manage world items.

Parameters:

- `action` (string, required): Operation to perform: "create" world items, "list" world items, "update" world items by id, or "add-to-actor" to attach items to an actor. One of: `create`, `list`, `update`, `add-to-actor`.
- `items` (array of object): Required for "create" and "add-to-actor". One or more items to create. Each item requires a name and a type valid for D&D 5e (e.g. "weapon", "equipment", "spell", "feat"). Items: at least 1.
  - `name` (string, required): Display name of the item
  - `type` (string, required): Item type valid for the active system (e.g. "action", "talent", "weapon")
  - `img` (string): Optional icon path (e.g. "icons/svg/explosion.svg")
  - `system` (object): System-specific data (free-form). Passed through to Foundry's DataModel layer.
- `updates` (array of object): Required for "update". One or more item patches. Each entry must include "id" plus at least one field to change (name, img, system, folder). Items: at least 1.
  - `id` (string, required): ID of the world Item to update
  - `name` (string): New display name
  - `img` (string): New icon path
  - `system` (object): System-specific fields to update (merged into existing system data)
  - `folder` (string): Move item into this folder (name or ID). Created if absent.
- `folder` (string): For "create": folder name/ID to place items in (created if absent). For "list": filter to items inside this folder.
- `type` (string): For "list": filter by item type (e.g. "action", "talent"). Omit to return all types.
- `nameFilter` (string): For "list": case-insensitive substring match on item name.
- `actorIdentifier` (string): For "add-to-actor": actor name or ID to receive the items.

## Admin

Set up and troubleshoot: installed modules and their errors, who owns which actor, and the Obsidian mirror settings.

### get-modules

List installed Foundry modules with version, active state, declared compatibility (min/verified/max core), and required-dependency satisfaction, plus the core Foundry and game-system versions. Each module includes an `issues` list (missing/inactive dependencies, version-out-of-range). Use to spot version/dependency/compatibility conflicts.

Kind: read-only. Title: List modules.

Parameters:

- `activeOnly` (boolean): Only return active modules.
- `withIssuesOnly` (boolean): Only return modules that have detected issues.

### get-module-errors

Return runtime errors/warnings captured from the Foundry client (console.error/warn, uncaught errors, unhandled promise rejections), each with its stack and the module it was attributed to, plus a triage summary of counts by module. Use this when a module misbehaves; filter by module or time.

Kind: read-only. Title: Get module errors.

Parameters:

- `level` (string): Filter by severity. One of: `error`, `warn`.
- `moduleId` (string): Filter to a module/system id (partial match), e.g. "lib-wrapper".
- `sinceTimestamp` (string): ISO timestamp; only newer entries.
- `limit` (integer): Max entries (default 100, max 500).

### clear-module-errors

Clear the captured diagnostics buffer (e.g. before reproducing an issue so only fresh errors remain).

Kind: changes something and can delete or overwrite. Title: Clear module errors.

No parameters.

### get-module-manifest

Return a single module's full manifest (version, compatibility, relationships/dependencies, authors, url) for deeper inspection.

Kind: read-only. Title: Get module manifest.

Parameters:

- `moduleId` (string, required): The module id.

### list-actor-ownership

List current ownership permissions for actors, showing which players have what access levels.

Kind: read-only. Title: List actor ownership.

Parameters:

- `actorIdentifier` (string): Optional: specific actor name/ID to check, or "all" for all actors
- `playerIdentifier` (string): Optional: specific player name to check ownership for

### plan-ownership-change

Plan who owns which actor; apply it with apply-planned-change, revert it with undo-change. "assign": give the player(s) a level (NONE, LIMITED, OBSERVER, OWNER). "remove": set them to NONE. Bulk phrases work ("all friendly NPCs", "party characters"; player "party"). The plan lists each change ("Wolf: Player OBSERVER, was default").

Kind: read-only. Title: Plan ownership change.

Parameters:

- `action` (string, required): assign or remove. One of: `assign`, `remove`.
- `actorIdentifier` (string, required): Actor name or ID, "all friendly NPCs" or "party characters".
- `playerIdentifier` (string, required): Player or character name, or "party" for all connected players.
- `permissionLevel` (string): assign: NONE, LIMITED, OBSERVER (sees the sheet) or OWNER (controls it). One of: `NONE`, `LIMITED`, `OBSERVER`, `OWNER`.

### get-obsidian-mirror

GM ONLY. The Obsidian mirror's settings (enabled, mirrored kinds, journals whose page text is mirrored, excluded folders, story item types), their hash, the backend environment (whether FOUNDRY_AI_OBSIDIAN_DIR is set, the "Open in Foundry" base FOUNDRY_AI_OPEN_BASE, the poll interval, FOUNDRY_AI_FOUNDRY_URL where images are fetched) and the mirror's live status (last cycle, note counts per type, Library and image copies, notes it skipped because the GM edited them, errors). The mirror writes notes only when FOUNDRY_AI_OBSIDIAN_DIR is set AND settings.enabled is true. Settings change only through plan-obsidian-mirror. Read-only.

Kind: read-only. Title: Get Obsidian mirror settings.

No parameters.

### plan-obsidian-mirror

Plan a change to the Obsidian mirror's settings; nothing changes until apply-planned-change (the GM confirms, and the module's "AI Tool: Obsidian mirror (writes)" switch must be on). Every argument is optional and a missing one keeps its current value. "enabled" turns the mirror on or off (it also needs FOUNDRY_AI_OBSIDIAN_DIR); "kinds" picks what is mirrored; "textFolderIds" and "textJournalIds" name the journals whose page text is mirrored (default: none, page text stays in Foundry); "excludeFolderIds" are folders that are never mirrored, subfolders included; "storyItemTypes" are the item types that count as story items; "libraryPacks" are the compendium packs that get Library notes. Refused when nothing would change. The summary names ids and counts, never page text. Returns a planId for apply-planned-change; undo-change restores the previous settings.

Kind: read-only. Title: Plan Obsidian mirror change.

Parameters:

- `enabled` (boolean): True starts the mirror (needs FOUNDRY_AI_OBSIDIAN_DIR), false stops it. Notes already written stay in the vault.
- `kinds` (array of string): Which kinds get notes: pc (player characters), npc, scene, journal, item (story items). The full list replaces the current one; an empty list mirrors nothing. One of: `pc`, `npc`, `scene`, `journal`, `item`.
- `textFolderIds` (array of string): Journal folders whose page text is mirrored (the full list replaces the current one; subfolders included). The page text is copied into the Obsidian vault of the GM.
- `textJournalIds` (array of string): Journals whose page text is mirrored (the full list replaces the current one).
- `excludeFolderIds` (array of string): Folders (any document type) whose contents are never mirrored, subfolders included. The full list replaces the current one.
- `storyItemTypes` (array of string): Item types that get a story-item note when the item is in the mirrored set (for example weapon, equipment, consumable, tool, loot, container). The full list replaces the current one.
- `libraryPacks` (array of string): Compendium packs (e.g. world.ddb-monsters) whose monsters, items, spells, classes, species, backgrounds and feats get Library notes in the GM vault (licensed, kept out of git). Replaces the list.
