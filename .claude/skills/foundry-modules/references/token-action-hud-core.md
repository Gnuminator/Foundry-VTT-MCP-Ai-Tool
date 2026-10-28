# Token Action HUD Core (`token-action-hud-core`)

Verified on Foundry 14.368 / dnd5e 6.0.6, module 2.1.2, 2026-10-28 (test server B). Parts not clicked through are marked "(not verified)".

**Verdict: keep.** The manifest says it is verified on Foundry 14.368, nothing in the source conflicts with the AI Tool, and it saves players from digging through the character sheet. It does nothing without its system module `token-action-hud-dnd5e`, so the two are kept or dropped together.

**For Danni's guides:** Click your token and a small bar of buttons appears with your attacks, spells, skills and saves, so you can roll from the map without opening the character sheet.

## What it does

Core version 2.1.2. It draws a repositionable bar of action buttons for the selected token (or, with "Always Show HUD", for the user's own character). Core has no game rules of its own: it provides the HUD, the layout editor, saved layouts and the roll plumbing, and the system module (`token-action-hud-dnd5e`, see its page) decides which groups and actions exist. It is flagged as a library, requires `socketlib`, and optionally uses `color-picker` for colour fields. Per its manifest it also keeps layouts in persistent storage (a `storage` folder in the module) through GM-side socket calls (not verified).

It refreshes on token selection, actor, item, active effect and combat updates (hooks found in the bundle: `controlToken`, `updateToken`, `updateActor`, `createItem`, `updateItem`, `deleteItem`, `createActiveEffect`, `updateCombat`).

## Where its UI is

- On the canvas: with a token controlled (checked with Test Hero, a level 3 Fighter) the HUD appears at the top left of the canvas with the actor name and the tabs Inventory, Features, Attributes, Effects and Utility (13 groups in the DOM). It follows the controlled token; with none controlled it is empty. The elements are `#token-action-hud-app` and `#token-action-hud`. Top-level buttons open groups on hover (or on click, see below). Drag a top-level button to move it (not verified).
- Two keybindings to enable/disable and collapse/expand the HUD (Configure Controls, "Token Action HUD"; exact default keys not verified).
- Game Settings, Configure Settings, Token Action HUD Core: 23 entries plus the menus `customStyle` and `layout`; the settings below. Unlock the HUD (padlock button) to edit groups, add groups, drop in macros.
- Per-user layouts: "User Default Layout" and the reset buttons in the same menu.

## Settings we use and why

Scope read from the bundled source; defaults confirmed live on B (`allow` is "1", the menu entry Player; style `foundryVTT`; also on by default: `enableCompendiumActions`, `enableMacroActions`; `tooltips` full, `tooltipDelay` 1500). "Client" settings are per browser, so each player sets their own; "world" settings are the GM's and apply to everyone.

| Label                 | Key (`token-action-hud-core.<key>`) | Scope  | Default                         | Our value                                                                                                         |
| --------------------- | ----------------------------------- | ------ | ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Enable HUD            | `enable`                            | client | on                              | leave on                                                                                                          |
| Allow HUD             | `allow`                             | world  | Player and up (requires reload) | leave, so players get it                                                                                          |
| Roll Handler          | `rollHandler`                       | world  | `core`                          | leave `core` (a world setting; the dnd5e module hands rolls to dnd5e)                                             |
| Always Show HUD       | `alwaysShowHud`                     | client | on                              | leave on: a player sees their character with nothing selected                                                     |
| Style                 | `style`                             | client | Foundry VTT                     | leave                                                                                                             |
| Direction             | `direction`                         | client | Auto                            | leave                                                                                                             |
| Dragging              | `drag`                              | client | When Unlocked                   | leave                                                                                                             |
| Enable Customization  | `enableCustomization`               | world  | on                              | on for the pilot; consider off at the table so players cannot rearrange (not verified how this looks to a player) |
| Global Default Layout | `customLayout`                      | world  | blank (system layout)           | blank until a table layout is exported                                                                            |

The first-run prompt is stored as a hidden world setting (`startup`) and is shown once (not verified).

## How it interacts with the AI Tool

No interaction found. A grep of `packages/`, `docs/` and `scripts/` finds the module only in a comment in `scripts/pi/world-refs.mjs` (its secret-word scan matches the setting name after the module id, so `token-action-hud` never counts). None of our handlers read or write its settings or layouts.

- Our writes (add-feature, create-npc, item changes) do not touch the HUD, but the HUD listens for item and actor updates, so new items should show up after the update (not verified).
- The HUD does not change roll flow for our tools: it only calls dnd5e's own roll and use functions, which create the same chat messages our `get-chat-log` reads.
- `foundry-mcp-bridge` needs no setting for it.
- Kit scenario: none yet, none earned. Nothing the AI Tool reads or writes goes through the HUD, and the kit never needs it. Clicking an action and HUD refresh after our writes were not tried on 2026-10-28 (not verified).

## Gotchas on Foundry 14 / dnd5e 6

- Manifest: minimum 13.351, verified 14.368. No v14 problem found in the manifest or settings.
- Core requires `socketlib` (present on server A). If `socketlib` is missing the module does not load.
- The dnd5e module pins core to 2.1.2 through 2.1.99, so updating core alone past 2.1.99 will mark the dnd5e module incompatible. Update them together.
- Saved layouts and per-actor customisation live in module storage and user data. Removing the module leaves those files behind but no world documents (not verified).
- Layout saves go through a GM client over the socket (`saveData`, `getData`), so a player's layout change may not persist while no GM is connected (not verified).
- Pi: it is a pure client module and a `storage` folder; nothing headless-specific found, but the folder must be writable by the Foundry user (not verified).

## Sources

- Repo: https://github.com/Larkinabout/fvtt-token-action-hud-core ; wiki "How to Use Token Action HUD".
- `C:\FoundryTest\data\Data\modules\token-action-hud-core\module.json`, `readme.md`, `languages\en.json`, `dist\token-action-hud-core.min.mjs` (settings registration, hooks).
- Repo greps: `scripts/pi/world-refs.mjs`.
