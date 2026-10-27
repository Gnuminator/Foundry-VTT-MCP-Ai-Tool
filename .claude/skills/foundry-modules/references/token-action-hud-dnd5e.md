# Token Action HUD D&D 5e (`token-action-hud-dnd5e`)

Not verified live: drafted from the module's manifest, docs and source on disk, 2026-10-27; live check pending.

**Verdict: keep.** This is the D&D 5e half of the HUD and the manifest targets exactly our stack: Foundry 14.359+ (verified 14.368) and dnd5e 6.0.0 to 6.99 (verified 6.0.5). It reads dnd5e 6 activities, so it matches how our own tools use items. Keep or drop it together with `token-action-hud-core`.

**For Danni's guides:** The bar shows your weapons, spells, class features, skills, saves and conditions as buttons; click one to use it, right-click an item to open its sheet.

## What it does

Version 2.2.0, requires `token-action-hud-core` (2.1.2 up to 2.1.99). It fills the core HUD with D&D 5e groups. Groups seen in its language file: Abilities, Checks and Skills, Saves, Conditions, Rests, Combat (roll initiative, end turn, add or remove from combat), Counters, Inventory (weapons, equipment, consumables, containers), Features (class, race, background, feats, active/passive, monster features, legendary and lair actions, multiattacks), Spells by level (cantrips, 1st to 9th, pact, innate, at-will, limited), and class lists (Ki, Metamagic, Maneuvers, Invocations, Infusions and similar).

For dnd5e 6 activities: with "Show Activities as Actions" off, an item is one button and clicking it opens dnd5e's activity choice window when the item has several activities; with it on, every activity is its own button and runs directly. Whether the dnd5e 6 "skip dialog" behaviour matches this in practice is (not verified).

## Where its UI is

Same HUD as core (select a token). Settings: Game Settings, Configure Settings, Token Action HUD D&D 5e. Tooltips on hover show item info (tooltip mode is a core setting).

## Settings we use and why

All ten are per-user (client scope), so each player chooses their own. Key prefix `token-action-hud-dnd5e.`; defaults read from the minified source.

| Label                               | Key                               | Default | Our value                                                                                |
| ----------------------------------- | --------------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| Show Activities as Actions          | `showActivitiesAsActions`         | off     | leave off for players (shorter bar); on is handy for multi-activity items (not verified) |
| Show Slow Actions                   | `showSlowActions`                 | on      | leave                                                                                    |
| Show Items without Activation Costs | `showItemsWithoutActivationCosts` | off     | leave                                                                                    |
| Show Uncharged Items                | `showUnchargedItems`              | off     | leave                                                                                    |
| Show Unequipped Items for PCs       | `showUnequippedItems`             | off     | leave (equip first, then it shows)                                                       |
| Show Unequipped Items for NPCs      | `showUnequippedItemsNpcs`         | on      | leave                                                                                    |
| Show Unprepared Spells              | `showUnpreparedSpells`            | off     | leave                                                                                    |
| Show Spells in All Castable Groups  | `showSpellsAcrossGroups`          | off     | leave                                                                                    |
| Display Spell Information           | `displaySpellInfo`                | on      | leave                                                                                    |
| Abbreviate Skill and Ability Names  | `abbreviateSkills`                | off     | leave                                                                                    |

Because these are client settings, a GM cannot set them for the table. If Danni wants one bar style for everybody, export a layout and set the core "Global Default Layout" (not verified).

## How it interacts with the AI Tool

No interaction found. Grep of `packages/`, `docs/`, `scripts/` shows no code that reads or writes this module's settings, flags or HUD. Points that do relate:

- Rolls and item uses started from the HUD go through dnd5e's own roll and activity functions, so they produce ordinary chat messages and the play recorder and `get-chat-log` see them like any other roll.
- Our `use-item`, `request-attack-roll` and `request-ability-check` do not depend on the HUD; they call dnd5e directly (`activity.use`, `rollAttack`) in the GM client. They work with the module on or off.
- Items our Build tools add (add-feature, create-npc) are ordinary dnd5e items and appear in the HUD groups according to type, activation and the settings above (not verified).
- No `foundry-mcp-bridge` setting is needed.

## Gotchas on Foundry 14 / dnd5e 6

- Compatibility range is tight: dnd5e up to 6.99 and core up to 2.1.99. A dnd5e 7 or a core 2.2 will need a module update first.
- Registered as `socket: false`; all socket work is in core.
- Items with no activation cost, unequipped gear and unprepared spells are hidden by default, so "my weapon is missing" is usually a setting or an unequipped item.
- Removing the module leaves no data in actors or items (not verified). Custom layouts stay in core's storage.
- Pi: nothing platform-specific found.

## Sources

- Repo: https://github.com/Larkinabout/fvtt-token-action-hud-dnd5e
- `C:\FoundryTest\data\Data\modules\token-action-hud-dnd5e\module.json`, `readme.md`, `languages\en.json`, `scripts\token-action-hud-dnd5e.min.js` (setting registration and defaults).
- Repo greps: `packages/foundry-module/src/data-access/actor-builder.ts` (our activity use and roll calls).
