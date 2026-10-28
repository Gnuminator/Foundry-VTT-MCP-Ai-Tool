---
name: foundry-modules
description: What each Foundry module in the Curse of Strahd world and the test kit does, where its UI is, the settings we use and why, how it interacts with the AI Tool, its Foundry 14 / dnd5e 6 gotchas and the keep-or-drop verdict. Use when a task touches a third-party module (changing its settings, adding or dropping it, writing a guide or kit scenario that names it, debugging a module error, deciding what to install for Danni), or when writing a new module reference page.
---

# Foundry modules: one verified page per module

Each module has a page in `references/<module-id>.md` (the id is the folder name in
`Data/modules`, which is also the id Foundry and the AI Tool use). The pages are written in our own
words from the module's README, its manifest and source on disk, and by driving it on a test
server. Foundry's own UI is `foundry-core-ui`; the test servers are `foundry-test-env`.

## Index

| Module id                  | Page                                     | Verdict  |
| -------------------------- | ---------------------------------------- | -------- |
| `foundryvtt-actor-studio`  | `references/foundryvtt-actor-studio.md`  | keep     |
| `ddb-importer`             | `references/ddb-importer.md`             | optional |
| `dnd-players-handbook`     | `references/dnd-players-handbook.md`     | keep     |
| `token-action-hud-core`    | `references/token-action-hud-core.md`    | keep     |
| `token-action-hud-dnd5e`   | `references/token-action-hud-dnd5e.md`   | keep     |
| `dice-so-nice`             | `references/dice-so-nice.md`             | keep     |
| `NotYourTurn`              | `references/NotYourTurn.md`              | keep     |
| `automated-conditions-5e`  | `references/automated-conditions-5e.md`  | keep     |
| `monks-player-settings`    | `references/monks-player-settings.md`    | optional |
| `vtta-tokenizer`           | `references/vtta-tokenizer.md`           | keep     |
| `tarokka-reading`          | `references/tarokka-reading.md`          | keep     |
| `combat-spell-timer`       | `references/combat-spell-timer.md`       | drop     |
| `dae`                      | `references/dae.md`                      | optional |
| `monks-combat-details`     | `references/monks-combat-details.md`     | keep     |
| `monks-tokenbar`           | `references/monks-tokenbar.md`           | drop     |
| `3ds-atlas`                | `references/3ds-atlas.md`                | keep     |
| `JB2A_DnD5e`               | `references/JB2A_DnD5e.md`               | optional |
| `autoanimations`           | `references/autoanimations.md`           | optional |
| `calendaria`               | `references/calendaria.md`               | optional |
| `lib-wrapper`              | `references/lib-wrapper.md`              | keep     |
| `racooze-map-library`      | `references/racooze-map-library.md`      | optional |
| `racoozes-free-battlemaps` | `references/racoozes-free-battlemaps.md` | optional |
| `sequencer`                | `references/sequencer.md`                | keep     |
| `share-media`              | `references/share-media.md`              | keep     |
| `socketlib`                | `references/socketlib.md`                | keep     |
| `travel-pace`              | `references/travel-pace.md`              | keep     |
| `item-piles`               | `references/item-piles.md`               | optional |
| `tidy5e-sheet`             | `references/tidy5e-sheet.md`             | optional |
| `quick-insert`             | `references/quick-insert.md`             | keep     |
| `find-the-culprit`         | `references/find-the-culprit.md`         | keep     |
| `fxmaster`                 | `references/fxmaster.md`                 | optional |
| `tokenmagic`               | `references/tokenmagic.md`               | drop     |
| `fxbus`                    | `references/fxbus.md`                    | drop     |
| `theatre`                  | `references/theatre.md`                  | drop     |
| `polyglot`                 | `references/polyglot.md`                 | optional |

### Batch E: new candidates (tried 2026-10-28 on test server B, Foundry 14.369 / dnd5e 6.0.6)

None of the nine broke the world: all nine plus the 23 keep-list modules installed on server B loaded together (37 active) with no console errors. Not installed anywhere else; the Pi and the Strahd world are untouched.

