# DDB-Importer (`ddb-importer`)

Not verified live: drafted from the module's manifest, docs and source on disk, 2026-10-27; live check pending.

**Verdict: optional.** A content-build tool for this PC only: it needs the owner's D&D Beyond login cookie, it never goes to the Pi, and it is not part of any kit profile or table session.

**For Danni's guides:** DDB-Importer pulls your D&D Beyond characters and books into Foundry; you do not need it at the table, our server already has the finished content.

## What it does

Version 7.5.9 by MrPrimate. It imports from dndbeyond.com into Foundry: characters, spells, items, monsters ("munching"), encounters, adventures and books. It talks to D&D Beyond through a proxy; the browser holds the login cookie. The manifest asks for Foundry 14.367 and dnd5e 6.0.3 (6.0.99 at most), and recommends `auraeffects`, `tokenizer-2` and `vision-5e`. It uses sockets and persistent storage; it ships no compendium packs itself.

Our use, from the vault note `Dev/Foundry AI Tool/Design/Content module build plan.md`: the content module was filled by importing spells, monsters, items, adventures, books and characters on this PC (class data is covered by the content module itself). Adventure Muncher (a separate tool) builds the book packages that DDB-Importer then imports.

## Where its UI is

- A DDB-Importer settings category in Game Settings with the proxy, cookie and compendium options (not verified).
- Import buttons on the actors, items, journals and compendium directories, and a "Munch" panel for bulk import (setting "Munch button be at the top?") (not verified).
- Character sheet import button for single characters (not verified).
- A Compendiums settings window ("DDB Importer Compendium Settings") that warns when two entity types share one compendium and can create the missing ones.

## Settings we use and why

Keys are `ddb-importer.<key>`. Names come from `lang/en.json`.

| Label                                                      | Key                                   | Notes                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DDB Cobalt Cookie                                          | `cobalt-cookie`                       | The D&D Beyond login. As a world setting every player can read it. Keep it in the browser instead (`cobalt-cookie-local`) and clear this one (not verified which our PC uses). The preflight scan flags it                                              |
| Use the D&D Beyond login from the DDBI Utilities Extension | `cobalt-extension`                    | Ask / Always / Never. Alternative to pasting the cookie                                                                                                                                                                                                 |
| Patreon Supporter Key                                      | `patreon-key`                         | Secret. Flagged by the scan as `beta-key` and `patreon-user` too                                                                                                                                                                                        |
| Use a custom proxy?                                        | `custom-proxy`                        | Our PC runs a local proxy (patched copy that keeps the cookie out of its logs), bound to 127.0.0.1 only (`docs/dev/PI-SETUP.md`, licensed content)                                                                                                      |
| Auto create compendiums if not present?                    | `auto-create-compendium`              | Leave default (not verified)                                                                                                                                                                                                                            |
| Compendiums                                                | `entity-<type>-compendium`            | One per type: adventure, background, class, effect, feat, item, journal, monster, override, species, spell, summons, table, vehicle. Values are pack names, not secrets; the Pi push lets them through with `-AllowSettingKeys 'ddb-importer.entity-*'` |
| Monster Spell Version                                      | `munching-policy-force-spell-version` | Chooses 2024 or original-rules spells for monsters (not verified which we use)                                                                                                                                                                          |

## How it interacts with the AI Tool

- **Safety:** `packages/foundry-module/src/preflight-scan.ts` reports `ddb-importer.cobalt-cookie`, `ddb-importer.beta-key` and `ddb-importer.patreon-user` when they hold a value, because a world setting is readable by players. The pre-flight tool (`get-preflight`) shows it.
- **Push to the Pi:** `push-world.ps1` refuses `ddb-importer` entirely and stops on any setting name that looks like a secret. It never leaves this PC.
- **Data it leaves behind:** imported documents carry `flags.ddb`. The Pi stage strips that metadata (Foundry never loads it).
- **Re-run cleanup after every import:** per the build-plan note, a D&D Beyond import adds 2024 Player's Handbook spells and items back into our content module; the cleanup chain (`phbWins`, `repairDroppedLinks`, `verify`) puts it back. Adventure Muncher also writes monsters' "came from" link as their own id; that was repaired by name.
- No bridge tool calls it. Admin tools `get-modules` and `get-module-errors` list it like any module.

## Gotchas on Foundry 14 / dnd5e 6

- The manifest pins Foundry 14.367 and dnd5e 6.0.x exactly; a dnd5e update can break it.
- Importing a D&D Beyond character with no species fails silently: the armour class step reads the species name, throws, and leaves an empty "New Actor". Give the character a species on D&D Beyond first (build-plan note, 2026-10-03).
- The cookie can be lost when the browser pane's storage is cleared; the note records restoring `ddb-cobalt-cookie` from the local proxy setup (not verified how it is set today).
- Upstream's proxy logs the cookie; use only our patched copy and check any log for the cookie before reading it (CLAUDE.md).
- Not a kit profile: nothing in the test kit enables it. Linux/Pi: not installed, by rule.
- Buying the adventure on D&D Beyond is needed before it can be imported (build-plan note); no content is stored in this repo.

## Sources

- Manual: https://docs.ddb.mrprimate.co.uk ; repo https://github.com/MrPrimate/ddb-importer
- `C:\FoundryTest\data\Data\modules\ddb-importer\module.json`, `lang/en.json`; setting keys by grep in `dist/main.mjs` (data folders not read)
- `packages/foundry-module/src/preflight-scan.ts`, `docs/dev/PI-SETUP.md` (licensed content), vault `Content module build plan.md`
