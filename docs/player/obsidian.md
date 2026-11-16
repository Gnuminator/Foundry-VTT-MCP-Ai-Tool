---
title: Your notes in Obsidian
description: Optional. Get your handouts, recaps, character and session log as notes in Obsidian on your own computer, read-only, with Syncthing. How to set it up, what is in it and how to stop.
---

# Your notes in Obsidian

**This is optional.** Everything in it is also on the [player page](README.md) and My character in
your browser. If you like keeping campaign notes in [Obsidian](https://obsidian.md) (a free notes
app), the table's server can keep a small notes folder of your own up to date on your computer:
the handouts the GM gave you, the recaps, your character, your stats and the session log.

It only goes one way. The server sends, your computer receives. Nothing you change or delete in
that folder ever goes back, and it holds only what you may already see in the game: no secrets, no
adventure text the GM has not shown you, nothing about other players' characters. If you do not
want this, do nothing: you install nothing and the player page keeps working.

## What you need

- A **Windows, Mac or Linux computer**, or an **Android phone**. (There is no free Syncthing for
  iPhone; use the player page there.)
- **Obsidian**, free for personal use: [obsidian.md/download](https://obsidian.md/download).
- **Syncthing**, free, the program that copies the folder:
  [syncthing.net/downloads](https://syncthing.net/downloads/). On Windows, SyncTrayzor or the
  plain Syncthing from winget (`winget install Syncthing.Syncthing`) both work; on Android use
  Syncthing-Fork from F-Droid or Google Play.
- About ten minutes, and the GM (or whoever runs the tool) to add your device on their side.

## Set it up

1. **Install Syncthing and open it.** It opens a page in your browser (address
   `http://127.0.0.1:8384`); that page is on your own computer, not on the internet. If it asks
   about anonymous usage reports, say no.
2. **Find your device ID.** In Syncthing click **Actions**, then **Show ID**. It is a long code of
   eight groups of letters and digits. Send it to the GM, together with the name you play under in
   Foundry. (The ID is not a password; it only lets the server know who to offer the folder to.)
3. **Wait for the GM to say it is added.** The GM has Claude add your ID on the server; that takes
   a short while and happens when the server is quiet, so it may be the next day.
4. **Accept the server.** Syncthing shows a notice that a device wants to connect (the server's
   name is whatever it is called on the Pi, often _dietpi_). Click **Add Device**. Check that the device ID shown matches the one the GM sent you. If it does
   not, press **Ignore** and tell the GM. Do not change any other setting.
5. **Accept the folder.** A second notice says the server wants to share a folder named like
   _Foundry vault Mira_. Click **Add**, choose where it should go on your computer (for example
   `Documents\Foundry vault`), and open **Advanced**. Set **Folder Type** to **Receive Only**,
   then **Save**. Receive Only means your computer can only take files in, never send them out.
6. **Open it in Obsidian.** Start Obsidian, choose **Open folder as vault**, and pick the folder
   from step 5. The notes appear within a minute or two. The vault comes with the table's look
   switched on; it holds no plugins.

## What is in it

| Folder or note | What                                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Handouts`     | The journal pages the GM has revealed to you, such as a letter or a map note. A page that the GM shows only to some players arrives only for them.       |
| `Recaps`       | The recap of each session, once the GM has revealed it.                                                                                                  |
| `My character` | Your character: abilities, hit points, spells, items and features, as in My character.                                                                   |
| `My stats`     | Your own numbers for the campaign: damage taken, healing, spell slots spent, rolls in the open and your best roll. Only rolls everybody could see count. |
| `Session log`  | One note per game night: what the table could see happen, in short lines. Secret rolls and hidden things never appear.                                   |

The server updates the notes about once a minute while the game runs, and as soon as your
computer is on and Syncthing is running it catches up. Handouts and recaps show up there after the
GM reveals them, just like on the player page.

Do not write your own notes in this folder. It belongs to the server: a note you add there stays
on your computer and is never sent anywhere, but a note it manages is overwritten at the next
update. Keep your own notes in a second Obsidian vault.

## If Syncthing says something is wrong

- **"Locally Changed Items" (yellow):** you, or Obsidian, changed something in the folder. Nothing
  went to the server. Press **Revert Local Changes** to put the server's version back. (This also removes any note you
  added there yourself.)
- **Obsidian's own files:** Obsidian writes a few settings files into the vault (`workspace.json`
  and the like). They cause the yellow notice. To stop it: in Syncthing open the folder, **Edit**,
  **Ignore Patterns**, and paste:

  ```text
  .obsidian/workspace*.json
  .obsidian/cache
  .obsidian/plugins
  .trash
  ```

- **Nothing arrives:** the server may be off, or you are not connected to the internet. Syncthing
  retries on its own. Ask the GM if it has been days.

## How to stop

- **On your side:** in Syncthing click the folder, **Actions**, **Remove**. This stops the sync and
  keeps the notes that are already on your computer; delete the folder yourself if you want them
  gone. You can also uninstall Syncthing. The server then has nobody to send to.
- **On the server:** tell the GM, and Claude removes your device from the share. Your files on the
  server stay with the campaign; they are only reachable from the player page and the share.

You can start again later with a new device ID, or the same one.

## What this does not do

- It does not let you edit anything in the game. Foundry is where you play.
- It does not show other players' characters or notes, or anything the GM has not revealed.
- It is not a backup of your computer or of your own Obsidian notes.
