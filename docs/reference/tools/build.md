---
description: Every tool in the Build set with its description and parameters. Generated from the tool catalog.
---

<!-- Generated from the tool catalog by packages/mcp-server/src/tool-reference.ts. Do not edit by hand: run `npm run docs:tools` after changing a tool. CI fails when this page is stale. -->

# Build tools

Make and change NPCs, monsters and items: from a compendium or from scratch, with features, attacks and spells. Set up rooms: teleports and tokens in a room. Part of the [tool reference](../tools.md); [Tool sets](../TOOL-SETS.md) explains how Claude Desktop loads the sets. Claude Desktop entry: `foundry-mcp-build`.

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
- `actor` (string): For "add-to-actor": actor name or ID to receive the items.

## list-creatures-by-criteria

List creatures by Challenge Rating, type, size, spellcasting or legendary actions (D&D 5e). Returns minimal data for encounter building: pick by name, then pull full details only for the final choices with get-compendium-item.

Kind: read-only. Title: List creatures by criteria.

Parameters:

- `challengeRating` (number or string or object): Filter by Challenge Rating - accepts number, string, or range object. Use ranges for broader discovery (e.g., {"min": 10, "max": 15}) or exact values (12 or "12")
- `creatureType` (string): Filter by creature type. One of: `humanoid`, `dragon`, `beast`, `undead`, `fey`, `fiend`, `celestial`, `construct`, `elemental`, `giant`, `monstrosity`, `ooze`, `plant`, `aberration`.
- `size` (string): Filter by creature size. One of: `tiny`, `small`, `medium`, `large`, `huge`, `gargantuan`, `sm`, `med`, `lg`, `grg`.
- `hasSpells` (boolean): Filter for spellcasting creatures
- `hasLegendaryActions` (boolean): Filter for creatures with legendary actions (D&D 5e)
- `limit` (number): Maximum results to return (default 50, max 1000; raise it for a wide survey). Range: 1 to 1000. Default: `50`.

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

## dnd5e-add-feature

Direct write. D&D 5e only. Add a feature, attack, spellcasting setup or spells to an existing actor. featureType picks the mode. Parameters per mode (all need actor):

- passive (a trait with no roll): featureName, description
- save (breath weapon): featureName, saveAbility, saveDC, damageParts; area, halfOnSave optional
- attack (Claw, Bite): featureName, attackType, damageParts, rangeFt when ranged; weapon fields optional
- attack-with-save (hit plus save, Stinger): the attack ones plus saveAbility, saveDC, saveDamageParts
- aura (damage in range, no roll): featureName, damageParts, areaType, areaSize
- spellcasting (run before "spells"): spellcastingClass, spellcastingLevel
- spells (from the compendium): spellNames

Find the actor with list-characters or get-character.

Kind: changes something. Title: Add feature to actor.

Parameters:

- `featureType` (string, required): One of: `passive`, `save`, `attack`, `attack-with-save`, `aura`, `spellcasting`, `spells`.
- `actor` (string, required): Name or ID of the target actor (partial name works).
- `featureName` (string): Name of the new feature; unique on the actor.
- `description` (string): HTML description (optional).
- `activationType` (string): Action economy type. Default "action". One of: `action`, `bonus`, `reaction`, `legendary`, `lair`, `special`.
- `damageParts` (array of object): Damage dice. attack: first entry is the base weapon die, extras stack. attack-with-save: the on-hit damage. Items: at least 1.
  - `number` (number, required): Range: at least 1.
  - `denomination` (number, required): One of: `4`, `6`, `8`, `10`, `12`, `20`, `100`.
  - `type` (string, required): e.g. "fire"
- `saveAbility` (string): One of: `str`, `dex`, `con`, `int`, `wis`, `cha`.
- `saveDC` (number): Saving throw DC (1–30). Range: 1 to 30.
- `halfOnSave` (boolean): Half damage on a successful save (save mode). Default true.
- `saveDamageParts` (array of object): Damage on a failed save (attack-with-save). Items: at least 1.
  - `number` (number, required): Range: at least 1.
  - `denomination` (number, required): One of: `4`, `6`, `8`, `10`, `12`, `20`, `100`.
  - `type` (string, required): e.g. "fire"
