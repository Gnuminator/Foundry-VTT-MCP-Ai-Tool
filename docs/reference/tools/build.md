---
description: Every tool in the Build set with its description and parameters. Generated from the tool catalog.
---

<!-- Generated from the tool catalog by packages/mcp-server/src/tool-reference.ts. Do not edit by hand: run `npm run docs:tools` after changing a tool. CI fails when this page is stale. -->

# Build tools

Make and change NPCs, monsters, items and player characters: from a compendium or from scratch, with features, attacks and spells. Set up rooms: teleports and tokens in a room. Part of the [tool reference](../tools.md); [Tool sets](../TOOL-SETS.md) explains how Claude Desktop loads the sets. Claude Desktop entry: `foundry-mcp-build`.

## manage-world-items

Direct write. Manage Item documents in Foundry VTT. Specify the operation with "action":

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

## list-creatures-by-criteria

List creatures by Challenge Rating, type, size, spellcasting or legendary actions (D&D 5e). Returns minimal data for encounter building: pick by name, then pull full details only for the final choices with get-compendium-entry-full.

Kind: read-only. Title: List creatures by criteria.

Parameters:

- `challengeRating` (number or string or object): Filter by Challenge Rating - accepts number, string, or range object. Use ranges for broader discovery (e.g., {"min": 10, "max": 15}) or exact values (12 or "12")
- `creatureType` (string): Filter by creature type. One of: `humanoid`, `dragon`, `beast`, `undead`, `fey`, `fiend`, `celestial`, `construct`, `elemental`, `giant`, `monstrosity`, `ooze`, `plant`, `aberration`.
- `size` (string): Filter by creature size. One of: `tiny`, `small`, `medium`, `large`, `huge`, `gargantuan`, `sm`, `med`, `lg`, `grg`.
- `hasSpells` (boolean): Filter for spellcasting creatures
- `hasLegendaryActions` (boolean): Filter for creatures with legendary actions (D&D 5e)
- `limit` (number): Maximum results to return (default: 500 for comprehensive surveys, max: 1000). Range: 1 to 1000. Default: `500`.

## create-actor-from-compendium

Direct write. Create one or more actors from a specific compendium entry with custom names. Use search-compendium first to find the exact creature you want, then use this tool with the packId and itemId from the search results.

Kind: changes something. Title: Create actor from compendium.

Parameters:

- `packId` (string, required): ID of the compendium pack containing the creature (e.g., "dnd5e.monsters")
- `itemId` (string, required): ID of the specific creature entry within the pack (get this from search-compendium results)
- `names` (array of string, required): Custom names for the created actors (e.g., ["Flameheart", "Sneak", "Peek"]). Items: at least 1.
- `quantity` (number): Number of actors to create (default: based on names array length); limited to 1 to 50 actors per request. Range: 1 to 50.
- `addToScene` (boolean): Whether to add created actors to the current scene as tokens. Default: `false`.
- `placement` (object): Token placement options (only used when addToScene is true)
  - `type` (string, required): Placement strategy. One of: `random`, `grid`, `center`, `coordinates`. Default: `grid`.
  - `coordinates` (array of object): Specific coordinates for each token (required when type is "coordinates")
    - `x` (number, required): X coordinate in pixels
    - `y` (number, required): Y coordinate in pixels

## get-compendium-entry-full

Use this for a complete stat block (items, spells, abilities) when creating an actor; to just read an entry use get-compendium-item.

Kind: read-only. Title: Get full compendium entry.

Parameters:

- `packId` (string, required): Compendium pack identifier
- `entryId` (string, required): Entry identifier within the pack

## dnd5e-add-feature

Direct write. D&D 5e only. Add a feature, attack, spellcasting setup or spells to an existing actor. featureType picks the mode; each parameter says which modes use it. Required besides actorIdentifier:

- passive: a trait with no roll (Magic Resistance): featureName
- save: forces a saving throw (breath weapon): featureName, saveAbility, saveDC, damageParts
- attack: weapon attack (Claw, Bite): featureName, attackType, damageParts (rangeFt when ranged)
- attack-with-save: a hit plus a save for bonus damage (Stinger): the attack ones plus saveAbility, saveDC, saveDamageParts
- aura: damage to all in range, no roll: featureName, damageParts, areaType, areaSize
- spellcasting: slots and casting ability, run before "spells": spellcastingClass, spellcastingLevel
- spells: import named spells from the compendium: spellNames (English, max 50)

Find the actorIdentifier with list-characters or get-character.

Kind: changes something. Title: Add feature to actor.

Parameters:

