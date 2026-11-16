---
title: 'One-time setup: the Obsidian plugin'
description: Install the Foundry AI Tool plugin in your vault and connect it to the dashboard, so Open in Foundry works from a note.
---

# One-time setup: the Obsidian plugin

The plugin adds **Open in Foundry** to your notes and shows whether a handout is revealed. You need
it only if you want those. First do [your vault on your PC](setup-obsidian-sync.md). About 10
minutes, once.

Stuck on a step? Ask Claude first: open a chat with the GM coach on and say where you are.

**You need:** the vault open in Obsidian, the dashboard address, and three values from the person
who built the tool (the GM token, the Cloudflare Client ID and the Cloudflare Client Secret). They
give you those privately; never paste them in a chat or a note.

- **GM token:** a password the tool uses instead of a username. The person who built the tool sends
  it to you privately, and you cannot do step 3 below until you have it.
- **Cloudflare Client ID:** the one that ends in `.access`.
- **Cloudflare Client Secret:** the one that starts with `cfast_`.

This Cloudflare pair is the one made for Obsidian. It is not the pair you used for Claude Desktop.

## Install the plugin

1. Go to the project's releases page (<https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool/releases>),
   open the newest release and download `foundry-ai-tool-obsidian.zip`.
2. Unzip it. You get a folder called `foundry-ai-tool` (and a `snippets` folder you can ignore).
3. In File Explorer open `Documents\Obsidian\Foundry GM vault`. Click **View**, **Show**, **Hidden
   items**, then open `.obsidian`. If there is no `plugins` folder, make one.
4. Copy the folder `foundry-ai-tool` into `plugins`. Its `main.js` must end up at
   `.obsidian\plugins\foundry-ai-tool\main.js`, not one folder deeper.
5. In Obsidian click the gear (bottom left), **Community plugins**. If it says Restricted mode,
   click **Turn on community plugins**. Under **Installed plugins** switch on **Foundry AI Tool**.

## Connect it

1. Click the gear next to **Foundry AI Tool** in the plugin list.
2. **Dashboard address:** type the dashboard's https address. Use https: the plugin sends the two
   Cloudflare values only to an https address, never to a plain http one (so `http://localhost`
   will not get through the Cloudflare login). The GM token goes with every request.
3. Add the GM token:
   1. Click the **GM token** field.
   2. Click **Add secret**.
   3. In **ID** type `foundry-gm-token`.
   4. In **Secret** paste the token only.
   5. Click **Save**.
   6. Pick `foundry-gm-token` in the list.
4. Do the same for **Cloudflare Access Client ID** (ID `cf-access-client-id`) and **Cloudflare
   Access Client Secret** (ID `cf-access-client-secret`).

The three values stay in Obsidian on your PC. They are not in the vault, so Syncthing never copies
them.

## Done when it looks like this

Open an NPC note, then use any one of these. The sheet opens on your Foundry screen. (The first
time, a small dashboard page may ask you to click **Open**.)

- Right-click the note in the file list, then click **Open in Foundry**.
- Or press Ctrl+P, type **Open in Foundry** and press Enter.
- Or click the small text at the bottom right of the Obsidian window. It reads **Foundry: npc** (the
  note's type), or **Players: ...** on a journal page. It only shows while a Foundry note is open.

The **Open in Foundry** link inside the note text uses the server's address, which may not work on
your PC yet. If it does nothing, use one of the three ways above.

## If it does not work

- **"...did not come from the dashboard":** the Cloudflare Client ID or Secret is wrong or has
  expired. Ask the person who built the tool for new ones.
- **"...Check the GM token in the plugin settings.":** paste the GM token again.
- **"The dashboard at ... did not answer":** the address is wrong or the server is down. Open the
  dashboard address in a browser to see.
- **The plugin is not in the list:** the folder must be `.obsidian\plugins\foundry-ai-tool` with
  `main.js` directly inside it. Restart Obsidian.
