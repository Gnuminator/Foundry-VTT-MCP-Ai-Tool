# Changelog

## v0.16.1 (2026-06-15) — Dependency-security patch

Patches the shipping network/runtime dependencies ahead of the Phase 6 remote-access work. **No behavior
changes for existing installs** — the Foundry module id and all wire contracts are unchanged.

### Security / dependency fixes

- **werift 0.17.7 → 0.23.0** (the WebRTC stack for the HTTPS/remote Foundry link) — clears the `uuid`
  bounds-check advisory. The only breaking dependency bump; **validated live** against a real Foundry
  world (Foundry 14, HTTPS) over the WebRTC DataChannel.
- **@modelcontextprotocol/sdk 1.7 → 1.29** (DNS-rebinding / ReDoS), **axios 1.6 → 1.18** (SSRF / ReDoS),
  **ws 8.14 → 8.21**, plus `body-parser`, `path-to-regexp`, and the dashboard's **express 4.19 → 4.22** —
  all in-range and behavior-preserving.
- Removed an unused `socket.io-client` dependency from the Foundry module.
- Production-only `npm audit`: **15 → 3** advisories (the remaining 3 are a single upstream-unpatched
  `ip` advisory inside the WebRTC ICE stack, with no fix available).

### Build / CI

- Bumped `actions/setup-node` to `20.19` across the release workflows (clears EBADENGINE; the shipped
  runtime still targets Node 18).

## v0.16.0 (2026-06-15) — First release as **Foundry AI Tool**

This is the first release under the project's new identity. **Foundry AI Tool** is an MCP server +
Foundry VTT module (plus an original co-GM dashboard) that gives AI models live access to a Foundry
game. It began as a fork of [adambdooley/foundry-vtt-mcp](https://github.com/adambdooley/foundry-vtt-mcp)
(MIT) and has since been detached into its own standalone project, trimmed to **Windows + D&D 5e**, and
reimplemented behind stable contracts. See [CREDITS.md](CREDITS.md) for upstream attribution.

### No breaking changes for existing installs

The Foundry module **id is unchanged** (`foundry-mcp-bridge`), as are the socket channel, settings
namespace, and query method names — so an existing install keeps working and upgrades in place. The
only thing that moved is the **home repository**: releases now come from
[Gnuminator/Foundry-VTT-MCP-Ai-Tool](https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool), not the
old `Gnuminator/Foundry-VTT-MCP` fork. To receive updates from the new repo, reinstall once from the new
manifest — see **Migrating from the old repo** below.

### New identity & project structure

- Renamed to **Foundry AI Tool**; standalone repository (no longer a GitHub fork), clean history, new
  README/CREDITS/LICENSE attribution.
- npm scope is now `@gnuminator/*` (`@gnuminator/shared`, `@gnuminator/mcp-server`,
  `@gnuminator/foundry-module`, `@gnuminator/cogm-dashboard`).
- Authored `docs/ARCHITECTURE.md` describing the system from first principles (the MCP tool surface, the
  Foundry-link socket bridge, the JSON-lines control channel, the D&D 5e system adapter, the job queue,
  GM-gating, and the standalone co-GM dashboard).

### Scope trim — Windows + D&D 5e only

- **Removed non-D&D system adapters** — PF2e, DSA5 (Das Schwarze Auge 5), WFRP4e, and Cosmere RPG, along
  with their system-specific tools (e.g. the DSA5 archetype character creator) and registry
  registrations. The **D&D 5e** adapter remains cleanly behind the system-registry abstraction.
- **Removed macOS support** (Windows-targeted: NSIS installer + standalone server ZIP).

### Reimplementation behind stable contracts

- Reimplemented the `shared` types/schemas/constants and codified both wire protocols
  (control-channel + Foundry-link frames) in `shared/src/protocol.ts`, with the frozen wire identifiers
  preserved byte-for-byte and a parity/contract-guard test suite wired into CI.
- Migrated the control-channel endpoints (dashboard client, stdio wrapper, backend control server) onto
  the shared protocol contract; deduped the WebRTC chunking constants to a single canonical source.
- Shrank and cleaned the Foundry module's `data-access` layer (stripped all non-D&D remnants + dead
  code).
- Brought the MCP tool layer and the D&D 5e adapter under comprehensive test coverage — **1078 tests
  total** (mcp-server 1017, shared 49, foundry-module 12) — as a parity net.

### Co-GM dashboard

- The original co-GM control surface (live session feed + GM control panel: combat panel, generic tool
  runner, backend proxy, confirm-gated writes) ships as `packages/cogm-dashboard` — original work, not
  derived from upstream.

### Tooling

- Single canonical release workflow (`build-complete-release.yml`): Windows NSIS installer + standalone
  MCP server ZIP + Foundry module ZIP + GitHub Release + Foundry package-registry update, on tag push.
- CI runs build + the three unit suites + schema smoke test + manifest validation on every push.

### Migrating from the old repo

If you have a previous version installed from `Gnuminator/Foundry-VTT-MCP`, your module keeps working —
but Foundry checks the **old** repo for updates, because that URL is baked into the installed manifest.
To switch to the new repo so future updates come from here, see
[docs/MIGRATION.md](docs/MIGRATION.md) for the one-time reinstall steps. No data migration is required.

---

## Historical releases (pre-detach upstream lineage)

> ⚠️ The entries below predate the detach, the rename to **Foundry AI Tool**, and the **D&D 5e-only**
> trim. They describe the upstream-derived fork and reference systems that have since been **removed**
> (PF2e, DSA5, WFRP4e, Cosmere RPG) and macOS support that is no longer included. They are kept for
> historical lineage only — see the v0.16.0 entry above for what the current release actually contains.

## v0.8.2 (2026-06-07)

### New Features

