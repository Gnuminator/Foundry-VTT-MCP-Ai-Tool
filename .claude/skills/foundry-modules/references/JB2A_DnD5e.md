# JB2A free animation set (`JB2A_DnD5e`)

Not verified live: drafted from the module's manifest, README, license, scripts and folder layout on disk, 2026-10-27; live check pending.

**Verdict: optional.** Version 0.9.4 is the free tier of the Jules and Ben animated assets, about 1.6 GB of clips that only Sequencer-based modules use. Keep it only with Automated Animations. It is CC BY-NC-SA, so none of it goes into the repo or vault.

**For Danni's guides:** The animation clips for spell and weapon effects; they sit on the server and only matter if automatic animations are on.

## What it does

Assets only: animated webm and webp files for spells, melee and ranged attacks, tiles and token effects (3,476 files: 2,129 webm, 1,343 webp). Its script waits for Sequencer's `sequencer.ready` hook and registers its database as `jb2a`, and exposes `game.modules.get("JB2A_DnD5e").api.freeDatabase`. It also ships two small packs: a macro pack `jb2a-sequencer` and an actor pack `jb2a-actors`. The Patreon set `jb2a_patreon` is a larger superset; if both are active the newer module wins on conflicts.

## Where its UI is

Almost none. A one-time public info card in chat, the two packs in the Compendium sidebar, and two settings.

## Settings we use and why

Keys are `JB2A_DnD5e.<key>`, world scope.

| Label (client)            | Key            | Default   | Our value / reason                                                             |
| ------------------------- | -------------- | --------- | ------------------------------------------------------------------------------ |
| Info Chat Card - Disabled | `runonlyonce`  | off       | the first GM load posts the card and switches this on by itself                |
| JB2A location             | `jb2aLocation` | `modules` | leave; Automated Animations has a separate `jb2aLocation` for external hosting |

## How it interacts with the AI Tool

- **Chat.** One public info card appears in the chat log the first time a GM loads the world. `get-chat-log` and the play recorder will see it once.
- **Compendiums.** `list-compendium-packs` lists the macro and actor packs. They are tool-irrelevant; mind the actor pack when searching for monsters.
- **Nothing else.** No scenes, journals or documents. No `foundry-mcp-bridge` setting is needed.

## Gotchas on Foundry 14 / dnd5e 6

- Manifest `verified` is 14, with no maximum; the script uses only core settings, chat and pack APIs.
- It does not declare Sequencer, but without Sequencer active its database never registers.
- Automated Animations needs one JB2A module; without it the GM sees a permanent error at every load.
- The free set covers only part of the spell list (the first to seventh level folders hold 113, 155, 67, 27, 26, 19 and 2 files, cantrips 52), so many spells will not animate.
- 1.6 GB on disk, so check space on the Pi and the backup size. Clients fetch a clip on first play; browsers decode each webm per play.
- Changing `jb2aLocation` makes it rewrite the pack image paths on load (it unlocks and relocks the packs).
- Licence: CC BY-NC-SA 4.0. Reference it by module id only.

## Sources

- Patreon: https://www.patreon.com/JB2A; wiki: https://jules-bens-aa.github.io/jb2a-wiki
- `C:\FoundryTest\data\Data\modules\JB2A_DnD5e\module.json`, `README.md`, `Library License.txt`, `scripts\`; folder structure and counts only.
