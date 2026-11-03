---
title: Glossary
description: The Foundry words and the tool words used in these guides, in plain language, in one place.
---

# Glossary

Words you meet in these guides. Foundry's own words come first, then the tool's.

Foundry words:

- **World:** your campaign in Foundry: its scenes, actors, journals and settings.
- **Scene:** a map. The **active scene** is the one players are on.
- **Navigation Name:** a second name for a scene that players see instead of the real one.
- **Actor:** a character or creature with a sheet (a PC, an NPC, a monster).
- **Token:** an actor's picture on the map. Its **Display Name** setting decides who sees its name.
- **Journal:** a book of pages in the Journal tab. A **journal page** is one page in it.
- **Compendium:** a library of ready-made content, such as the official books you own.
- **Ownership:** who may see or edit a document: None, Limited, Observer, Owner. Observer means
  "can read".
- **Game Settings:** Foundry's settings window (Settings tab, gear icon, then **Game Settings**).
  The tool's settings are in the category **Foundry AI Tool**. Settings and messages there that say
  "MCP Bridge" (for example **Enable MCP Bridge**) belong to the module.
- **World id:** your world's short id, the name of its folder on the Foundry server. The tool uses
  it as a folder name in Obsidian (`Campaigns/<world id>/`).

Tool words:

- **MCP:** the way Claude Desktop talks to tools. The tool's entry in Claude Desktop is called
  `foundry-mcp`, and "MCP Bridge" or "MCP Server" in Foundry's messages means this tool.
- **Direct action:** a tool that changes the game as soon as Claude or the dashboard uses it. It is
  not in Recent Changes, and the tool cannot undo it; you fix it by hand in Foundry.
- **Guarded change:** a change made in three steps: plan, confirm, apply. It is recorded and can
  be undone.
- **Plan:** a proposed change with a list of what it will do (the diff). Plans expire after 15
  minutes.
- **Feature switch:** a setting that allows one feature to make changes, such as "AI Tool: Tarokka
  (writes)". Most are off by default; a few start on (Live play for damage, healing and conditions,
  Ownership, the table viewer, GM windows and Undo for everything). [Features](features.md) lists each one.
- **GM Actions:** the dashboard's switch for changing the game from the dashboard. Off by default.
  **Start session** turns it on.
- **GM token:** a password-like part of the dashboard's GM address (`?token=…`). The tool admin
  gives you the address; open it once and the browser remembers it.
- **Recent Changes:** the dashboard panel that lists applied changes, each with Undo when possible.
- **Bridge vault:** the tool's own GM-only storage on the bridge's computer: the Tarokka reading,
  revealed handouts, the change history and the logs. It is not part of Foundry's world backup.
- **Play log:** the record of what happens in play (rolls, HP, rests, combat), with each player's
  user name. The session notes and stats come from it.
- **Play session:** one evening of play. You mark its start and end in the dashboard.
- **The Veil:** the campaign's look: the castle in the mist and a lamplit line. It is one choice of
  the Theme setting (Neutral, The Veil or Off), it can dress Foundry's join page, and it is also the
  name of a Dice So Nice dice theme, "AI Tool: The Veil".
