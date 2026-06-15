# Dependency-patch live smoke-test checklist (user-driven)

The Phase 6 dependency-security patch (2026-06-15) touched **shipping runtime** code paths that
cannot be exercised from a dev session — they need the live bridge, which is owned by Claude Desktop
on `127.0.0.1:31414`/`31415`. This checklist is the **acceptance gate** for the patch. Run it
**yourself** (step 2 restarts Claude Desktop, which ends any in-app Claude Code session).

> Everything here already passed the automated gate (wiped build, typecheck, 1078 tests, esbuild
> bundle with werift 0.23 inlined, schema smoke, manifest). What's left is the **runtime** confirm of
> the four shipping bumps below — nothing in CI can bind the live ports.

## What changed (runtime-shipping only)

| Dep                         | From → To       | Live path it affects                                                    |
| --------------------------- | --------------- | ----------------------------------------------------------------------- |
| `werift`                    | 0.17.7 → 0.23.0 | **WebRTC** Foundry link (port `31416`) — only when Foundry is **HTTPS** |
| `@modelcontextprotocol/sdk` | 1.7.0 → 1.29.0  | **stdio MCP handshake** between Claude Desktop and the wrapper          |
| `axios`                     | 1.6.x → 1.18.0  | backend → **ComfyUI** map-generation HTTP calls (port `31411`)          |
| `ws`                        | 8.14.x → 8.21.0 | **WebSocket** Foundry link (port `31415`) — when Foundry is **HTTP**    |

> **`werift` is only on the WebRTC path.** A typical localhost **HTTP** Foundry uses the plain
> **WebSocket** transport (`ws`, port `31415`) and never loads werift. werift activates only when
> Foundry is served over **HTTPS** (the browser can't open `ws://` from an HTTPS page, so the module
> POSTs a WebRTC offer to `http://localhost:31416/webrtc-offer`). To exercise werift you must either
> run Foundry over HTTPS, or force `FOUNDRY_CONNECTION_TYPE=webrtc` (env on the backend).

## Before you start

- Rebuild/repackage the server from this commit (`npm run build:release`) and install that build, so
  the bundled `backend.bundle.cjs` carries werift 0.23 + the MCP SDK 1.29 bump.
- Close any Foundry world with the bridge enabled (you'll re-open it).

## Checklist

### 1. Install the patched server build

- [ ] Install the freshly-built server (installer `.exe`, or point the Claude Desktop MCP config at the
      rebuilt `dist/`). Confirm it's the build from the dep-patch commit.

### 2. Restart Claude Desktop (confirms the MCP SDK 1.29 stdio handshake)

- [ ] Fully quit and reopen Claude Desktop. **(Ends any in-app Claude Code session — expected.)**
- [ ] Confirm the `foundry-mcp` server shows **connected/ready** in Claude Desktop (the tool list
      loads). A failed list/handshake here would implicate the MCP-SDK 1.7→1.29 bump.

### 3. Open Foundry as GM — confirm the Foundry link

- [ ] Launch the world as **GM** with the bridge enabled.
- [ ] **HTTP localhost (default):** confirm the module reports **Connected** on `31415` (the `ws`
      path). This confirms the `ws` 8.21 bump.
- [ ] **HTTPS / WebRTC (the werift confirm):** if your Foundry is HTTPS (or you set
      `FOUNDRY_CONNECTION_TYPE=webrtc`), confirm the module connects via **WebRTC** — the backend log
      shows `[WebRTC] Data channel opened` / `Peer connection fully established`, and queries return.
      **This is the werift 0.23 live confirm.** A DTLS/ICE failure (`ICE connection failed`,
      `Peer connection failed - DTLS handshake may have failed`) would implicate werift.

### 4. Verify reads through the bridge

- [ ] In the co-GM dashboard (or via Claude), confirm a **read tool** returns live data (current scene
      / character list / world info). This proves a full round-trip over whichever transport won.

### 5. (Optional) Exercise the bumped HTTP + write paths

- [ ] **axios / ComfyUI:** if you use map generation, kick off a `generate-map` and confirm it
      progresses (confirms axios 1.18 → ComfyUI on `31411`).
- [ ] **One write:** advance a combat turn (or post a chat whisper) and confirm it lands — proves the
      write path over the patched transport.

## Pass / fail

- **PASS** — Claude Desktop loads the tool list (MCP SDK ok), the module connects (ws and/or werift),
  and a read returns real data. If you tested WebRTC, the DataChannel opened. Record it and proceed.
- **FAIL** — note the exact step + any console/module/backend error text. Likely suspects by symptom:
  - tool list won't load → MCP SDK 1.29
  - HTTP Foundry won't connect on `31415` → `ws` 8.21
  - HTTPS Foundry won't connect / DTLS or ICE errors on `31416` → **werift 0.23** (the breaking bump)
  - map-gen stalls → axios 1.18 / ComfyUI

## Rollback (if werift 0.23 fails the WebRTC handshake)

werift 0.23 is the only **breaking** runtime bump. If WebRTC regresses and HTTP/ws works fine, you can
temporarily pin back while we investigate:

```
npm install werift@0.17.7 -w @gnuminator/mcp-server   # revert the breaking bump only
npm run build:release                                  # rebundle
```

This re-introduces the `uuid` bounds-check advisory (moderate, WebRTC-only) but restores 0.17 behavior.
Report the backend WebRTC log so a fresh session can diff the 0.17→0.23 ICE/DTLS path.

## Notes

- The assistant **cannot** observe steps 2–5 (the restart ends its session) — by design.
- Do **not** run a second backend from a dev session during the test — it would bind
  `31414`/`31415`/`31416` and collide with the live bridge.
