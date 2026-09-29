---
title: Never do this, only do this if
description: Short rules for the GM, each with its reason in one line.
---

# Never do this, only do this if

Short rules. Each has its reason on the next line.

## Never do this

- **Never show the dashboard, Claude Desktop or Obsidian on a screen the players can see.**
  They show true names, exact HP, private rolls, GM notes and the Tarokka cards.
- **Never give players the dashboard's GM address or the GM token.**
  The GM page can change the game and shows every secret; players get `/player` only.
- **Never type a secret into "Post to chat" or a whisper.**
  A whisper's text reaches every player's browser; only its display is hidden.
- **Never apply a plan you have not read.**
  The list of changes in the confirm window is your only preview.
- **Never turn on "Allow Non-GM Users to Run the Bridge".**
  The bridge is built to run in a GM's browser only; this lets a player's browser run it.
- **Never rename or move the module's folder `foundry-mcp-bridge`.**
  The bridge finds the module by that name.
- **Never delete the bridge vault folder.**
  It holds the Tarokka reading, the revealed handouts, the change history and the logs, and
  Foundry's world backup does not include it.
- **Never open the dashboard to your network or the internet without a GM token.**
  Anyone who reaches the GM page can change your game.
- **Never run a second bridge next to the one Claude Desktop starts.**
  Two bridges compete for the same ports, and the connection to Foundry can break.

## Only do this if

- **Turn on GM Actions only if you are about to change the game from the dashboard.**
  With it off, a misclick cannot change anything; turn it off again after.
- **Turn on a feature switch ("AI Tool: … (writes)") only if you use that feature tonight.**
  With it off, neither Claude nor the dashboard can apply changes for it.
- **Tick "Show cards" in the Tarokka drawer only if nobody else can see your screen.**
  The card names are the campaign's biggest secret.
- **Reveal a handout only if the other pages in its journal are safe for players or set to None.**
  Players need Observer on the journal, and every page that inherits it becomes readable.
- **Undo a reveal only if you accept that players may already have read it.**
  Undo hides the page again, but nobody forgets.
- **Set a token's Display Name to "Hovered by Anyone" or "Always for Everyone" only if players may
  know that creature's name.**
  The player page then shows its name.
- **Leave a scene without a Navigation Name only if its real name is no spoiler.**
  Foundry's navigation bar can show players the real name; a Navigation Name replaces it.
- **Edit a note the tool generated in Obsidian only if you want it frozen.**
  The tool never overwrites a note you edited, so it stops updating (it lists it in `_status.md`).
- **Turn off "Allow Write Operations" only if you want Claude to stop most changes.**
  It also blocks Undo, and some direct tools do not check it at all.
- **Choose "Always allow" for a tool in Claude Desktop only if the tool only reads.**
  For tools that change the game, you want to be asked each time.
- **Set an Anthropic API key on the dashboard only if you want the AI commentary panel and accept
  the cost.**
  It is the paid API, billed per use, and it sends game events to Anthropic automatically.
