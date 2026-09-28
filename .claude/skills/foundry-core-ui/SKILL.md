---
name: foundry-core-ui
description: Navigate and drive the Foundry VTT v14 web client and the dnd5e 6 system by hand (setup screen, join, users and permissions, the in-world layout, every sidebar tab, scene controls and canvas layers, document sheets, configuration menus, chat and rolls, combat tracker, dnd5e character/NPC/item sheets and system settings). Use when a task needs clicking through Foundry's own UI in the browser pane (checking what a player or GM sees, verifying a feature in the client, changing a setting through the UI, finding where a button lives), or when writing docs or tests that name Foundry UI elements. Reference pages are verified against Foundry 14.368 / dnd5e 6.0.5.
---

# Foundry v14 + dnd5e 6: driving the client

Per-area reference pages live in `reference/`. Each is written in our own words from the
official knowledge base (foundryvtt.com/kb), the API docs, the community wiki (foundryvtt.wiki),
dnd5e's own wiki, and the v14 client source on disk; sources are linked per section. Each page
carries a verification stamp: `verified on Foundry 14.368 / dnd5e 6.0.5, <date>` when its entries
were clicked through in the running test client, with anything not verified marked in place.

| Page                                     | Covers                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| `reference/setup-and-packages.md`        | `/setup`: worlds, systems, modules, installs, backups, app configuration       |
| `reference/join-auth-users.md`           | `/join`, users, roles, User Management, permissions, ownership dialog          |
| `reference/in-world-layout.md`           | the `/game` screen: controls, sidebar, players list, hotbar, pause, menus      |
| `reference/sidebar-tabs.md`              | every sidebar tab, directory buttons, context menus, folders, compendiums      |
| `reference/scene-controls-and-layers.md` | scene control groups and tools, canvas layers, token HUD, regions              |
| `reference/document-sheets.md`           | journal, scene, token, roll table, playlist, compendium, macro, folder windows |
| `reference/configuration-menus.md`       | Game Settings, Controls, Module Management, World Configuration, Users, Tours  |
| `reference/chat-and-rolls.md`            | chat log, roll modes, chat commands, dice syntax, inline rolls, chat cards     |
| `reference/combat-tracker.md`            | encounters, combatants, initiative, turns and rounds, tracker settings         |
| `reference/dnd5e-actor-sheets.md`        | dnd5e character, NPC and item sheets, activities, rests, slots, resources      |
| `reference/dnd5e-settings.md`            | every dnd5e system setting, the welcome screen, the compendium browser         |

## Working rules

- Use the local test server only (`foundry-test-env` skill: start it, join as `Claude`, or
  `Player` for the player's view). Never the live campaign, never ports 31414-31416.
- Read before clicking: `find` / `read_page` (accessibility tree) for labels and refs, a
  screenshot when layout matters. Buttons move when rows are added; re-read after changes.
- The browser pane is often smaller than Foundry's minimum (1366×768) and a hidden tab renders
  at 0×0: resize the tab (`resize_window` 1440×900) and keep the Foundry tab in front while it
  loads, or the canvas fails to start. Under an emulated size, prefer screenshot coordinates.
- Opening a second tab with `preview_start` can reload the first one; use `tabs_create` +
  `navigate` for extra tabs. Two users at once: GM on `localhost:30001`, Player on
  `127.0.0.1:30001` (separate cookies).
- `javascript_tool` is for reading state (`game.*`, `ui.*`) to confirm what the UI did; make
  changes through the UI or the AI Tool.
- Keep the test world clean: cancel dialogs you only opened to look at, undo settings you
  changed, delete what you created. Leave a world with **Return to Setup** before stopping
  Foundry.

## Third-party modules

Each third-party module we install on the test server gets its own skill,
`.claude/skills/foundry-mod-<module-id>/`, built the same way: a short `SKILL.md` index plus
`reference/*.md` per area of the module's UI, sources linked (the module's README, wiki, and its
code on disk under `C:\FoundryTest\data\Data\modules\<id>`), every entry clicked through on the
test server and stamped `verified on Foundry <core> / dnd5e <version> / <module-id> <version>,
<date>`. Update the stamp when the module updates.
