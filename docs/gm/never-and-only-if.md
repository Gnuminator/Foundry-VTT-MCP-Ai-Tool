---
title: Never do this, only do this if
description: Short rules for the GM, each with its reason in one line.
---

# Never do this, only do this if

Short rules. Each has its reason on the next line.

## Never do this

- **Never show the dashboard, Claude Desktop or Obsidian on a screen the players can see, and
  never share those windows in Discord or a video call.**
  They show true names, exact HP, private rolls, GM notes and the Tarokka cards.
- **Never give players the dashboard's GM address or the GM token.**
  The GM page can change the game and shows every secret; players get `/player` only.
- **Never post an AI comment ("Post to chat", on the old dashboard) or send a whisper that names a
  secret.**
  A whisper's text reaches every player's browser; only its display is hidden.
- **Never apply a plan you have not read.**
  The list of changes in the confirm window is your only preview.
- **Never turn on "Allow Non-GM Users to Run the Bridge".**
  The module's connection to the bridge is built for a GM's browser only; this lets a player's
  browser make it.
- **Never rename or move the module's folder `foundry-mcp-bridge`.**
  Foundry only loads a module from a folder named after its id.
- **Never delete the bridge vault folder.**
  It holds the Tarokka reading, the revealed handouts, the change history and the logs, and
  Foundry's world backup does not include it.
- **Never open the dashboard to your network or the internet without a GM token.**
  Anyone who reaches the GM page can change your game.
- **Never run a second bridge next to the one that is already running.**
  Two bridges compete for the same ports, and the connection to Foundry can break.

## Only do this if

- **Click Start session only when play begins, and End session when it ends.**
  Start session is the only switch for live play: it turns on GM Actions and every feature switch
  ("AI Tool: … (writes)"), Tarokka and Party included. With live play off, a misclick cannot change
  anything. End session (or Pre-flight's "Turn them off again") turns it all off again.
- **Tick "Show cards" in the Tarokka drawer only if nobody else can see your screen.** (The
  drawer is under Advanced ▾.)
  The card names are the campaign's biggest secret.
- **Raise a journal to Observer only after every page in it is set to None.**
  Pages inherit the journal's ownership, so every page left on Inherit becomes readable at once.
  The [dashboard tour](dashboard.md#revealing-a-handout) has the steps.
- **Undo a reveal only if you accept that players may already have read it.**
  Undo hides the page again, but nobody forgets.
- **Set a token's Display Name to "Hovered by Anyone" or "Always for Everyone" only if players may
  know that creature's name.**
  The player page then shows its name.
- **Leave a scene without a Navigation Name only if its real name is no spoiler.**
  Foundry's navigation bar can show players the real name; a Navigation Name replaces it.
- **Edit a note the tool generated in Obsidian only if you want it frozen.**
  The tool never overwrites a note you edited, so it stops updating (it lists it in
  `AI Tool/_status.md`, or `AI Tool/Foundry/_status.md` for notes about PCs, NPCs, scenes and
  journals).
- **Turn off "Allow Write Operations" only if you want the tool to change nothing.**
  It stops every change from Claude and from the dashboard, chat messages and Undo included;
  reading still works.
- **Choose "Always allow" for the tools that change the game only if you are happy not to be asked
  by Claude Desktop.** Changes through the plan are still confirmed and can be undone; direct
  actions (rolls, new NPCs, journals, chat messages) are not. Set **Write/delete tools** to
  **Needs approval** to be asked each time.
- **Set an Anthropic API key on the dashboard only if you want the AI commentary panel (on the old
  dashboard) and accept the cost.**
  It is the paid API, billed per use, and it sends game events to Anthropic automatically.
