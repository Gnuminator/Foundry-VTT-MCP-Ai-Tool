# Obsidian integration plan

Status: **O1, O2 and O3 done (2026-09-28); see "As built".** Written
2026-09-28 (branch `claude/amazing-bardeen-q1x1q6`) from four research sweeps (prior art, Obsidian
platform, game data, dev project); plugin facts re-checked on GitHub the same day. The GM handed
Claude ownership of everything Obsidian on 2026-09-28 (structure, plugins, automations, formatting);
section 12 is recorded on that basis. Later phases run in their own session (prompt in section 13). Related:
`CURSE-OF-STRAHD-PLAN.md` 0.3, 0.6, 2.1, feature 2 and 10. GM setup today: Obsidian 1.13.7, one vault
`C:\Users\chris\Documents\Obsidian\vault` (only `Welcome.md`), core plugins, no community plugins.

## As built (2026-09-28)

- **Vault:** the section 3 skeleton (Home, `Inbox/`, `Templates/`, `Attachments/`, `Daily/`,
  `Campaigns/`, `Dev/Foundry AI Tool/`); `Welcome.md` moved to `.trash`. Settings: Markdown links
  (relative), new notes in `Inbox/`, attachments in `Attachments/`, deletes to the vault trash;
  Templates and Daily notes use `Templates/` and `Daily/`. Templates: Session plan, NPC, Location,
  Daily note. No community plugins.
- **Vault pass (2026-09-28, with O2):** templates follow section 5 (`npc-prep`, `location-prep`,
  `quest-prep`, `encounter-prep`, `session-plan`; `fvtt_uuid`, `ai_context`), so GM prep never shares
  a `type` with generated notes; new Quest, Encounter and Question (dev) templates; hints live in
  `%% %%` comments, not YAML comments (the Properties editor drops those). Bookmarks: Home, the dev
  Dashboard, the test world's Home. Excluded files: `Dev/Foundry AI Tool/Sources/` (the raw history
  export duplicates the split notes). **Community plugins (GM decision 2026-09-28):** the prep set
  (Templater, Fantasy Statblocks, Dice Roller, Initiative Tracker) and the world set (Calendarium,
  Excalidraw, Omnisearch); not Leaflet (no release since 2024) and not the AI set (vault MCP,
  Claudian or Agent Client). The integration itself still needs no community plugin (principle 2);
  these serve the GM's own prep. Our own plugin is P1 (section 10). Installed from each plugin's
  latest GitHub release (Templater 2.25.1, Fantasy Statblocks 4.10.3, Dice Roller 11.4.2, Initiative
  Tracker 13.0.21, Calendarium 2.1.0, Excalidraw 2.27.3, Omnisearch 1.31.0). Templates use Templater
  (core Templates off): they ask for a name and campaign and file the note in
  `Campaigns/<world>/Prep/<NPCs|Locations|Quests|Encounters|Sessions|Tables>/`; NPC has a Fantasy
  Statblocks block, Encounter an Initiative Tracker `encounter` block, new Roll table template for
  Dice Roller; the Question template files itself in the dev Questions folder. The Daily note
  template keeps core `{{date}}` syntax because Templater's file-creation trigger stays off (O2,
  "Templater safety"). Calendarium's calendar is a GM question (match Foundry's Calendaria).
- **Renderer v1 (pulled in from O2):** `packages/mcp-server/src/obsidian/`, `npm run obsidian --
export [<worldId>] [--vault <dir>]` (or `FOUNDRY_AI_OBSIDIAN_DIR`). Writes
  `AI Tool/Sessions/<date>.md` (one per log day), `AI Tool/Changes/<YYYY-MM>.md` (from
  `gm/audit.json`) and `AI Tool/Tarokka/Current reading.md` (cards in collapsed `[!danger]- Card (GM
secret)` callouts); creates the campaign `Home.md` (Bases tables) and `Prep/` once. Path fence,
  world-id check, atomic writes, unchanged notes skipped, deterministic output. Checked in Obsidian
  1.13.7 on the test world.
- **Dev area:** `Dashboard.md` (Bases: open questions, sessions, decisions; milestones), a session
  note, Question notes, and **a read-only mirror instead of the junction**:
  `scripts/obsidian/sync-dev-docs.ps1` copies `docs/`, `.claude/skills/` and CLAUDE/CHANGELOG/README
  into `repo-docs/` (robocopy `/MIR`, Markdown only). Why: Obsidian advises against junctions and a
  mirror can never write back into the git working tree; the cost is a refresh at session end.
