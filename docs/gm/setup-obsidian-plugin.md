---
title: 'One-time setup: the Obsidian plugin'
description: Install the Foundry AI Tool plugin in your vault and connect it to the dashboard, so Open in Foundry works from a note.
---

# One-time setup: the Obsidian plugin

The plugin adds **Open in Foundry** to your notes and shows whether a handout is revealed. You need
it only if you want those. First do [your vault on your PC](setup-obsidian-sync.md). About 10
minutes, once.

**You need:** the vault open in Obsidian, the dashboard address, and three values from the person
who built the tool (the GM token, the Cloudflare Client ID and the Cloudflare Client Secret). They
give you those privately; never paste them in a chat or a note.

## Install the plugin

1. Go to the project's releases page (<https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool/releases>),
   open the newest release and download `foundry-ai-tool-obsidian.zip`.
2. Unzip it. You get `main.js`, `manifest.json` and `styles.css`.
3. In File Explorer open `Documents\Obsidian\Foundry GM vault`. Click **View**, **Show**, **Hidden
   items**, then open `.obsidian`. If there is no `plugins` folder, make one.
4. In `plugins` make a folder called `foundry-ai-tool` and copy the three files into it.
5. In Obsidian click the gear (bottom left), **Community plugins**. If it says Restricted mode,
   click **Turn on community plugins**. Under **Installed plugins** switch on **Foundry AI Tool**.

## Connect it

1. Click the gear next to **Foundry AI Tool** in the plugin list.
2. **Dashboard address:** type the dashboard's https address.
3. Click the **GM token** field, then **Add secret**. In **ID** type `foundry-gm-token`, in **Secret**
   paste the token only, **Save**. Pick it in the list.
4. Do the same for **Cloudflare Access Client ID** (ID `cf-access-client-id`) and **Cloudflare
   Access Client Secret** (ID `cf-access-client-secret`).

The three values stay in Obsidian on your PC. They are not in the vault, so Syncthing never copies
them.

## Done when it looks like this

Open an NPC note and click **Open in Foundry** in the status bar at the bottom. The sheet opens on
your Foundry screen. (The first time, a small dashboard page may ask you to click **Open**.)

## If it does not work

- **"...did not come from the dashboard":** the Cloudflare Client ID or Secret is wrong or has
  expired. Ask the person who built the tool for new ones.
- **"...Check the GM token in the plugin settings.":** paste the GM token again.
- **"The dashboard at ... did not answer":** the address is wrong or the server is down. Open the
  dashboard address in a browser to see.
- **The plugin is not in the list:** the folder must be `.obsidian\plugins\foundry-ai-tool` with the
  three files directly inside it. Restart Obsidian.
