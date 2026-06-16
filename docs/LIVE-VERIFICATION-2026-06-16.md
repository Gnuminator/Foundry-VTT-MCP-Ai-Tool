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

## Write path — sampled live (safe, self-cleaning round-trips)

With GM Actions toggled on for the run (and restored to **off** in a `finally`),
a representative set of writes was exercised through `POST /api/tool` with the
confirm flags, choosing operations that revert to zero residue:

| Tool                         | Result | Notes                                                                                                       |
| ---------------------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| send-chat-message            | ✅     | GM-only **whisper** (to "Silvera (Christian)"), returns `messageId`. The one intentional trace left behind. |
| add-map-note                 | ✅     | created note `Tt4e3OHf9oxPGC1Q` at (200,200)                                                                |
| delete-map-note              | ✅     | removed it (`deletedCount: 1`) — note round-trip leaves nothing                                             |
| toggle-token-condition (ON)  | ✅     | `prone` applied to "Tribal Warrior" (enemy token)                                                           |
| toggle-token-condition (OFF) | ✅     | reverted — `isActive: false` (its pre-existing Bloodied/Dead are HP-derived, untouched)                     |

This confirms the write surface end-to-end: the GM-Actions gate, the per-action
confirm, the destructive double-confirm (delete-map-note), and that creates/
toggles both apply and revert. The write helper was a one-off (not committed) —
it mutates the live game, so it isn't a reusable artifact like the read sweep.

## Not yet verified

- **The other ~30 write tools** — only the sample above was run. The rest
  (damage/healing, actor/NPC creation, ownership, token moves, loot, encounter
  placement, etc.) mutate shared/visible game state and were left for explicit,
  per-action GM confirmation during a non-live moment.
- **Map generation** — needs ComfyUI running.
- The 5 skipped reads — re-run with real ids.

## Queued fixes (found via the dashboard's MODULE DIAGNOSTICS + LIVE FEED)

Triaged from live dashboard screenshots. The "5 errors / 22 warns" panel is
**mostly third-party / environment, not ours** — dnd5e `renderChatMessage`
deprecation, calendaria, combat-tracker-dock, dice-so-nice (missing
`celticlynx/d2-2b.webp`), automated-conditions-5e, and a core
"window too small (525×1993, needs ≥1024×768)" error (your Foundry browser
window). Only two diagnostics are ours, plus one UX gap:

- [ ] **A — Duplicate condition events.** Live feed shows the same "gained" /
      "lost" condition event **twice** per single toggle. `registerHooks()` is
      guarded, so it's not
      double-registration — it's two `ActiveEffect` docs per logical condition
      (Automated Conditions 5e mirrors dnd5e conditions). Fix: dedupe in
      `session-events.ts onActiveEffect` by `(actorId, effectName, eventType)`
      within ~1.5s. (foundry-module; needs module rebuild+reinstall.)
- [ ] **B — ComfyUI startup noise.** `main.ts startComfyUIMonitoring` emits
      `ui.notifications.warn` + `console.warn` (→ diagnostics) after a 2-min
      poll when ComfyUI isn't installed but `mapGenAutoStart` is on. Fix:
      short-circuit when not installed + downgrade the outcome to info.
      Immediate workaround: turn OFF the `mapGenAutoStart` setting (no deploy).
- [ ] **C — (enhancement) agentic co-GM "ask".** `/api/ask` only reasons over
      the event/combat snapshot, so "what weapon does Silvera have equipped?"
      can't be answered. Give the ask read-tool access (`get-character`,
      `search-character-items`). (cogm-dashboard; dashboard-only, no module redeploy.)

A + B batch with the earlier `get-character` partial-name fix into **one module
rebuild** (reinstall once). C is independent.