- **O2 (done 2026-09-28):**
  - **Ownership guard:** every generated note carries `generated_by: "foundry-ai-tool"` and
    `generated_hash` (sha256 prefix over the note with the hash blanked); a canvas carries both in a
    `generated` marker node (hash over the parsed JSON, so re-serialization does not count). A note
    the GM edited, or any file the tool did not write, is never overwritten and is listed in
    `AI Tool/_status.md`; O1 notes were migrated once. `.base` files carry no marker: Obsidian
    re-saves a base when it is opened and drops comments, so a base is ours while its content
    matches what the tool generates; a base changed in Obsidian stays (delete it to get ours back).
  - **Sessions by play session:** `AI Tool/Sessions/<date> S<NN>.md`, grouped by session markers
    (`session-start` / `session-end` lines in the session log, from the new tools `mark-play-session`
    and `get-play-session`; dashboard Start/End session control) with the 3-hour-gap fallback.
    Properties: session number, started/ended at and by (`marker`, `gap`, `open`), duration, events,
    event types, actors, scenes, changes (links to `Changes/<month>.md#^<changeId>`).
  - **Change history:** append-only `gm/audit-log.jsonl` (reserved; one line per apply or undo, no
    before-values) merged with the audit ring; each change block ends with a `^<changeId>` block id.
  - **Tarokka:** `Archive/<readingId>.md` per archived reading and `Spread.canvas` (cross layout,
    card names in collapsed callouts, revealed cards green).
  - **Also:** `AI Tool/Bases/` (Sessions, Changes, Tarokka readings); common properties (`type`,
    `fvtt_world`, `fvtt_modified`, `player_visible: false`, `schema: 1`, `tags: [campaign/<world>,
<type>]`); dot-prefixed temp files; notes the tool no longer produces move to the vault `.trash/`;
    a failed note does not stop the export (the CLI exits 1).
  - **Automatic render:** with `FOUNDRY_AI_OBSIDIAN_DIR` set, the backend re-renders a world 3 s
    after the pump appended events, a change was applied or undone, or a session was marked (at
    most 30 s apart during steady play); a per-world cache re-reads only changed session logs.
  - **Templater safety:** every `<%` that comes from data is written as `&lt;%`, and Templater's
    "trigger on new file creation" stays off in the GM vault: generated notes carry player-chosen
    text (character names, chat), which that setting would run as code on the GM's PC.
  - **Dashboard:** "Open in Obsidian" links, GM only (`OBSIDIAN_VAULT_NAME`, else the folder name
    of `FOUNDRY_AI_OBSIDIAN_DIR`): campaign Home, each change's month note, the Tarokka reading.
  - **Principle 7 exception:** session markers are log lines like the event pump's, never game
    state, so `mark-play-session` is gated like a read (still GM-only).
  - **Live check** on the test server with a throwaway vault (`C:\FoundryTest\obsidian`, seeded
    with the O1 notes; the test env's new `ObsidianDir`): O1 day note trashed and notes migrated,
    Start/End session from the dashboard, an HP change showed up in the session note within
    seconds, an edited note was skipped and listed, split on: players get no Obsidian data and
    cannot mark sessions (403). Bases and canvas checked in Obsidian 1.13.7; opening a base there
    re-saved it (the reason bases compare by content).
  - **Known limits:** `get-play-session` calls a session open until 3 hours after its last event,
    even when a gap inside it already split the notes; the newest session note says
    `ended_by: open` until the next event arrives; a base definition that changes in a later
    version reaches an existing vault only after the GM deletes the old base.
- **O3 (done 2026-09-28):**
  - Contracts: `shared/src/play-log.ts` (PlayRecord v2, query `getPlayRecords`) and
    `packages/mcp-server/src/stats/types.ts` (StatsModel). Recorder in the module
    (`play-recorder.ts`, GM clients only, shadow before-values), pump in the backend
    (`play-log-pump.ts`, `sessions/<date>.play.jsonl`, `FOUNDRY_AI_PLAY_LOG=off` disables it), a pure
    stats builder (`stats/build.ts`), stats in the session notes and `AI Tool/Stats/`, read tool
    `get-play-stats` (87 tools total).
  - **Changes to section 8:** no `sessionId` in the raw records: sessions are the O2 grouping over
    both logs (markers, gaps), a view that can change retroactively, so the raw log stays raw. Each
    record has a deterministic `key` (document `modifiedTime`, message id, combat round/turn) and
    the pump drops keys it already wrote, so two GM clients never double a record. No `stats/`
    area in the bridge vault: the exporter stays read-only on the bridge vault, and the stats are
    cheap to rebuild from the logs (the dashboard and the AI use `get-play-stats`). Calendaria moon
    phases are not captured yet (world time is).
  - **Roll breakdowns (GM decisions 2026-09-28):** every roll records what was rolled, the dice with
    their results (kept and dropped), each bonus or penalty with its inferred source (ability,
    proficiency, magic, bonuses; `modifier` when unknown), the natural d20 and the total. Players see
    a roll's breakdown in the dashboard exactly when they can see the roll in Foundry's chat
    (public rolls, the GM's public NPC rolls included); whispered, blind, self and GM-private rolls
    stay GM-only (`gm-roll` events). A target's AC/DC and hit/miss reach players only when dnd5e's
    challenge visibility setting shows them; the GM always sees them (`details.breakdown`, GM feed,
    session notes). This also closes the old leak of blind damage rolls into the player feed.
  - **As built:** the recorder keys a document's `_stats.modifiedTime` only when it is within 60 s
    of now, else `Date.now()`; each key then adds a 2 s time bucket plus the before/after values, so
    two GM clients still produce one key (unlinked token actors and all deletes always use
    `Date.now()`, since their `modifiedTime` is unreliable). Rests are recorded from the rest chat
    card, and from the `dnd5e.restCompleted` hook for rests without a card (the `manage-rest` tool
    rests with `chat: false`); a rest with a card is recorded once. Every record that names a user
    carries `userName`. HP credit (`source` on hp records) is exact when dnd5e applies damage or
    healing from a chat card's Apply button (`dnd5e.preApplyDamage`'s `options.originatingMessage`;
    `source.exact: true`), else a guess: a damage or healing roll from the last 10 s, not yet
    credited to that actor, whose total fits the change under 5e rules (full, half for resistance,
    double for vulnerability, less when stopped at 0 or max HP; temp HP lost in the same update
    counts toward damage). One roll message is credited at most once per target; stats count HP
    deltas, not rolls. `combat-start` and `combat-end` carry `data.roster` (combatant names);
    combat stats list every participant (both rosters, turns taken, anyone whose HP changed);
    `combat-end` carries the ended combat's round and last turn (Foundry 14 nulls `combat.turn`
    before the delete hook). The session feed's `damage` events use the same credit rule
    (`details.sourceMessageId`, `sourceExact`; shared helpers in `hp-credit.ts`).
  - **Roll breakdowns as built:** public rolls are `roll` events (`damage-roll` for damage) whose
    `description` is a player-safe line such as "Wolf 1, Bite attack: 1d20 (15) +2 STR +2
    proficiency = 19" (no target AC/DC or outcome unless dnd5e's `challengeVisibility` world setting
    is `all`); `details.breakdown` holds the GM's full line; whispered, blind and self rolls are
    GM-only `gm-roll` events instead. Sources are inferred (ability, proficiency, magic) or
    `modifier` when unknown; proficiency is never assumed on damage; a 0 never names an ability;
    rolls dnd5e did not type (a plain `/r`) guess no sources and keep their flavor as the title;
    function terms such as the hit die show their dice (`max(1, 1d10 + 2)`); skills use dnd5e's own
    labels ("Perception check"). Module files: `session-events.ts`, `systems/dnd5e/roll-breakdown.ts`.
    The `/player` feed (split on) shows only public `roll`/`damage-roll` descriptions with details
    stripped; the GM feed and session notes show `details.breakdown`.
  - **Foundry 14 roll-mode privacy fix:** v14 names chat visibility by message mode (`public`,
    `gm`, `blind`, `self`); dnd5e 6 passed its message-config `rollMode` to `ChatMessage.create`
    unmapped, and a legacy name (`gmroll`) fell back to the user's default (public), so
    `roll-saving-throws`, `use-npc-activity` and private player roll buttons posted publicly on v14.
    Fixed via `shared.rollModeFor` / `rollToMessageOptions` / `usesMessageModes` in
    `packages/foundry-module/src/data-access/shared.ts`.
  - **Live verification (2026-09-28, second PC test server, Foundry 14.368, dnd5e 6.0.5):** a
    scripted fight as the Claude GM user checked the play log, the GM feed, the `/player` feed with
    the split on, and the session note's stats: a card Apply credited exactly despite a newer roll,
    a tool damage fitting no roll stayed uncredited, and an HP-bar edit fitting a fresh roll was
    credited as a guess.

