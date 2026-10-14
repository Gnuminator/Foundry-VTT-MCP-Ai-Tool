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
3. On the page about the bridge, tick **Reach the bridge through the Cloudflare tunnel**. In the
   name box type the tunnel name you were given (it starts with `mcp.`). Leave the port as it is.
4. Go on. A small window asks for the **Client ID**, then the **secret**. Paste each one and press
   Enter. The secret is hidden while you type; that is normal. Nothing you paste is shown or saved
   anywhere except in a locked store that only your Windows user can open.
5. Finish. Start Claude Desktop. In the **Search and tools** menu switch on the connectors you want
   (Core is always on; Play and Prep are the ones you will use most).

## Check that it works

Ask Claude: _"What world is open in Foundry?"_ A normal answer with the world's name means you are
connected. If Claude says it cannot reach the bridge, go to the list below.

## If something does not work

- **"The bridge is not reachable":** the tunnel may be stopped. Open PowerShell and run the status
  line the person who built the tool gave you, or restart your PC. The tunnel starts by itself at
  every sign-in.
- **The five connectors are missing:** Claude Desktop was still running and rewrote its settings
  when it quit. Quit it from the tray and run the installer again.
- **The key was refused:** the Client ID or the secret was pasted wrong, or the key was switched
  off. Run the installer again and paste both again, or ask for a new key.
- **Everything worked yesterday and nothing works today:** check that the server is on
  (`https://` the Foundry address should open) before anything else.

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
