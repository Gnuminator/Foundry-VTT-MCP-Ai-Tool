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

The Strahd list is `scripts/modules/strahd-modules.json` (35 modules; it carries the same verdict
word as this table, and a test keeps the all-modules kit profile in step with its ids). Version =
the version on test server A (the pinned set) when the page was written or refreshed on 2026-10-28.

| Module id                  | Version         | Page                                     | Verdict  |
| -------------------------- | --------------- | ---------------------------------------- | -------- |
| `foundryvtt-actor-studio`  | 2.10.5-aitool.4 | `references/foundryvtt-actor-studio.md`  | keep     |
| `ddb-importer`             | 7.5.9           | `references/ddb-importer.md`             | optional |
| `dnd-players-handbook`     | 2.2.0           | `references/dnd-players-handbook.md`     | keep     |
| `token-action-hud-core`    | 2.1.2           | `references/token-action-hud-core.md`    | keep     |
| `token-action-hud-dnd5e`   | 2.2.0           | `references/token-action-hud-dnd5e.md`   | keep     |
| `dice-so-nice`             | 6.4.4           | `references/dice-so-nice.md`             | keep     |
| `NotYourTurn`              | 4.1.0           | `references/NotYourTurn.md`              | keep     |
| `automated-conditions-5e`  | 14.606.4.5      | `references/automated-conditions-5e.md`  | keep     |
| `monks-player-settings`    | 14.01           | `references/monks-player-settings.md`    | keep     |
| `vtta-tokenizer`           | 5.0.3           | `references/vtta-tokenizer.md`           | keep     |
| `tarokka-reading`          | 1.0.5           | `references/tarokka-reading.md`          | keep     |
| `combat-spell-timer`       | 2.3.0           | `references/combat-spell-timer.md`       | drop     |
| `dae`                      | 14.0.19         | `references/dae.md`                      | optional |
| `monks-combat-details`     | 14.03           | `references/monks-combat-details.md`     | keep     |
| `monks-tokenbar`           | 14.01           | `references/monks-tokenbar.md`           | drop     |
| `3ds-atlas`                | 1.5.3           | `references/3ds-atlas.md`                | keep     |
| `JB2A_DnD5e`               | 0.9.4           | `references/JB2A_DnD5e.md`               | optional |
| `autoanimations`           | 8.0.1           | `references/autoanimations.md`           | optional |
| `calendaria`               | 1.4.6           | `references/calendaria.md`               | keep     |
| `lib-wrapper`              | 1.13.5.1        | `references/lib-wrapper.md`              | keep     |
| `racooze-map-library`      | 1.2.42          | `references/racooze-map-library.md`      | optional |
| `racoozes-free-battlemaps` | 1.2.0           | `references/racoozes-free-battlemaps.md` | optional |
| `sequencer`                | 4.3.0           | `references/sequencer.md`                | keep     |
| `share-media`              | 3.14.3          | `references/share-media.md`              | keep     |
| `socketlib`                | 1.1.4           | `references/socketlib.md`                | keep     |
| `travel-pace`              | 5.3.1           | `references/travel-pace.md`              | keep     |
| `combat-tracker-dock`      | 5.0.2           | `references/combat-tracker-dock.md`      | keep     |
| `dnd5e-item-resources`     | 1.3.00          | `references/dnd5e-item-resources.md`     | optional |
| `monks-common-display`     | 14.01           | `references/monks-common-display.md`     | optional |
| `monks-little-details`     | 14.01           | `references/monks-little-details.md`     | keep     |
| `dd-import`                | 6.1.1           | `references/dd-import.md`                | keep     |
| `dice-calculator`          | 4.0.6           | `references/dice-calculator.md`          | keep     |
| `gm-vision`                | 2.0.5           | `references/gm-vision.md`                | keep     |
| `healthEstimate`           | 36.1.1          | `references/healthEstimate.md`           | keep     |
| `nice-more-dice`           | 1.4.2           | `references/nice-more-dice.md`           | keep     |