## 1. Summary

- Obsidian becomes the GM's reading and prep surface. The bridge vault (JSON) and Foundry stay
  canonical; the tool writes Markdown **views** into one folder it owns and **reads** the GM's prep.
  Nothing flows from Obsidian into Foundry on its own.
- Plain files first: `.md`, `.base` and `.canvas` files work with Obsidian closed, on the Orange Pi
  (where Obsidian never runs) and with any sync. The dev project gets its own area in the same vault.
- "Log everything" becomes the data source for session notes and stats. Nothing player-facing is
  built before the M2 projection, and then only as a **separate** player vault.

## 2. Principles

1. **The repo stays the source of truth.** Anything a future session must obey lives in the repo.
   Game state lives in the bridge vault and Foundry; a rendered note is never read back as state.
2. **Files first, plugins optional.** The integration needs no community plugin (Restricted mode can
   stay on). REST APIs, MCP plugins, the CLI and `obsidian://` URIs are Windows-only conveniences.
3. **Never overwrite notes the GM wrote.** Each folder has one owner. The tool writes only under
   `AI Tool/`, only files marked `generated_by: foundry-ai-tool` whose content still matches the hash
   it last wrote; a generated note the GM edited is skipped and listed in `AI Tool/_status.md`.
4. **Secrets stay GM-side.** GM-only data (Tarokka, attention, NPC secrets, GM recaps, the raw play
   log) may be rendered into the GM's private vault; nothing player-facing gets it except through the
   feature 2 projection. Excluded files and collapsed callouts only hide text ([settings](https://obsidian.md/help/settings)),
   shared Sync vaults have no per-folder rights ([collaborate](https://obsidian.md/help/sync/collaborate)): the boundary is a separate vault.
5. **Nothing from Obsidian enters Foundry world data automatically**: Foundry sends every journal,
   flag and actor to every client (CoS plan 2.1). Player text uses the reveal flow.
6. **Windows now, Orange Pi later:** one env var (off by default), Windows-safe names, headless.
7. New writes to Foundry or the bridge vault: off by default, plan, confirm, audit, undo.

## 3. Vault layout

```text
vault/                                   GM vault: private, never Published, never a shared Sync vault
├─ Home.md                               GM-owned start page: links to each campaign and the dev dashboard
├─ Inbox/                                default folder for new notes (keeps stray notes out of repo-docs)
├─ Templates/                            core Templates folder: prep and dev templates (section 5)
├─ Campaigns/<worldId>/                  same key as the bridge vault (test server: ai-tool-test)
│  ├─ Home.md                            GM-owned campaign page; embeds the ready-made bases
│  ├─ Prep/                              GM-owned; the tool only reads
│  │  ├─ NPCs/ Locations/ Quests/        one note per thing, made from Templates/
│  │  ├─ Encounters/ Sessions/           encounter ideas; one plan note per upcoming session
│  │  └─ Threads.md                      open plot threads
│  ├─ Reference/                         GM-owned one-off exports of owned books; stays on the PC
│  └─ AI Tool/                           tool-owned, regenerated; each note opens with a "generated" callout
│     ├─ _status.md                      last render, skipped (GM-edited) notes, errors
│     ├─ Sessions/                       one note per play session, e.g. "2026-10-03 S01.md"
│     ├─ Changes/                        one note per month, one block per applied/undone change (^chg-…)
│     ├─ Tarokka/                        Current reading.md, Archive/<readingId>.md, Spread.canvas
│     ├─ Foundry/                        uuid-keyed mirrors: Actors/NPCs, Actors/PCs, Scenes, Journals, Items
│     ├─ Stats/                          derived tables as notes (per PC, per combat, dice, spells)
│     ├─ Recaps/GM/                      GM recaps (M8), embedded in session notes
│     ├─ Attention.md Dread.md …         later features (M4 to M9) as read-only views
│     └─ Bases/                          sessions, npcs, pcs, changes, combats (.base files)
└─ Dev/Foundry AI Tool/                  dev project area (section 7)
   ├─ Dashboard.md                       bases: open questions, milestones, recent sessions, changed docs
   ├─ repo-docs/                         read-only mirror of docs/, skills, CLAUDE/CHANGELOG/README
   └─ Sessions/ Decisions/ Questions/ Milestones/   notes Claude Code writes; the GM answers questions
Later, separate: Documents\Obsidian\<campaign>-players\   player vault, written only by the backend
```

## 4. Components and data flow

Components: vault skeleton, templates and dev area (O1); renderer in
`packages/mcp-server/src/obsidian/` (O2); play-log recorder and derived tables (O3); export index and
links (O4); prep reader (O5); prep imports as plans (O6); player vault writer (O7).

| Data                                              | Canonical home                         | Into Obsidian                       | Back from Obsidian                            |
| ------------------------------------------------- | -------------------------------------- | ----------------------------------- | --------------------------------------------- |
| Tarokka, reveals, attention, NPC secrets, configs | bridge vault `gm/*.json`               | one-way render                      | never; edit in the dashboard (plan/apply)     |
| Play log (events, chat, combat, v2 records)       | bridge vault `sessions/*.jsonl`        | one-way: session notes, `Stats/`    | never                                         |
| Change history                                    | new append-only `gm/audit-log.jsonl`   | one-way: `Changes/`                 | never                                         |
| Actors, scenes, journals, items                   | Foundry world                          | one-way mirror; journal text opt-in | never automatically                           |
| GM prep (voice, wants, plans, quests, threads)    | Obsidian `Prep/`                       | the GM writes it                    | read-only AI context (O5); guarded plans (O6) |
| Player handouts, recaps, public stats             | revealed pages + M2 projection         | separate player vault only (O7)     | never                                         |
| Dev notes                                         | `Dev/…` Sessions, Decisions, Questions | Claude writes; the GM answers       | next session copies answers into repo docs    |
| Repo docs                                         | git                                    | live view through the junction      | through git/Claude; never renamed in Obsidian |

Renderer rules: env `FOUNDRY_AI_OBSIDIAN_DIR` (vault root; unset = off); writes only below
`Campaigns/<worldId>/AI Tool/`; atomic temp-plus-rename with a dot-prefixed temp name (Obsidian
ignores dotfiles); rewrites only on a hash change; runs after pump writes (debounced), apply/undo and
`npm run obsidian -- render`. Obsidian picks up outside changes ([data storage](https://obsidian.md/help/data-storage));
rewriting a note open in the editor triggers an auto-merge that has lost text ([forum](https://forum.obsidian.md/t/has-been-modified-externally-merging-changes-automatically/111594)).

## 5. Note templates and properties

Properties stay flat, use the 7 core types and quote wikilinks ([properties](https://obsidian.md/help/properties)).
Every generated note carries `type`, `fvtt_uuid`, `fvtt_world`, `fvtt_modified`, `rules`
(2014/2024), `player_visible` (from ownership), `generated_by: foundry-ai-tool`, `generated_at`,
`schema: 1`, `tags: [campaign/<worldId>, <type>]` and `aliases` (the original name).

GM prep NPC (`Templates/npc.md`; location, quest, encounter and session-plan follow the same shape):

```yaml
---
type: npc-prep
fvtt_uuid: '' # Actor.<id>: passport icon "Copy Document UUID" on the sheet title bar
settlement: ''
voice: ''
want: ''
secret: '' # GM-only; never leaves the GM vault
ai_context: true # false keeps this note out of the co-GM context
tags: [campaign/<worldId>, npc]
---
```

Generated types (properties beyond the common set):

- `session`: `session_number`, `date`, `started_at`, `ended_at`, `duration_min`, `game_date_start/end`
  (Calendaria), `scenes`, `pcs`, `npcs_seen`, `combats`, `combat_rounds`, `party_damage_dealt/taken`,
  `pc_downs`, `npc_kills`, `crits`, `fumbles`, `spell_slots_spent`, `gm_changes`, `reveals`. Body: GM
  recap, timeline by scene, a section per combat, changes (`^chg-…` links), reveals, the Prep plan.
- `npc`: `cr`, `creature_type`, `settlement`, `attitude`, `attitude_score`, `relationships` (quoted
  links), `last_seen_session`, `scenes`, `conversion_status`, `prep` (the Prep note with the same
  `fvtt_uuid`); optional `statblock` code block in Fantasy Statblocks YAML.
- `pc`: `player`, `class`, `level`, `hp_max`, `ac`, `dread`, campaign totals. `scene`: `nav_name`,
  `region`, `mood_preset`, `journal`, `visits`, `last_visited`.
- `tarokka-reading`: `reading_id`, `source`, `read_at`, `revealed_count`, `linked_count`; each card
  name in a collapsed `> [!secret]-` callout, like the dashboard veil.

File names: sanitized document name (strip `# | ^ : %% [ ]`, Windows-reserved characters and device
names), id suffix only on collision, never renamed by the tool. The GM may rename or move generated
notes in Obsidian; the tool finds them by `fvtt_uuid`, never by path ([links](https://obsidian.md/help/links)).

## 6. Links back to Foundry

- Identity is `fvtt_uuid` (`Actor.<id>`, `Scene.<id>`, `JournalEntry.<id>.JournalEntryPage.<id>`,
  `Compendium.…`). `@UUID[…]{label}` in mirrored text becomes `[[note|label]]` when a mirror exists,
  else the label plus the uuid in code. Compendium uuids link to Foundry only.
- **Open in Foundry:** each generated note gets `[Open in Foundry](<base>/open?uuid=Actor.abc)`. The
  new GET route serves a small same-origin page that uses the GM token already stored in the browser
  and calls the existing `open-in-foundry` tool by POST: it opens the sheet on the GM's screen and
  changes nothing. No token in any note or URL; uuid validated; player 403. `<base>` defaults to
  `http://127.0.0.1:3000`, configurable for the Pi behind Cloudflare.
- **Open in Obsidian** from the dashboard: `obsidian://open?vault=vault&file=<URI-encoded path>`;
  since 1.13.4 Obsidian confirms each action until "Don't ask again" ([URI](https://obsidian.md/help/uri)).
- Change history: `[[Changes/2026-10#^chg-…]]`; change ids already fit Obsidian's block-id rules.

## 7. Dev-project area

The repo is public, so nothing Obsidian writes may land in the working tree. Rejected: the repo root
as a vault (~950 `.md` files from `node_modules`, `.claude/` hidden, `.obsidian` in a public tree),
`docs/` as its own vault (loses root docs, still writes into the repo), a copied mirror (stale).
**Chosen (as built): `Dev/Foundry AI Tool/` in the existing vault with a read-only mirror
(`scripts/obsidian/sync-dev-docs.ps1`), notes outside it.** The junction below was the research
recommendation and was not built (see "As built").

- `mklink /J "<vault>\Dev\Foundry AI Tool\repo-docs" "<repo>\docs"` (no admin); optional `skills`
  junction for `.claude\skills`; root files (CLAUDE.md, README) are linked on GitHub instead. Obsidian
  "strongly advises against" junctions ([symlinks](https://obsidian.md/help/Symbolic+links+and+junctions)):
  keep the target disjoint, nothing under `.obsidian`, git as backup, renames and deletes via git.
- **Two-minute watch test first:** change a doc via git or Claude; if Obsidian's file list and
  search do not update without a restart, use a read-only mirror (`robocopy … /MIR`) at session end.
- New notes go to `Inbox/`. The four `../` links in `BUILT.md` and `MIGRATION.md` can create stray
  notes when clicked, so repo docs are read-only in Obsidian. Obsidian resolves both link styles; repo
  docs keep relative Markdown links, GitHub alerts (`> [!NOTE]` renders in both), no frontmatter.
- Claude access without touching the repo: `.claude/settings.local.json` (gitignored) gets
  `permissions.additionalDirectories` = `Dev/Foundry AI Tool` only, plus a deny rule
  `Read(//c/Users/chris/Documents/Obsidian/vault/Campaigns/**)` so no dev session can carry campaign
  secrets or adventure text into a public commit ([permissions](https://code.claude.com/docs/en/permissions)).
  Note-writing rules go in `CLAUDE.local.md`, ignored via `.git/info/exclude`.
- Workflow: Claude writes a session note at wrap-up and a Question note per open question with a
  default; the GM answers in Obsidian; the next session copies the answer into the repo and sets
  `status: ingested`. Properties: `type` (dev-session | decision | question | milestone), `status`,
  `date`, `branch`, `head`, `milestone`, `repo_doc`. Optional `SessionEnd` stub ([hooks](https://code.claude.com/docs/en/hooks));
  [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) help write valid `.base` files.
- Exclude `Dev/` **before the first vault sync**; exclusions do not remove uploaded files ([sync](https://obsidian.md/help/sync/settings)).

## 8. Play log for analytics (the data source)

The GM wants every roll, skill, spell, slot, resource, item and charge change, and every actor,
token and scene change logged for dashboards and fun stats. Today the chat ring (200) and combat
timeline die with the browser, one hit logs both `damage-roll` and `damage`, `death` means "0 HP",
`actorId` is ambiguous for unlinked tokens, and the audit ring forgets after 500 (`event-pump.ts`).

- **Capture** on the always-on Assistant-GM client (today the bridge-connected GM browser, later the
  Pi's headless client). Only that client records; the backend pump is the only file writer.
- **Before-values:** `update*` hooks carry only the diff and `preUpdate*` runs only on the client
  that made the change [verify in O3], so the recorder keeps a shadow copy of watched fields
  (extending the HP/resource caches `session-events.ts` seeds at `ready`).
- **Record v2** (fields by kind): `v: 2`, `id`, `t`, `seq`, `sessionId`, `kind`, `userId`, `sceneId`,
  `actor` (`uuid`, `tokenUuid`, `isPC`, `name`), `combat` (`id`, `round`, `turn`), `path`, `before`,
  `after`, `delta`, `roll` (`formula`, `total`, `dice`, `crit`, `fumble`, `advantage`, `rollType`,
  `dc`, `outcome`), `source` (`messageId` or `changeId`).
- **Kinds:** rolls (attack, damage, save, check, skill, tool, initiative, death save, hit die), spell
  casts (level, slot, upcast), slots, class resources, hit dice, item uses/charges/quantity, loot,
  currency, HP, conditions/effects, XP/level, rests, actor/token create/delete, scene change, combat
  start/turn/end, user join/leave, session start/end, Calendaria time and moon, `gm-change`. Token
  movement as counts unless opted in. Roll kinds via the `chat-roll-kind` adapter (dnd5e 6 checks in O3).
- **Storage:** append-only `sessions/<date>.play.jsonl` beside today's file (the vault name regex
  allows it); chat deduplicated by message id. Sessions: dashboard start/stop, else a gap over 3
  hours; `sessionId` on every record; Pi time zone = the GM's.
- **Derived tables:** pure, idempotent, rebuildable from raw (new vault area `stats/`): per session,
  PC and combat (rounds, HP lost, damage by actor, downs, kills), dice (d20 spread, nat 20/1 per
  player), spells and slots, resources and consumables, loot, time per scene. Count HP deltas, not
  damage rolls. Rendered as `Stats/` notes with numeric properties; the dashboard reads the same.
- **Privacy:** the raw log (whispers, blind rolls, NPC names) is GM-only. Player-facing stats go only
  through the M2 projection: allowlisted aggregates, PC subjects, no NPC numbers, canary scan first.

## 9. Plugin shortlist

**Security caveat.** Community plugins get Obsidian's full access (files, network, programs) once
Restricted mode is off. Obsidian has scanned each version automatically since May 2026; that is not
a review, and declared capabilities are still "coming soon" ([plugin security](https://obsidian.md/help/plugin-security),
[future of plugins](https://obsidian.md/blog/future-of-plugins/)). Rules: community browser only (no
BRAT), maintained plugins, read release notes of anything that sees GM secrets, one vault MCP at
most, no AI auto-allow, no API keys in notes, servers on 127.0.0.1 only. Versions as of 2026-09-28.

| Plugin                                                                                                                                  | Facts                                                                            | Verdict                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Core: Bases, Canvas, Templates, Daily notes, Properties                                                                                 | maintained; Bases covers most query needs                                        | **use**                                                     |
| [Dataview](https://github.com/blacksmithgu/obsidian-dataview)                                                                           | MIT, 0.5.70 (2025-04-07); DataviewJS runs arbitrary JS                           | optional (JS off; Bases first)                              |
| [Templater](https://github.com/SilentVoid13/Templater)                                                                                  | AGPL-3.0, 2.25.1; JS user scripts, opt-in shell commands                         | optional (core Templates suffices)                          |
| [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks)                                                                         | MIT, 8.4.0 (2026-08-25)                                                          | optional (prep to-dos)                                      |
| [Calendar](https://github.com/liamcain/obsidian-calendar-plugin), [Periodic Notes](https://github.com/liamcain/obsidian-periodic-notes) | MIT; last releases are 2021 and 2022 betas                                       | avoid (stale; Daily notes + Bases)                          |
| [Excalidraw](https://github.com/zsviczian/obsidian-excalidraw-plugin)                                                                   | AGPL-3.0, 2.27.3; script engine                                                  | optional (sketches; the tool writes `.canvas`)              |
| [Kanban](https://github.com/obsidian-community/obsidian-kanban)                                                                         | GPL-3.0, 2.0.51 (2024-05-31), in a community archive                             | avoid (Bases Kanban view from 1.14)                         |
| [Git](https://github.com/Vinzent03/obsidian-git)                                                                                        | MIT, 2.40.0; "not a syncing service"; git traverses junctions                    | avoid on the GM vault                                       |
| [Local REST API with MCP](https://github.com/coddingtonbear/obsidian-local-rest-api)                                                    | MIT, 5.3.1; one full-access key; app must run; traversal fix in 5.2.0            | optional, loopback; the bridge never depends on it          |
| [Claude Code IDE](https://github.com/petersolopov/obsidian-claude-ide)                                                                  | MIT, 0.2.5; loopback, read-only: open file and selection for `/ide`              | optional, low risk                                          |
| [Agent Client](https://github.com/RAIT-09/obsidian-agent-client)                                                                        | Apache-2.0, 0.13.0; Claude Code etc. in Obsidian, prompt per action              | optional; this **or** Claudian                              |
| [Claudian](https://github.com/YishenTu/claudian)                                                                                        | MIT, 2.3.7; vault is the agent's working dir (read/write/bash)                   | optional; pick one                                          |
| [Copilot](https://github.com/logancyang/obsidian-copilot)                                                                               | AGPL-3.0, 4.0.11; hosted tier routes input via its vendor                        | avoid in the campaign vault                                 |
| [MCP Connector](https://github.com/istefox/obsidian-mcp-connector)                                                                      | MIT, 2.7.0; 52 tools incl. delete; per-client tokens, allowlists, hidden folders | optional: the one vault MCP, read-only token, `Dev/` hidden |
| [Semantic Notes Vault MCP](https://github.com/aaronsb/obsidian-mcp-plugin)                                                              | MIT, 0.12.9; HTTP on localhost:3001                                              | avoid (second vault MCP)                                    |
| [MCPVault](https://github.com/bitbonsai/mcpvault) (not a plugin)                                                                        | MIT; reads files, `--read-only`; filter bypasses fixed June 2026                 | optional alternative for Claude Desktop                     |
| [DnD Beyond Importer](https://github.com/Webcreator3478/D-D-Beyond-Character-Importer---Obsidian-Plugin)                                | MIT, 1.1.4, 2 stars; unofficial DDB endpoint, public sheets                      | avoid (PCs come from the Foundry mirror)                    |
| [DnD HP Tracker](https://github.com/Butterski/obsidian-dnd-hp-tracker)                                                                  | MIT, 1.3.1, 0 stars; one HP pool in settings                                     | avoid (Foundry tracks HP)                                   |
| [Spell Picker](https://github.com/szynszyl320/spell-picker-obsidian)                                                                    | 0BSD, 1.1.0, 0 stars; SRD data from an external API                              | avoid (Foundry has the 2024 spells)                         |
| [Fantasy Statblocks](https://github.com/Obsidian-TTRPG-Community/fantasy-statblocks)                                                    | MIT, 4.10.3 (2026-01-21)                                                         | optional; NPC mirrors use its block format                  |
| [Initiative Tracker](https://github.com/Obsidian-TTRPG-Community/initiative-tracker)                                                    | GPL-3.0, 13.0.21                                                                 | avoid for play; O6 reads its `encounter` syntax only        |
| [Dice Roller](https://github.com/Obsidian-TTRPG-Community/dice-roller), [Leaflet](https://github.com/javalent/obsidian-leaflet)         | no SPDX license; last releases 2025-03, 2024-03                                  | avoid                                                       |
| [Calendarium](https://github.com/javalent/calendarium)                                                                                  | MIT, 2.1.0 (2025-09-27); no bridge to Calendaria                                 | optional                                                    |

Foundry side: [Markdown Exporter](https://foundryvtt.com/packages/export-markdown) or the
[Obsidian Bridge](https://foundryvtt.com/packages/obsidian-bridge) export suit a one-off dump into
`Reference/`. Never point an importer ([MD to Journal](https://foundryvtt.com/packages/md-to-journal),
[Lava Flow](https://foundryvtt.com/packages/lava-flow), [Vaults](https://github.com/wizzlethorpe/vaults),
Obsidian Bridge import) at the GM vault, and skip the MarkdownToFoundry relay.

## 10. Phases

Each code phase ends green (`npm run typecheck && npm run lint:ratchet && npm run build`,
`CI=true npm test`), is checked live on the test server with a throwaway vault (never the GM's),
then committed and summarized. Models: Sonnet for O1, O2 and research; Opus for the O3 recorder
design, the O4 route, O7 and reviews of anything that handles secrets or player output.

- **O1 (done 2026-09-28, see "As built"; mirror instead of junction, no settings.local.json change
  yet): vault scaffold + dev area.** With the GM: the
  section 3 skeleton, templates (npc, location, quest, encounter, session-plan, dev notes), both
  `Home.md` and `Dashboard.md` with bases, vault settings, the junction after the watch test,
  `settings.local.json` scope and deny rule, `CLAUDE.local.md`, open section 12 items as Question
  notes. Checks: watch test; a dev session is refused reading `Campaigns/`; `git status` stays clean.
- **O2 (done 2026-09-28, see "As built"): renderer v1 (existing data).** Config, name sanitizer, guarded writer (path fence, marker and
  hash checks, `_status.md`); session notes from today's JSONL; `Changes/` from a new append-only
  `gm/audit-log.jsonl`; Tarokka current, archive, `Spread.canvas`; `Bases/`; CLI; "Open in Obsidian"
  links. Tests: renderer snapshots; sanitizer (reserved names, link-breaking characters, collisions);
  no write outside `AI Tool/`; GM-edited note skipped; unchanged content not rewritten.
- **O3: full play log.** Recorder v2 with shadow before-values, chat and combat pumps, uuids, session
  markers, `stats/`, `Stats/` notes. Tests: v13/5.3 and v14/6.0 fixtures, one writer with two GM
  clients, dedupe, no double counting, midnight split, rebuild equals incremental, 1,000 events per
  minute. Live: a scripted fight as the Claude GM user.
- **O4: Foundry mirrors + links.** `getExportIndex({sinceModifiedTime})` (uuid, name, folder,
  ownership, navName, `_stats`, opt-in page text); NPC, PC, scene, journal-index and story-item
  notes; `@UUID` rewrite; `/open` route. Tests: link rewrite, `player_visible`, route auth (none 401,
  player 403), a GET never writes.
- **O5: prep as AI context (read-only).** GM-only `get-prep-notes` and co-GM context: Prep notes for
  active-scene tokens (by `fvtt_uuid`), location, session plan, open quests and threads; capped (~12
  lines), treated as data. Tests: cap, `ai_context: false`, Prep secret canary, inert injections.
- **O6: prep imports as guarded plans** (switch `obsidian-import`, off): NPC attitude properties to
  `plan-npc-attitude` (after M5), `encounter` blocks to a proposed encounter, player-marked quests to
  `create-quest-journal`. Tests: diff, confirm, audit, undo.
- **O7: player vault** (after M2): separate folder written only by the backend from the projection
  (revealed pages, public log, player recap, allowed stats); the M2 canary suite run on every file.
- **O8: Orange Pi.** Vault dir on the Pi's data volume, synced to the PC (default Syncthing: whole
  vault as one Send & Receive folder, `.stignore` for `.obsidian/workspace*.json` and `Dev/`); Pi
  time zone; no Obsidian on the Pi. Tests: Windows-safe names, `.sync-conflict-*` files reported.
- **P1: companion plugin** (GM decision 2026-09-28: plan now, build after O4, which brings the
  `/open` route and the export index it relies on). Our own desktop-only Obsidian plugin, source in
  this repo (new workspace `packages/obsidian-plugin`, esbuild, `obsidian` typings), installed into
  the GM vault by a script (not the community directory, no BRAT). It talks only to the co-GM
  dashboard (loopback by default, base URL configurable for the Pi), never to Foundry or the bridge;
  the GM token lives in Obsidian's SecretStorage, never in notes or plugin settings. Every write goes
  through the dashboard's existing gates (GM Actions switch, plan, confirm with diff, audit, undo);
  note edits only through `Vault.process` / `processFrontMatter` on the note the GM acted on.
  Features, in build order: (1) status bar from the dashboard stream: play session open or closed,
  current scene, combat round, connection; (2) commands to start and end a play session
  (`mark-play-session`) and a hotkey "add GM note to the session log" (a new log-only tool, shown in
  the session notes); (3) "Open in Foundry" for any note with `fvtt_uuid`; (4) "Insert Foundry link":
  a picker over `list-ref-choices` that fills `fvtt_uuid` or inserts a link; (5) reveal status on
  notes linked to journal pages and Tarokka cards, and "Reveal to players" as a guarded plan (needs
  M2 for anything player-facing); (6) an AI-context panel: the note's `ai_context` switch and what
  O5 would send. Tests: unit tests with a mocked `obsidian` module; live in the GM's Obsidian after
  O4. Community plugins it can use when present: Fantasy Statblocks (NPC blocks), Initiative Tracker
  (encounters), Calendarium (in-game date).

## 11. Risks

1. Secrets gain a copy on every device the vault syncs to: PC only until O8, then encrypted or
   LAN-only sync; never a shared Sync vault or [Publish](https://obsidian.md/help/publish/security).
2. A mis-pointed importer or a hand-moved note leaks (hence a backend-written player vault).
   Mirrored adventure text is private use: never in the repo, fixtures, `Dev/` or the player vault.
3. Junction: unsupported, may miss external changes, sync could push repo docs or write phone edits
   into the working tree, git traverses it. Watch test, early exclusions, mirror fallback.
4. Auto-merge on open notes (ownership zones, hash check); log volume (notes per session, not per
   event); v14/dnd5e 6 hooks (fixtures); unlinked tokens (`tokenUuid`); young Bases syntax (schema
   version plus a render test); plugin churn and an AI plugin with vault-wide write (stay plugin-free).
5. Pi: [network drives](https://forum.obsidian.md/t/file-changes-on-a-network-drive-made-outside-obsidian-are-not-shown/22710)
   break Obsidian's watcher; Linux allows names Windows rejects; [obsidian-headless](https://github.com/obsidianmd/obsidian-headless)
   is beta, proprietary, paid, arm64 unverified.

## 12. Decisions (recommended default in bold; recorded 2026-09-28)

1. Vault: **one vault with `Campaigns/` and `Dev/`**, or a separate dev vault?
2. Links: **wikilinks (default) for your notes, repo docs read-only**, or Markdown links vault-wide?
3. Secrets in Obsidian: **yes, GM vault on this PC only; card names in collapsed callouts**, or none?
4. Adventure journals: **index notes only, full text opt-in per folder**, or full text by default?
5. Prep: **lives in Obsidian `Prep/`; read-only AI context first (O5), plans later (O6, off)**?
6. Sessions: **dashboard start/stop plus a 3-hour-gap fallback; numbered S01, S02**?
7. Log scope: **all of section 8; whispers and blind rolls GM-only; token movement as counts**?
8. Player stats: **none until M2; then own-PC stats and party totals through the projection**?
9. Sync: **none now; Syncthing on the LAN with the Pi**, or Obsidian Sync (paid, E2E, headless)?
10. Players in Obsidian: **no; `/player` stays the channel; player vault only on request (O7)**?
11. Plugins: **the integration stays core-only; you add optional ones from section 9**?
12. Dev notes: **session note at wrap-up, SessionEnd stub off, questions answered in Obsidian,
    `skills` junction yes, dev sessions denied read access to `Campaigns/`**?
13. Stats: **all (damage, downs, crits, rounds, slots, time per scene, attendance, in-game days)**?

Recorded by Claude as owner (2026-09-28): 1 one vault. 2 **Markdown links vault-wide** (consistent with
the repo docs and generated notes; wikilinks still resolve). 3 yes. 4 index notes, text opt-in. 5 yes.
6 yes. 7 yes. 8 none until M2. 10 no. 11 the integration stays core-only; the GM chose the prep and
world plugin sets for their own use (2026-09-28, see "As built"). 12 session note at
wrap-up, SessionEnd stub off, questions in Obsidian, skills mirrored (no junction). 13 all. **Left to the
GM** (Question notes in the vault): 9 sync method when the Pi arrives (Syncthing is free, Obsidian Sync
is paid), and the Claude Code deny rule for `Campaigns/` in dev sessions (a permission-settings change).

## 13. Start prompt for the Obsidian session

```text
You are working on the Foundry AI Tool repo at
C:\Users\chris\Documents\Claude Code\Projects\Foundry VTT AI Tool. This session builds the Obsidian
integration planned in docs/OBSIDIAN-PLAN.md. Read first: CLAUDE.md, docs/OBSIDIAN-PLAN.md (all of
it), docs/CURSE-OF-STRAHD-PLAN.md sections 0.3, 0.6, 2.1, feature 2 and 10. Use the foundry-test-env
and foundry-ai-tool skills for live checks.

Rules:
- Branch from the branch that has M0+M1 (claude/amazing-bardeen-q1x1q6 unless merged into main) as
  claude/obsidian. Push only to the `aitool` remote, feature branch only, when I say so.
- Never touch the live bridge (ports 31414-31416, mcp__foundry-mcp__* tools). Test bridge
  31514-31516, dashboard 3100.
- My vault is C:\Users\chris\Documents\Obsidian\vault and you own everything Obsidian (structure,
  plugins, automations, formatting): decide and report. Never write into Campaigns/*/Prep/,
  Reference/ or Inbox/, never edit a note the tool did not generate, move files to the vault's .trash
  instead of deleting.
- Tests write to temp dirs; live checks use a throwaway vault, never mine. No campaign or adventure
  text in the repo, fixtures or docs. Stage explicit paths only.
- Everything new is off by default; Foundry or bridge-vault writes go through plan/apply/undo. Keep
  green: npm run typecheck && npm run lint:ratchet && npm run build; CI=true npm test.

Start: read "As built" and the Question notes in Dev/Foundry AI Tool/Questions (bold default where
unanswered), then O3 (full play log; recorder design with Opus) and report. Stop after each phase for my go-ahead; update
CLAUDE.md progress and the plan's status line as phases finish. Pick models as section 10 says.
```

## Sources

[Bases](https://obsidian.md/help/bases) · [JSON Canvas](https://jsoncanvas.org/spec/1.0/) ·
[CLI](https://obsidian.md/help/cli) · [headless sync](https://obsidian.md/help/sync/headless) ·
[sync options](https://obsidian.md/help/sync-notes) · [license](https://obsidian.md/license) ·
[Syncthing](https://docs.syncthing.net/users/syncing.html) · [player-facing-notes](https://github.com/Obsidian-TTRPG-Community/player-facing-notes)
(GM vault plus projection) · [Familiar's Obsidian guide](https://familiarvtt.com/guides/obsidian-notes) ·
[sessionscribe](https://github.com/Txpple/fvtt-app-sessionscribe) · [GitHub wikilinks](https://github.com/orgs/community/discussions/73062) ·
[git junction traversal](https://github.com/git-for-windows/git/issues/5320).
