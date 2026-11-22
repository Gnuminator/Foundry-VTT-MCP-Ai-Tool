---
title: Connect Claude by web address (no installer)
description: Add the five Foundry connectors to Claude as custom connectors with an address and an email sign-in, without the Windows client or a tunnel key.
---

# Connect Claude by web address (no installer)

There are two ways to give Claude the Foundry connectors. The first is the small Windows client in
[Connect Claude Desktop to the server](connect-claude-desktop.md). The second is this page: you add
each connector to Claude by its **web address** and sign in with your email. There is nothing to
install and there is no tunnel key. It works in Claude Desktop and in Claude on the web, on any PC.

The tool admin must have switched this way on first. If the page below does not match what you see,
ask them; the installer way keeps working and you can use it instead.

You need: a Claude account and the five addresses from the tool admin. About 5 minutes.

**Check your plan first.** A free Claude plan allows only **one** custom connector, and the five
Foundry connectors are five. On Free, use the Windows client instead (see
[Claude Free or Pro](claude-plans.md)). On Pro you can add all five.

## The five addresses

Each connector is one set of tools, with its own address, so the switches in the **+** menu work as
they do with the installer. The tool admin sends you the addresses; they all start the same way and
end in the name of the set:

| Connector | Address ends in | What it is for                                    |
| --------- | --------------- | ------------------------------------------------- |
| Core      | `/mcp/core`     | Look things up, review and undo changes           |
| Play      | `/mcp/play`     | Run the table: tokens, combat, rolls, chat        |
| Prep      | `/mcp/prep`     | Prepare sessions, quests, handouts, pre-flight    |
| Build     | `/mcp/build`    | Make and change NPCs, monsters and items          |
| Admin     | `/mcp/admin`    | Modules, settings, who owns what, Obsidian mirror |

Core, Play and Prep are the ones you will use most. Add Build and Admin when you need them.

## Add them

Do this once per connector.

1. In Claude, open **Settings**, then **Plugins**, and choose "Add custom connector".
2. Type a name you will recognise (for example `Foundry Play`) and paste that connector's address.
   Leave any advanced fields empty. Press **Add**, then **Connect**.
3. A Cloudflare page asks for your email. Use the email the tool admin has for you as a GM.
   Cloudflare mails you a code; type it in. Claude then says it is connected.
4. Repeat for the other connectors. The sign-in is quick after the first one.
5. Open a new chat, click the **+**, choose **Plugins** and switch on the ones you want for that
   chat, as in [Asking Claude](asking-claude.md#tool-sets-which-switches-to-turn-on).

Do "Stop the Allow questions" from the [installer page](connect-claude-desktop.md#stop-the-allow-questions)
for each connector too: the screens are the same.

## Check that it works

Ask Claude _"What world is open in Foundry?"_ A normal answer with the world's name means you are
connected. With Prep switched on, ask _"Run get-preflight"_ for the full check.

## Good to know

- **Only GMs get in.** Cloudflare checks your email, and the tool then checks it again against the
  list of GMs. A player's login never opens these addresses.
- **Plan, confirm and undo are the same.** A change is planned first, shown to you, applied after
  your yes and kept in Recent Changes with an Undo, exactly as with the installer.
- **A slow change can look like an error.** If a change takes more than about a minute and a half,
  Claude may show an error (a Cloudflare 524) although it landed. Before you try it again, ask Claude
  to list the latest changes, or open **Recent Changes** in the dashboard.
- **If the tool admin takes you off the list,** the connectors stop working within a few minutes.
- **On a plan B night** the server is not reachable and these connectors do not work, like the rest
  ([Game night runbook](game-night-runbook.md#the-server-is-down)).

## If something does not work

- **Claude says the connector failed to connect:** check that you pasted the whole address, with the
  `/mcp/...` part, and that your email is the one the tool admin has for you.
- **The sign-in page says you have no access:** your email is not on the GM list. Tell the tool admin
  which email you used.
- **One connector works and another says it is off:** switch it on in the **+** menu, then **Plugins**.
- **It stopped working today:** open the game's address. If it does not load, the server is down; see
  the [Game night runbook](game-night-runbook.md).

## Taking one off

Settings, **Plugins**, pick the connector and remove it. Nothing else is stored on your PC.
