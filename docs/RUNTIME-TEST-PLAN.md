# Runtime & in-game test plan

The unit/characterization suites (~1,935 tests) prove the code does what its
specs say against the **mock harness**. They do **not** prove the tool works in a
**live Foundry game** — transport, third-party-module interaction, dnd5e data
shapes, UI, and AI behavior only get exercised live. This plan covers that gap.

It complements `docs/LIVE-VERIFICATION-2026-06-16.md` (the first pass: 27/32
reads + a 3-write sample, all green). Treat this as the standing checklist to run
each time the bridge/module/dashboard changes.

## Method

- **Driver:** the co-GM dashboard's GM tool proxy — `GET /api/tools`,
  `POST /api/tool` — against the live game. Single-user GM mode on localhost, so
  no auth needed. (Same path `scripts/live-read-sweep.mjs` uses.)
- **Reads:** run freely; re-run `node scripts/live-read-sweep.mjs` for the bulk.
- **Writes:** enable GM Actions for the run, restore OFF after. Prefer
  **create→verify→revert** or operate on a **disposable test actor/scene** so the
  live game is never left altered. Build a `scripts/live-write-sweep.mjs` (a
  proper, opt-in, self-cleaning version of the one-off used on 2026-06-16) so
  write runs are repeatable and auditable.
- **Record** every run's pass/skip/fail + notes back into
  `docs/LIVE-VERIFICATION-<date>.md`. A failure report must include the exact
  tool, args, and error text.
- **Safety:** never run destructive tools (`delete-tokens`, `remove-actor-
ownership`, `clear-*`) against real game state — only against test fixtures.

---

## 1. Transport & connection runtime

The control channel "cycles and can go half-open"; the client has keepalive +
heartbeat + request-timeout recovery. Verify it actually recovers.

