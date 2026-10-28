---
title: Connect Claude Desktop to the server
description: Install the small Windows client so Claude Desktop on your PC reaches the Foundry AI Tool that runs on the home server, with a key that only you hold.
---

# Connect Claude Desktop to the server

Foundry and the tool run on the home server, not on your PC. To let Claude Desktop on your PC talk
to them, you install a small program once. It does two things: it adds the five Foundry connectors
to Claude Desktop, and it keeps a private, locked tunnel open to the server. You do this once, and
you need your **tunnel key** (two pieces of text) from the person who built the tool.

You need: a Windows PC, Claude Desktop installed and signed in, and the tunnel key. About 10 minutes.

## Install

1. **Quit Claude Desktop completely.** Right-click its icon in the tray (bottom right, near the
   clock) and choose **Quit**. Closing the window is not enough. The installer will not close it for
   you.
2. Run `FoundryMCPServer-Setup-vX.Y.Z.exe` that you were sent.
3. On the page called "Bridge address", tick **Use the Cloudflare tunnel**. In **Tunnel name**
   type the name you were given (it starts with `mcp.`). Leave the address and the port as they are.
4. Go on. A small window asks for the **Client ID**, then the **secret**. Paste each one and press
   Enter. The secret is hidden while you type; that is normal. Nothing you paste is shown or saved
   anywhere except in a locked store that only your Windows user can open.
5. Finish. Start Claude Desktop. Click the **+** in the chat box, choose **Connectors**, and switch
   on the ones you want (`foundry-mcp` is Core; Play and Prep are the ones you will use most).
   A connector that is switched off is not available in that chat. Then do "Stop the Allow
   questions" below once, so Claude does not ask "Allow?" on every tool call.

## Check that it works

Ask Claude: _"What world is open in Foundry?"_ A normal answer with the world's name means you are
connected. If Claude says it cannot reach the bridge, go to the list below.

## Stop the "Allow" questions

Without this step Claude Desktop asks "Allow?" on almost every Foundry tool call, in every new chat.
Claude Desktop keeps this choice in your account, not in a file, so the installer cannot set it for
you. You do it once per connector.

1. In Claude Desktop open **Customize**, then **Connectors**.
2. Click one of the Foundry connectors (`foundry-mcp`, `foundry-mcp-play`, `foundry-mcp-prep`,
   `foundry-mcp-build`, `foundry-mcp-admin`).
3. Under **Tool permissions**, click the drop-down on the right of the **Read-only tools** line
   (it may say **Blocked** or **Needs approval** now) and choose **Always allow** (the check mark).
4. Do the same on the **Write/delete tools** line. We suggest **Always allow** there too, because
   the tool already shows you a plan and asks you to confirm before it changes anything, so you
   see one question, not two. Do not leave either line on **Blocked**: then Claude cannot use
   those tools at all.
5. Repeat for the other connectors you use. At the table that is `foundry-mcp` (Core),
   `foundry-mcp-play` and `foundry-mcp-prep`; do `foundry-mcp-build` and `foundry-mcp-admin` too if
   you switch them on.

On a new install every Foundry connector may show **Blocked** for both groups. Set each connector
you use; a connector you never set stays as it is.

Each Foundry tool is marked as reading or changing, so the two groups sort themselves. A few Play
tools act at once without a plan (rolls, chat messages, moving or deleting tokens); with **Always
allow** on writes, Claude Desktop will not stop for those either. Details in
[Asking Claude](asking-claude.md).

**To go back:** on the connector's **Tool permissions** screen, set the **Write/delete tools**
drop-down to **Needs approval** (the hand). Do the same for **Read-only tools** if you want to be
asked for reading too.

## If something does not work

- **"The bridge is not reachable":** the tunnel may be stopped. Open PowerShell and run the status
  line the person who built the tool gave you, or restart your PC. The tunnel starts by itself at
  every sign-in.
- **The five connectors are missing:** Claude Desktop was still running and rewrote its settings
  when it quit. Quit it from the tray and run the installer again.
- **The key was refused:** the Client ID or the secret was pasted wrong, or the key was switched
  off. Run the installer again and paste both again, or ask for a new key.
- **Everything worked yesterday and nothing works today:** open the game's address first.
  If it does not load, the server is down; see the [Game night runbook](game-night-runbook.md).

## Taking it off

Settings, Apps, **Foundry AI Tool Client**, Uninstall. It removes the five connectors, the tunnel
and your stored key. Your key can also be switched off from the server side at any time, so a lost
laptop is not a problem: tell the person who built the tool.

## Good to know

- The tunnel carries only the connection between Claude Desktop and the tool. Nobody on the internet
  can use it without the key, and the key never leaves your PC.
- You do not need Tailscale or any other program for this.
- If you move to a new PC, install again there with the same key, or ask for a fresh one and have
  the old one switched off.