Two verdicts changed on 2026-10-28 after a live check on Foundry 14.369: `calendaria` optional to
keep (the Barovian calendar and Travel Pace build on it; clean load) and `monks-player-settings`
optional to keep (its player drop-down is there, the first check opened the wrong window).
`autoanimations` stays optional (the null `id` error did not reproduce on 8.0.1) and `ddb-importer`
stays optional, with its kit-profile line corrected (it is in `modules-all`).

Batch E (new candidates, another lane) adds more. `Dev/Foundry AI Tool/Backlog.md` in the vault
lists the batches.

### Disabled in the old Frostmaiden world: one-line verdicts

The 17 modules that were installed but switched off in the old Rime of the Frostmaiden world (vault
`Design/Module inventory (Frostmaiden world).md`, 2026-10-03). None is in the Strahd list, none has
a page and none was tried live on 2026-10-28: they are not installed on test servers A to C and
none looks likely to matter for Strahd. Versions and compatibility are from the inventory.
`skip` = leave it out of the Strahd world; revisit only if Danni asks for what it does.

| Module id                    | Verdict | Reason                                                                                                            |
| ---------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `levels`                     | skip    | replaced by core v14 scene levels; it patches token elevation, vision and collision                               |
| `monks-active-tiles`         | skip    | 12 libWrapper patches and tile triggers that can change HP or scenes behind the AI Tool's back; Strahd needs none |
| `multi-token-edit`           | skip    | Mass Edit: 29 libWrapper patches for a convenience; edit one by one, or ask Claude                                |
| `wall-height`                | skip    | no Foundry 14 release (verified 13 only); core v14 levels covers the use                                          |
| `betterroofs`                | skip    | a rendering patch for roof tiles; try it only if a Strahd map shows a roof problem                                |
| `foundrytodiscord`           | skip    | our Discord bot does this; both would post every chat message twice                                               |
| `monks-enhanced-journal`     | skip    | replaces the journal sheets and overlaps the journal writes our prep tools make                                   |
| `niks-shared-npc-initiative` | skip    | dnd5e 6 groups NPC initiative itself; the installed 14.1.1 is dnd5e 5 only                                        |
| `popout`                     | skip    | moves sheets into extra browser windows (verified 13.350); not needed for table play                              |
| `colorsettings`              | skip    | abandoned library (verified Foundry 11); nothing in the Strahd set requires it                                    |
| `fvtt-party-sheet`           | skip    | Foundry 13 only; dnd5e 6's group actor and our `get-party` cover it                                               |
| `mad-freecontent`            | skip    | a free map pack, content only; Strahd maps come from the Racooze packs and our own content                        |
| `monks-scene-navigation`     | skip    | restyles the scene bar that core v14 already has                                                                  |
| `scene-packer`               | skip    | a library for packaging scenes, for module authors; nothing we ship uses it                                       |
| `stickynotes`                | skip    | Foundry 13 only; core map notes do the same job                                                                   |
| `theripper-premium-hub`      | skip    | a settings hub for TheRipper93's paid modules, which we do not use (Carousel Combat Tracker is standalone)        |
| `tile-scroll`                | skip    | a cosmetic scrolling-tile effect; not needed                                                                      |

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
- Open a settings window the way a user does (Settings tab, then the button). A window built from
  code can lack what a module adds through its own hook: that fooled the first Player Settings page.

## Adding a module

1. Read its manifest, README and source in `C:\FoundryTest\data\Data\modules\<id>` (server B and C
   have their own copies under their data folders).
2. Take a test server through `scripts/test-env/lock.ps1 take -Server B` (or C), enable the module
   in the `ai-tool-test` world, drive it by hand in the browser pane, release the lock.
   Enabling many at once: set `core.moduleConfiguration` from the console, then reload.
   A module folder copied in while Foundry runs shows up only after a server restart.
3. Write the page, add the index row, add a kit scenario under `scripts/test-kit/scenarios/` only
   where the module earns one (it changes something the AI Tool reads or writes, or it can break a
   kit run).
