# Dungeons & Dragons Player's Handbook (`dnd-players-handbook`)

Not verified live: drafted from the module's manifest, docs and source on disk, 2026-10-27; live check pending.

**Verdict: keep.** It is our source for the 2024 character rules: Actor Studio builds from its packs, and the AI Tool's rules search reads it first. It is licensed content; it stays on private servers and never in the repo.

**For Danni's guides:** This is the official 2024 Player's Handbook inside Foundry: the classes, species, backgrounds, feats and spells your players pick from.

## What it does

Version 2.2.0, the official 2024 Player's Handbook module (made by the Foundry team). It holds the book as a journal and the matching game data as compendium packs. It needs Foundry 13 or newer (verified 14) and dnd5e 5.1.9 or newer. It adds a script (`scripts/dnd-players-handbook.mjs`, with a journal sheet in `scripts/apps/journal-sheet.mjs`) and styles for the book layout. The module itself only stores a "Last Version" setting (`PHB.SETTING.VERSION`) to decide whether to show a changelog.

Packs (name, label, type; from `module.json`):

| Pack        | Label             | Type         | Holds                                                 |
| ----------- | ----------------- | ------------ | ----------------------------------------------------- |
| `content`   | Player's Handbook | JournalEntry | The book, shown as a table of contents                |
| `classes`   | Character Classes | Item         | class, subclass and feat items                        |
| `origins`   | Character Origins | Item         | species ("race"), background and feat items           |
| `feats`     | Feats             | Item         | feats                                                 |
| `spells`    | Spells            | Item         | spells                                                |
| `equipment` | Equipment         | Item         | gear and starting equipment                           |
| `tables`    | Roll Tables       | RollTable    | roll tables                                           |
| `actors`    | Actors            | Actor        | creature entries (summons and similar) (not verified) |

Ownership on every pack: Players are Observers, Assistant GMs are Owners.

## Where its UI is

- Compendium tab: the packs above, listed as `... [dnd-players-handbook]`. The `content` pack opens as a table-of-contents journal.
- Actor Studio's source picker lists these packs by that suffix.
- No settings screen of its own beyond the hidden version setting.

## Settings we use and why

Its own setting does not matter. What matters is which other tools point at it:

| Where        | Setting                                     | Value                                                                                                                                          | Why                                                                                                 |
| ------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Actor Studio | `foundryvtt-actor-studio.compendiumSources` | species and background from `origins`, class and subclass from `classes`, spells from `spells`, feats from `feats`, equipment from `equipment` | Our table keeps to the 2024 book; stage 13 sets the equipment source                                |
| AI Tool      | `rulesSearchPacks` (bridge setting)         | empty = default                                                                                                                                | An empty value searches `dnd-players-handbook` first, then `dnd5e`, then the `aitool-content` packs |

## How it interacts with the AI Tool

- `search-rules` and the rules-search data access read it by default (`DEFAULT_RULES_PACKAGES` in `packages/foundry-module/src/data-access/rules-search.ts`). Ordinary compendium tools (`list-compendium-packs`, `search-compendium`, `get-compendium-item`) read the packs like any other.
- Character creation happens in Actor Studio, which copies items from these packs onto new actors; those copies carry a "came from" link back to the pack, which the Obsidian Library and the content cleanup rely on.
- The Pi receives it as a private module (`aitool-content`, `dnd-players-handbook`, `foundryvtt-actor-studio` are the default private set in `docs/dev/PI-SETUP.md`); it is never put in the repo, the vault or a public release. The content module's cleanup makes the Player's Handbook win over D&D Beyond duplicates ("phbWins", vault build-plan note).
- Nothing here quotes the book. Guides and tools name packs, not rules text.

## Gotchas on Foundry 14 / dnd5e 6

- Manifest says dnd5e 5.1.9 or newer with no maximum, so dnd5e 6 is allowed. Foundry minimum is 13, verified 14.
- If Actor Studio shows each option twice, a dnd5e system pack is also ticked in the sources; untick it (`docs/gm/prepare-session-0.md`).
- Pack names end in `[dnd-players-handbook]` in pickers; the pack ids are `dnd-players-handbook.<name>`, which is how settings must spell them.
- Removing the module breaks every "came from" link and any Actor Studio source that names it (not verified for all cases).
- Licensed: a missing or damaged copy on the Pi means empty pickers for players; stage 11 copies the module from this PC.
- The module ships a `signature.json` (integrity data from the publisher); do not edit its files.

## Sources

- `C:\FoundryTest\data\Data\modules\dnd-players-handbook\module.json`, `lang/en.json`, `scripts/` and `styles/` (listing only; pack contents not read)
- `packages/foundry-module/src/data-access/rules-search.ts`, `docs/dev/PI-SETUP.md` (stage 13, private modules), `docs/gm/prepare-session-0.md` section 3, vault `Content module build plan.md`
