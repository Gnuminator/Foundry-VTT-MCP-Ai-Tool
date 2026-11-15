---
description: Every tool in the Admin set with its description and parameters. Generated from the tool catalog.
---

<!-- Generated from the tool catalog by packages/mcp-server/src/tool-reference.ts. Do not edit by hand: run `npm run docs:tools` after changing a tool. CI fails when this page is stale. -->

# Admin tools

Set up and troubleshoot: installed modules and their errors, Foundry settings, modules on or off, user roles, who can open a compendium pack, a journal or a scene, who owns which actor, round token rings for all actors, and the Obsidian mirror settings. Part of the [tool reference](../tools.md); [Tool sets](../TOOL-SETS.md) explains how Claude Desktop loads the sets. Claude Desktop entry: `foundry-mcp-admin`.

## plan-ownership-change

Plan who owns which actor; apply it with apply-planned-change, revert it with undo-change. "assign": give the player(s) a level (NONE, LIMITED, OBSERVER, OWNER). "remove": set them to NONE. Bulk phrases work ("all friendly NPCs", "party characters"; player "party"). The plan lists each change ("Wolf: Player OBSERVER, was default").

Kind: read-only. Title: Plan ownership change.

Parameters:

- `action` (string, required): assign or remove. One of: `assign`, `remove`.
- `actorIdentifier` (string, required): Actor name or ID, "all friendly NPCs" or "party characters".
- `playerIdentifier` (string, required): Player or character name, or "party" for all connected players.
- `permissionLevel` (string): assign: NONE, LIMITED, OBSERVER (sees the sheet) or OWNER (controls it). One of: `NONE`, `LIMITED`, `OBSERVER`, `OWNER`.

## list-actor-ownership

List current ownership permissions for actors, showing which players have what access levels.

Kind: read-only. Title: List actor ownership.

Parameters:

- `actorIdentifier` (string): Optional: specific actor name/ID to check, or "all" for all actors
- `playerIdentifier` (string): Optional: specific player name to check ownership for

## plan-token-rings

Plan turning the dynamic token ring on or off on the actors' default tokens (round tokens; dnd5e flashes the ring on damage). Up to 150 actors or tokens per plan: when some remain, apply and ask again. Undo reverts the whole plan (actors or tokens); if one write fails, the earlier ones are rolled back where possible. Disable is not the exact inverse of an enable (it turns every ring in scope off, also rings that were on before). With tokens placed, plan the tokens already on scenes instead (each token, linked or not, on every scene or only the named scenes): try it on a copy first. Apply with apply-planned-change, revert with undo-change.

Kind: read-only. Title: Plan dynamic token rings for actors or placed tokens.

Parameters:

- `action` (string, required): One of: `enable`, `disable`.
- `tokens` (string): actors (default): the default token of each actor. placed: the tokens already placed on scenes. One of: `actors`, `placed`.
- `scenes` (array of string): With tokens placed: only these scenes; default all scenes.
- `actorType` (string): Which actors; default all (characters and NPCs). One of: `all`, `npc`, `character`.
- `names` (array of string): Only actors with these names.

## plan-table-viewer

Plan a Foundry user for the TV at the table (default name "Table"): Player role, no password, owns nothing. Apply it with apply-planned-change, revert it with undo-change. The TV signs in as this user once (see the TV table viewer guide). Refuses if a user (player or GM) with that name already exists, or if the users cannot be checked.

Kind: read-only. Title: Plan the TV table viewer user.

Parameters:

- `name` (string): The user's name on Foundry's join page. Default "Table".

## plan-foundry-setup

Read or plan Foundry setup; apply with apply-planned-change, revert with undo-change. mode read lists, plan plans. area user: target a user name, value {role: NONE|PLAYER|TRUSTED|ASSISTANT} (read lists users, roles, actors; a Gamemaster is never changed; a role change signs them out; same name twice: use the id). area ownership: target journal:name or scene:name, value {default, users:{name or id: level}} (not actors). area module: target a module id or title (read lists all: on/off, requires, required by), value true or false; needed modules go on or dependents off with it, and windows reload on apply and undo. area setting: target namespace.key (read: partial name). area pack: target a pack id, value {ownership:{PLAYER,TRUSTED: NONE|LIMITED|OBSERVER|OWNER, ASSISTANT: OWNER only; a role gets the highest level of itself and lower roles}, locked, folder (name/null)}. Secrets are hidden. Needs the Foundry setup switch.

Kind: read-only. Title: Read or plan Foundry setup.

Parameters:

- `mode` (string, required): One of: `read`, `plan`.
- `area` (string, required): One of: `setting`, `pack`, `module`, `user`, `ownership`.
- `target` (string): Setting key, pack id, module id or title, user name or id, journal:name or scene:name.
- `value` (any): plan only: the new value, or the pack changes.

## get-modules

List installed Foundry modules with version, active state, declared compatibility (min/verified/max core), and required-dependency satisfaction, plus the core Foundry and game-system versions. Each module includes an `issues` list (missing/inactive dependencies, version-out-of-range). Use to spot version/dependency/compatibility conflicts.

Kind: read-only. Title: List modules.

Parameters:

- `activeOnly` (boolean): Only return active modules.
- `withIssuesOnly` (boolean): Only return modules that have detected issues.
- `includeManifest` (boolean): Include each module's manifest url (long; off by default to keep the answer small).

## get-module-errors

Return runtime errors/warnings captured from the Foundry client (console.error/warn, uncaught errors, unhandled promise rejections), each with its stack and the module it was attributed to, plus a triage summary of counts by module. Use this when a module misbehaves; filter by module or time.

Kind: read-only. Title: Get module errors.

Parameters:

- `level` (string): Filter by severity. One of: `error`, `warn`.
- `moduleId` (string): Filter to a module/system id (partial match), e.g. "lib-wrapper".
- `sinceTimestamp` (string): ISO timestamp; only newer entries.
- `limit` (integer): Max entries (default 100, max 500).

## clear-module-errors

Direct write. Clear the captured diagnostics buffer (e.g. before reproducing an issue so only fresh errors remain).

Kind: changes something and can delete or overwrite. Title: Clear module errors.

No parameters.

## get-module-manifest

Return a single module's full manifest (version, compatibility, relationships/dependencies, authors, url) for deeper inspection.

Kind: read-only. Title: Get module manifest.

Parameters:

- `moduleId` (string, required): The module id.

## get-obsidian-mirror

GM ONLY. The Obsidian mirror's settings (enabled, mirrored kinds, journals whose page text is mirrored, excluded folders, story item types), their hash, the backend environment (whether FOUNDRY_AI_OBSIDIAN_DIR is set, the "Open in Foundry" base FOUNDRY_AI_OPEN_BASE, the poll interval, FOUNDRY_AI_FOUNDRY_URL where images are fetched) and the mirror's live status (last cycle, note counts per type, Library and image copies, notes it skipped because the GM edited them, errors). The mirror writes notes only when FOUNDRY_AI_OBSIDIAN_DIR is set AND settings.enabled is true. Settings change only through plan-obsidian-mirror. Read-only.

Kind: read-only. Title: Get Obsidian mirror settings.

No parameters.

## plan-obsidian-mirror

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
