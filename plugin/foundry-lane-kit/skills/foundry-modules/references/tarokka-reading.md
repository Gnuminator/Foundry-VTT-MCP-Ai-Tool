# Tarokka Reading (`tarokka-reading`)

Verified on Foundry 14.368 / dnd5e 6.0.6, module 1.0.5, 2026-10-28 (test server B). Parts not clicked through are marked "(not verified)".

**Verdict: drop.** Replaced on 2026-10-29 (D-130) by our own Tarokka table in `foundry-mcp-bridge` (AI Tool toolbar group, "Tarokka table"; `packages/foundry-module/src/tarokka-table-window.ts`): place the five cards face down, flip one at a time, players see only flipped cards, cards drawn in CSS with optional pictures. The AI Tool no longer reads this module, so the notes below describe what it did, as a record of the behaviour we matched. Before the change, version 1.0.5 declared Foundry 11 to 14 (verified 14), had no dnd5e-specific code, and was the table-facing half of the reading.

**For Danni's guides:** This is the card table for the Tarokka reading: you deal five cards face down and flip them one at a time while the players watch the same screen.

## What it does

- A five-position reading. The window on 14.368 labels the positions The Symbol (2), The Artifact (1), The Lair (5), The Blade (3) and The Ally (4). These are the module's own names for the five README positions (Tome, Symbol, Sword, Ally, Enemy); the bracketed numbers are the order in which the cards are dealt. The GM picks cards in advance or leaves a slot random. Duplicates and wrong-deck picks are flagged in the prepare view (from README, not verified).
- The GM deals, places the next card on a slot and flips cards one at a time; players only see revealed cards, and position names and GM notes stay on the GM's browser (README; dealing was done, but placing, flipping and showing to players were not tried, so those parts are not verified).
- Ships no artwork (cards are drawn in CSS). The GM can rename each card and give it an image (Customize cards > Edit cards, or Import a folder with files named after the card).
- English and French. Works with any game system.

## Where its UI is

- Verified: a scene control group "Tarokka Reading" (diamond icon, `tarokka`) with one tool, "open", in the left toolbar, GM only. Our bridge adds its own separate `aiTool` control group.
- Buttons **Prepare**, **New reading**, **Show to players** inside the window (footer hint: Click "New reading" to deal the cards). **Stop showing** appears once shown (not verified).
- Historic (D-130): our bridge used to show a dialog "Offer this reading to the AI Tool?" after **New reading**. That dialog and the import are gone; our own Tarokka table replaces this module.
- **Settings > Module Settings > Tarokka Reading > Customize cards** (GM only menu) for names and images.
- Players get the reading window opened automatically while the GM has "shown" it (also at their login if it is currently shown).

## Settings we use and why

Game Settings has a "Tarokka Reading" category with one entry, the `cardsConfig` menu; its state lives in four hidden settings (key `tarokka-reading.<key>`). Live: after New reading the dealt reading sat in the browser's localStorage key `tarokka-reading.secret` (5 cards; keys id, broadcast, cards, stages), while the world setting `reading` stayed empty (no positions, broadcast false) until cards are shown to players:

| Key             | Scope  | Holds                                  | Notes                                                     |
| --------------- | ------ | -------------------------------------- | --------------------------------------------------------- |
| `secret`        | client | `{id, broadcast, cards[5], stages[5]}` | the full dealt reading, only in the dealing GM's browser  |
| `plan`          | client | `[{cardId, note}] x5`                  | prepared choices and GM notes, same browser               |
| `reading`       | world  | `{id, broadcast, positions[]}`         | the public part: only revealed cards, shared with players |
| `cardOverrides` | world  | `{cardId: {name, image}}`              | the GM's renamed cards and images                         |

We change nothing in these. Use the Customize cards menu for names and images. Recommended before play: decide which GM browser deals (see gotchas) and keep to it.

## How it interacts with the AI Tool

Our feature has its own built-in roll (3 common + 2 high cards, crypto random) and a vault store; this module is one optional source.

