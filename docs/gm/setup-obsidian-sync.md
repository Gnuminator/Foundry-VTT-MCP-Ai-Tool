---
title: 'One-time setup: your vault on your PC (Obsidian and Syncthing)'
description: Install Obsidian and Syncthing on your own PC, pair with the vault on the home server, and check that a note travels both ways. About 20 minutes, once.
---

# One-time setup: your vault on your PC (Obsidian and Syncthing)

The tool writes your campaign notes into an Obsidian vault on the home server. **Syncthing** keeps a
copy of that vault on your PC, in both directions, and **Obsidian** is the app you read it in. You
set this up once. What the vault holds and how to use it is in [Your Obsidian vault](obsidian.md).

**You need:** your Windows PC, about 20 minutes, and one message to the person who built the tool
(your Syncthing ID, step 3). They add your PC on the server; you cannot do that part yourself.

## 1. Install Obsidian

1. Go to <https://obsidian.md/download> and download the Windows installer.
2. Run it. Do not open a vault yet.

## 2. Install and start Syncthing

1. Click Start, type **PowerShell**, press Enter.
2. Type `winget install Syncthing.Syncthing` and press Enter. Say yes if it asks to accept terms.
3. Close PowerShell and open it again, then type `syncthing` and press Enter.
4. Your browser opens the Syncthing page (the address is `http://127.0.0.1:8384`; it only works on
   your own PC). Leave the PowerShell window open while you do the rest. If Syncthing asks about
   anonymous usage reporting, choose **No**. A warning about setting a GUI password can wait.
5. Click **Actions**, **Settings**, **Connections**, untick **Enable NAT traversal** (so Syncthing never
   asks your router to open a port) and click **Save**.

## 3. Send your ID

1. On the Syncthing page, click **Actions** (top right), then **Show ID**.
2. Click **Copy** and paste it in a private message to the person who built the tool. Say it is for
   the GM vault.
3. Wait for their answer ("added"). Keep the Syncthing page open.

## 4. Accept the server and the folder

1. A yellow bar says **foundry-pi** wants to connect. Click **Add Device**, then **Save**.
2. A second bar offers the folder **Foundry GM vault**. Click **Add**.
3. In the window that opens, set **Folder Path** to
   `C:\Users\<your name>\Documents\Obsidian\Foundry GM vault` (Syncthing creates it).
4. Open the **Ignore Patterns** tab and paste these lines:

   ```text
   .obsidian/workspace*.json
   .obsidian/cache
   .obsidian/plugins
   .obsidian/community-plugins.json
   .trash
   ```

   They keep each PC's own Obsidian settings out of the sync.

5. Click **Save**. The folder row shows **Syncing**, then **Up to Date** in green.

## 5. Open the vault in Obsidian

1. Start Obsidian. On the first screen click **Open** next to **Open folder as vault**, pick
   `Documents\Obsidian\Foundry GM vault` and confirm.
2. If Obsidian asks about trusting the vault's author, choose **Browse vault in Restricted Mode**.
   The plugin has its own page: [One-time setup: the Obsidian plugin](setup-obsidian-plugin.md).

## 6. Start Syncthing by itself at sign-in

1. In PowerShell run `(Get-Command syncthing).Source` and copy the path it prints.
2. Press **Win + R**, type `shell:startup`, press Enter. A folder opens.
3. Right-click empty space, **New**, **Shortcut**. As location type the copied path in quotes, a
   space, then `--no-browser`. Name it **Syncthing**. Finish.
4. Right-click the new shortcut, **Properties**, set **Run** to **Minimized**, **OK**.

You can now close the PowerShell window from step 2. The next time you sign in to Windows,
Syncthing starts on its own.

## Done when it looks like this

- In Syncthing, the **Foundry GM vault** folder says **Up to Date**, and under **Remote Devices**
  **foundry-pi** says **Up to Date**.
- In Obsidian the file list shows folders such as `AI Tool` and `Prep`.
- **A note travels both ways.** In Obsidian, right-click the `Prep` folder, **New note**, call it
  `Sync test` and type a line. Within a minute Syncthing shows the change going out, and then
  **foundry-pi** says **Up to Date** again: the server has your note. In the other direction,
  everything the server wrote before you joined (for example `Home.md`) is already on your PC.
  Message the person who built the tool the name `Sync test`; they confirm it is on the server.
  Then delete `Sync test`.

## If it does not work

- **The Syncthing page does not open:** Syncthing is not running. Start it from PowerShell with
  `syncthing`, then open `http://127.0.0.1:8384` yourself.
- **foundry-pi says Disconnected:** the person who built the tool has not added your ID yet, or the
  server is off. Send the ID again and ask them to check the server.
- **No yellow bar for the folder:** wait a minute. If it still does not come, tell the person who
  built the tool, who offers the folder again.
- **Out of Sync, or files with `.sync-conflict` in the name:** you and the server changed the same
  note before they met. Open both files in Obsidian, keep the text you want in the normal one and
  delete the other.
- **Your PC was off for a while:** nothing is lost. Start Syncthing and wait for **Up to Date**.
