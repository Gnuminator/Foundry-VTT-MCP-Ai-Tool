# Code Review — Foundry AI Tool (2026-07)

**Repo:** `Gnuminator/Foundry-VTT-MCP-Ai-Tool` (remote `aitool`) · **HEAD at review:** `bfbc93b` (v0.18.0),
working tree clean · **Date:** 2026-07-02

**Method.** Read-only audit run as an Opus orchestrator + a swarm of Sonnet-5 finder agents. 76
dimension-lensed finders (correctness / security / missing-functionality / contract / tests /
dead-code) over 24 repo partitions produced **176 raw findings**, deduped here into themes. Many issues
were found independently by 3–5 finders — that consensus is noted where it happened.

**Verification tags.** `✅CONFIRMED` = the cited code was opened and verified during synthesis.
`🔶PLAUSIBLE` = finder evidence is specific and internally consistent (often multi-finder) but was not
independently re-read. A full 3-vote adversarial verify-swarm was **not** run (see
[Coverage & caveats](#coverage--caveats)).

---

## Phase 0 — deterministic ground truth (captured this run)

| Check                            | Result                                                                      |
| -------------------------------- | --------------------------------------------------------------------------- |
| `npm run typecheck`              | ✅ 0 errors                                                                 |
| `npm run lint -- --quiet`        | ✅ 0 errors                                                                 |
| `npm run build`                  | ✅ pass                                                                     |
| Tests                            | ✅ **1,959 pass** — shared 49, mcp-server 1090, foundry-module 791, cogm 29 |
| `npm run audit:circular` (madge) | ✅ no circular deps                                                         |
| `npm run audit:unused` (knip)    | ⚠️ 13 files, unused dep `axios`, unresolved `tslib`, 30 exports, 79 types   |

Notes: the real test total (**1,959**) far exceeds the "~1,120" the docs cite. `axios` is a genuinely
unused `mcp-server` dependency. knip's "unused files" for mcp-server entrypoints (`backend.ts`,
`standalone.ts`, `control-ping.ts`, `job-queue.ts`) are **false positives** — reached via
bundler/dynamic import; confirmed during review.

---

## Headline: the remote-access security model has holes, and its master gate ships OFF

Phase 6 is actively pushing the bridge toward remote/multiplayer exposure (`standalone.ts`,
`docs/REMOTE-ACCESS.md`, `deploy/`). Multiple independent finders converged on a coherent security
story. **This is the #1 takeaway — resolve before any non-localhost exposure.**

### 🔴 Blocker

- **B1 — WebRTC signaling binds `0.0.0.0:31416`, wildcard CORS, zero auth, unconditionally.**
  ✅CONFIRMED · `packages/mcp-server/src/foundry-connector.ts:84` (also lines 58, 70) · flagged by 4
  finders. `webrtcSignalingServer.listen(31416, '0.0.0.0', …)` + `Access-Control-Allow-Origin: '*'` +
  unauthenticated `POST /webrtc-offer`. Not gated by any `remoteMode`/standalone flag. On **any**
  machine running the bridge, anyone on the LAN who can POST an offer can open a WebRTC data channel and
  drive Foundry.
- **B2 — the GM gate ships disabled and locked.** ✅CONFIRMED · `packages/foundry-module/src/settings.ts:257`
  (+ lock at `:418`) · ~10 finders. `allowNonGmAccess` is registered `default: true` and
  `lockNonGmAccessSetting()` forces the checkbox `checked = true; disabled = true`, so a world owner
  can't turn it off in the UI. `queries.ts` `validateGMAccess()` allows when
  `game.user.isGM || allowNonGmAccess()`, so **every logged-in non-GM player** passes the gate on all
  ~80 query handlers. The in-code comment even says "keep this GM-only before sharing the world
  publicly" — the default contradicts it.

### 🟠 High

- **H1 — main Foundry WS server binds all interfaces.** ✅CONFIRMED · `foundry-connector.ts:164` —
  `httpServer.listen(port, cb)` with no host arg → Node binds `0.0.0.0` (port 31415).
- **H2 — control channel (TCP :31414) has no authentication.** ✅CONFIRMED · `backend.ts:543`,
  `backend.ts:69` — raw `net.createServer`; any TCP client that connects can `call_tool` the whole
  router. Loopback by default, but `MCP_CONTROL_HOST` is read straight from env with no allow-list, and
  `standalone.ts` advertises this as the remote path.
- **H3 — `setActorOwnership` skips the write-permission gate every sibling applies.** ✅CONFIRMED ·
  `packages/foundry-module/src/data-access/ownership-players.ts:58-92` · 5 finders. Goes straight from
  `validateFoundryState()` to `actor.update({ownership})`; docstring admits "No write-permission gate."
  With B2, a non-GM can self-grant **OWNER** on any actor; `allowWriteOperations` has no effect here.
- **H4 — player event feed leaks exact enemy HP and hidden-combatant names.** ✅CONFIRMED ·
  `packages/cogm-dashboard/src/redact.ts:141` + `packages/foundry-module/src/session-events.ts:522`.
  `redactEventForPlayer` drops `details` but passes `description` verbatim; the description is built as
  `` `${actor.name} took ${Math.abs(delta)} damage` ``. Player view shows "GoblinBoss took 14 damage" —
  exact number + a hidden combatant. Defeats the documented HP-secrecy guarantee.
- **H5 — Cloudflare-email GM grant is forgeable + dashboard binds `0.0.0.0`.** ✅CONFIRMED ·
  `packages/cogm-dashboard/src/auth.ts:74`, `server.ts:585`. `auth.ts` trusts
  `cf-access-authenticated-user-email` verbatim (no JWT/signature/upstream-IP check); `server.ts` binds
  all interfaces with no `trust proxy`. No defense-in-depth: any path reaching :3000 directly forges the
  GM role. The split is opt-in — unset tokens ⇒ everyone is GM.
- **H6 — `create-actor-from-compendium`'s wired handler bypasses the write gate.** 🔶PLAUSIBLE ·
  `packages/foundry-module/src/data-access/actor-creation.ts:165` (routed from `queries.ts:459`).
  `createActorFromCompendiumEntry` never calls `checkWritePermission`, unlike the sibling
  `createActorFromCompendium`.
- **H7 — `socket-bridge.handleMCPQuery` does no auth itself.** ✅CONFIRMED ·
  `packages/foundry-module/src/socket-bridge.ts:260` — dispatches on peer-controlled `data.method` into
  `CONFIG.queries` with no allowlist; all gating is delegated to per-handler `validateGMAccess`, which
  B2 neutralizes.
- **H8 — journal read tools return GM-only "secret" pages.** 🔶PLAUSIBLE ·
  `packages/foundry-module/src/data-access/journals.ts:44` — `listJournals`/`getJournalContent`/
  `getJournalPageContent` never check `ownership`; secret pages returned to any caller. Read-side
  analogue of H4; treat as High.
- **H9 — `link-quest-to-npc` silently no-ops.** 🔶PLAUSIBLE ·
  `packages/mcp-server/src/tools/quest-creation.ts:888` — fallback `replace('</div></section>', …)`
  targets a substring that never matches the generated HTML (which emits `</div>\n    </section>`);
  `replace` returns the string unchanged yet the tool reports success. The same file handles this
  whitespace divergence correctly at line 983.
- **H10 — ComfyUI is started twice.** 🔶PLAUSIBLE · `packages/mcp-server/src/backend.ts:206` + `270-308`
  — `ComfyUIService` and `mapGenerationComfyUIClient` both auto-start on port 31411 with no shared
  handle. _(Superseded by the ComfyUI decommission — see next steps.)_
- **H11 — Foundry-mock id collision.** 🔶PLAUSIBLE ·
  `packages/foundry-module/src/test-support/foundry-mock/documents.ts:88` — `randomId(type.toLowerCase())`
  for 16-char types (`measuredtemplate`, `journalentrypage`) leaves zero counter chars after truncation
  → identical ids → silent overwrite in `MockCollection`. Undermines tests using those embedded types.
- **H12 — highest-risk networking/lifecycle files are untested.** ✅CONFIRMED (glob) ·
  `mcp-control-client.ts`, `polling-feed.ts`, `foundry-connector.ts`, `socket-bridge.ts`, `main.ts`,
  `index.ts`, `job-queue.ts`, `webrtc-connection.ts` have no test files.

---

## 🟡 Medium — recurring themes (64 findings)

1. **Write-permission gate applied inconsistently across data-access.** `addActorItems`,
   `actor-builder.createNpcActor`, `setTokenVisionLight` (`scenes-tokens.ts:596`), and all `scene-fx`
   writes skip `checkWritePermission`. The "Allow Write Operations" safety toggle is bypassable through
   several paths.
2. **The risk-tier permission model is partly decorative.** `permissions.ts` — `WriteOperation.requiresGM`
   is set on `deleteData`/`modifyWorld` but **never read**; `checkWritePermission` ignores it.
   `deleteTokens` (irreversible, no rollback) is gated only MEDIUM, not the HIGH_RISK `deleteData` tier
   that exists for exactly this.
3. **Roll attribution is client-trusted / spoofable.** `player-rolls.ts:532` + `main.ts:543`
   `requestMessageUpdate` trust a client-supplied `userId`; roll-button authz reads only DOM `data-*`
   attributes with no server re-validation.
4. **Wire-protocol validation is dead.** `shared/src/protocol.ts:96` — every exported Zod schema is
   imported only as a `type`; frames are never validated at runtime. `MCP_METHODS` in
   `shared/src/constants.ts:61` is a stale, unused subset. False assurance.
5. **`system-detection` cache poisoning.** `utils/system-detection.ts:32` — one transient failure caches
   `'other'` forever, permanently disabling all dnd5e tools; `clearSystemCache()` is never called on error.
6. **Audit log records success before the write.** `actor-creation.ts:398` — `addActorsToScene` logs
   `success` before `createEmbeddedDocuments` runs → false success on failure.
7. **Tautological / no-op verification.** `quest-creation.ts:474` passes on any change;
   `queries.ts:653` `handleUpdateCampaignProgress` is a no-op stub that always reports success.
8. **`drop-loot` accepts negative currency** (`tools/loot.ts:64`) — can silently subtract gold.
9. **WebRTC chunking is one-way** (`webrtc-connection.ts`) — outgoing chunked, incoming never
   reassembled; large job payloads can exceed the 64 KB SCTP limit.
10. **First-connection-wins identity** (`foundry-connector.ts:120`) — any client that connects first
    becomes "the Foundry module" with no identity check.
11. **Untested high-risk logic** — ComfyUI map pipeline, `ErrorHandler` classification, enhanced
    creature-index consumer paths.
12. **`comfyui-paths.getDefaultPythonCommand()`** returns `python/python.exe`, not the bundled-installer
    layout → auto-start spawn fails on a real Windows install. _(Superseded by ComfyUI decommission.)_
13. **Dashboard binds `0.0.0.0` with the split opt-in/off** (`server.ts:585`) — default/misconfigured
    deployment reachable beyond localhost grants every caller the unauthenticated GM role.

---

## ⚪ Low / Nit (84 findings) — representative

Dead code: `tools/map-generation.ts` carries an unused in-memory job subsystem; `campaign-management`
`storeCampaignStructure` is a no-op with dead try/catch; PF2e formatting branches remain in
`tools/character.ts` and `tools/compendium.ts` (dead since the D&D-only narrowing). Consistency:
`character.ts` handlers bypass `ErrorHandler` (unlike siblings); `scene-control` handlers re-throw raw
`ZodError`. Correctness nits: `grid_size` default disagrees (70 vs 100); `contentPreview` can render
literal `"undefined..."`; `formatCR` mislabels off-spec fractions.

The full itemized list (all 176 findings with evidence, severity, dimension, confidence) was produced by
the swarm; ask the reviewer to persist it if a machine-readable appendix is wanted.

---

## New vs. already-tracked

| Finding                                                            | Status vs. prior docs                                                                                 |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| B1 / H1 — network `0.0.0.0` binds, no auth                         | **Newly discovered**                                                                                  |
| B2 — `allowNonGmAccess` default-on + locked                        | **Newly surfaced as the exploitable default** (comment knew; no doc tracked it as risk)               |
| H3 / H6 — write-gate bypasses (ownership, actor-create)            | **Newly discovered**                                                                                  |
| H4 / H8 — redaction HP + journal-secret leaks                      | H4 sharpens a known PHASE6 TODO; exact-number-via-`description` leak is **new**                       |
| H2 / H7 / H12 — control-channel + socket-bridge no-auth & untested | Matches PROJECT-STATUS risk #3 — **corroborated + deepened**                                          |
| queries dual-registration                                          | Prior "verify" lead — swarm did **not** surface it as a defect (likely benign)                        |
| Doc drift (tool count, versions)                                   | Known staleness, now **quantified**: 73 tools vs docs' "57"; workspace pkgs `0.15.0` vs root `0.18.0` |

---

## Coverage & caveats

- **Swarm coverage.** 70 of 76 finder lenses completed. A transient server-capacity throttle killed 63
  lenses in the first pass; a throttled re-run recovered 57. The last **6 lenses**
  (`shared:{sec,gaps}`, `docs:contract`, `infra:{bugs,sec,gaps}`) were killed by a hard **monthly spend
  limit** and were covered by the orchestrator reading the code directly (`constants.ts`, `ci.yml`,
  Cloudflare template).
- **Phase-4 completeness critics did not run** (killed in the first pass); the orchestrator substituted
  its own coverage read.
- **Phase-3 verify-swarm did not run** (spend limit). The Blocker + top-security High cluster was
  verified by direct code reading (`✅` tags); Medium/Low are finder-reported (`🔶`).
- **Shallow / unreviewed areas.** `installer/` (NSIS `.nsi`, `configure-claude.ps1` — unsafe
  download/exec not audited), the three GitHub **release** workflows, `deploy/Dockerfile` + compose, and
  `shared/src/schemas.ts` got only a shallow manual pass. The four large output-formatting tool files got
  lens coverage but their deep HTML logic wasn't exhaustively verified.
- **Positive findings.** `ci.yml` is well-gated (green-gate + 4 suites + 3 smoke tests). The Cloudflare
  template is security-conscious (only exposes :3000; keeps 31414/15/16 off the tunnel). No circular
  deps. Zero `@ts-ignore`/`@ts-expect-error`.

---

## Recommended sequence

The two biggest items are being handled in their own sessions:
**(A) decommission ComfyUI entirely**, and **(B) design remote hosting for the GM**. The remaining
outstanding fixes are tracked as a checkbox backlog in [ROADMAP.md](ROADMAP.md#code-review-2026-07--action-backlog).

Priority order for the rest:

1. **Before any non-localhost exposure (blocker-class):** gate the `0.0.0.0` binds (B1/H1) behind an
   explicit opt-in, loopback by default; add auth to the WebRTC/control surfaces (H2); flip
   `allowNonGmAccess` default to **false** and unlock it (B2). _(Overlaps with session B.)_
2. **Close the write-gate holes (High):** route `setActorOwnership`, `createActorFromCompendiumEntry`,
   `addActorItems`, `setTokenVisionLight`, `scene-fx`, `actor-builder` writes through
   `checkWritePermission`; enforce `requiresGM` for HIGH_RISK and gate `deleteTokens` there.
3. **Fix the player-view leaks (High):** strip numbers from `description` (or rebuild it player-safe) and
   filter `journals` reads by `ownership`.
4. **Fix `link-quest-to-npc` silent no-op (H9)** and add real post-write verification.
5. **Test the untested wire/lifecycle files (H12):** `socket-bridge`, `queries`, `foundry-connector`,
   dashboard feed.
6. **Housekeeping:** drop `axios`; sync workspace `package.json` versions to 0.18.0; regenerate
   `TOOL_INVENTORY` (73 tools); remove dead PF2e / job-subsystem code.
