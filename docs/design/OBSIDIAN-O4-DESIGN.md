# Obsidian O4 design: Foundry mirrors and links

Status: **built and live-tested (2026-09-29, branch `claude/amazing-bardeen-q1x1q6`); results and
known limits in `OBSIDIAN-PLAN.md` "As built", O4.** Section 11's questions are answered with the
recommended defaults (recorded as decisions there); section 6.4 adds the P1 plugin compatibility
rules; section 9.1 records the lead's interface refinements.

**Build status (2026-09-29, second session; full gate green: typecheck, lint ratchet 7,656, build,
3,311 tests):** every chunk done. C5b: the pump is wired into `backend.ts` (started with the Foundry
link when `FOUNDRY_AI_OBSIDIAN_DIR` is set, stopped on SIGINT/SIGTERM, its status behind
`get-obsidian-mirror`); `mirror-canary.test.ts` and the scheduling and junction tests are written. C8:
the live test passed on the first PC's test server, "O4 as built" is in `OBSIDIAN-PLAN.md`. The table
below is the first session's hand-off, kept for the record.

**Build status (end of the first 2026-09-29 session; full gate green: typecheck, lint ratchet 7,656,
build, 3,297 tests):**

| Chunk                                                                                                                     | State                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 contract (`shared/src/export-index.ts`)                                                                                | done, tested                                                                                                                                                                                                                                               |
| C2 module query `getExportIndex` (`packages/foundry-module/src/export-index.ts`, registration, feature `obsidian-mirror`) | done, 186 tests; the per-rule ESLint recount of queries.ts/main.ts passed through the ratchet                                                                                                                                                              |
| C3 converter (`obsidian/html-to-md.ts`, `links.ts`, `md-escape.ts`)                                                       | done (written by the lead), 21 tests                                                                                                                                                                                                                       |
| C4 renderer (`obsidian/mirror-render.ts`, `mirror-paths.ts`, `render.ts` Home/status line)                                | done, 84 tests; lead fixes: mirror banner, no `fvtt_sig` on page notes                                                                                                                                                                                     |
| C5a `NoteWriter` extraction + scan (`note-writer.ts`, `mirror-scan.ts`)                                                   | done, 67 tests, extraction checked byte for byte                                                                                                                                                                                                           |
| C5b pump (`obsidian/mirror-pump.ts`, test fake `src/test-support/fake-export-index.ts`)                                   | written, 23 tests pass; **NOT wired into `backend.ts`** (the backend never starts it; `get-obsidian-mirror` reports `status: null`); **`mirror-canary.test.ts` not written**; the junction-escape and 10-minute-timer tests from the brief are not written |
| C6 settings and tools (`mirror-settings.ts`, `tools/obsidian-mirror.ts`)                                                  | done, 102 tests (94 tools)                                                                                                                                                                                                                                 |
| C7 `/open` route (`open-route.ts`, `public/open.*`)                                                                       | done, 32 tests, reviewed by the lead                                                                                                                                                                                                                       |
| C8 env, skill, docs                                                                                                       | `start.ps1` sets `FOUNDRY_AI_OPEN_BASE`; skill O4 checks drafted; CHANGELOG drafted; "O4 as built" in OBSIDIAN-PLAN not written                                                                                                                            |

