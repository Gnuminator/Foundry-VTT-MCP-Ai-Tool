---
title: Getting started
description: What Foundry AI Tool is, its parts in plain words, how they fit together, a short glossary and how it is set up.
---

# Getting started

This page is for a GM who is new to Foundry VTT and to this tool. Read it once from top to bottom.
The other GM pages build on it.

## What the tool is

Foundry AI Tool lets Claude (an AI) read your Foundry game and change it. It also gives you a
control panel in the browser, the dashboard, that shows the table live.

You stay in charge, but know the two kinds of change:

- **Guarded changes.** Damage, healing, conditions, spell slots, token moves and edits, and the
  tool's own features (party, Tarokka, handouts, the Obsidian mirror): Claude plans a change and you approve it, and
  every such change can be undone.
- **Direct actions.** Many of Claude's other tools (rolls, new NPCs, journals, chat
  and more) act as soon as Claude uses them, and the tool cannot undo them. [Asking Claude](asking-claude.md)
  lists which ones, and how to make Claude Desktop ask first if you want that.

Players get their own page that never shows spoilers.

## The parts

| Part                | What it is                                                                         | What you use it for                                                   |
| ------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Foundry VTT**     | The virtual tabletop. You and the players join it in a browser.                    | Running the game: maps, tokens, character sheets, dice, chat.         |
| **The module**      | "Foundry AI Tool", an add-on module inside Foundry.                                | It lets the bridge read and change your world. You rarely touch it.   |
| **The bridge**      | A small program on the home server (the Orange Pi).                                | It connects Foundry, Claude Desktop, the dashboard and Obsidian.      |
| **Claude Desktop**  | Anthropic's Claude app on your computer. A small client reaches the bridge for it. | Asking Claude about the game, prep, rules and planned changes.        |
| **The dashboard**   | A web page on your second screen.                                                  | Your control panel: live feed, combat, approving and undoing changes. |
| **The player page** | A read-only page of the dashboard at `/player`.                                    | What players may see: combat order, a safe feed, handouts, recaps.    |
| **Obsidian**        | A note-taking app. The tool writes notes into an Obsidian vault.                   | Reading and prep: session notes, change history, stats, world notes.  |
| **The Orange Pi**   | A small home server that is always on.                                             | Runs Foundry, the bridge and the dashboard all the time.              |

## How they fit together

- **Foundry is where the game happens.** Maps, tokens, sheets, dice and chat all live there.
- **The dashboard is your control panel.** Open it on a second screen. It shows the live feed and
  combat. Before it changes anything it asks you to confirm; for a planned change it lists what
  will change. Every guarded change, whether it came from the dashboard or from Claude, is listed
  there with Undo.
- **Claude Desktop is where you talk to Claude.** Claude reads the game through the bridge. For
  the guarded features it plans a change, shows it to you, and waits for your yes before it
  applies it.
  You can also apply its plan yourself in the dashboard.
- **Obsidian is for reading and prep.** The tool writes notes there after things happen. Nothing
  you write in Obsidian flows back into Foundry by itself. The one exception is a quest note in
  your `Prep` folder: you can import it as a GM-only quest journal, after you confirm a plan (see
  [Features](features.md#obsidian-import)).
- **The bridge connects them.** The module inside Foundry talks to the bridge. Claude Desktop and
  the dashboard talk to the bridge too.

```text
  Claude Desktop ──┐
                   ├──► bridge ◄──► module in the server's Foundry browser ──► your game
  dashboard ───────┘      │
                          └──► Obsidian notes (one way)
```

Two things to know from the start:

- The module runs inside a Foundry browser on the server, logged in as a helper GM called the
  Assistant GM. It holds the link to the bridge, so the tool works even when no human GM is logged
  in, and your own browser never runs the bridge. If it goes down, tell the tool admin.
- Players never use the bridge. They see Foundry as usual. They can also open the player page; it
  is behind the same email-code login as the game.

## What is special for Curse of Strahd

- **Tarokka reading.** Deal a reading with the tool's built-in roll, or choose the
  five cards yourself. The cards stay GM-only, outside Foundry. You can link each card to a
  journal page, a scene or an actor. You reveal a card by writing the text players may read.
- **A spoiler-safe player page.** It shows names the way players know them ("Unknown creature"
  otherwise), no enemy HP numbers, only public rolls, and only the handouts you reveal.
- **Handouts.** Reveal a journal page to the players. It shows on the player page and they can
  open it in Foundry.

The Tarokka and handout features are off until you switch them on in Game Settings (see
[the dashboard tour](dashboard.md)).

## Glossary

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
  Ownership, the table viewer and Undo for everything). [Features](features.md) lists each one.
- **GM Actions:** the dashboard's switch for changing the game from the dashboard. Off by default.
- **GM token:** a password-like part of the dashboard's GM address (`?token=…`). The tool admin
  gives you the address; open it once and the browser remembers it.
- **Recent Changes:** the dashboard panel that lists applied changes, each with Undo when possible.
- **Bridge vault:** the tool's own GM-only storage on the bridge's computer: the Tarokka reading,
  revealed handouts, the change history and the logs. It is not part of Foundry's world backup.
- **Play log:** the record of what happens in play (rolls, HP, rests, combat), with each player's
  user name. The session notes and stats come from it.
- **Play session:** one evening of play. You mark its start and end in the dashboard.

## How it is set up

For the campaign, Foundry, the bridge, the dashboard and the Assistant GM browser all run on the
Orange Pi home server, and you start nothing there yourself. Your own part is small: install the
connection for Claude Desktop once ([Connect Claude Desktop to the server](connect-claude-desktop.md)),
then use the [before-session checklist](before-session.md). You reach Foundry and the dashboard
through Cloudflare, which asks for an emailed code now and then.

### Setup on the admin's own PC (Windows)

> **Note: this part is for the tool admin's own Windows PC** (and as the fallback if the server
> fails on game night). You do not do it. The server's setup is in
> [docs/dev/PI-SETUP.md](../dev/PI-SETUP.md).