- `featureType` (string, required): Mode: decides which parameters are used. One of: `passive`, `save`, `attack`, `attack-with-save`, `aura`, `spellcasting`, `spells`.
- `actorIdentifier` (string, required): Name or ID of the target actor (partial name match works). Always required.
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
- `proficient` (boolean): Adds the proficiency bonus to hit. Used by: attack, attack-with-save. Default: true. Default: `true`.
- `equipped` (boolean): Weapon is equipped. Used by: attack, attack-with-save. Default: true. Default: `true`.
- `reachFt` (number): Melee reach in feet. Used by: attack, attack-with-save (melee only). Default: 5. Range: at least 5. Default: `5`.
- `rangeFt` (number): Normal range in feet. Used by: attack, attack-with-save. Required when attackType is "ranged". Range: at least 1.
- `longRangeFt` (number): Long range in feet; attacks beyond rangeFt up to this distance are at disadvantage. Must be greater than rangeFt. Used by: attack, attack-with-save (ranged only). Range: at least 1.
- `properties` (array of string): Weapon property codes: ada, amm, fin, fir, foc, hvy, lgt, lod, mgc, rch, ret, spc, thr, two, ver. Used by: attack, attack-with-save. Default: `[]`.
- `spellcastingClass` (string): The spellcasting class; determines slot table and default casting ability. Warlock uses Pact Magic. Required for: spellcasting. One of: `artificer`, `bard`, `cleric`, `druid`, `paladin`, `ranger`, `sorcerer`, `warlock`, `wizard`.
- `spellcastingLevel` (number): Class level (1–20). Determines how many slots the actor receives. Required for: spellcasting. Range: 1 to 20.
- `spellcastingAbility` (string): Casting ability. Omit for the class default (wizard, artificer INT; cleric, druid, ranger WIS; sorcerer, warlock, bard, paladin CHA). Used by: spellcasting. One of: `str`, `dex`, `con`, `int`, `wis`, `cha`.
- `spellNames` (array of string): English spell names to import (exact match, case-insensitive). Max 50 per call. Required for: spells. Items: 1 to 50.
- `compendiumPacks` (array of string): Compendium pack IDs to search, in priority order (first match wins). Default: ["dnd5e.spells"] (SRD 2014). Use "dnd5e.spells24" for 2024 rules. Used by: spells. Default: `["dnd5e.spells"]`.
- `sourceRules` (string): Rules edition. Used by: passive, attack, attack-with-save, aura, spellcasting. Default: "2014". One of: `2014`, `2024`. Default: `2014`.
- `sourceBook` (string): Source book abbreviation (e.g. "MM'14"). Used by: passive, attack, attack-with-save, aura. Default: `""`.
- `sourcePage` (string): Page number in the source book. Used by: passive, attack, attack-with-save, aura. Default: `""`.

## dnd5e-create-npc

Direct write. D&D 5e only. Create an NPC from scratch with a full stat block: identity, ability scores, saves, HP, AC, speeds, senses, skills, damage and condition traits, languages and biography. It adds no items, actions, features or spells: add them afterwards with dnd5e-add-feature. The actor goes in the "Foundry MCP Creatures" folder.

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
- `damageImmunities` (array of string): Damage types the creature is immune to (e.g. ["necrotic", "poison"]), lowercase 5e names. Other values are accepted with a warning. Default: `[]`.
- `damageResistances` (array of string): Damage types the creature is resistant to. Same canonical set as damageImmunities. Default: `[]`.
- `damageVulnerabilities` (array of string): Damage types the creature is vulnerable to. Same canonical set as damageImmunities. Default: `[]`.
- `conditionImmunities` (array of string): Conditions the creature is immune to (e.g. ["charmed", "frightened"]), lowercase 5e names. Other values are accepted with a warning. Default: `[]`.
- `languages` (array of string): Languages the creature speaks (e.g. ["Common", "Goblin"]). Default: `[]`.
- `languagesCustom` (string): Free-text language note (e.g. "telepathy 60 ft."). Default: `""`.
- `biography` (string): HTML biography text shown in the character sheet. Default: `""`.
- `sourceBook` (string): Source book abbreviation (e.g. "MM'14", "VGM"). Default: `""`.
- `sourcePage` (string): Page number in the source book. Default: `""`.
- `sourceRules` (string): Rules edition. One of: `2014`, `2024`. Default: `2014`.

## dnd5e-add-features-from-compendium

Direct write. D&D 5e only. Import monster features and class features by name from a compendium pack onto an actor (NPC or PC), copied as they are in the compendium. Examples: "Pack Tactics", "Multiattack", "Action Surge", "Font of Magic". Names must be exact (any case) and in English: translate them first. compendiumPacks is searched in order, first match wins. Default ["dnd5e.monsterfeatures", "dnd5e.classfeatures"] is the 2014 SRD; ["dnd5e.monsterfeatures24"] is 2024 monster features only. Not for: spells or spell slots (use dnd5e-add-feature with featureType "spells" or "spellcasting"); 2024 class features (they live inside the class items, so this cannot import them); homebrew. Returns a report: added, skipped (already on the actor), not found, failed. Find the actorIdentifier with list-characters or get-character.