- **D&D 5e NPC Creation Suite** (PR #41 by @LManfre)
  - `dnd5e-create-npc` — build a full NPC stat block from scratch (abilities, saves, skills, senses, AC/HP, CR)
  - `dnd5e-add-feature` — one tool with modes: `passive`, `save`, `attack`, `attack-with-save`, `aura`, `spellcasting`, `spells`
  - `dnd5e-add-features-from-compendium` — bulk-import features/spells from compendium packs
  - Targets the dnd5e activities data model (4.x/5.x)

- **WFRP4e (Warhammer Fantasy Roleplay 4e) System Support** (PR #53 by @nyoung)
  - Character extraction: 10 characteristics, wounds, fate/fortune, resilience/resolve, corruption, career/species/class, skills, and arcane/divine spellcasting
  - `get-character` / `list-characters` / `search-character-items` now work on WFRP4e worlds

### Fixes

- **macOS installer** (PR #54): the Claude Desktop config is now merged rather than overwritten, preserving any other configured MCP servers; more robust logged-in-user detection; postinstall scripts no longer abort on a non-critical failure; additional Foundry data-dir locations probed
- **Node 26 install failure** (Issue #51, reported by @frankyh75): removed the unused `better-sqlite3` dependency, which failed to build against Node 26's V8 ABI

---

## v0.6.2 (2025-12-03)

### New Features

- **Spellcasting Data Extraction** (Issue #14)
  - `get-character` now returns full spellcasting entries with spell lists
  - PF2e: Spellcasting entries with traditions, DC, attack, slots, prepared/expended status
  - D&D 5e: Class-based spellcasting with spell slots and prepared spells
  - DSA5: Zauber (spells), Liturgien, Zeremonien, Rituale with AsP/KaP tracking
  - **Spell Targeting Info**: Each spell now includes `range`, `target`, and `area` fields
    - D&D 5e: Range (Self/Touch/60 ft), target type (1 creature/self/area), area template
    - PF2e: Range, descriptive target, area type (emanation/cone/burst)
    - DSA5: Reichweite, Zielkategorie, Wirkungsbereich

- **Use Item Tool** (`use-item`)
  - Cast spells, use abilities, activate features, consume items
  - Works across systems: D&D 5e, PF2e, DSA5
  - Supports spell upcasting (D&D 5e)
  - Proper resource consumption (spell slots, charges, consumables)
  - GM-only with character targeting
  - **Target Selection**: Specify targets by name or use `["self"]` to target caster
    - Example: "Have Clark cast Magic Missile on the Goblin"
    - Example: "Have Vitch use a healing potion on himself"
    - Targets set via Foundry's targeting system before item use

- **Search Character Items Tool** (`search-character-items`)
  - Token-efficient item search within a character's inventory
  - Filter by type (weapon, spell, feat, equipment, etc.)
  - Filter by category (items, spells, features, all)
  - Text search across item names and descriptions
  - Returns compact results without full descriptions

---

## v0.6.1 (2025-12-03)

### New Features

- **DSA5 System Support** (PR #12 by @frankyh75)
  - Full SystemAdapter implementation for Das Schwarze Auge 5
  - Supports all 8 Eigenschaften (MU/KL/IN/CH/FF/GE/KO/KK)
  - LeP, AsP, KaP resource tracking
  - DSA5-specific filters: level, species, culture, size, hasSpells
  - DSA5IndexBuilder for creature compendium indexing
  - DSA5 character creation from archetypes

- **Token Manipulation Tools** (PR #13)
  - `move-token` - Move tokens with optional animation
  - `update-token` - Update visibility, disposition, size, rotation, elevation
  - `delete-tokens` - Bulk token deletion
  - `get-token-details` - Detailed token info with linked actor data
  - `toggle-token-condition` - Apply/remove status effects (prone, poisoned, etc.)
  - `get-available-conditions` - List system-specific status effects

- **Character API Optimization** (PR #9)
  - Lazy-loading: `get-character` now returns minimal item metadata (no descriptions)
  - New `get-character-entity` tool for on-demand full entity details
  - Removed 20-item limit - now returns ALL items
  - ~37% token reduction per character
  - PF2e: traits, rarity, level, actionType
  - D&D 5e: attunement status

### Improvements

- **Documentation** (PR #8)
  - Clarified search-compendium limitations (name-only search, heuristic filters)
  - Directed users to list-creatures-by-criteria for accurate filtering

---

## v0.4.17 (2025-09-09)

- Wrapper/backend architecture: convert MCP entry to a thin stdio wrapper that proxies to a singleton backend over `127.0.0.1:31414`.
- Backend singleton + lock: backend binds Foundry connector on `31415` and creates `%TEMP%\foundry-mcp-backend.lock`.
- Startup race fix: resolves Claude Desktop duplicate-start race by keeping wrappers alive and ensuring only one backend owns ports.
- Runtime stability: backend now bundled (`dist/backend.bundle.cjs`) and preferred by wrapper for reliable startup in installer environments.
- Shared package now emits JS + d.ts, ensuring runtime availability for both dev and installer.
- Logging: wrapper writes to `%TEMP%\foundry-mcp-server\wrapper.log`; backend logs to `%TEMP%\foundry-mcp-server\mcp-server.log`.
- Installer: enhanced staging to include full server `dist`, bundled wrapper `index.cjs`, bundled backend, and `node_modules/@foundry-mcp/shared`.
- Build scripts: added root convenience scripts (`build:release`, `bundle:server`, `installer:stage`); NSIS script accepts `--skip-download` and `--skip-nsis` for staging-only runs.

Notes

- No changes needed for CI; existing workflows continue to build bundles and the installer.
- Foundry MCP Bridge port remains `31415`. Control channel is `31414` (internal wrapper↔backend only).