- `saveOnSave` (string): Damage on a successful save (attack-with-save). Default "none". One of: `half`, `none`.
- `areaType` (string): Template shape. save: optional, and areaSize is then required. aura: required ("emanation" or "sphere" for radial). One of: `cone`, `cube`, `cylinder`, `emanation`, `line`, `radius`, `sphere`, `""`.
- `areaSize` (number): Template size in areaUnits (e.g. 30). Required for aura, and for save with areaType. Range: above 0.
- `areaUnits` (string): Units for areaSize. Default "ft". One of: `ft`, `m`.
- `affectsType` (string): What the area targets. Default "creature". One of: `creature`, `object`, `space`, `""`.
- `attackType` (string): One of: `melee`, `ranged`.
- `weaponClass` (string): Weapon category; "natural" for claws, bite, touch. Default "natural". One of: `natural`, `simpleM`, `martialM`, `simpleR`, `martialR`.
- `abilityModifier` (string): Ability for to-hit and damage. Default STR melee, DEX ranged. One of: `str`, `dex`, `con`, `int`, `wis`, `cha`.
- `attackBonus` (number): Flat bonus to the attack roll only (not damage). Default 0. Range: 0 to 10.
- `proficient` (boolean): Adds the proficiency bonus to hit. Default true.
- `equipped` (boolean): Default true.
- `reachFt` (number): Melee reach in feet. Default 5. Range: at least 5.
- `rangeFt` (number): Normal range in feet. Required when ranged. Range: at least 1.
- `longRangeFt` (number): Long range in feet (disadvantage beyond rangeFt); above rangeFt. Range: at least 1.
- `properties` (array of string): Weapon property codes: ada, amm, fin, fir, foc, hvy, lgt, lod, mgc, rch, ret, spc, thr, two, ver.
- `spellcastingClass` (string): Spellcasting class: sets the slot table and default ability. One of: `artificer`, `bard`, `cleric`, `druid`, `paladin`, `ranger`, `sorcerer`, `warlock`, `wizard`.
- `spellcastingLevel` (number): Class level (1–20); sets the slots. Range: 1 to 20.
- `spellcastingAbility` (string): Casting ability. Default: the class default. One of: `str`, `dex`, `con`, `int`, `wis`, `cha`.
- `spellNames` (array of string): English spell names (exact, case-insensitive), max 50. Items: 1 to 50.
- `compendiumPacks` (array of string): Pack IDs in priority order. Default ["dnd5e.spells"] (2014); "dnd5e.spells24" for 2024.
- `sourceRules` (string): Rules edition. Default "2014". One of: `2014`, `2024`.
- `sourceBook` (string): Source book abbreviation (e.g. "MM'14").
- `sourcePage` (string)

## dnd5e-create-npc

Direct write. D&D 5e only. Create an NPC from scratch with a full stat block (no items, actions or spells: add them afterwards with dnd5e-add-feature). The actor goes in the "Foundry MCP Creatures" folder.

Kind: changes something. Title: Create NPC.

Parameters:

- `name` (string, required)
- `creatureType` (string, required): One of: `humanoid`, `undead`, `beast`, `dragon`, `aberration`, `construct`, `elemental`, `fey`, `fiend`, `giant`, `monstrosity`, `ooze`, `plant`, `celestial`, `swarm`.
- `creatureSubtype` (string): Subtype (e.g. "Goblinoid")
- `size` (string, required): One of: `tiny`, `small`, `medium`, `large`, `huge`, `gargantuan`.
- `alignment` (string): Alignment (e.g. "Neutral Evil")
- `cr` (string or number, required): Challenge Rating: whole number (0, 1, 5), fraction string ("1/8", "1/4", "1/2"), or decimal number (0.25, 0.5)
- `hpAverage` (number, required): Average (fixed) hit points. Range: at least 1.
- `hpFormula` (string, required): Hit dice formula (e.g. "3d8+9")
- `acMode` (string, required): "default": Foundry calculates AC; "flat": use acValue. One of: `default`, `flat`.
- `acValue` (number): Fixed AC (0–30) for acMode "flat". Range: 0 to 30.
- `abilities` (object, required): The six ability scores (1–30 each)
  - `str` (number, required)
  - `dex` (number, required)
  - `con` (number, required)
  - `int` (number, required)
  - `wis` (number, required)
  - `cha` (number, required)
- `savingThrows` (array of string): Save proficiencies. One of: `str`, `dex`, `con`, `int`, `wis`, `cha`.
- `walkSpeed` (number): Walk speed, ft. Range: at least 0.
- `flySpeed` (number): Fly speed, ft. Range: at least 0.
- `swimSpeed` (number): Swim speed, ft. Range: at least 0.
- `climbSpeed` (number): Climb speed, ft. Range: at least 0.
- `burrowSpeed` (number): Burrow speed, ft. Range: at least 0.
- `hover` (boolean): Hovers (cannot fall)
- `darkvision` (number): Darkvision, ft. Range: at least 0.
- `blindsight` (number): Blindsight, ft. Range: at least 0.
- `tremorsense` (number): Tremorsense, ft. Range: at least 0.
- `truesight` (number): Truesight, ft. Range: at least 0.
- `specialSenses` (string): Other senses as text
- `skills` (array of object): Skill proficiencies
  - `skill` (string, required): One of: `Acrobatics`, `Animal Handling`, `Arcana`, `Athletics`, `Deception`, `History`, `Insight`, `Intimidation`, `Investigation`, `Medicine`, `Nature`, `Perception`, `Performance`, `Persuasion`, `Religion`, `Sleight of Hand`, `Stealth`, `Survival`.
  - `proficiency` (string, required): proficient or expert (double). One of: `proficient`, `expert`.
