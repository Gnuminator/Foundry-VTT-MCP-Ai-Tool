# Foundry AI Tool — Architecture

> The system from first principles: the idea, the contracts, and the data flows — not a
> line-by-line code recap. This is the spec the implementation is measured against.
>
> **Scope of this document.** The system described here is the _trimmed_ one we actually
> ship and run: **Windows-targeted, Dungeons & Dragons 5e only.** There is no macOS support
> and no multi-system support beyond a single registered D&D 5e adapter. Where the design
> deliberately keeps a door open (the system-adapter registry), this document says so and
> explains why the door stays useful even with one adapter behind it.

---

## 1. The concept

Foundry VTT is a virtual tabletop: it holds the _entire live state of a game session_ —
actors and their sheets, tokens on a map, the combat tracker, scenes, journals and quests,
compendiums of monsters and items, the chat log. All of that lives inside Foundry's
browser-side JavaScript world, reachable only by code running _inside_ that browser tab.

An AI assistant — Claude, or any other [Model Context Protocol](https://modelcontextprotocol.io)
client — has no way to reach into a browser tab. The **idea** of this project is to close that
gap by turning Foundry into a set of **MCP tools**:

- _Read_ tools that answer questions about game state — "what's in this scene?", "what are
  the PCs' hit points?", "whose turn is it?", "what undead of CR 5 exist in my compendiums?"
- _Write_ tools that change the game on the GM's behalf — create an NPC from a stat block,
  drop tokens onto the canvas, advance the combat turn, apply damage, roll initiative, post
  to chat, generate a battle map.

Once Foundry's capabilities are expressed as MCP tools, two things become possible:

1. **A conversational GM assistant.** A GM talks to Claude ("set up the goblin ambush from
   the module on the current scene") and Claude calls the tools to make it happen, narrating
   and reasoning as it goes.
2. **A live co-GM dashboard.** A standalone web app watches the session in real time and
   surfaces an AI co-GM that comments on combat, answers tactical questions, and can drive
   the same tool surface — without Claude Desktop in the loop at all.

The trick is that the AI never touches Foundry directly. Every capability is mediated by a
small in-Foundry module that runs inside the browser context and exposes a narrow, audited,
**GM-gated** bridge to the outside world. The AI sees tools; the module sees Foundry's API;
a pair of well-defined wire contracts connect them.

### The four moving parts

```
   ┌──────────────────┐   stdio (MCP)    ┌──────────────────────────────────────────────┐
   │  Claude Desktop / │◄────────────────►│  mcp-server: stdio wrapper (index.ts)         │
   │  any MCP client   │                  │  - speaks MCP to the client                   │
   └──────────────────┘                   │  - relays to the control channel              │
                                          └───────────────┬──────────────────────────────┘
                                                          │ TCP, JSON-lines
   ┌──────────────────┐   HTTP + SSE                      │ 127.0.0.1:31414  (control channel)
   │  Browser: co-GM   │◄───────────┐                     ▼
   │  dashboard UI     │            │      ┌──────────────────────────────────────────────┐
   └──────────────────┘            └─────►│  mcp-server: BACKEND (backend.ts)             │
                              (SSE server  │  - control-channel server (ping/list/call)    │
                               + tool proxy│  - tool dispatch → tool classes               │
                               in Node)    │  - system-adapter registry (D&D 5e)           │
                                           │  - job queue + ComfyUI client (map gen)       │
                                           │  - Foundry connector (WS / WebRTC server)     │
                                           └───────────────┬──────────────────────────────┘
                                                           │ WebSocket :31415  /  WebRTC :31416
                                                           ▼
                                           ┌──────────────────────────────────────────────┐
                                           │  Foundry VTT (browser): foundry-mcp-bridge    │
                                           │  - socket bridge (dials out to the backend)   │
                                           │  - query handlers → Foundry's live API        │
                                           │  - GM-gating, permissions, transactions       │
                                           │  - session-event tracker (chat/combat feed)   │
                                           └──────────────────────────────────────────────┘
```

The rest of this document walks each part and then traces three requests end-to-end.

### Port map (localhost)

| Port    | Protocol        | Spoken between                                            |
| ------- | --------------- | --------------------------------------------------------- |
| `31411` | HTTP            | backend ⇄ ComfyUI (local AI image generation)             |
| `31414` | TCP, JSON-lines | stdio wrapper **and** co-GM dashboard → backend (control) |
| `31415` | WebSocket       | Foundry module → backend (the "Foundry connector")        |
| `31416` | HTTP POST       | Foundry module → backend (WebRTC signaling/handshake)     |

> **Wire identifiers are frozen contracts.** The Foundry module id `foundry-mcp-bridge`, the
> Foundry settings namespace `foundry-mcp-bridge`, the game-socket channel
> `module.foundry-mcp-bridge`, and the query-method prefix `foundry-mcp-bridge.*` are
> load-bearing: existing installs and all three processes key off them. They are intentionally
> _not_ renamed even though the product is now "Foundry AI Tool." A true rename is a separate,
> migration-gated change.

---

## 2. The in-Foundry module (`foundry-mcp-bridge`)

**Package:** `packages/foundry-module`. **Runs:** inside Foundry's browser tab, loaded as a
Foundry ESModule (`dist/main.js`).

This is the only component with direct access to Foundry's live API (`game`, `canvas`,
`CONFIG`, the document classes `Actor`/`Scene`/`Token`/`JournalEntry`, hooks, etc.). Its job
is to be a **disciplined gateway**: expose exactly the operations the tools need, enforce
who's allowed to call them, and make writes safe and reversible.

### Lifecycle (`main.ts`)

The module hooks Foundry's lifecycle:

- **`init`** — register settings, register query handlers into `CONFIG.queries`, register
  campaign hooks, and start the **session-event tracker** (hooks that buffer chat and combat
  activity — see §8's feed). Diagnostics error-capture is installed even earlier, at module
  evaluation time, so it catches the earliest console/uncaught errors from _other_ modules.
- **`ready`** — **the GM gate.** If the current user is not a GM, the module returns
  immediately and silently: no connection, no notifications, nothing. Only for a GM does it
  read settings, auto-connect the socket bridge if enabled, build the enhanced creature index
  if needed, and begin heartbeat monitoring + reconnect.

The connection is **outbound**: the module dials the backend, not the other way around. This
matters for the remote-hosting story — a hosted Foundry can reach a bridge, even though the
bridge can't reach into a hosted Foundry.

### Transport (`socket-bridge.ts` + `webrtc-connection.ts`)

The module supports two transports and auto-selects based on page security:

- **WebSocket** (`ws://host:31415/foundry-mcp`) when Foundry is served over **HTTP**
  (typical localhost). Simple and direct.
- **WebRTC DataChannel** when Foundry is served over **HTTPS**. A browser on an HTTPS page
  cannot open an insecure `ws://` to localhost, but it _can_ HTTP-POST a WebRTC offer to
  `http://localhost:31416/webrtc-offer` (the localhost exception), receive an answer, and
  bring up an encrypted peer DataChannel — no TLS certificate required. WebRTC's SCTP
  messages are capped at 64 KB, so the module **chunks** large payloads (50 KB chunks with a
  `chunked-message` envelope) and the backend reassembles them.

Either way, the message protocol on top is identical (see §3's Foundry-link protocol). The
bridge reconnects with exponential backoff and a heartbeat, because the backend cycles often.

### Query handlers (`queries.ts` + `data-access.ts`)

Every capability the module exposes is a **query handler** registered into Foundry's
`CONFIG.queries` map under a `foundry-mcp-bridge.*` key — e.g.
`foundry-mcp-bridge.getCharacterInfo`, `foundry-mcp-bridge.listCreaturesByCriteria`,
`foundry-mcp-bridge.move-token`, `foundry-mcp-bridge.upload-generated-map`. When a query
arrives over the transport, the socket bridge looks up `CONFIG.queries[method]` and invokes
it; there is no giant switch on the module side — the registry _is_ the dispatch table.

`queries.ts` is a thin layer; the heavy lifting (reading actor sheets, building creature
indexes, creating documents, attaching roll buttons to chat cards, etc.) lives in
`data-access.ts`. Every handler routes through a `validateGMAccess()` check that **silently
fails** for non-GM users — defense in depth on top of the `ready`-hook gate.

### Safety (`permissions.ts`, `transaction-manager.ts`)

See §7. Briefly: writes are classified by risk and gated by settings; multi-step writes can
be wrapped in a transaction that knows how to roll itself back.

---

## 3. The two wire contracts

There are **two** distinct socket layers, and keeping them separate is central to the design.

### 3a. The control channel — `127.0.0.1:31414` (TCP, JSON-lines)

This is the contract between the **MCP server's outer clients** (the stdio wrapper, and the
co-GM dashboard) and the **backend**. It is a plain TCP socket carrying **newline-delimited
JSON**. One JSON object per line, request and response correlated by an `id` the caller
generates.

**Request:**

```json
{"id":"<caller-generated>","method":"<ping|list_tools|call_tool>","params":{...}}
```

**Response:**

```json
{"id":"<same id>","result":{...}}
        — or —
{"id":"<same id>","error":{"message":"..."}}
```

Three methods, and only three:

| Method       | `params`                          | `result`                                                                     |
| ------------ | --------------------------------- | ---------------------------------------------------------------------------- |
| `ping`       | _(none)_                          | `{ "ok": true }`                                                             |
| `list_tools` | _(none)_                          | `{ "tools": [ <MCP tool definitions> ] }`                                    |
| `call_tool`  | `{ "name": "...", "args": {...}}` | MCP tool result: `{ "content": [{"type":"text","text":"..."}], "isError"? }` |

A `call_tool` result always wraps the tool's output as MCP content: a single text block whose
`text` is either a plain string or a JSON-serialized object. Errors are returned **in-band** as
a successful frame with `isError: true` and the message in the text block — not as a transport
`error`. (A transport-level `error` is reserved for malformed requests / unknown methods.)
Callers unwrap `content[0].text` and `JSON.parse` it opportunistically.

This is deliberately the _same_ protocol the stdio wrapper and the dashboard both speak, which
is what lets the dashboard reuse the entire tool surface without a second backend.

### 3b. The Foundry link — WebSocket `:31415` / WebRTC `:31416`

This is the contract between the **backend** (acting as a server) and the **Foundry module**
(acting as a client that dials out). Messages are JSON objects discriminated by a `type` field.

Backend → module:

```json
{"type":"mcp-query","id":"query-N","data":{"method":"foundry-mcp-bridge.<handler>","data":{...}}}
{"type":"ping","id":"..."}
{"type":"map-generation-progress","data":{...}}
{"type":"job-completed","jobId":"...","data":{...}}
```

Module → backend:

```json
{"type":"mcp-response","id":"query-N","data":{"success":true,"data":<result>}}
{"type":"mcp-response","id":"query-N","data":{"success":false,"error":"..."}}
{"type":"pong","id":"...","data":{...}}
{"type":"generate-map-request", ...}        // module-initiated requests (e.g. ComfyUI control)
{"type":"chunked-message", ...}             // a slice of an oversized WebRTC payload
```

The backend keeps a `pendingQueries` map keyed by `query-N` with a 10-second timeout, exactly
as the control channel keeps its own pending map keyed by `id`. The two layers mirror each
other but never share identifiers or sockets.

**Why two layers?** The control channel is process-local, trusted, and synchronous-feeling
(request/response). The Foundry link crosses the trust/process boundary into a browser, may be
remote, may need encryption without certificates (WebRTC), and must tolerate a flaky tab. By
keeping them distinct, each can evolve and harden independently, and the backend can serve
multiple control-channel clients (wrapper + dashboard) while owning a single Foundry link.

---

## 4. The MCP server (`packages/mcp-server`)

This package is **two processes**, not one.

### 4a. The stdio wrapper (`index.ts`)

This is the executable Claude Desktop (or any MCP client) launches. It speaks **MCP over
stdio** and does almost nothing itself:

- On startup it ensures a **backend** is running. It tries to connect to the control channel
  on `127.0.0.1:31414`; if nothing answers, it **spawns** `backend.js` as a child process and
  retries with backoff (up to 40 attempts) until the control channel comes up.
- It registers two MCP handlers: `ListTools` relays to control-channel `list_tools`;
  `CallTool` relays to control-channel `call_tool`. That's it — the wrapper is a thin MCP↔TCP
  shim.
- It owns the backend's lifecycle: when stdin closes (the client exits) or it receives
  SIGTERM/SIGINT, it kills the child backend and exits.

Splitting the wrapper from the backend means the _backend can be shared_. Claude Desktop spawns
the wrapper, the wrapper spawns the backend, and the **dashboard connects to that same backend's
control channel** — one Foundry link, many consumers.

### 4b. The backend (`backend.ts`)

The long-lived workhorse. Responsibilities:

1. **Singleton lock.** On start it acquires `foundry-mcp-backend.lock` (a PID file in the OS
   temp dir). If a live, validated backend already holds it, this instance parks forever
   (never resolves) so the client never sees a "server closed" error. The PID check is
   hardened against Windows PID reuse (it validates the holder is actually a node process and
   the lock isn't stale) so an unrelated OS process inheriting the PID doesn't masquerade as a
   running backend.
2. **Control-channel server.** A `net.createServer` on `31414` parsing JSON-lines, handling
   `ping` / `list_tools` / `call_tool` (§3a).
3. **Tool dispatch.** `call_tool` runs a single large `switch` on the tool name and calls the
   matching handler on one of the **tool classes**. Each domain is a class constructed once at
   startup — `CharacterTools`, `CompendiumTools`, `SceneTools`, `CombatTools`,
   `TokenManipulationTools`, `CombatResolutionTools`, `EncounterTools`, `MapGenerationTools`,
   `DiagnosticsTools`, the D&D-5e-specific creators, and so on. A tool handler typically
   validates its args, then calls `foundryClient.query('foundry-mcp-bridge.<handler>', data)`
   to reach into Foundry, then shapes the result. The full tool list is the union of every
   class's `getToolDefinitions()`; that union is what `list_tools` returns.
4. **The Foundry connector** (`foundry-client.ts` → `foundry-connector.ts` → `webrtc-peer.ts`).
   The backend _is the server_ for the Foundry link: it runs the WebSocket server on `31415`
   and the WebRTC signaling endpoint on `31416`, registers the module when it connects,
   and exposes `query(method, data)` / `sendMessage(msg)` over whichever transport won.
5. **Map-generation pipeline** — the job queue and ComfyUI client (§6).

Tool handlers never see the transport. They call `FoundryClient.query()`, which throws a clear
"module not connected" error if Foundry isn't linked — and that specific error is what lets the
dashboard distinguish "backend up, Foundry down" from "channel down" (§8).

### 4c. Configuration (`config.ts`)

A Zod-validated config object sourced from environment variables with sane defaults: Foundry
host/port (`31415`, namespace `/foundry-mcp`), connection type (`auto` | `websocket` |
`webrtc`), WebRTC STUN servers, ComfyUI port (`31411`), a `toolResponseMaxChars` cap to keep
tool outputs from blowing past model context, and the server name/version. `WEBRTC_CONSTANTS`
pins the SCTP limits (64 KB max message, 50 KB chunk threshold, chunk-count and timeout caps to
defuse "chunk bomb" memory attacks) and **must stay in sync** with the module's chunking code.

---

## 5. The D&D 5e system adapter (behind the registry)

Foundry is system-agnostic; "an actor" means something different in D&D 5e than in any other
system. The tools that _reason about creatures_ — search the compendium, list creatures by
criteria, extract character stats — need system-specific knowledge: where the Challenge Rating
lives, what counts as a creature type, how to describe a filter in English.

Rather than hard-code D&D 5e throughout the tool layer, the design isolates that knowledge
behind a **registry + adapter interface** (`packages/mcp-server/src/systems`):

- **`SystemAdapter`** (`types.ts`) — the interface every system implements:
  `getMetadata()`, `canHandle(systemId)`, `getFilterSchema()` (a Zod schema),
  `matchesFilters(creature, filters)`, `getDataPaths()` (e.g.
  `challengeRating → "system.details.cr"`), `getPowerLevel(creature)`,
  `extractCharacterStats(actorData)`, and the formatters. The interface is written in terms of
  _concepts_ (power level, creature index, filters) rather than D&D nouns, so it isn't a D&D
  interface wearing a generic name.
- **`SystemRegistry`** (`system-registry.ts`) — a `Map<SystemId, SystemAdapter>` with
  `register()`, `getAdapter(systemId)` (exact match, then `canHandle()` fallback for aliases),
  and `getSupportedSystems()`. A single global instance via `getSystemRegistry(logger)`.
- **`DnD5eAdapter`** (`systems/dnd5e/adapter.ts`) — the **one** registered adapter. It owns the
  5e filter schema (CR, creature type, size, spellcasting, legendary actions…), the 5e data
  paths, and the 5e formatting. `SystemId` is now `'dnd5e' | 'other'`.

At backend startup (`backend.ts`):

```ts
const systemRegistry = getSystemRegistry(logger);
systemRegistry.register(new DnD5eAdapter());
```

and the registry is injected into `CharacterTools` and `CompendiumTools`. Those tools look up
`registry.getAdapter(world.systemId)` and delegate the system-specific decisions to it.

**Why keep the registry with only one adapter?** Because it is the seam that keeps the design
_honest_. The tool layer talks to an interface, not to D&D constants; the 5e knowledge is
quarantined in one folder; and the cost of the abstraction is one `register()` call. The
project is D&D-only _by product decision_, not because 5e assumptions have leaked everywhere.
Adding a system later means writing an adapter and registering it — not editing the tools. The
parallel `IndexBuilder` interface exists for the same reason on the Foundry side, where the
creature index is actually built in the browser against live compendiums.

---

## 6. The job queue (long-running operations)

Most tools are request/response and finish in well under the 10-second Foundry-query timeout.
**AI battle-map generation** is not: it drives a local [ComfyUI](https://github.com/comfyanonymous/ComfyUI)
Stable-Diffusion pipeline that takes 30–60+ seconds. That needs an async job model
(`job-queue.ts` + `comfyui-client.ts`, orchestrated in `backend.ts`).

**Job model.** A `JobData` record carries an id, a content hash of the request, status
(`queued → generating → processing → complete | failed | expired`), progress percent and a
human-readable stage, retry/attempt counters, an estimated duration, and (when done) a result
holding the generated image path and a ready-to-create Foundry scene payload.

**Lifecycle:**

1. `generate-map` creates a job (deduplicating identical in-flight requests by prompt hash),
   returns the `jobId` immediately, and kicks off background processing.
2. Background processing ensures ComfyUI is up (starting the bundled service if needed),
   submits the prompt, and **polls** ComfyUI for status every 5 s while a **WebSocket progress
   callback** streams fine-grained step progress. Each progress tick is pushed to Foundry as a
   `map-generation-progress` message so the GM sees a live banner.
3. On completion the backend downloads the image and **uploads it to Foundry via a query**
   (`foundry-mcp-bridge.upload-generated-map`) rather than writing the filesystem directly —
   because the backend and Foundry may be different machines with different paths, only the
   module knows the correct local destination. It then broadcasts `job-completed` with a full
   scene payload, and the module creates (and optionally activates) the scene.
4. **Polling and cancellation.** `check-map-status` reads the job record; `cancel-map-job`
   interrupts the ComfyUI job (if a prompt id was captured) and marks the queue entry
   cancelled. A background timer expires jobs past their TTL (30 min) so the in-memory map
   doesn't grow without bound.

The queue is intentionally in-memory and modest (max 2 concurrent, 3 retries): this is a
single-GM local tool, not a render farm. The important design property is that _the slow path
never blocks the control channel_ — the AI gets an immediate job id and polls, exactly as it
would for any async API.

---

## 7. GM-gating & security

The threat model is simple but real: the bridge can _change the live game world_, and a
Foundry world has non-GM players connected to it. The module must guarantee that only the GM
can drive it, and that even the GM can't fat-finger a destructive bulk operation.

**Defense in depth, in layers:**

1. **The `ready`-hook gate (module).** On `ready`, a non-GM user causes the module to return
   immediately — no socket bridge, no query handlers doing work, no UI. This is silent by
   design: a player gets no error, no hint the bridge exists.
2. **Per-handler GM validation (module).** Every query handler calls `validateGMAccess()`,
   which returns a silent failure if `game.user.isGM` is false. So even if a handler were
   reachable some other way, it does nothing for a non-GM.
3. **Socket-message GM checks (module).** The game-socket listener that syncs player roll
   state only performs world-writing actions (`ChatMessage.update`, settings writes) when
   `game.user.isGM` — so a player client receiving the broadcast can't be tricked into writing.
4. **Risk-classified write permissions (`permissions.ts`).** Write operations are catalogued
   with a risk level — **low** (auto-allowed, e.g. create actor), **medium** (confirmation
   suggested, e.g. modify scene / bulk ops), **high** (confirmation + GM required, e.g. delete
   data, modify world). A master `allowWriteOperations` setting can disable writes entirely;
   bulk operations are bounded by `maxActorsPerRequest` and force confirmation past a small
   threshold. Parameters are validated/sanitized per operation.
5. **Reversible writes (`transaction-manager.ts`).** Multi-step mutations can run inside a
   transaction that records each create/update/delete with enough information to undo it
   (delete what was created, restore originals, recreate what was deleted). On failure the
   transaction rolls back in reverse order; a bounded history is kept for after-the-fact undo.

**Secrets.** The Anthropic API key used by the co-GM lives **only** on the dashboard's Node
server, read from the environment. It is never sent to the browser and never crosses the
control channel.

---

## 8. The co-GM dashboard (`packages/cogm-dashboard`)

A standalone product that turns the same bridge into a **live session companion**. It is
original work (not derived from upstream) and has **no Claude Desktop dependency at runtime** —
it talks to the backend's control channel directly and calls the Anthropic API itself.

**Two halves:**

- **A Node/Express server (`server.ts`).** It owns the secrets and the control-channel client.
  It serves the static browser UI, exposes a REST + **Server-Sent Events** API, and is the only
  thing that ever holds the Anthropic key.
- **A pure browser client.** HTML/CSS/JS that renders the live feed, the combat tracker,
  streamed AI commentary, and the GM-action surface. It only ever talks to its own server.

**The live feed (`feed/`).** `McpControlClient` is a hardened, **read-only, never-spawning**
control-channel client (it dials `31414`, never starts a backend). It is built for a backend
that cycles and can go _half-open_ (TCP still ESTABLISHED while the process is dead): TCP
keepalive, a connect timeout, an application-level `ping` heartbeat that forces a reconnect on
silence, a per-request timeout that **tears down the socket** (so one stall doesn't loop
forever), and a _liveness-aware_ `isConnected` that reports false once the channel goes quiet.
`PollingGameFeed` polls three tools on independent cadences — `get-recent-events` (incremental,
using the returned `latestTimestamp` as a cursor), `get-combat-state`, and `get-module-errors`
— with re-entrancy guards, cursor re-seeding on reconnect, and **hysteresis** so a transient
failure doesn't flap the "Foundry reachable" badge. It distinguishes channel-down (report
`unknown`) from "backend up, Foundry module not connected" (report `unreachable`) using the
typed errors from §4b.

**The AI co-GM (`ai/`).** `CoGm` is a thin wrapper over the Anthropic **Messages API** with
streaming. The large persona/rules/world block carries a `cache_control` breakpoint and is
byte-identical every call (served from the prompt cache after the first request); the volatile
game state goes in the user turn and is never cached. Each request is independent (no growing
conversation), keeping context bounded. Concurrency is **latest-wins**: a direct question
aborts any in-flight auto-comment. Commentary engines auto-generate comments on new events,
combat changes, and (optionally) module errors, debounced and rate-limited. If no API key is
present, the AI is disabled gracefully and the _feed still runs_.

**The GM-action surface (the write half).** The dashboard can invoke **any** bridge tool via
`POST /api/tool`, but with server-side gating that mirrors the module's risk model:

- Tools are classified `read` (the `get-`/`list-`/`search-`/`measure-` prefixes plus a small
  allowlist), `write`, or `destructive` (an explicit set: delete tokens, delete map note,
  remove ownership, clear errors, etc.).
- **Reads are always free.** Writes require a master **GM Actions** switch (off by default) to
  be on **and** an explicit `confirm`. Destructive tools require a _second_ `confirmDestructive`.
  Gating is enforced on the **server**, not in CSS — a hostile browser can't bypass it.
- `send-chat-message` is the one always-available write the co-GM uses to whisper the GM (it
  targets the world's GM names, derived from `get-world-info`).

This is also where the future **player vs GM split** lands: filter GM-only data on the SSE
stream and gate the write surface server-side, behind auth, so a public player view can show
the combat order and public feed without leaking hidden HP, notes, or write access.

---

## 9. Three end-to-end flows

### Flow A — Claude asks "what undead of CR 5 are in my compendiums?"

```
Claude → (MCP/stdio) → wrapper → (control 31414: call_tool list-creatures-by-criteria)
       → backend dispatch → CompendiumTools.handleListCreaturesByCriteria(args)
         │  looks up world systemId, gets DnD5eAdapter from the registry
         │  builds 5e filters {creatureType:"undead", challengeRating:5}
       → foundryClient.query("foundry-mcp-bridge.listCreaturesByCriteria", filters)
       → (Foundry link 31415/31416: {type:"mcp-query", id, data:{method, data}})
       → module socket bridge → CONFIG.queries["foundry-mcp-bridge.listCreaturesByCriteria"]
         │  validateGMAccess() ✓
         │  reads the enhanced creature index, applies the adapter's matchesFilters()
       → {type:"mcp-response", id, data:{success:true, data:[...creatures]}}
       → backend resolves the pending query → adapter.formatCreatureForList(each)
       → control-channel result {content:[{type:"text", text:"<json>"}]}
       → wrapper → Claude sees the tool result and answers in prose
```

Key points: the **registry** decides what "CR 5 undead" means; the **enhanced creature index**
(prebuilt in the browser) makes the filter fast; the result crosses _both_ wire contracts, each
correlating its own id.

### Flow B — Dashboard GM clicks "advance combat turn"

```
Browser → POST /api/tool {name:"advance-combat-turn", confirm:true}
        → server.ts classifyTool() → "write" → checks gmActionsEnabled ✓ and confirm ✓
        → McpControlClient.callTool("advance-combat-turn", args)
        → (control 31414: call_tool) → backend → CombatTools.handleAdvanceCombatTurn
        → foundryClient.query("foundry-mcp-bridge.<advanceTurn>") → module → Foundry combat API
        → response climbs back → server replies {ok:true, ...}
        ── meanwhile ──
        PollingGameFeed's get-combat-state poll picks up the new turn
        → handlers.onCombat() → SseHub.broadcast("combat", …) → browser tracker re-renders
```

Key points: the dashboard uses the **exact same backend** as Claude Desktop (no second
backend), the write is **gated server-side** (switch + confirm), and the _confirmation the GM
sees_ in the UI comes from the live SSE feed, not from the tool's return value.

### Flow C — "Generate a battle map of a goblin war camp"

```
Claude → call_tool generate-map {prompt, scene_name, size}
       → MapGenerationTools.generateMap → JobQueue.createJob → returns {jobId} immediately
       → background: ensure ComfyUI (31411) up → submit prompt → poll status every 5s
         │  ComfyUI WebSocket progress → backend → {type:"map-generation-progress"} → module banner
       → on done: download image → query "foundry-mcp-bridge.upload-generated-map" (module saves
         it to the correct local path) → broadcast {type:"job-completed", scene payload}
       → module creates the Scene (+ walls, + "AI Generated Maps" folder), optionally activates it
   meanwhile Claude polls: call_tool check-map-status {job_id} → queued/generating/complete
```

Key points: the slow operation returns a **job id at once** and never blocks the channel;
progress is pushed to Foundry live; the image is delivered **through the module** (path-correct,
machine-independent) rather than by a filesystem write the backend can't be sure about.

---

## 10. Design principles (why it's shaped this way)

- **The AI sees tools, never Foundry.** Every capability is an MCP tool with a schema; the
  module is the only code with Foundry API access. This is the security boundary and the
  stable contract.
- **Two wire layers, kept separate.** A trusted, process-local control channel (JSON-lines TCP)
  and an untrusted, possibly-remote, possibly-encrypted Foundry link. Each hardens
  independently; the backend bridges them.
- **One backend, many clients.** Splitting the stdio wrapper from the backend lets Claude
  Desktop and the standalone dashboard share a single Foundry link and the single tool surface.
- **Knowledge quarantined behind interfaces.** D&D 5e specifics live in one adapter behind a
  registry; the tool layer speaks to the interface. One adapter today, but the seam is real.
- **Async work is a job, not a held connection.** Map generation returns a job id and streams
  progress; the channel stays responsive.
- **GM-gated, defense in depth.** Silent non-GM gate, per-handler checks, risk-classified
  writes, reversible transactions, and server-side gating on the dashboard. Secrets never reach
  the browser.
- **Built to survive a flaky backend.** Half-open detection, heartbeats, request timeouts that
  reconnect, cursor re-seeding, and reachability hysteresis — because the backend cycles and the
  Foundry tab is just a browser tab.

---

## Appendix — package map

| Package                   | Role                                                                                    | Runs in           |
| ------------------------- | --------------------------------------------------------------------------------------- | ----------------- |
| `packages/mcp-server`     | stdio MCP wrapper + backend (control channel, tools, registry, jobs, Foundry connector) | Node.js (Windows) |
| `packages/foundry-module` | `foundry-mcp-bridge` — the in-Foundry gateway                                           | Foundry's browser |
| `packages/cogm-dashboard` | standalone co-GM dashboard (Node SSE server + browser client)                           | Node.js + browser |
| `shared`                  | shared types/vocabulary                                                                 | both              |
