---
description: Every tool the bridge serves, by tool set; one page per set holds the descriptions and parameters. Generated from the tool catalog.
---

<!-- Generated from the tool catalog by packages/mcp-server/src/tool-reference.ts. Do not edit by hand: run `npm run docs:tools` after changing a tool. CI fails when this page is stale. -->

# Tool reference

The bridge serves 107 tools in six sets (five for Claude Desktop, the sixth for players only). [Tool sets](TOOL-SETS.md) explains the sets and how Claude Desktop loads them; each set has its own page listing every tool with the description and parameters Claude reads.

| Set | Claude Desktop entry | Tools | For |
| --- | --- | --- | --- |
| [Core](tools/core.md) | `foundry-mcp` | 24 | Look things up (world, characters, scenes, journals, compendiums, combat) and review, apply or undo planned changes. Always on. |
| [Play](tools/play.md) | `foundry-mcp-play` | 37 | Run the table live: tokens, combat turns, rolls, damage, conditions, resources, chat, scene mood, map notes and loot. |
| [Prep](tools/prep.md) | `foundry-mcp-prep` | 20 | Prepare sessions and write recaps: quests and journals, encounter budgets, the Tarokka reading, handouts, the session log, play stats and the pre-flight check. |
| [Build](tools/build.md) | `foundry-mcp-build` | 10 | Make and change NPCs, monsters, items and player characters: from a compendium or from scratch, with features, attacks and spells. Set up rooms: teleports and tokens in a room. |
| [Admin](tools/admin.md) | `foundry-mcp-admin` | 11 | Set up and troubleshoot: installed modules and their errors, Foundry settings, modules on or off, user roles, who can open a compendium pack, a journal or a scene, who owns which actor, round token rings for all actors, and the Obsidian mirror settings. |
| [Player](tools/player.md) | `none (served on /mcp/player only)` | 5 | A player's own read-only view: their character sheet, what their next level grants, and short passages from the books their Foundry user can see. Served only on /mcp/player, never on stdio. |