On the admin's own PC everything runs on one Windows PC: Claude Desktop, the bridge, the dashboard,
and the browser in which you are logged in to Foundry as the GM.

1. **Foundry 14 with the dnd5e system.** The tool supports Foundry 14 with dnd5e 6.
2. **Install the module.** On Foundry's setup screen: **Add-on Modules**, **Install Module**, paste
   the manifest URL from the [README](../../README.md#installation) into **Manifest URL**,
   **Install**.
3. **Turn the module on in your world.** In the world: Settings tab (gear icon), **Module
   Management**, tick **Foundry AI Tool**, save.

Steps 4 to 6 are done once, by whoever set up the tool for you. They need Node.js, git, a copy of
the tool built once, and a terminal; the [README](../../README.md#installation) has the commands.

4. **Connect Claude Desktop.** The bridge is added to Claude Desktop's configuration file
   (`claude_desktop_config.json`), as five entries: `foundry-mcp` (core) and `foundry-mcp-play`,
   `-prep`, `-build`, `-admin`. Quit and restart Claude Desktop. From then on, Claude Desktop starts
   the bridge when it starts. Then pick which tool sets are on: see
   [Asking Claude](asking-claude.md#tool-sets-which-switches-to-turn-on).
5. **The dashboard.** It is started by hand: open a terminal in the tool's folder and run
   `npm run dev:cogm`. Leave that window open; closing it stops the dashboard. Then open
   `http://localhost:3000` in your browser.
6. **Obsidian (optional).** The bridge writes notes into an Obsidian vault when it knows where the
   vault is: `FOUNDRY_AI_OBSIDIAN_DIR` in the `env` part of every `foundry-mcp` entry in Claude
   Desktop's configuration. For the dashboard's 📓 links, also set `OBSIDIAN_VAULT_NAME` (or
   `FOUNDRY_AI_OBSIDIAN_DIR`) in `packages/cogm-dashboard/.env`.

### Monsters, spells and rules in Obsidian (the Library)

Once the Foundry mirror is on, NPC notes show the full stat block and the portrait, scene notes
show the map, and journal pages keep their tables and pictures. Ask Claude to add compendiums to
the mirror's Library (`plan-obsidian-mirror` with `libraryPacks`, for example your monsters,
spells, classes and feats) and the tool writes a note for every entry into `AI Tool/Library/`:
monsters with stat blocks, spells, items, classes with their features by level, subclasses,
species, backgrounds and feats. Pictures are copied into `AI Tool/Attachments/`.

The Library is sorted by kind, then by book: `AI Tool/Library/Monsters/Monster Manual (2024)/`,
`AI Tool/Library/Spells/Player's Handbook (2024)/`, and so on. Entries without a book go in
`Other`. Notes have `book` and `page` properties when the compendium gives them, and
`AI Tool/Library/Books/` has one note per book that lists everything from that book. Every
Library note links to its book's note, so in Obsidian's graph view each book is a hub. The notes
about your world follow Foundry's own folders the same way: a journal in Foundry's "Act 1" folder
is at `AI Tool/Foundry/Journals/Act 1/`. When something moves in Foundry, its note moves with it.
A note you edited stays where it is, and `_status.md` lists it.

Each adventure also gets a hub note in `AI Tool/Foundry/Adventures/`: a top Foundry folder with
journals and scenes in it (the same folder name for each, as an adventure import makes them)
counts as an adventure. The hub links every chapter, scene, NPC and item note in it and the
book's note in the Library. To colour the graph by adventure, run **Apply AI Tool graph colours**
in Obsidian (command palette, or the button in the AI Tool plugin's settings): each adventure gets
a colour and the Library goes grey. Your own colour groups stay, ahead of ours.

This is book content you bought, so it stays on your computer:

- The tool writes a `.gitignore` that keeps `Library/` and `Attachments/` out of git.
- If your vault is inside a git repository that would pick up the other mirror notes, the tool
  leaves out stat blocks, page text and pictures there, and `AI Tool/Foundry/_status.md` says
  how to fix it.
- If the bridge runs on another computer than Foundry, set `FOUNDRY_AI_FOUNDRY_URL` to
  Foundry's address so the pictures can be fetched.

Each time you play, the order is simple: start Claude Desktop, open Foundry and join as
the GM, open the dashboard in your browser. The [before-session checklist](before-session.md) has
the details. (On the admin's own PC the dashboard is also started by hand, with
`npm run dev:cogm`.)

## Next

- [A tour of the dashboard](dashboard.md)
- [Asking Claude](asking-claude.md)
- [Before each session](before-session.md)
