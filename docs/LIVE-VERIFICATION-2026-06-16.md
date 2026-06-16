# Live read-only verification — 2026-06-16

First end-to-end test against a **live game**, not the mock harness. Path:
co-GM dashboard (`localhost:3000`) → `POST /api/tool` → MCP control channel
(`127.0.0.1:31414`) → bridge module in the hosted Foundry (Molten, WebRTC) →
live world **"Rime of the Frostmaiden"** (dnd5e). Driven via the dashboard's GM
tool proxy; **no game-mutating tools were called** — only `mutates: 'read'` ones.

Repro: `node scripts/live-read-sweep.mjs` (with the dashboard + bridge running).

## Environment

- Control channel: **connected**, AI enabled, single-user GM mode.
- Catalog: **73 tools** (32 read · 35 write · 6 destructive).
- World had **705 actors** (the full bestiary is imported as world actors); only
  **23 are `type=character`** (PCs), several of them test/duplicate entries
  (`123123123`, two `Andell`, **two `Silvera Frostmantle`**, `Tester McTesterson`,
  `Backup Char`, …). Scene had ~28 tokens; `list-scenes` returned 160 scenes.

## Result: read surface healthy — 27/32 pass, 0 failures (5 skips need ids)

| Tool                       | Result  | Notes                                                                                                                                                                                                       |
| -------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| get-world-info             | ✅      | title/system/foundry/users                                                                                                                                                                                  |
| list-characters            | ✅      | `{characters,total,filtered}` (705)                                                                                                                                                                         |
| get-character              | ✅      | works with exact full name or id (see fix below); one transient blip mid-sweep, then 3/3 + by-id OK                                                                                                         |
| search-character-items     | ✅      | `{characterId,characterName,matches,totalMatches}`                                                                                                                                                          |
| get-character-resources    | ✅      | spell slots + class resources                                                                                                                                                                               |
| get-active-effects         | ✅      | effect list                                                                                                                                                                                                 |
| get-available-conditions   | ✅      | condition catalog                                                                                                                                                                                           |
| get-current-scene          | ✅      | dimensions/background/navigation                                                                                                                                                                            |
| get-token-positions        | ✅      | 28 tokens                                                                                                                                                                                                   |
| get-token-details          | ✅      | position/size/appearance/behavior                                                                                                                                                                           |
| get-targets                | ✅      | current targets                                                                                                                                                                                             |
| get-combat-state           | ✅      | round/turn/combatants                                                                                                                                                                                       |
| get-combat-play-by-play    | ✅      | rounds + significant events                                                                                                                                                                                 |
| get-session-log            | ✅      | event buffer                                                                                                                                                                                                |
| get-recent-events          | ✅      | delta + timestamps                                                                                                                                                                                          |
| get-chat-log               | ✅      | messages                                                                                                                                                                                                    |
| get-modules                | ✅      | module/active counts                                                                                                                                                                                        |
| get-module-errors          | ✅      | error buffer                                                                                                                                                                                                |
| get-module-manifest        | ✅      | manifest                                                                                                                                                                                                    |
| list-actor-ownership       | ✅      | ownership map                                                                                                                                                                                               |
| list-compendium-packs      | ✅      | packs + types                                                                                                                                                                                               |
| list-creatures-by-criteria | ✅      | CR-filtered creatures                                                                                                                                                                                       |
| list-journals              | ✅      | journals                                                                                                                                                                                                    |
| list-scenes                | ✅      | 160 scenes                                                                                                                                                                                                  |
| search-compendium          | ✅      | `query="goblin"` results                                                                                                                                                                                    |
| suggest-balanced-encounter | ✅      | XP budget + suggestions                                                                                                                                                                                     |
| measure-distance           | ✅      | confirmed by hand: "Tribal Warrior"→"Saber-Toothed Tiger" = 7.5 ft. Args are `fromTokenName`/`toTokenName` (token NAMES, not ids) — the sweep guessed ids, which is the only reason it first showed a fail. |
| check-map-status           | ⏭ skip | needs `job_id`                                                                                                                                                                                              |
| get-character-entity       | ⏭ skip | needs `entityIdentifier`                                                                                                                                                                                    |
| get-compendium-item        | ⏭ skip | needs `packId,itemId`                                                                                                                                                                                       |
| get-compendium-entry-full  | ⏭ skip | needs `packId,entryId`                                                                                                                                                                                      |
| search-journals            | ⏭ skip | needs `searchQuery`                                                                                                                                                                                         |

The 5 skips are not failures — the sweep just didn't synthesize the required ids;
each should pass when given a real value (e.g. an `entityIdentifier` from a
`get-character` item list).

## Finding + fix: `get-character` partial names

A GM typed **"Silvera"**; the actor is **"Silvera Frostmantle"**, and the
resolver only did id / exact-name lookup → `Character not found`. Fixed
`getCharacterInfo` to resolve **id → exact name → unique partial → "did you mean"
on ambiguity** (commit in this session; characterized in
`data-access.character-resolve.test.ts`). Exact/id/not-found behavior unchanged.

## Not yet verified (need a live writer or specific inputs)

- **Write tools (35)** — not exercised; they mutate the live game and were left
  for explicit, per-action GM confirmation.
- **Map generation** — needs ComfyUI running.
- The 5 skipped reads — re-run with real ids.