- [ ] Dashboard reconnects after the backend restarts (kill + relaunch backend; dashboard returns to "connected" without a manual refresh).
- [ ] Half-open recovery: control channel goes quiet → heartbeat forces reconnect (watch `[cogm:control]` logs).
- [ ] Request timeout tears down + reconnects (don't loop 15s timeouts).
- [ ] WebRTC path (Molten/HTTPS): the in-browser module link survives a page reload and a brief network blip; werift smoke (`docs/DEPENDENCY-PATCH-SMOKE-TEST.md`).
- [ ] Foundry "reachable" transition refetches world info exactly once (no per-poll storm on the contended backend).

## 2. Tool feature tests (per domain)

Reads are mostly done; finish the skips and systematically exercise writes on
fixtures. Track each as ✅ / ⚠️ / ❌ with the result shape.

- [ ] **Reads — finish the 5 skipped**: `get-character-entity` (entityIdentifier from a real item), `get-compendium-item` + `get-compendium-entry-full` (packId/itemId), `check-map-status` (a real job_id), `search-journals` (a query).
- [ ] **Characters/items**: `get-character` (full name, partial — after fix, id, ambiguous), `search-character-items` (query/type/category combos), `use-item`, `manage-world-items`, `create-world-items`/`list`/`update`.
- [ ] **Actor creation**: `create-actor-from-compendium` (1 + quantity + addToScene), `get-compendium-entry-full`, `add-actors-to-scene` — on a **test scene**.
- [ ] **dnd5e authoring**: `dnd5e-create-npc`, `dnd5e-add-feature`, `dnd5e-add-features-from-compendium`, attack/aura/passive/save-feature, spellcasting, add-spells — on a **throwaway test actor**, then delete it.
- [ ] **Token manipulation**: `move-token` (+ move back), `update-token`, `get-token-details`, `toggle-token-condition` (on→off — **verify fix A: no dup events**), `delete-tokens` (test token only).
- [ ] **Combat tracker**: `get-combat-state`, `advance-combat-turn`, `set-initiative`, `roll-initiative-for-npcs` — in a test encounter.
- [ ] **Combat resolution (dnd5e)**: `apply-damage-and-healing` (+ heal back), `roll-saving-throws`, `use-npc-activity`, `manage-rest` — on test actors. Verify HP/slots match the sheet.
- [ ] **Movement**: `get-token-positions`, `measure-distance` (`fromTokenName`/`toTokenName`!), `get-targets`.
- [ ] **Dice/rolls**: `request-player-rolls`, `request-ability-check`, `request-attack-roll`, `roll-npc-check` — verify the roll button appears + resolves.
- [ ] **Resources/effects**: `get-character-resources`, `update-character-resource` (+ revert), `get-active-effects`, `clear-stale-conditions` (test actor).
- [ ] **Chat/log**: `send-chat-message` (ooc/ic/whisper, speaker), `get-chat-log`, `get-combat-play-by-play`.
- [ ] **Encounter & scene-fx**: `suggest-balanced-encounter`, `place`/`delete-measured-template`, `set-scene-mood` (+ restore), `add`/`delete-map-note`, `set-token-vision-light` (+ restore), `drop-loot` (test scene).
- [ ] **Ownership**: `assign`/`list`/`remove-actor-ownership` — on a test actor.
- [ ] **Journals/quests**: `create-quest-journal`, `update-quest-journal`, `link-quest-to-npc`, `list`/`search-journals`. (No delete-journal tool — clean up manually.)
- [ ] **Diagnostics**: `get-modules`, `get-module-errors`, `clear-module-errors`, `get-module-manifest`.
- [ ] **Map generation** (only if ComfyUI is installed): `generate-map` → progress → scene; `check-map-status`; `cancel-map-job`. (See fix B if not installed.)

## 3. dnd5e data correctness

Spot-check that tool output matches what Foundry shows:

- [ ] HP/temp HP, AC, ability scores, saves.
- [ ] Spell slots per level + pact (warlock), prepared flags.
- [ ] Conditions present vs derived (Bloodied/Dead from HP) — don't double-count.
- [ ] Initiative order + current turn vs the tracker.
- [ ] CR/XP math in `suggest-balanced-encounter` for a known party.

## 4. Permission & security runtime

- [ ] Every tool except `ping` denies a **non-GM** caller (silent `Access denied`).
- [ ] **Player view** (`/player`): server-side redaction — no GM-only combat numbers, no module-error feed, no settings; enemy HP shown only as bands (per config).
- [ ] Player/GM split with a GM token + a player token (two browsers): roles resolve, the write surface is GM-gated (`requireGm` → 401/403).

## 5. Co-GM dashboard UI review

**GM view (`/`):**

- [ ] Live feed: events render correctly, in order, **no duplicates** (fix A), buffer cap respected.
- [ ] Combat panel: initiative/turn/HP track the game; quick-actions (roll-init) work when GM Actions on.
- [ ] Commentary: auto-comments trigger on event bursts, respect min-interval + debounce + pause; tone/model switches apply.
- [ ] Ask: question → streamed answer; latest-wins preempt; "Post to chat" works; (fix C: can it see character data?).
- [ ] Tool Runner: search, schema-driven forms, read vs write vs destructive gating, confirm + destructive double-confirm, results in drawer, error display.
- [ ] Settings: pause, tone, model, diagnostics toggle, GM Actions master switch — all persist + broadcast.
- [ ] SSE: stream survives reconnect; status/world/combat/events/errors snapshots on connect.
- [ ] Error states: bridge down → "offline" banner; AI disabled (no key) → ask returns a clean message; tool error → readable toast.

**Responsiveness / layout:**

- [ ] Narrow widths (the live game showed a 525px Foundry window) — does the dashboard degrade gracefully? Review breakpoints in `public/styles.css`.
- [ ] Player view layout on tablet/phone widths.
- [ ] Visual polish: spacing, contrast, truncation, long names (705-actor world has long names), empty states.

## 6. AI co-GM behavior

- [ ] Commentary is useful + grounded in the snapshot (no hallucinated state).
- [ ] Ask answers are accurate; when it lacks data it says so (today it can't see inventory — fix C).
- [ ] Error commentary on new module errors is sensible + rate-limited.
- [ ] Token usage / cache behavior is reasonable (watch "cache hit/miss · N out").

## 7. Performance & scale

- [ ] Large world (705 actors, 160 scenes): `list-characters`/`list-scenes` latency + payload size; consider a `type=character` filter default for the dashboard.
- [ ] Polling load: the dashboard's combined event/combat/error polls vs backend contention; tune intervals.
- [ ] Event/error/chat buffer caps hold under a long session; no memory growth.
- [ ] No per-poll world-info storm.

## 8. Regression after the queued fixes

Re-run the relevant slice after each fix lands + the module is rebuilt/reinstalled:

- [ ] **A** — toggle a condition → exactly **one** feed event each way.
- [ ] **B** — with ComfyUI absent + `mapGenAutoStart` on, MODULE DIAGNOSTICS has **no** foundry-mcp ComfyUI warn/error.
- [ ] **C** — ask "what does <PC> have equipped?" → answered from a tool call.
- [ ] **get-character** partial name resolves live.

## Out of scope (not ours)

Third-party module deprecations (dnd5e/calendaria/combat-tracker-dock/AC5E),
dice-so-nice's missing asset, and the core "window too small" error are the
game's other modules / the browser window — track but don't fix.
