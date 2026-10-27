# Tarokka Reading (`tarokka-reading`)

Not verified live: drafted from the module's manifest, docs and source on disk, 2026-10-27; live check pending.

**Verdict: keep.** Version 1.0.5 declares Foundry 11 to 14 (verified 14), has no dnd5e-specific code, and is the table-facing half of the reading: the dealing, face-down cards and one-by-one reveal at the table. Our own feature does not replace that; it stores, links and reveals text. The AI Tool reads the module only through its internal settings, which is the fragile part (1.x only), so pin the version.

**For Danni's guides:** This is the card table for the Tarokka reading: you deal five cards face down and flip them one at a time while the players watch the same screen.

## What it does

- Five-card cross: Tome, Symbol, Sword (common deck), Ally, Enemy (high deck, "Crowns"). The GM picks cards in advance or leaves a slot random. Duplicates and wrong-deck picks are flagged in the prepare view.
- The GM deals (cards slide in face down), clicks a glowing slot to place the next card, clicks the card to flip it. Players only see revealed cards; position names and the GM notes stay on the GM's browser.
- Ships no artwork (cards are drawn in CSS). The GM can rename each card and give it an image (Customize cards > Edit cards, or Import a folder with files named after the card).
- English and French. Works with any game system.

## Where its UI is

- A diamond icon in the left scene toolbar, GM only (opens the reading window; module id `tarokka`).
- **Prepare**, **Show to players** / **Stop showing**, **New reading** inside that window.
- **Settings > Module Settings > Tarokka Reading > Customize cards** (GM only menu) for names and images.
- Players get the reading window opened automatically while the GM has "shown" it (also at their login if it is currently shown).

## Settings we use and why

None of its settings are visible config; its state lives in four hidden ones (key `tarokka-reading.<key>`):

| Key             | Scope  | Holds                                  | Notes                                                     |
| --------------- | ------ | -------------------------------------- | --------------------------------------------------------- |
| `secret`        | client | `{id, broadcast, cards[5], stages[5]}` | the full dealt reading, only in the dealing GM's browser  |
| `plan`          | client | `[{cardId, note}] x5`                  | prepared choices and GM notes, same browser               |
| `reading`       | world  | `{id, broadcast, positions[]}`         | the public part: only revealed cards, shared with players |
| `cardOverrides` | world  | `{cardId: {name, image}}`              | the GM's renamed cards and images                         |

We change nothing in these. Use the Customize cards menu for names and images. Recommended before play: decide which GM browser deals (see gotchas) and keep to it.

## How it interacts with the AI Tool

Our feature has its own built-in roll (3 common + 2 high cards, crypto random) and a vault store; this module is one optional source.

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
- Foundry 14: the toolbar code handles both the old array and the new object form of `getSceneControlButtons` (from source); the diamond showing up on 14 is (not verified).
- Do not mix up the two reveals: the module's "Show to players" flips cards on the players' screens; our `plan-tarokka-reveal` publishes a journal page. Use one, or both on purpose.
- Removing the module leaves `tarokka-reading.*` rows in world and user settings (harmless). Our vault readings stay.
- Card images you import are your files; no artwork or book text is in this module.

## Sources

- <https://github.com/Stphn-Wrn/tarokka-reading> (MIT), `README.md`, `module.json`.
- `C:\FoundryTest\data\Data\modules\tarokka-reading\src\` (`main.js`, `state.js`, `reading.js`, `deck.js`, `cards.js`).
- Repo: `packages/foundry-module/src/tarokka.ts`, `tarokka-window.ts`, `main.ts`; `packages/mcp-server/src/tarokka/service.ts`, `deck.ts`, `tools/tarokka.ts`, `tool-sets.ts`; `docs/gm/features.md`, `docs/gm/getting-started.md`, `docs/gm/cookbook.md`, `docs/dev/ARCHITECTURE.md`.