- `damageImmunities` (array of string): Lowercase 5e damage types (e.g. ["necrotic"]); others warn
- `damageResistances` (array of string): Damage types, as damageImmunities
- `damageVulnerabilities` (array of string): Damage types, as damageImmunities
- `conditionImmunities` (array of string): Lowercase 5e conditions (e.g. ["charmed"]); others warn
- `languages` (array of string): Languages (e.g. ["Common"])
- `languagesCustom` (string): Language note (e.g. "telepathy 60 ft.")
- `biography` (string): HTML biography
- `sourceBook` (string): Source book (e.g. "MM'14")
- `sourcePage` (string): Source page
- `sourceRules` (string): Rules edition. One of: `2014`, `2024`. Default: `2014`.

## dnd5e-add-features-from-compendium

Direct write. D&D 5e only. Import monster features and class features by name from a compendium pack onto an actor (NPC or PC), copied as they are in the compendium. Examples: "Pack Tactics", "Multiattack", "Action Surge", "Font of Magic". Names must be exact (any case) and in English: translate them first. compendiumPacks is searched in order, first match wins. Default ["dnd5e.monsterfeatures", "dnd5e.classfeatures"] is the 2014 SRD; ["dnd5e.monsterfeatures24"] is 2024 monster features only. Not for: spells or spell slots (use dnd5e-add-feature with featureType "spells" or "spellcasting"); 2024 class features (they live inside the class items, so this cannot import them); homebrew. Returns a report: added, skipped (already on the actor), not found, failed. Find the actor with list-characters or get-character.

Kind: changes something. Title: Add compendium features to actor.

Parameters:

- `actor` (string, required): Name or ID of the target actor (partial name match supported)
- `featureNames` (array of string, required): English feature names to import (exact match, case-insensitive). Maximum 50 per call. Items: 1 to 50.
- `compendiumPacks` (array of string): Pack IDs to search in order, first match wins. Default ["dnd5e.monsterfeatures", "dnd5e.classfeatures"] (SRD 2014); "dnd5e.monsterfeatures24" for 2024 monster features. Default: `["dnd5e.monsterfeatures","dnd5e.classfeatures"]`.

## plan-room-setup

Plan Region-based scene parts: "teleport" moves tokens entering one rectangle to another (same or other scene); "spawn" makes a room rectangle plus tokens from actors on free squares in it; "levels" adds Scene Levels; "stairs" joins levels; "hazard" makes difficult terrain, darkness or an existing effect; "whisper" whispers a room card to the GM only when a token enters the rectangle; "practice" (name?, language en|da) makes a practice scene, dummy, a practice hero per player, step journal and begun combat. Apply with apply-planned-change, undo with undo-change. Needs the module switch "Room setup" (off by default).

Kind: read-only. Title: Plan room setup (teleports, rooms, levels, stairs, hazards).

Parameters:

- `action` (string, required): One of: `teleport`, `spawn`, `levels`, `stairs`, `hazard`, `whisper`, `practice`.
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
- `language` (string): practice: step list. One of: `en`, `da`.
- `levels` (array of any): levels: [{name, bottom, top?, background?}]. stairs: level names.
- `movementActions` (array of string)
- `kind` (string): One of: `difficult`, `darkness`, `effect`.
- `magical` (boolean): difficult: magical terrain.
- `darknessMode` (string): One of: `override`, `brighten`, `darken`.
- `modifier` (number): darkness: 0 to 1.
- `effectUuid` (string)
- `text` (string): whisper: the room card text for the GM (2000 characters at most).
- `once` (boolean): whisper: only the first entry (default every entry; two tokens entering at the same moment can both whisper).

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

## plan-macro

Plan a script macro (JavaScript) for the GM: created GM-only in the Macro directory, with the full source and a plain-English summary shown in the plan. Apply it with apply-planned-change, revert it with undo-change. It runs in the GM's browser, so keep it small and use only Foundry's own API (game, canvas, ui, ChatMessage, Roll, actors and tokens). The source is parsed and checked against an allowlist: only the Foundry API names (game, canvas, ui, ChatMessage, Roll, Dialog, Actor, Item, fromUuid and the usual built-ins like Math, Object, JSON), no class, `this`, `with` or module loading, no member name that reaches the network, the page, storage, other macros or dynamic code, no computed member name except a number or a counting loop variable (use Object.entries for data keys; for a random pick write xs[+Math.floor(Math.random() \* xs.length)] or xs.at(Math.floor(...)), never xs[Math.floor(...)]), no picture, sound or file fields, no web address, path or markup with attributes in a string. This is a guard against mistakes, not a sandbox: the GM reads the full source in the plan before confirming. Needs the "AI Tool: Macro forge (writes)" switch.

Kind: read-only. Title: Plan a GM-only script macro.

Parameters:

- `name` (string, required): The macro name shown in the Macro directory (max 60 characters).
- `description` (string, required): What the macro does, in plain English for a GM who will not read the code (10 to 600 characters). Shown in the plan beside the source.
- `source` (string, required): The full script text (max 20000 characters).