**Next (in order, all done in the second session):** wire the pump in `backend.ts` (declare `let mirrorPump` before the C6 tools
block, `status: () => mirrorPump?.status() ?? null`, construct and start it inside the
`FOUNDRY_LINK_ENABLED` block when `obsidianVaultDir` is set, with `mirrorEnv.pollMs` and
`mirrorEnv.openBase`, and stop it in the SIGINT/SIGTERM handlers); write `mirror-canary.test.ts`
(section 8: vault canaries from `gm/tarokka.json`, `tarokka-config.json`, `audit.json`,
`audit-log.jsonl` and the secret terms never reach a mirror file; the opted-in page canary only in its
own page note; no `<%`); the missing pump tests; then the live test (the skill's "Obsidian mirror
checks (O4)", throwaway vault only) and "O4 as built" in `OBSIDIAN-PLAN.md`. C2's open doubts: the
watermark covers only requested kinds after filters and caps; a null modified time is always in
`since` results; `idsOnly` ignores `sinceModifiedTime`; Notes have no `_stats` in 14.368 (pin edits
change `sig`, not `modified`); a row over 2.5 MB is rebuilt without page text.

It details phase O4 of `OBSIDIAN-PLAN.md` (sections 3, 5, 6, 10 O4, 12 decisions 2 and 4) so that
Sonnet workers can build it in parallel chunks (section 9). Foundry facts were checked in the installed
Foundry 14.368 (`app/` = `C:\FoundryTest\app`, `app/package.json:91`) and dnd5e 6.0.5 (`dnd5e.mjs` =
`C:\FoundryTest\data\Data\systems\dnd5e\dnd5e.mjs`). Code citations are `file:line` on this branch.

## 0. Decisions at a glance

| Topic            | Decision                                                                                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What             | One note per world PC, NPC, scene, journal (an index note) and story item; page text only for opted-in journals                                                        |
| Where            | `Campaigns/<worldId>/AI Tool/Foundry/{PCs,NPCs,Scenes,Journals,Items}/`, then the Foundry folder path (I-100; flat before), plus `Foundry/_status.md`                  |
| Source           | New module query `getExportIndex` (GM client only, paged, byte budget)                                                                                                 |
| Change detection | Incremental: effective `_stats.modifiedTime` above a watermark, every 10 s. Reconciliation: a per-document signature (`sig`) for deletes, ownership, users             |
| State            | The notes are the state (`fvtt_uuid`, `fvtt_sig` properties); no new bridge-vault state file; settings in `gm/obsidian-mirror.json` via a guarded plan                 |
| Off by default   | Needs `FOUNDRY_AI_OBSIDIAN_DIR` AND `enabled: true` in the mirror settings (feature switch "AI Tool: Obsidian mirror (writes)", default off)                           |
| Names            | Sanitized name, id suffix only on a collision; the tool never renames a note, and moves one only when its folder changes (I-100); the current name goes into `aliases` |
| Links            | Markdown links in note bodies (decision 2); quoted wikilinks only inside properties (Obsidian resolves only those there)                                               |
| Open in Foundry  | `GET /open?uuid=` serves a static confirm page; `POST /api/open` acts; the GM token stays in the dashboard's localStorage, never in a URL                              |
| `player_visible` | Advisory for the GM only (same rules as M2); never used to pick what players get                                                                                       |

## 1. Wire contract and the module query

### 1.1 Contract file

New `shared/src/export-index.ts` (re-exported from `shared/src/index.ts`). The module never imports it at
runtime (`browser-imports.test.ts`); it imports the types and mirrors the constants, pinned by a contract
test like `player-visibility.contract.test.ts`.

```ts
export const EXPORT_INDEX_QUERY = 'getExportIndex'; // wire: foundry-mcp-bridge.getExportIndex
export type ExportKind = 'actor' | 'scene' | 'journal' | 'item';
export type PlayerAccess = 'none' | 'limited' | 'observer' | 'owner';
export const DEFAULT_STORY_ITEM_TYPES = [
  'weapon',
  'equipment',
  'consumable',
  'tool',
  'loot',
  'container',
];
export const FOUNDRY_UUID_SOURCE =
  '^(?:Compendium\\.[\\w-]+\\.[\\w-]+\\.)?[A-Z][A-Za-z]+\\.[A-Za-z0-9]{16}(?:\\.[A-Z][A-Za-z]+\\.[A-Za-z0-9]{16})*$';

export interface ExportIndexRequest {
  kinds?: ExportKind[]; // default: all four
  sinceModifiedTime?: number; // server ms; entries whose effective modified time is greater
  uuids?: string[]; // fetch exactly these top-level docs (max 500); ignores since
  idsOnly?: boolean; // reconciliation mode: ExportIdEntry rows only
  includeText?: { folderIds: string[]; journalIds: string[] }; // journals whose page text is sent
  excludeFolderIds?: string[]; // never export docs in these folders (subfolders included)
  storyItemTypes?: string[]; // default DEFAULT_STORY_ITEM_TYPES
  after?: string | null; // paging cursor from the previous response
  limit?: number; // entries per page (see 1.4)
}
export interface ExportIndexResponse {
  success: true;
  schema: 1;
  worldId: string;
  clientId: string; // random per module page load (a reload means: reconcile)
  watermark: number; // max effective modified time over ALL exportable docs at call time
  usersSignature: string; // hash of every user's id, role and banned flag
  entries: ExportEntry[] | ExportIdEntry[];
  next: string | null; // cursor "<kind>:<id>" of the last entry, null when done
  truncated: Array<{ kind: ExportKind; total: number; cap: number }>;
  buildMs: number;
}
export interface ExportIdEntry {
  uuid: string;
  kind: ExportKind;
  sig: string;
  modified: number | null;
}
```

`FOUNDRY_UUID_SOURCE` is the pattern `gm-helper-queries.ts:44-45` already enforces for `open-in-foundry`; the
dashboard compiles it for `/api/open`, the module keeps its copy (contract test pins both). The contract
also holds the `/open` types (6.3).

### 1.2 Entries per kind

Common fields on every entry (`ExportEntryBase`): `uuid`, `id`, `kind`, `name` (the source name, see items),
`folder: {id, path: string[]} | null` (names root to leaf via `Folder#ancestors`, `client/documents/folder.mjs:104`),
`created`, `modified` (effective, 1.3), `sig` (1.5), `playerAccess`, `playerVisible` (section 4),
`rules: '2014' | '2024' | null` (`readRulesTag`, else `detectRulesVersion`, `rules-version.ts:63-93`; null for
scenes and journals).

| Kind                                                                                                       | Extra fields (all read from documents the GM client already holds)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actor` (types `character`, `npc`; vehicles and groups are skipped)                                        | `pc` (= `hasPlayerOwner`, `client-document.mjs:163-165`, the M2 rule), `actorType`, `owners` (names of non-GM users with OWNER), `hpMax`, `ac`, `size`, `alignment`, `disposition` (prototype token: `secret`/`hostile`/`neutral`/`friendly`, `common/constants.mjs:1151`), `tokenName` and `playerName` (the prototype token's name when its display mode shows it, else `Unknown creature`: the M2 rule, `player-visibility.ts:120-125`). Character: `level` (`system.details.level`, summed from class items, `dnd5e.mjs:84236-84239`), `classes: [{name, levels, subclass}]` (`Actor5e#classes`, `dnd5e.mjs:42578`), `species`, `background`. NPC: `cr` (`system.details.cr`, `dnd5e.mjs:85296`), `creatureType` (`system.details.type`, `dnd5e.mjs:85288`), `sourceBook`. Both: `features: [{name, type}]` (embedded item names only, max 80) and `notableItems` (magical or uncommon and rarer, `{name, sourceUuid}`), `sourceUuid` (what the actor was made from: `_stats.compendiumSource`, else `duplicateSource`, never the actor itself; an NPC note links it; absent from older modules) |
| `scene`                                                                                                    | `navName`, `navigation` (`common/documents/scene.mjs:70-72`), `journal: {uuid, pageUuid} \| null` (`scene.mjs:158-159`), `pins: [{label, entryUuid, pageUuid}]` from map Notes (`note.mjs:45-57`, max 300). No tokens, no lighting, no `active` (all volatile).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `journal`                                                                                                  | `categories: [{id, name, sort}]` (`journal-entry.mjs:48`), `textIncluded` (opt-in hit), `pages: ExportPageEntry[]` (max 1,000): `uuid`, `id`, `name`, `type` (core `text`/`image`/`pdf`/`video` plus dnd5e types, `journal-entry-page.mjs:32,48`), `category`, `sort`, `modified`, `playerAccess`, `playerVisible`, and only when `textIncluded`: `text: {format: 'html' \| 'markdown', content, truncated}` from `text.content` / `text.markdown` (`journal-entry-page.mjs:57-61`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `item` (world `game.items` of the story types only; never embedded, compendium, spells, features, classes) | `itemType`, `rarity` (dnd5e 6 keeps `system.rarities`, a set, and `system.rarity` is a getter for the lowest, `dnd5e.mjs:29525,29630`; reading the getter works on 5.x too), `attunement` (`dnd5e.mjs:29240`), `magical` (`properties.has('mgc')`), `identified` (`dnd5e.mjs:29397`), `playerName` (dnd5e overwrites the prepared `name` with the unidentified name on every client, `dnd5e.mjs:29437-29439`, so `name` comes from `_source.name`), `holders: [{uuid, name, match: 'source' \| 'name'}]` (actors whose embedded item has `_stats.duplicateSource` or `compendiumSource` equal to this item's uuid, else the same name for magical items; max 20)                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### 1.3 Effective modified time

`_stats.modifiedTime` is a server-managed field (`common/data/fields.mjs:4043`, managed list `:4070`); the
server stamps it in `_tagStats` on the document it commits (`app/dist/database/backend/server-document.mjs`,
minified). Embedded documents carry their own `_stats` (`journal-entry-page.mjs:77`). Whether an embedded
update also moves the parent's time is not visible in the client source, so the design never depends on
it. The module computes an **effective** time per exported doc:

| Kind    | Effective modified time = max of                                                       |
| ------- | -------------------------------------------------------------------------------------- |
| actor   | the actor, its embedded items, its folder chain                                        |
| scene   | the scene, its embedded Notes, its folder chain (never tokens: they move all the time) |
| journal | the journal, its pages, its categories, its folder chain                               |
| item    | the item, its folder chain, the embedded items that make up `holders`                  |

HP ticks during combat move an actor's time; the actor is re-sent, renders to the same text and is not
rewritten (3.5). Deletes of embedded documents and user role changes move no time at all: the signature
(1.5) catches them.

### 1.4 Paging and size limits

Order is fixed (kinds in the order actor, scene, journal, item; then id ascending), so the cursor
`"<kind>:<lastId>"` stays valid when documents are added or removed between pages. The backend query
timeout is 10 s (`foundry-connector.ts:402-405`). WebSocket frames are not chunked; the bridge's ws
server accepts frames up to the default 100 MiB `maxPayload`.

| Limit                  | Value                                                                             |
| ---------------------- | --------------------------------------------------------------------------------- |
| entries per page       | 200 default, 500 max (`idsOnly`: 5,000 default, 10,000 max)                       |
| response budget        | 512 KB of JSON; at least one entry; hard cap 2.5 MB                               |
| text per page          | 512 KB (`text.truncated: true` beyond)                                            |
| text per journal entry | 2 MB; later pages get `text: null, textOmitted: 'budget'`                         |
| `uuids` per request    | 500                                                                               |
| names, labels          | 200 characters                                                                    |
| world caps             | actors 5,000, scenes 1,000, journals 3,000, items 5,000 (reported in `truncated`) |

### 1.5 Signature

`sig` = cyrb53 (a 53-bit string hash, a few lines of pure JS; Foundry has no hash helper in
`common/utils/`) over the entry's exported fields except `modified` and `sig`, plus each text page's own
`modifiedTime` (never the text itself, which would cost time on every reconciliation). So `sig` changes
exactly when the note would change: a renamed page, a deleted pin, an ownership change, a new player user
(through `playerAccess`), a holder that dropped the item. The backend never computes a sig; it only
compares the module's value with the note's `fvtt_sig` property.

### 1.6 Gate

Registered in `bridgeHandlers` next to the M2 queries (`queries.ts:148-161`), never in `CONFIG.queries`
(`queries.ts:77-79`). Wrapped in `withGmGate` (`queries.ts:59-72`) **and** an explicit `game.user.isGM`
check in the body: unlike reads such as `listActors`, the export stays GM-client-only even when
`allowNonGmAccess` is on, because it enumerates every document and computes player access over
`game.users`. A non-GM client gets `{success: false, error: 'Access denied'}`.

### 1.7 Never exported

- Page text of journals that are not opted in (the `text` field does not exist on those pages).
- Actor biographies, item and feature descriptions, NPC action text, unidentified descriptions (adventure
  and official text; names only).
- Any `flags` (other modules keep state there; ours too), `system` fields not listed in 1.2, HP value and
  temp HP, conditions and effects, token positions and token lists, image and asset paths.
- Chat, combat, settings, users beyond owner names, compendium content (compendium links open in Foundry,
  section 5), and anything from the bridge vault (the backend adds only the M2 `revealed` flag, 3.3).

### 1.8 Opt-in configuration

Settings live in the bridge vault, `gm/obsidian-mirror.json` under the key `settings`, changed only through
the guarded flow (principle 7): tool `plan-obsidian-mirror` creates a vault-only plan (`vault-set`, the
pattern of `handouts/service.ts:253-270`) for the new guarded feature `obsidian-mirror`, registered in the
module next to `handouts` (`main.ts:71-81`, `guarded-features.ts:34-46`); the GM applies it with
`apply-planned-change` after seeing the diff; it is audited and can be undone.

```ts
interface MirrorSettings {
  schema: 1;
  enabled: boolean; // default false
  kinds: Array<'pc' | 'npc' | 'scene' | 'journal' | 'item'>; // default all five
  text: { folderIds: string[]; journalIds: string[] }; // default none (decision 4)
  excludeFolderIds: string[]; // default none; any kind
  storyItemTypes: string[]; // default DEFAULT_STORY_ITEM_TYPES
}
```

A text folder includes its subfolders (`Folder#getSubfolders(true)`, `client/documents/folder.mjs:364`;
depth is at most 4, `constants.mjs:548`). `journalIds` covers journals outside any folder. Why not a module
setting: world settings reach every client (CoS plan 2.1) and the choice is about the GM's vault, not the
world. Why not a note in Obsidian: a rendered or GM note is never read back as config (principle 1).

## 2. Backend: the mirror pump

New `packages/mcp-server/src/obsidian/mirror-pump.ts`, started in `backend.ts` beside the event and play-log
pumps (`backend.ts:550-581`) only when the Foundry link is on and `obsidianAutoRenderSettings().vaultDir` is
set (`auto-render.ts:31-36`). It writes notes itself through the shared `NoteWriter` (3.5); it does not go
through `ObsidianAutoRender`, which renders bridge-vault data and keeps working unchanged.

### 2.1 State

No new bridge-vault file. In memory: `watermark`, `clientId`, `usersSignature`, the settings hash, and the
note map `uuid -> {path, sig, insideFence}` built by the scan. The scan (`obsidian/mirror-scan.ts`) walks
`Campaigns/<worldId>/` (skips dot folders and `.trash`, uses `lstat` and never follows links), reads the
first 4 KB of each `.md`, and keeps notes with `generated_by: "foundry-ai-tool"`, a mirror `type` and an
`fvtt_uuid`. Prep notes also carry `fvtt_uuid` (`type: npc-prep`), so the scan records them separately as
`prep` links (3.3). A mirror note the GM moved outside `AI Tool/Foundry/` is recorded as "moved by the
GM": never written again, never duplicated, listed in `_status.md`. Two notes with one uuid: the one inside
the fence with a valid hash wins; the others are listed as duplicates.

### 2.2 Cycles

| Cycle       | When                                                                                                    | What                                                                                                                                                                                                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Incremental | every `FOUNDRY_AI_MIRROR_POLL_MS` (default 10,000, minimum 5,000)                                       | `getExportIndex({sinceModifiedTime: watermark - 2000, ...settings})`, all pages; render the entries; the new watermark is the **first** page's `watermark` (anything modified after that call is newer than it, so it is caught next cycle; the 2 s overlap covers equal timestamps; renders are idempotent); a failed cycle keeps the old watermark |
| Reconcile   | at start, when `clientId` or `usersSignature` changes, when the settings hash changes, every 10 minutes | `idsOnly` for all kinds; compare each `sig` with the note's `fvtt_sig`; fetch mismatches and new uuids with `uuids` (batches of 500); a uuid with a mirror note but no row is deleted in Foundry (2.3). A settings change forces every row to count as a mismatch                                                                                    |

At most one cycle runs at a time; pages are fetched one after another; a cycle that passes 60 s is
abandoned and retried at the next tick; reconciles run at most once per 60 s except after a settings
change. A response whose `worldId` differs from `worldIds.current()` resets the in-memory state. Errors
are logged once until they recover (the `PlayLogPump` pattern, `play-log-pump.ts:129-150`).

### 2.3 Deletions and renames

Foundry has no tombstones, so deletion is set arithmetic in the reconcile: every mirror note whose top-level
uuid is missing from the `idsOnly` rows goes to the vault `.trash/` when it is ours and unedited
(`moveToTrash`, `export.ts:252-271`), together with that journal's page notes; an edited one stays and is
listed as "deleted in Foundry, kept because you edited it". Page notes whose page no longer appears in a
freshly fetched journal entry, or whose journal lost its text opt-in, are trashed the same way. A document
renamed in Foundry keeps its note path; the H1, the `name` property and `aliases` change (3.4).

### 2.4 Status

The pump keeps a `MirrorStatus` (enabled, vault dir set, last cycle and reconcile times, counts per kind,
text pages, skipped, moved by the GM, duplicates, truncations, errors) for the read tool
`get-obsidian-mirror` and renders `AI Tool/Foundry/_status.md` after each cycle that changed anything (only
lasting facts, like `renderStatusNote`, `render.ts:871-903`). The O2 `AI Tool/_status.md` gets one fixed line
linking to it. Logs: `Obsidian mirror updated {written, created, trashed}` like `auto-render.ts:166-176`.

## 3. Notes

### 3.1 Paths

`Campaigns/<worldId>/AI Tool/Foundry/` with `PCs/`, `NPCs/`, `Scenes/`, `Journals/`, `Items/` (plan section 3
had `Actors/PCs`; one level less keeps Windows paths short). Journal text notes go to
`Journals/<journal file stem>/<page file stem>.md` next to the index note `Journals/<journal file stem>.md`.
Since I-100 a note sits below its kind folder in the document's Foundry folder path
(`Journals/Act 1/Vallaki.md`); when that path changes, an unedited note moves once, by rename,
its page notes with it, and an edited one stays (listed in `_status.md`). A PC that loses its player
owner stays in `PCs/` and its `type` becomes `npc` (the bases filter by tag, not by folder).

### 3.2 Common properties

Order (the `generatedProps` order, `render.ts:81-98`, which gains a `playerVisible` argument; today it
hard-codes `false` at `:92`): `type`, `fvtt_world`, `fvtt_uuid`, `fvtt_type` (documentName), `name`,
`folder` (path joined with `/`), the type's own properties, `aliases: [<current name>]`, `fvtt_modified`
(ISO of the effective time when the note content last changed), `fvtt_sig`, `player_access`,
`player_visible`, `rules`, `schema: 1`, `tags: [campaign/<worldId>, <type>]`, `generated_by`,
`generated_hash` (last). No `generated_at` (O2 keeps output deterministic). Every value goes through
`yamlScalar` (`render.ts:48-54`: JSON-quoted, Templater-neutralized).

### 3.3 Templates per kind

| `type`                            | Own properties                                                                                                                                                                                                  | Body (after the H1 and `GENERATED_BANNER`)                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pc`                              | `player` (owner names), `class` ("Fighter 3 / Rogue 1"), `level`, `species`, `background`, `hp_max`, `ac`, `stats`, `prep`                                                                                      | Open in Foundry link; Notable items (links to story item notes when `sourceUuid` matches); Features (names); links to the Stats note (`type: pc-stats` with the same `fvtt_uuid`) and the Prep note                                                                                                                                                                                                                                                                                                 |
| `npc`                             | `cr`, `creature_type`, `size`, `alignment`, `disposition`, `token_name`, `player_name`, `hp_max`, `ac`, `source_book`, `last_seen`, `prep`                                                                      | Open in Foundry; "Players see this creature as: …"; Features (names by type); Seen in (R4); Prep link. No statblock block in O4 (question 7)                                                                                                                                                                                                                                                                                                                                                        |
| `scene`                           | `nav_name`, `player_name` (what Foundry's navigation shows players: `navName` or else the true name, `scene-navigation.mjs:97`), `navigation`, `journal`, `pins` (count), `tokens` (count), `last_seen`, `prep` | Open in Foundry; a warning callout when the scene is navigable and has no `navName` ("players see the true name in the navigation bar"); the linked journal; map pins as links to journal or page notes; Who is here (the scene's tokens folded by world actor, name, disposition and hidden: a link to the actor's NPC or PC note labelled with the token name, the count, disposition and hidden in words); Seen in (R4: the sessions the scene appeared in, newest first); the Prep link (I-121) |
| `journal`                         | `pages`, `pages_player_visible`, `pages_revealed`, `text_mirrored`, `categories`, `prep`                                                                                                                        | Open in Foundry; pages grouped by category (`### <category>`), one list item each: link (to the page note when text is mirrored), page type, player access, "revealed" (M2 allowlist `gm/reveals.json`), then the block id `^p-<pageId>`; the Prep link (I-121)                                                                                                                                                                                                                                     |
| `journal-page` (text opt-in only) | `journal` (quoted wikilink to the index note), `page_type`, `revealed`, `sort`                                                                                                                                  | Open in Foundry; back link `[Journal](../<index>.md#^p-<pageId>)`; the converted text (section 5)                                                                                                                                                                                                                                                                                                                                                                                                   |
| `story-item`                      | `item_type`, `rarity`, `attunement`, `magical`, `identified`, `player_name`, `holders` (quoted wikilinks when a mirror note exists, else names)                                                                 | Open in Foundry; holders with how each was matched                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Properties never hold Markdown links: Obsidian resolves links in properties only as quoted wikilinks, so
`journal`, `holders`, `stats` and `prep` use `"[[<vault path without .md>|<name>]]"` (full vault path, so
they never depend on the note's own folder); bodies use relative Markdown links as O2 does
(`render.ts:223`). Path segments are percent-encoded (`encodeURIComponent` plus `(`, `)`), labels escaped
(section 5).

### 3.4 Names and collisions

- File stem = `safeFileName(name)` (`render.ts:108-118`: Windows-reserved characters and device names,
  link-breaking `# ^ [ ] | %`, 120 characters). Items use the source name, never the unidentified one.
- Uniqueness is per folder and case-insensitive (Windows and Obsidian), compared after Unicode NFC. The
  existing note map wins: a uuid that already has a note keeps its path forever. A new document takes the
  bare stem if free, else `<stem> (<last 6 of id>)` (the `pcStatsFileNames` rule, `export.ts:349-359`), else
  `<stem> (<full id>)`. New documents are placed in `(createdTime, id)` order so two runs pick the same.
- If the full path would pass 240 characters, the stem is cut (suffix kept).
- Never renamed by the tool: the GM's links to a note keep working (Obsidian only fixes links for renames
  made inside Obsidian). The current Foundry name is the H1, `name` and `aliases`, so search and the quick
  switcher find both names. The GM may rename or move a note inside `AI Tool/Foundry/`; the scan follows it
  by `fvtt_uuid`.

### 3.5 Ownership and writes

- `NoteWriter` moves out of `export.ts:126-272` into `obsidian/note-writer.ts` (same behavior, exported), so
  the mirror uses the same fence (`export.ts:147-154`), atomic writes, ownership checks and trash moves.
  New: before the first write of a run, `realpath` of `AI Tool/Foundry` must lie inside `realpath` of the
  vault (a junction there would otherwise escape the fence).
- A mirror note the GM edited fails `checkMarkdownOwnership` (`ownership.ts:72-85`), is never overwritten
  and is listed; a foreign file with a mirror's name is left alone. Deleting a mirror note brings it back at
  the next reconcile (like a base); to stop mirroring something, use `excludeFolderIds` or `kinds`.
- **No rewrite for a timestamp alone:** a note whose new text differs from the note on disk only in
  `fvtt_modified` is not written (the renderer compares with `fvtt_modified` blanked). HP churn therefore
  never rewrites an open NPC note (the auto-merge risk, plan risk 4).
- Writes yield every 50 notes (`setImmediate`), so a first run of 1,500 notes does not stall the backend.

### 3.6 Bases

Written by the mirror into `AI Tool/Bases/` (the O2 exporter does not prune that folder,
`export.ts:64-69`), compared by content (`baseOwnershipCheck`, `ownership.ts:185-192`): `PCs.base`,
`NPCs.base` (cr, creature_type, disposition, player_visible, folder), `Scenes.base` (nav_name, navigation,
player_visible, folder), `Journals.base` (pages, pages_player_visible, pages_revealed, text_mirrored,
folder), `Story items.base` (rarity, magical, identified, holders), and `Player visible.base` (every mirror
note with `player_visible` true: "what can players open in Foundry"). Filters use the known-good forms
`file.inFolder("Campaigns/<w>/AI Tool/Foundry")` and `file.hasTag("<type>")`. `renderCampaignHome`
(`render.ts:910-955`, created once) gains a Foundry section for new worlds; existing Homes are the GM's.

### 3.7 Adventure hubs and graph colours (I-105, 2026-10-06)

So the graph shows each adventure as its own cluster instead of one ball with the Library in it,
the mirror writes one hub note per adventure: `AI Tool/Foundry/Adventures/<folder>.md`, `type:
adventure-hub` (`adventure-hubs.ts`, `renderAdventureHub` in `mirror-render.ts`).

- **What counts as an adventure:** the first Foundry folder below a kind folder. Foundry keeps
  folders per document type, so an imported adventure has a folder of the same name for journals,
  scenes and actors; the hub joins them by name (case-insensitive). The name comes from each note's
  `folder` property (the Foundry folder names), not its path: a long name may be shortened in one
  kind's paths (deep chapter folders) and not in another's. A folder counts when it holds at
  least one journal note and one scene note. No setting yet; to keep a folder out of the mirror,
  `excludeFolderIds` still works.
- **Source:** the mirror's own note map (notes inside the fence), after each reconcile, right after
  the bases. No extra module query, no module change. New notes from an incremental cycle reach the
  hub at the next reconcile.
- **Body:** a count line, the book's Library hub (`Library/Books/<title>.md`, I-100) when a book
  title matches the folder name, then one section per kind (journals, scenes, NPCs, PCs, story
  items) with a relative link to every note, grouped by subfolder, at most 400 per section.
  Properties: `name`, `aliases`, `adventure_folders` (campaign-relative), `book`, `tags`, the
  ownership pair. No `fvtt_uuid`, so the scan ignores hubs.
- **Ownership:** as for other mirror notes (`checkMarkdownOwnership`): an edited hub is kept and
  listed. Hubs are written and trashed only after a complete scan (an incomplete one may miss
  notes). A hub whose adventure is gone moves to the vault trash; an edited one stays and is listed.
- **Graph colours:** the mirror never edits `.obsidian`. The design plugin has a button and command
  "Apply AI Tool graph colours" (`packages/obsidian-plugin/src/graph-colours.ts`): it reads the hub
  notes, builds one colour group per adventure (query: the hub path and its `adventure_folders`)
  and a grey group for `AI Tool/Library/`, and merges them into `.obsidian/graph.json` after the
  GM's own groups (first match wins in Obsidian, so the GM's groups win). Our groups are found by
  their query form, replaced on each run, and keep a colour the GM changed. Open graph views close
  first (Obsidian stores their options, a group the GM just added included), the merge starts from
  the graph plugin's live options when it is loaded (else `graph.json`), the plugin saves them, and
  one graph view opens again when any was open.

## 4. `player_visible`

"Players" are users with `!isGM`; banned users count as NONE and GMs as OWNER inside
`testUserPermission` (`common/abstract/document.mjs:407-415`). Levels come from Foundry itself
(`getUserLevel`, `document.mjs:386-395`: an embedded document with `INHERIT`, `-1`, uses its parent;
levels `constants.mjs:470-496`). `player_access` is the highest level any player holds.

| Kind        | `player_visible` is true when                                                                                                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| actor, item | some player has OBSERVER or more (the full sheet). LIMITED only shows in `player_access`                                                                                                                                                               |
| journal     | some player has OBSERVER on it (`JournalEntry#visible`, `client/documents/journal-entry.mjs:29-31`)                                                                                                                                                    |
| page        | some **single** player can observe the journal AND the page: exactly M2's rule, reused by exporting `playerAccess` from `player-visibility.ts:255-264` (renamed `pageAccessForPlayers`, no behavior change) so M2 and O4 cannot drift                  |
| scene       | `navigation` is on and some player has LIMITED or more (`scene-navigation.mjs:86`, `ClientDocument#visible` `client-document.mjs:240-243`); the active scene is always visible to players, which the note says in words instead of a churning property |

`player_visible` means "a player can open it in Foundry's UI". It never means the data is hidden from a
player: Foundry sends every document to every client (CoS plan 2.1). It is a GM aid only; O7 builds the
player vault from the M2 projection and never copies or filters mirror notes.

## 5. Page text: HTML to Markdown and the `@UUID` rewrite

Only pages of opted-in journals have text. The converter (`obsidian/html-to-md.ts`) parses with
`htmlparser2` ^10.1.0 (already vetted for the dashboard; v12 needs Node 20.19+; the floor is now Node 22, so
v12 is allowed) and **rebuilds** Markdown from an allowlist: headings, paragraphs, line breaks, bold, italic,
lists, blockquotes, simple tables (else paragraphs), `pre` (a fence one backtick longer than any run inside,
info string `text`), horizontal rules. `section.secret` becomes a collapsed `> [!secret]- GM secret`
callout (the GM vault may hold secrets, decision 3). Images become `[image: <alt>]`. No raw HTML is ever
written. Markdown-format pages (`text.markdown`) go through the same text escaping, not the parser.

Text nodes are escaped (`md-escape.ts`): `<` as `&lt;` (no raw HTML), `[[` and `![[` (no wikilinks or
embeds from data), backticks (no code spans or fences from data, so no Dice Roller `dice:` spans or
plugin blocks), `%%` (comments), `#` at a word start (no stray tags), `^` at a line end (no block ids), and
`<%` through `neutralizeTemplater` at the one choke point (`ownership.ts:32-34,63-69`).

Links in text nodes follow Foundry's own enrichers: content links
`@(Actor|Cards|Item|Scene|JournalEntry|Macro|RollTable|PlaylistSound|Compendium|UUID)[target#hash]{label}`
(`client/applications/ux/text-editor.mjs:203-204`, types `constants.mjs:515-516`), embeds
`@Embed[...]{label}` (`:218`), inline rolls `[[...]]` (`:249`), dnd5e `[[/check ...]]`, `[[lookup ...]]`,
`&Reference[...]` (`dnd5e.mjs:31931-31946`).

| Source                                                       | Written as                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@UUID[Actor.X]{L}` (also Scene, JournalEntry, Item)         | `[L](<relative path>)` when a mirror note exists; else `L` + `` `Macro.X` `` code (kinds not mirrored, excluded folders); else `L` + `` `Actor.X (not found)` ``                                                                                                      |
| `@UUID[JournalEntry.J.JournalEntryPage.P]{L}`                | the page note when text is mirrored, else the index note's block `…/Journal.md#^p-P`                                                                                                                                                                                  |
| `@UUID[.P]{L}`, `@UUID[..X]` (relative)                      | resolved against this page as Foundry does (`common/utils/helpers.mjs:1299-1305,1380-1420`), then as above                                                                                                                                                            |
| `@UUID[Actor.X.Item.I]`, `@UUID[Scene.S.Token.T]`, `…Note.N` | the parent's note (embedded documents have no note); the label keeps the embedded name                                                                                                                                                                                |
| `@UUID[Compendium.<pkg>.<pack>.<Type>.<id>]{L}`              | `[L](<base>/open?uuid=…)`: compendium content is never mirrored and opens in Foundry (plan section 6)                                                                                                                                                                 |
| a compendium actor that stands for a world NPC (all forms)   | the world NPC's note: the journal row's `actorLinks` (module side: the NPC made from it, by `compendiumSource`, `duplicateSource` or `flags.core.sourceId`, else the only world NPC with the compendium actor's name, case-insensitive); else the Library rules above |
| legacy `@Compendium[...]`, compendium uuids without a type   | `L` + code (they fail `FOUNDRY_UUID_SOURCE`)                                                                                                                                                                                                                          |
| legacy `@Actor[id or name]{L}` etc.                          | resolved by id, else by exact name in the index (as `text-editor.mjs:628-644` does), then as `@UUID`                                                                                                                                                                  |
| `@Embed[uuid ...]{L}`                                        | `"Embedded: "` + the link as for `@UUID` (never the embedded text)                                                                                                                                                                                                    |
| `[[/r 1d20]]`, dnd5e enrichers                               | the raw text as inline code                                                                                                                                                                                                                                           |
| `#hash` in a content link                                    | dropped (Foundry heading slugs do not match Obsidian headings)                                                                                                                                                                                                        |
| `<a href>` and bare URLs                                     | `[text](url)` only for `http:` and `https:`; `obsidian:`, `javascript:`, `file:`, `data:` and relative hrefs become text                                                                                                                                              |

The label is `{L}` when given, else the target's current name from the index, else the raw id; it is
escaped (whitespace collapsed, `\ [ ]` escaped, 200 characters). A link target created after the page note
was rendered stays a code span until that page's `sig` changes (rare: a target cannot be referenced before it
exists, except after a delete and a same-id re-import).

## 6. The `/open` route

### 6.1 Shape

Every mirror note body has `[Open in Foundry](<base>/open?uuid=<uuid>)`. `<base>` is the new backend env
`FOUNDRY_AI_OPEN_BASE` (the backend renders the notes), default `http://localhost:3000`, validated as an
http(s) origin without credentials, path or query; the test env sets it to `http://localhost:3100`; the Pi
sets the dashboard's tunnel URL. It must be the origin the GM opens the dashboard at (the README and
skills say `http://localhost:<port>`): the `/open` page reads the token from that origin's
localStorage, so a `127.0.0.1` link would find none with the split on (changed from `127.0.0.1` while
building, 2026-09-29). The uuid is the only parameter: no label, no token.

### 6.2 Auth and "a GET never writes"

| Request                            | Split off (legacy, loopback bind) | Split on: no or bad token | Player token | GM token                           |
| ---------------------------------- | --------------------------------- | ------------------------- | ------------ | ---------------------------------- |
| `GET /open?uuid=…` (static shell)  | 200                               | 200                       | 200          | 200                                |
| `POST /api/open` `{uuid, userId?}` | acts                              | 401                       | 403          | acts: calls `open-in-foundry` once |

- **GET shows, POST acts.** A click in Obsidian is a top-level navigation: it carries no header, and the
  dashboard sets no cookie (the GM page keeps its token in localStorage `cogm_token`, `public/app.js:11-24`).
  So the GET cannot authenticate; it serves `public/open.html`, a shell with no data (like `/` and `/player`
  today), and never calls the bridge. Its script (`public/open.js`) reads the uuid from the URL and the token
  from the same localStorage key, shows "Open this Actor (`Actor.abc…`) on your Foundry screen?", and POSTs
  on click (the button has focus, so Enter works).
- Why not act on GET, even though opening changes no game state: link previews and scanners fetch URLs; a
  scene link calls `scene.view()` on the GM's client (`gm-helper-queries.ts:85-86`), which pulls the GM off
  the table's scene mid-play; and a sheet opening on a screen-shared GM screen can show secrets. One click is
  the price.
- `POST /api/open` rules: `requireGm` semantics (401/403 as `app.ts:246-255`); the token only from the
  `X-CoGM-Token` header, never from `?token=` (`auth.ts:54-55` accepts it elsewhere; here it is refused so a
  token never lands in a URL or history); header `X-CoGM-Request: open` required (a custom header forces a
  CORS preflight the dashboard never grants, which also protects legacy mode where every caller is GM,
  `auth.ts:70`); `Sec-Fetch-Site: cross-site` or `same-site`, and an `Origin` that is neither the
  dashboard's own nor in the route's `allowedOrigins` (empty in O4), refused with 403 `cross-site`
  (6.4); JSON body only; uuid checked against `FOUNDRY_UUID_SOURCE` (400); at most 10 opens per 10 s
  (429).
- Headers on `/open` and `/open.html`: CSP `default-src 'none'; script-src 'self'; connect-src 'self';
style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` (stricter than
  `PLAYER_CSP`, `app.ts:79-81`), `Referrer-Policy: no-referrer`, `Cache-Control: no-store`. The script
  writes only with `textContent` (the page shares an origin with the GM token).
- Several GMs logged in: the tool throws "pass userId" (`gm-helper-queries.ts:184-187`); the route answers
  409 `{code: 'choose-gm', gms: [{id, name}]}` (from `list-ref-choices` kind `user`, role `gm`) and the page
  offers one button per GM.
- If Obsidian's core Web viewer opens the link inside Obsidian, that view has its own localStorage: with the
  split on, the page asks the GM to open the dashboard once there. The default browser needs nothing.

### 6.3 What it calls, and P1

The route calls the existing `open-in-foundry` tool (`tools/guarded-changes.ts:126-146`, already a read in
`tool-policy.ts:28-32`), which reaches `openDocumentForGm` (`gm-helper-queries.ts:196-215`): it validates the
uuid again, opens a sheet, a journal page or a scene view, and changes nothing. The contract file holds
`OpenLinkRequest {uuid, userId?}`, `OpenLinkResult {opened, documentName, name, userId}` and the error codes
(`gm-required`, `bad-uuid`, `cross-site`, `choose-gm`, `rate-limited`, `bridge`). P1 reuses the route as is:
its "Open in Foundry" command POSTs with the token from Obsidian's SecretStorage and the same
`X-CoGM-Request` header (the command itself is the click), so the plugin needs no route of its own and
never sees a URL with a token.

### 6.4 Compatibility with the P1 plugin (recorded 2026-09-29)

Facts from the vault research note `Dev/Foundry AI Tool/Research/Integrations.md` ("Obsidian companion
plugin (P1): facts that change the plan"): the plugin's requests come from origin `app://obsidian.md`
(Obsidian desktop `fetch`); it reads streams with `fetch` and a stream reader, because `requestUrl`
does not stream and a native `EventSource` cannot send headers; it keeps the GM token in Obsidian's
SecretStorage (a namespaced id such as `foundry-ai-dashboard-token`). Adding the CORS allowance for
that origin belongs to P1, not O4, but nothing in O4 may rule it out:

| Topic         | O4 does                                                                                                                                                                                                                                                                                                                       | P1 adds                                                                                                                                                                                                                                                                                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Origin check  | `POST /api/open` refuses `Sec-Fetch-Site` `cross-site` or `same-site`, and an `Origin` that is neither the dashboard's own (compared by host with the `Host` header; `Origin: null` refused) nor in the route dependency `allowedOrigins` (default `[]`), with 403 `cross-site`. An allowlisted origin passes this check only | `app://obsidian.md` in `allowedOrigins` (from config)                                                                                                                                                                                                                                                                                                       |
| Preflight     | Every check runs inside the POST handler, never in a middleware on all methods, so an `OPTIONS` preflight (no token, no custom header value) is never refused by them. O4 adds no `OPTIONS` handler and sends no `Access-Control-*` header, so browsers keep blocking every cross-origin call                                 | An `OPTIONS` answer on GM routes for allowlisted origins only: `Access-Control-Allow-Origin: app://obsidian.md` (never `*`), `Access-Control-Allow-Headers: X-CoGM-Token, X-CoGM-Request, Content-Type` (plus `Authorization` if P1 moves to a bearer token), `Access-Control-Allow-Methods`, `Vary: Origin`; the same `Allow-Origin` on the real responses |
| Custom header | `X-CoGM-Request: open` stays required on the POST, for every origin; it is what forces the preflight                                                                                                                                                                                                                          | sends it (the preflight answer lists it)                                                                                                                                                                                                                                                                                                                    |
| Token         | Header only (`X-CoGM-Token`), never `?token=` or a cookie. The `/open` page reads `localStorage.cogm_token` only because it runs on the dashboard origin                                                                                                                                                                      | reads the token from SecretStorage and sends the same header                                                                                                                                                                                                                                                                                                |
| Responses     | JSON with a `code` on every error (`OpenLinkErrorCode` in the contract); 409 `choose-gm` lists the GMs; `/api/open` never redirects or returns HTML                                                                                                                                                                           | reads them with `fetch`; its own GM picker                                                                                                                                                                                                                                                                                                                  |
| Streams       | O4 adds and changes no stream; no new GM surface depends on `EventSource`-only or cookie-only auth                                                                                                                                                                                                                            | reads `/api/stream` with `fetch` and the header                                                                                                                                                                                                                                                                                                             |

Tests pin it (`open-route.test.ts`): an `OPTIONS /api/open` preflight from `app://obsidian.md` is not
401 or 403 and carries no `Access-Control-Allow-Origin`; a POST from that origin with a GM token is 403
`cross-site` with the default allowlist, and 200 when the test builds the route with
`allowedOrigins: ['app://obsidian.md']` (still 403 without `X-CoGM-Request`).

## 7. Security review

1. **GM data stays in the GM vault.** Mirror notes are written only under
   `Campaigns/<worldId>/AI Tool/Foundry/` (and the mirror's bases), only with the vault dir set and the
   mirror enabled. Nothing in the dashboard reads the Obsidian vault; the player hub and endpoints are
   untouched (`app.ts:393-408`). O7 must never copy mirror notes (1.2 data includes hidden NPCs and GM-only
   journals); `player_visible` is advisory.
2. **Query gate:** bridge-only, GM-gated and GM-client-only (1.6); a Player console cannot reach it
   (it is not in `CONFIG.queries`).
3. **No vault secrets in mirrors:** the only bridge-vault input is the `revealed` boolean per page. No
   Tarokka card names, readings, audit diffs, attention or secret terms. Foundry-side secrets (a GM-only
   journal, a `section.secret`) are GM data in a GM vault; opted-in secrets sit in collapsed callouts.
4. **Adventure text** enters the vault only per the GM's opt-in and never the repo, fixtures, `Dev/` or the
   player vault (plan risk 2). Tests use invented text.
5. **Injection:** one choke point for Templater (`neutralizeTemplater`); no raw HTML; data never opens a
   wikilink, embed, code span, fence, comment, block id or tag (section 5); only http(s) links; YAML values
   JSON-quoted; tags from a fixed set; block ids built from validated 16-character Foundry ids; file names
   from `safeFileName`.
6. **Path fences:** world id regex (`export.ts:119-122`), `NoteWriter.resolve` (`export.ts:147-154`),
   `realpath` check against junctions (3.5), a scan that does not follow links.
7. **`/open`:** no token in any URL or note; GET never acts; header-only token; custom-header CSRF guard;
   uuid pattern; rate limit; strict CSP and no framing; a shell without data. In legacy mode the dashboard
   binds loopback by default (M0 `DASHBOARD_HOST`).
8. **Load:** paging, byte budgets, caps, one cycle in flight, 60 s cycle limit, writes only on change.
9. **Sync footprint (O8):** mirrors add world data to anything that syncs the vault; the same rules as
   plan risk 1 apply. Trashed mirror notes keep their text in the vault `.trash/`.

## 8. Tests

**Module** (`export-index.test.ts`, foundry-mock harness): fields per kind; PC vs NPC by
`hasPlayerOwner` (a player-owned `npc` is `pc`); unidentified item name vs `_source.name`; effective time
covers embedded items, pages, pins, folder chain and not tokens; `since`, `uuids`, `idsOnly`; cursor
stable when a document is added or deleted between pages; byte budget and every cap; text only for
opted-in folders, their subfolders and listed journals; `excludeFolderIds`; `sig` changes on page delete,
pin delete, user role change, ownership change and holder change, and not on an HP change; GM gate (a
non-GM client with `allowNonGmAccess` on is refused); **canary**: a mock world with unique strings in
flags, biographies, item descriptions, a non-opted page, HP value, token names on the canvas and user
emails, none of which appear in any response. Contract test for the mirrored constants.

**Backend:** converter and link table (every row of section 5, label escaping, fences, `section.secret`,
`javascript:` and `obsidian:` hrefs, `[[`, `<%`); snapshots per note kind and per base; `player_visible`
and `player_access` rendering; names (reserved names, case-insensitive collisions, suffix order,
stability across runs, 240-character paths); ownership (an edited mirror note is skipped and listed, a note
moved outside the fence is never duplicated, duplicates reported); reconcile (deleted uuid to `.trash/`,
edited deleted note kept, page notes trashed with their journal and when text is turned off, sig mismatch
refetched, settings change forces all); watermark overlap (a document modified mid-cycle is caught next
cycle); an `fvtt_modified`-only change is not written; one cycle in flight, reconcile throttle;
`plan-obsidian-mirror` (feature off refuses, diff, undo) and `get-obsidian-mirror`; `tool-catalog.test.ts`
passes with the new `x-foundry-ref` annotations (`textFolderIds`: `folder` filtered to `JournalEntry`;
`textJournalIds`: `journal`; `excludeFolderIds`: `folder`); **canary**: a bridge vault seeded with Tarokka
card names, audit diffs and secret terms, plus a fake Foundry: no mirror file contains them, and the
opted-in page's canary appears only in its own page note.

**Dashboard** (`open-route.test.ts`): `GET /open` returns 200 without auth, contains no world data and
calls the bridge zero times (spy); POST: none 401, player 403, GM 200 with exactly one `open-in-foundry`
call; `?token=` alone is 401; missing `X-CoGM-Request` 403; `Sec-Fetch-Site: cross-site` 403; bad uuid 400;
several GMs 409 with the list; 11th open in 10 s 429; CSP and `no-store` headers present. The M2 canary
suite still passes unchanged.

**Live** (test server, throwaway vault `C:\FoundryTest\obsidian`, split on and off): switch the feature on,
plan and apply settings (enabled, a test journal folder with invented text); notes for Test Hero (`pc`,
Fighter 3, player "Player"), Wolf (`npc`, cr, "Unknown creature" when its token name is hidden), Test Arena
(`nav_name` and the warning), a test journal whose page has `@UUID` links, a relative link, a compendium
link and a `section.secret`; rename Wolf in Foundry (path kept, alias and H1 change); delete a journal (to
`.trash/`); edit a mirror note in Obsidian (skipped, listed); raise a page to Observer for Player
(`player_visible` flips within one poll); Obsidian 1.13.7: bases render, links and `#^p-` block links jump,
properties show wikilinks; click Open in Foundry in Obsidian: confirm page, Enter, the sheet opens on the
Claude GM client; the same link in a player-token browser shows 403 and in a fresh browser 401 (split on);
`/player` canary scan unchanged.

## 9. Build order and file ownership

Rebase on the M3 work first: C2 and C5 touch `queries.ts`, `main.ts` and `backend.ts` in one small block
each. Each chunk ends green (`npm run typecheck && npm run lint:ratchet && npm run build`,
`CI=true npm test`).

| Chunk                         | Model                    | Owns (only this chunk edits these)                                                                                                                                                                                                                   | Needs                   |
| ----------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| C1 contract                   | Sonnet                   | `shared/src/export-index.ts` (+test), one line in `shared/src/index.ts`                                                                                                                                                                              | none                    |
| C2 module query               | Sonnet, Opus review      | `packages/foundry-module/src/export-index.ts` (+test, +contract test), registration block in `queries.ts`, `pageAccessForPlayers` export in `player-visibility.ts`, feature registration in `main.ts`, typings in `types/foundry-v14.d.ts` if needed | C1                      |
| C3 conversion and links       | Sonnet                   | `packages/mcp-server/src/obsidian/{html-to-md,links,md-escape}.ts` (+tests), `packages/mcp-server/package.json` and `package-lock.json` (htmlparser2 ^10.1.0)                                                                                        | C1                      |
| C4 note rendering             | Sonnet                   | `obsidian/mirror-render.ts` (+snapshot tests; notes, bases, `Foundry/_status.md`), `render.ts` (`generatedProps` with `playerVisible`, exported; Home section)                                                                                       | C1; C3 signatures below |
| C6 settings and tools         | Sonnet                   | `obsidian/mirror-settings.ts` (+test), `tools/obsidian-mirror.ts` (+test), `tool-router.ts` (two routes, definitions)                                                                                                                                | C1                      |
| C7 dashboard `/open`          | Opus                     | `packages/cogm-dashboard/src/open-route.ts` (+test), mount and headers in `app.ts`, `public/open.html`, `public/open.js`                                                                                                                             | C1                      |
| C5 pump, scan, writer, wiring | Opus (reconcile), Sonnet | `obsidian/note-writer.ts` (extracted), `export.ts` (uses it; status line), `obsidian/{mirror-scan,mirror-pump}.ts` (+tests), `obsidian/mirror-canary.test.ts`, `backend.ts` (pump and tool wiring)                                                   | C1, C3, C4, C6          |
| C8 env, skill, docs           | Sonnet, then live test   | `scripts/test-env/start.ps1` (`FOUNDRY_AI_OPEN_BASE`), `.claude/skills/foundry-ai-tool/SKILL.md` (O4 checks), `docs/design/OBSIDIAN-PLAN.md` ("O4 as built"), `CHANGELOG.md`, `CLAUDE.md`                                                            | all                     |

Waves: C1; then C2, C3, C6, C7 and C4 in parallel (C4 codes against the signatures below); then C5; then C8
and the live test. Signatures fixed by this doc so workers do not wait on each other:

```ts
// C3
export function htmlToMarkdown(html: string, ctx: LinkContext): string;
export function markdownPageText(markdown: string, ctx: LinkContext): string;
export interface LinkContext {
  pageUuid: string;
  openBase: string;
  resolve(uuid: string): { notePath: string | null; name: string | null; blockId?: string } | null; // null = not in the world
  fromPath: string;
} // vault-relative path of the note being written
// C4
export function renderMirrorNote(
  worldId: string,
  entry: ExportEntry,
  ctx: MirrorRenderContext
): Array<{ path: string; text: string }>;
// C6
export async function readMirrorSettings(
  store: VaultStore,
  worldId: string
): Promise<{ settings: MirrorSettings; hash: string }>;
export const MIRROR_SETTINGS_FILE = 'obsidian-mirror.json';
export const MIRROR_FEATURE = 'obsidian-mirror';
```

New tools (92 to 94): `get-obsidian-mirror` (read: settings and pump status) and `plan-obsidian-mirror`
(plan; applied with `apply-planned-change`). Both match the read prefixes of `tool-policy.ts:47`, so the
dashboard needs no policy change.

### 9.1 Build refinements (lead, 2026-09-29)

- C1 (`shared/src/export-index.ts`) was written by the lead before the wave, with the full entry types,
  `EXPORT_INDEX_LIMITS` (adds `notableItemsPerActor` 40 and `pagesTotal` on journals), `isFoundryUuid`
  and the `/open` types (adds the error code `bad-request`).
- New lead file `packages/mcp-server/src/obsidian/mirror-common.ts`: `MirrorSettings`, `MirrorStatus`,
  `MirrorRenderContext`, `LinkContext` / `LinkTarget` (adds an optional `findByName` for legacy
  `@Actor[name]` links), `ScannedNote`, the folder constants, and the link helpers `openUrl`,
  `relativeLinkTarget`, `propertyWikilink`. All mirror paths are campaign-relative (relative to
  `Campaigns/<worldId>/`, the `NoteWriter` root).
- C4 also owns `obsidian/mirror-paths.ts` (names and collisions, 3.4), `sameMirrorContent` (the
  "no rewrite for a timestamp alone" rule, 3.5) and the render expectations in `export.test.ts` (Home
  section, status line).
- C6 also owns the env parsing: `FOUNDRY_AI_OPEN_BASE` and `FOUNDRY_AI_MIRROR_POLL_MS`
  (`mirrorEnvSettings` in `mirror-settings.ts`).
- C7 (the `/open` route) is built by an Opus agent; C5 by Opus (reconcile and deletes); the rest by
  Sonnet 5.5 workers.

## 10. Later (not in O4)

Session notes and Tarokka links point at mirror notes and `/open`; dashboard names link to mirror notes;
scene visits from the play log; M4 to M6 properties; O5 finds Prep notes for active-scene tokens by the map.

## 11. Questions for the GM (recommended default in bold)

**Decided 2026-09-29 (the GM's instruction: take the bold defaults; the GM can change any later):** 1
off until enabled with `plan-obsidian-mirror`; 2 PCs, NPCs, scenes, journal index notes, story items
(no vehicles, groups, compendium content); 3 no journal text by default, opt in per folder (with
subfolders) or per journal; 4 a rename in Foundry keeps the file name (new name = H1, `name`,
`aliases`); 5 one confirm click each time (Enter works), no "open without asking" switch; 6 world items
of the physical types (`DEFAULT_STORY_ITEM_TYPES`); 7 feature names only on NPC notes (no statblock
block in O4); 8 map pins yes, token lists no; 9 `section.secret` kept in a collapsed `[!secret]-`
callout; 10 `player_visible` at Observer, Limited shown in `player_access`.

1. Start: **off until you enable it with `plan-obsidian-mirror`**, or on once the vault dir is set?
2. Kinds: **PCs, NPCs, scenes, journal index notes, story items; no vehicles, groups, compendium content**?
3. Journal text: **none by default; opt in per journal folder (with subfolders) or per journal**?
4. Renamed in Foundry: **keep the file name (your links keep working; new name = title and alias)**?
5. Open in Foundry: **one confirm click each time (Enter works)**, or an "open without asking" switch now?
6. Story items: **world items of physical types**, or only magical and uncommon or rarer?
7. NPC notes: **feature names only in O4; a Fantasy Statblocks block later if you want it**?
8. Scene notes: **map pins yes, token lists no (they churn; session notes show who appeared)**?
9. `section.secret` in opted-in text: **kept, in a collapsed `[!secret]-` callout**, or dropped?
10. `player_visible` threshold: **Observer, with Limited shown in `player_access`**?

## 13. Library, stat blocks and images

Added after O4 (the Obsidian library lane). Section 12 is not used. Everything here lives in
the GM's vault only; examples in code and tests use made-up creatures and text.

### 13.1 Module queries

Two GM-only queries feed the Library (`shared/src/library-index.ts`, limits in `LIBRARY_LIMITS`):

- `getLibraryIndex {packs, after?}`: one row per document of the picked packs (uuid, name, type,
  subtype, folder group, identifiers, rules version, signature), plus the pack labels, the packs
  that are missing in this world, every pack id (for legacy `@Compendium[...]` links) and
  `origin`, Foundry's absolute base URL including any route prefix, no trailing slash. Pages
  hold at most 1,000 rows and 512 KB. The cursor is opaque: the bridge passes `next` back with
  the same `packs` list; a changed list starts over, and an `Invalid cursor` answer restarts
  the index.
- `getLibraryDocuments {uuids}`: at most 40 documents per call within a 1.5 MB response
  (deferred ones come back in `deferred`), description HTML cut at 256 KB, at most 300
  advancement links and 30 facts per document, NPC stat blocks in the shape the world export
  uses.

The world export (`getExportIndex`) also carries NPC stat blocks, portraits (`img`), scene maps
(`map`) and the same `origin`.

### 13.2 Library folder

`libraryPacks` in the mirror settings picks the packs. Notes go to
`Campaigns/<world>/AI Tool/Library/<Category>/`: Monsters, Spells, Classes, Subclasses, Species,
Backgrounds, Feats, `Class features/<class>`, `Species traits/<species>`, Background features,
Monster features, Features, Items, Other. Since I-100 each category has one folder per source
book (`Monsters/Monster Manual (2024)/`; no book: `Other`), with the group folder below the book,
notes carry `book` and `page`, and `Library/Books/<title>.base` lists one book across categories.
Each book also has a hub note `Library/Books/<title>.md` (type `library-book`, no `book`
property, embeds the base); every Library note links it (`From <book>, page N`) for the graph.
A note moves once, by rename, when its folder changes (never an edited one); same-named
entries of two rules versions in one folder get `(2014)` or `(2024)`. `fvtt_sig` holds the index signature,
so an unchanged entry is never fetched again. `.ai-tool-library.json` (a dot file Obsidian
ignores) keeps the membership the notes were rendered against, the lookups each note made (its
links) and the queue, for the next start.

### 13.3 Stat blocks in notes

Library monster notes and world NPC notes show one `[!statblock]` callout (`stat-block-md.ts`)
plus the portrait and the biography. dnd5e enrichers become the words Foundry shows
(`dnd5e-text.ts`): `[[/save dex 15]]` reads `DC 15 Dexterity`, damage reads `7 (2d6) acid`, and
plain inline rolls read as their formula (`1d20 + 2`).

### 13.4 The git guard

Licensed content (book and compendium text, D&D Beyond imports, their images) may only be
written where git will not pick it up. `LicensedGuard` answers three questions per campaign and
fails closed on every git error (exit 128, such as dubious ownership, is reported with git's own
first line):

- **Library and images** (`AI Tool/Library/`, `AI Tool/Attachments/`): the guard writes and keeps
  `AI Tool/.gitignore` with `/Library/` and `/Attachments/`. Allowed outside a repository, or
  when git confirms both folders are ignored and nothing in them is tracked. Without git
  installed it trusts that file and says that tracked files could not be checked.
- **Licensed text in world notes**: allowed outside a repository, or when git ignores the whole
  mirror folder `Campaigns/<world>/AI Tool/` and the vault trash for it
  (`.trash/Campaigns/<world>/AI Tool/`), and nothing under either is tracked. The guard never
  adds that rule itself. Otherwise world notes keep names, links and facts, but stat block
  bodies, opted-in page text, portraits and maps become one line pointing at `_status.md`, which
  explains the fix: add the folders to `.gitignore`, or move the vault out of the repository.
  Without git installed this stays off.
- **Trash**: Library notes and images are moved to the vault trash only when git ignores their
  trash folders.

A `.git` anywhere inside `AI Tool/` turns all three off. The answer is cached for five minutes.

### 13.5 Images

Portraits, scene maps and images in page text are fetched over HTTP from Foundry's base URL
(`FOUNDRY_AI_FOUNDRY_URL` when set, else `origin`) into `AI Tool/Attachments/`, mirroring the
Foundry path. Paths are compared case-folded; when two Foundry paths would share a file, the
later one gets a short hash in its name. Bodies stream with a 50 MB cap. A manifest keeps every
image, its name and which notes (owner uuids) embed it.

### 13.6 Re-render triggers

- World notes store `<sig>.r<renderer>.<inputs>` in `fvtt_sig`, where `inputs` hashes the guard's
  answers, the Library packs and the Library membership. Any change re-renders them, also when
  it happened while the bridge was down.
- Library notes re-render when their signature changes, when a membership change touches one
  of the lookups they made (a class note gains a subclass added later), and on a renderer
  change. Mirror settings re-render them only when a setting their links use changes (not
  `enabled` or the pack list, which reach them through the membership).

### 13.7 Budgets

World notes go first. The Library refresh, Library fetches and writes share a 30 s slice, image
copies get 20 s, all within the 60 s cycle; query and fetch timeouts never pass the remaining
time. Each step continues at the next cycle from where it stopped (index cursor, folder scan,
queue). Only the first refresh after a start runs before the world notes, in a 20 s slice; until
it finishes the world notes wait, so they are not written twice.

### 13.8 Trash

Nothing is deleted. Library notes whose entry left the packs (after a complete index and scan,
never for a missing pack, never when edited) and images no note embeds any more (only after a
complete reconcile, never with an unknown owner) are moved to the vault `.trash/`, through the
same fenced writer as mirror notes.