| Module                          | Version         | For Danni | The one thing to know                                                                                            |
| ------------------------------- | --------------- | --------- | ---------------------------------------------------------------------------------------------------------------- |
| Item Piles (+ `itempilesdnd5e`) | 3.3.4 (+ 1.1.0) | optional  | Replaces Loot Sheet NPC 5e. Needs the dnd5e companion; piles are `character` actors that `list-characters` shows |
| Tidy 5e Sheets                  | 14.4.0          | optional  | Our writes and rolls show up in it live; it removes the Tokenizer portrait button                                |
| Quick Insert                    | 3.7.8           | keep      | Turn on "GMs only", or players can search the names of actors and scenes they cannot see                         |
| Find the Culprit                | 3.3.0           | keep      | Disables our bridge during a search; Zero Modules and Reset restored all 14 modules                              |
| FXMaster                        | 8.4.2           | optional  | Weather lives in a scene flag, separate from the core weather `plan-scene-mood` sets                             |
| Token Magic FX                  | 0.8.4           | drop      | Works and survives our token moves, but noisy and overlaps Automated Animations                                  |
| FX Bus                          | 0.8.0           | drop      | Screen shake panel; client-side only, no data; not needed at the table                                           |
| Theatre Inserts                 | v3.4.2          | drop      | Its chat lines have no speaker: our log reads them as out-of-character chat from the user                        |
| Polyglot                        | 2.10.4          | optional  | Scrambles only the display; the stored text is plain, so recaps and player views show it in the clear            |

Both FXMaster and Item Piles post a **public** welcome card to chat on the first GM load; delete the cards before players join.

`Dev/Foundry AI Tool/Backlog.md` in the vault lists the batches.

## Page format (follow it exactly; every page uses these headings in this order)

```markdown
# <Module title> (`<module-id>`)

Verified on Foundry <core version> / dnd5e <version>, module <version>, <YYYY-MM-DD>.
(or: Not verified live: <why>. Mark every unverified claim in place with "(not verified)".)

**Verdict: keep | drop | optional.** <one or two sentences why.>

**For Danni's guides:** <one line a guide can link or quote, plain words, no jargon.>

## What it does

## Where its UI is

## Settings we use and why

## How it interacts with the AI Tool

## Gotchas on Foundry 14 / dnd5e 6

## Sources
```

Rules for a page:

- Short and concrete: about one screen per section. Say what you saw, not what the README promises.
  A claim you did not click through gets "(not verified)" next to it.
- **Settings:** the setting's label as the client shows it, its key (`<module-id>.<key>`), the value
  we use and the reason. List only settings we set or that bite; do not transcribe the whole menu.
- **AI Tool:** name the tools or handlers that read or change what the module touches (for
  example a journal flag, an actor flag, an item activity), say whether our writes survive the
  module's own hooks, and whether the module needs `foundry-mcp-bridge` settings. "No interaction"
  is a valid answer; say so.
- **Gotchas:** version limits (`compatibility.verified`), conflicts with other modules, what breaks
  on a world without the module (data left behind), anything the Pi (Linux, headless) changes.
- **Sources:** the README or repo URL, the manifest path, and the source files you read. No book or
  campaign text anywhere (CLAUDE.md: nothing from licensed content in the public repo).
- Keep the title, the stamp line and the Verdict line exactly as above; the index row copies the
  verdict word.
- Public text reads human: no em dashes, no filler.

## Adding a module

1. Read its manifest, README and source in `C:\FoundryTest\data\Data\modules\<id>` (server B and C
   have their own copies under their data folders).
2. Take a test server through `scripts/test-env/lock.ps1 take -Server B` (or C), enable the module
   in the `ai-tool-test` world, drive it by hand in the browser pane, release the lock.
3. Write the page, add the index row, add a kit scenario under `scripts/test-kit/scenarios/` only
   where the module earns one (it changes something the AI Tool reads or writes, or it can break a
   kit run).