Kind: changes something. Title: Add compendium features to actor.

Parameters:

- `actorIdentifier` (string, required): Name or ID of the target actor (partial name match supported)
- `featureNames` (array of string, required): English feature names to import (exact match, case-insensitive). Maximum 50 per call. Items: 1 to 50.
- `compendiumPacks` (array of string): Pack IDs to search in order, first match wins. Default ["dnd5e.monsterfeatures", "dnd5e.classfeatures"] (SRD 2014); "dnd5e.monsterfeatures24" for 2024 monster features. Default: `["dnd5e.monsterfeatures","dnd5e.classfeatures"]`.

## plan-room-setup

Plan Region-based scene parts: "teleport" moves tokens entering one rectangle to another (same or other scene); "spawn" makes a room rectangle plus tokens from actors on free squares in it; "levels" adds Scene Levels; "stairs" joins levels; "hazard" makes difficult terrain, darkness or an existing effect. Apply with apply-planned-change, undo with undo-change. Needs the module switch "Room setup" (off by default).

Kind: read-only. Title: Plan room setup (teleports, rooms, levels, stairs, hazards).

Parameters:

- `action` (string, required): One of: `teleport`, `spawn`, `levels`, `stairs`, `hazard`.
- `name` (string): teleport: entry name (arrival "&lt;name> (arrival)"). spawn: room name.
- `from` (object): teleport: the entry: grid squares, x/y top-left from 0; scene id or name (default viewed).
  - `x` (integer, required)
  - `y` (integer, required)
  - `width` (integer, required)
  - `height` (integer, required)
  - `scene` (string)
  - `level` (string)
- `to` (object): teleport: the arrival: grid squares, x/y top-left from 0; scene id or name (default viewed).
  - `x` (integer, required)
  - `y` (integer, required)
  - `width` (integer, required)
  - `height` (integer, required)
  - `scene` (string)
  - `level` (string)
- `twoWay` (boolean): teleport: also back from the arrival.
- `choice` (boolean): teleport: player confirms each teleport.
- `placement` (string): teleport: landing spot (default center). One of: `random`, `center`, `relative`.
- `area` (object): spawn: the room: grid squares, x/y top-left from 0; scene id or name (default viewed).
  - `x` (integer, required)
  - `y` (integer, required)
  - `width` (integer, required)
  - `height` (integer, required)
  - `scene` (string)
  - `level` (string)
- `creatures` (array of object): spawn: actors (id or name) and count, 40 tokens at most.
  - `actor` (string, required)
  - `count` (integer)
- `hidden` (boolean): spawn: tokens hidden from players (default true).
- `scene` (string): levels: scene.
- `levels` (array of any): levels: [{name, bottom, top?, background?}]. stairs: level names.
- `movementActions` (array of string)
- `kind` (string): One of: `difficult`, `darkness`, `effect`.
- `magical` (boolean): difficult: magical terrain.
- `darknessMode` (string): One of: `override`, `brighten`, `darken`.
- `modifier` (number): darkness: 0 to 1.
- `effectUuid` (string)

## plan-pc-creation

Plan a new player character: a character actor with items copied from compendium packs by uuid (a container brings its contents). Advancement does not run: add class features by uuid. Apply with apply-planned-change, undo with undo-change. Needs the switch "AI Tool: Character creation (writes)" on.

Kind: read-only. Title: Plan a new player character with pack items.

Parameters:

- `name` (string, required)
- `owner` (string): Player user name or id.
- `items` (array of object): Up to 200.
  - `uuid` (string, required)
  - `equipped` (boolean)
  - `prepared` (boolean)
  - `quantity` (integer)

## plan-actor-image

Plan a new portrait and/or token picture for an actor from a PNG, JPG or WebP file (max 5 MB) in an allowed folder on the GM's PC. The file is stored in the world's assets/ai-art folder; apply with apply-planned-change, revert with undo-change (the old paths come back, the file stays; a plan that is never applied also leaves its file there). Tokens already placed on scenes keep their picture.

Kind: changes something. Title: Plan a new portrait and token picture for an actor.

Parameters:

- `actor` (string, required): Actor name or id.
- `file` (string, required): Absolute path of the picture on this PC, inside an allowed folder.
- `slot` (string): portrait, token or both (default). One of: `portrait`, `token`, `both`.