Kit scenario: none yet, none earned (the existing Tarokka kit steps cover our side; the module's reading lives in browser storage and needs a live GM browser, so it cannot run headless).

**What we read from it** (read-only, `packages/foundry-module/src/tarokka.ts`, constant `TAROKKA_READING_MODULE`):

- `game.modules.get('tarokka-reading')` for installed, active and version (1.x only; any other major is refused).
- Client settings `secret` and `plan`, and world setting `cardOverrides`, through `game.settings.get`. Card ids, stages (hidden, placed, revealed), the GM note per slot, and the card name (override, else its `TAROKKA.Cards.<id>` localization).
- No journals, flags or items are read from it: the module creates none.
- A `clientSettingChanged` hook (`main.ts`) watches `tarokka-reading.secret`. When a new reading is dealt in a GM browser and our `tarokka` feature switch is on, a dialog asks the GM once whether to offer it to the AI Tool. Declining or confirming is logged (`module.tarokka.offer-*`).

**What we write, and where** (never into this module's settings):

- Bridge vault, GM only, outside Foundry: `gm/tarokka.json` (current reading plus archive), `gm/tarokka-config.json` (card links and name overrides), `gm/reveals.json` (pages we published).
- Foundry world: only on `plan-tarokka-reveal`, a journal page for the players (GM-typed text, observer ownership; may create a reveal journal). Those are separate from this module's players-window reveal.
- Tools: `get-tarokka-reading`, `plan-tarokka-import` (`source`: auto, builtin-roll, tarokka-reading), `suggest-tarokka-links`, `plan-tarokka-links`, `plan-tarokka-reveal` (prep set, `tool-sets.ts`); window and dashboard drawer "Import from tarokka-reading" button. Every write is a guarded plan, feature `tarokka`, off by default.

**Survives the module's own hooks?** Yes: it never touches our vault or reveal pages, and we never touch its settings. Card names in our summaries are kept out of the live feed by design (card names appear only in plan diffs and the GM reading view).

**Nothing is needed in `foundry-mcp-bridge` settings** beyond the Tarokka feature switch ("AI Tool: Tarokka (writes)").

## Gotchas on Foundry 14 / dnd5e 6

- The hidden settings are internal, not an API. A module update that renames `secret`, `plan` or the card ids silently breaks import; our code refuses any version that is not 1.x. Do not update past 1.x without re-running the Tarokka kit steps.
- `secret` and `plan` are client-scope, i.e. browser storage (localStorage) for that GM. A different browser, a cleared cache or a private window loses the reading before it is imported. Import it into the vault straight after dealing. `get-tarokka-reading` can ask another active GM client with the `userId` argument.
- A headless Assistant GM (or the Pi) cannot deal; it only receives an offer from a live GM browser. The reading window itself needs a GM in a normal browser.
- Foundry 14: the toolbar code handles both the old array and the new object form of `getSceneControlButtons` (from source); the diamond control group does show up on 14.368 (verified).
- Do not mix up the two reveals: the module's "Show to players" flips cards on the players' screens; our `plan-tarokka-reveal` publishes a journal page. Use one, or both on purpose.
- Removing the module leaves `tarokka-reading.*` rows in world and user settings (harmless). Our vault readings stay.
- Card images you import are your files; no artwork or book text is in this module.

## Sources

- <https://github.com/Stphn-Wrn/tarokka-reading> (MIT), `README.md`, `module.json`.
- `C:\FoundryTest\data\Data\modules\tarokka-reading\src\` (`main.js`, `state.js`, `reading.js`, `deck.js`, `cards.js`).
- Repo: `packages/foundry-module/src/tarokka.ts`, `tarokka-window.ts`, `main.ts`; `packages/mcp-server/src/tarokka/service.ts`, `deck.ts`, `tools/tarokka.ts`, `tool-sets.ts`; `docs/gm/features.md`, `docs/gm/getting-started.md`, `docs/gm/cookbook.md`, `docs/dev/ARCHITECTURE.md`.
