<p align="center">
  <img src="docs/images/brand/banner@2x.png" alt="Foundry AI Tool: live AI access to your Foundry VTT game, and a real-time co-GM dashboard" width="100%">
</p>

<p align="center">
  <a href="https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool/actions/workflows/ci.yml"><img src="https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool/releases/latest"><img src="https://img.shields.io/github/v/release/Gnuminator/Foundry-VTT-MCP-Ai-Tool?sort=semver" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Foundry-v14-fe6a1f" alt="Foundry v14">
  <img src="https://img.shields.io/badge/system-dnd5e-e63946" alt="D&D 5e">
</p>

---

Foundry AI Tool lets Claude **see and act on** a live Foundry VTT game, with the GM approving every
planned change. It also gives the GM a browser **co-GM dashboard** that watches the table in real
time, a **spoiler-safe page for the players**, and **Obsidian notes** of every session.

Claude Desktop (or any [MCP](https://modelcontextprotocol.io) client) connects to the bridge and
gets GM-gated tools for actors, combat, scenes, compendiums, journals and more. The dashboard works
on its own too: **no AI client is needed** to use it. Built for **Foundry 14 with dnd5e 6**, and
currently shaped around a Curse of Strahd campaign.

> **New here?** GMs start with the **[GM guides](docs/gm/README.md)**. Players read the
> **[player guide](docs/player/README.md)**. Everything else is in the
> **[documentation index](docs/README.md)**.

<p align="center">
  <img src="docs/images/brand/demo.gif" alt="Foundry AI Tool: the co-GM dashboard in action, with the live combat tracker, the GM tool runner, confirm-gated actions and the brand lockup" width="100%">
</p>

## What it does

- **AI access to the game.** 91 tools let Claude read characters, combat, scenes, journals,
  compendiums, chat and the session log, and act on them: roll for NPCs, apply damage, move tokens,
  add NPCs from compendiums, write journals.
- **Guarded AI writes with undo.** New features change the game in three steps: plan, confirm with a
  diff, apply. Each feature has its own switch in the module settings (off by default). A change is
  refused if anything changed since the plan, is recorded, and can be undone from the dashboard.
- **Tarokka reading (Curse of Strahd).** Deal a reading with the built-in roll, or import one dealt
  in the `tarokka-reading` module. The cards are kept GM-only, outside Foundry's world data. Link
  each card to a journal page, scene or actor, and reveal a card to players with only the text you
  write.
- **Spoiler-safe player page.** `/player` is built by projection from what players can see in
  Foundry: hidden creatures never appear, unknown names read "Unknown creature", enemies show no HP
  numbers, and private, blind and GM rolls stay out.
- **Handouts.** Reveal a journal page to the players. It appears on the player page with GM secrets,
  inline rolls and links to unrevealed pages removed, and becomes readable in Foundry.
- **Play log and stats.** The GM's client records rolls (with a full breakdown), HP (credited to the
  roll that caused it, when it can tell), rests, combat, items and chat, per user. Stats per session
  and per PC.
- **Obsidian notes.** One note per play session, the change history, the Tarokka reading, stats,
  and an optional mirror of the Foundry world (PCs, NPCs, scenes, journals, items) with links back
  into Foundry. Notes you edit are never overwritten.
- **Co-GM dashboard.** Live combat tracker and event feed, combat controls, a tool runner for every
  tool, Recent Changes with Undo, a Tarokka drawer and play session markers.

## The parts

| Part                                      | What it is                                                                                 | Runs in           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------- |
| **Foundry module** (`foundry-mcp-bridge`) | A GM-gated gateway inside Foundry: bridge handlers, the play recorder, the version adapter | a GM's browser    |
| **Bridge** (MCP server)                   | MCP tools, guarded writes, the GM-only bridge vault, the Obsidian renderer                 | Node.js           |
| **Co-GM dashboard**                       | The GM's control panel and the players' `/player` page                                     | Node.js + browser |

```
  Claude / MCP client ──(MCP)──► bridge ──(socket)──► Foundry module ──► your game
                                   ▲  │
  Co-GM dashboard ──(control)──────┘  └──► Obsidian notes (one way)
```

> Architecture deep-dive: **[docs/dev/ARCHITECTURE.md](docs/dev/ARCHITECTURE.md)**.

---

## Co-GM dashboard

A live session control surface that runs in a browser tab on a second screen.

![Dashboard overview during combat](docs/images/cogm/overview.png)

- **Live combat tracker:** initiative order, current turn, HP bars, conditions and death saves, in
  real time.
- **Live event feed:** damage, healing, deaths, conditions, spell slots and dice rolls with their
  breakdown, as they happen.
- **Recent Changes:** every guarded change, with Undo.
- **Play sessions:** Start and End session in the header; Obsidian notes follow these markers.
- **Tarokka drawer:** the reading (cards hidden until you choose to show them), links, reveals.
- **AI commentary (optional):** streaming call-outs and an Ask box. This uses the paid Anthropic API
  and only runs when an `ANTHROPIC_API_KEY` is set; everything else works without it.

![Multi-select combatants and act on them as a group](docs/images/cogm/combat-control.png)

**Run the game from the dashboard:** multi-select combatants and act on them as a group: roll
initiative for NPCs, advance the turn, apply damage or healing, roll saving throws.

![The Tool Runner exposes every Foundry bridge tool](docs/images/cogm/tool-runner.png)

**Tool runner:** every bridge tool behind a searchable, categorized form. Every parameter that names
something (an actor, a token, a journal page, a plan) has **Pick…**, a list of what exists now.

![Every game-changing action asks for confirmation](docs/images/cogm/confirm.png)

**Safe by default:** watching is always read-only; game-changing actions stay off until you flip the
**GM Actions** switch; every write asks for confirmation, a planned change shows its diff, and
destructive actions need a second confirmation.

> Full tour for GMs: **[docs/gm/dashboard.md](docs/gm/dashboard.md)**.

---

## Hosting and remote access

The bridge and the dashboard are decoupled, so they can run where it suits the table.

- **Loopback by default.** The bridge's Foundry link and the dashboard listen on `127.0.0.1` only.
  `FOUNDRY_LINK_HOST` / `DASHBOARD_HOST` open them to other interfaces; the dashboard refuses a
  non-loopback address without `GM_DASHBOARD_TOKEN`, and answers only host names on its allowlist
  (`DASHBOARD_ALLOWED_HOSTS`).
- **Standalone bridge.** Run the bridge without Claude Desktop: `npm run bridge:standalone` (host and
  port injectable; Windows service scaffold in [`deploy/windows/`](deploy/windows/)).
- **Player vs GM split.** With a GM token (or a Cloudflare Access email allow-list) the GM surface
  needs GM credentials and everyone else gets the read-only player view. The player endpoints
  always project, even when a GM token is presented.
- **Home server.** The plan is to run Foundry, the bridge and the dashboard on an Orange Pi 5 Pro at
  home: see [docs/dev/PI-SETUP.md](docs/dev/PI-SETUP.md). Remote access templates (Cloudflare
  Tunnel and Access, Docker) are in [docs/dev/REMOTE-ACCESS.md](docs/dev/REMOTE-ACCESS.md) and
  [`deploy/`](deploy/); they are templates, not a one-click deploy, and the exposure method is
  settled during the Pi setup.

---

## MCP tools

91 tools, by area:

| Area                         | Tools                                                                                                                                                                                                                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Characters                   | `get-character`, `get-character-entity`, `list-characters`, `get-character-resources`, `update-character-resource`, `search-character-items`, `use-item`, `manage-rest`                                                                                                                                                |
| Combat and rolls             | `get-combat-state`, `get-combat-play-by-play`, `roll-initiative-for-npcs`, `set-initiative`, `advance-combat-turn`, `apply-damage-and-healing`, `roll-saving-throws`, `roll-npc-check`, `use-npc-activity`, `request-player-rolls`, `request-ability-check`, `request-attack-roll`                                     |
| Conditions and effects       | `get-active-effects`, `get-available-conditions`, `toggle-token-condition`, `clear-stale-conditions`                                                                                                                                                                                                                   |
| Scenes and tokens            | `get-current-scene`, `list-scenes`, `switch-scene`, `set-scene-mood`, `get-token-positions`, `get-token-details`, `move-token`, `update-token`, `delete-tokens`, `measure-distance`, `get-targets`, `set-token-vision-light`, `place-measured-template`, `delete-measured-template`, `add-map-note`, `delete-map-note` |
| Compendium and NPCs          | `search-compendium`, `get-compendium-item`, `get-compendium-entry-full`, `list-compendium-packs`, `list-creatures-by-criteria`, `create-actor-from-compendium`, `dnd5e-create-npc`, `dnd5e-add-feature`, `dnd5e-add-features-from-compendium`, `suggest-balanced-encounter`                                            |
| Journals and quests          | `list-journals`, `search-journals`, `create-quest-journal`, `update-quest-journal`, `link-quest-to-npc`, `create-campaign-dashboard`                                                                                                                                                                                   |
| Items and loot               | `drop-loot`, `manage-world-items`                                                                                                                                                                                                                                                                                      |
| Chat, logs and play sessions | `get-chat-log`, `send-chat-message`, `get-recent-events`, `get-session-log`, `mark-play-session`, `get-play-session`, `get-play-stats`                                                                                                                                                                                 |
| Guarded changes              | `get-planned-change`, `apply-planned-change`, `list-recent-changes`, `undo-change`, `open-in-foundry`                                                                                                                                                                                                                  |
| Tarokka                      | `get-tarokka-reading`, `plan-tarokka-import`, `suggest-tarokka-links`, `plan-tarokka-links`, `plan-tarokka-reveal`                                                                                                                                                                                                     |
| Player view and handouts     | `get-player-visibility`, `list-revealed-pages`, `get-player-handouts`, `plan-page-reveal`, `check-secret-terms`                                                                                                                                                                                                        |
| Obsidian                     | `get-obsidian-mirror`, `plan-obsidian-mirror`                                                                                                                                                                                                                                                                          |
| Ownership                    | `assign-actor-ownership`, `remove-actor-ownership`, `list-actor-ownership`                                                                                                                                                                                                                                             |
| World and diagnostics        | `get-world-info`, `get-modules`, `get-module-manifest`, `get-module-errors`, `clear-module-errors`, `list-ref-choices`                                                                                                                                                                                                 |

---

## Supported systems

- **Dungeons & Dragons 5th Edition** (dnd5e 6 on Foundry 14)

System-specific logic (creature indexing, stat extraction, filters) lives behind a registry and
adapter interface, so another system is an adapter away, but only the D&D 5e adapter ships today.

---

## Installation

### 1. Install the Foundry module

In Foundry VTT, **Add-on Modules**, **Install Module**, paste this manifest URL:

```
https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool/releases/latest/download/module.json
```

Enable it in your world (requires Foundry **v14** with the dnd5e 6 system).

### 2. Set up the bridge (MCP server)

Requires Node.js 18+.

```bash
git clone https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool.git
cd Foundry-VTT-MCP-Ai-Tool
npm install
npm run build
```

Add the server to your Claude Desktop config (`claude_desktop_config.json`), then restart Claude
Desktop:

```json
{
  "mcpServers": {
    "foundry-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/packages/mcp-server/dist/index.js"]
    }
  }
}
```

The bridge links the AI client and the Foundry module over local sockets (control channel on
`127.0.0.1:31414`; Foundry link on `31415`/`31416`). Foundry must be open in a GM's browser with
the module active. For Obsidian notes, add `"env": { "FOUNDRY_AI_OBSIDIAN_DIR": "<your vault
folder>" }` to that entry.

### 3. Run the co-GM dashboard

```bash
npm run dev:cogm              # → http://localhost:3000 (the player page is /player)
```

The dashboard works without an API key: live feed, combat tracker, tool runner, Recent Changes,
Tarokka and the player page all function. Only the optional AI commentary needs
`ANTHROPIC_API_KEY` (see `packages/cogm-dashboard/.env.example`). To run it with Claude Desktop
closed, start the bridge standalone first: `npm run bridge:standalone`.

---

## Documentation

| Doc                                                     | What                                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [GM guides](docs/gm/README.md)                          | Getting started, the dashboard, asking Claude, session checklists, troubleshooting |
| [Player guide](docs/player/README.md)                   | What players see, what is recorded, which parts reach an AI                        |
| [Documentation index](docs/README.md)                   | Every folder: guides, developer docs, reference, plans, history                    |
| [ARCHITECTURE.md](docs/dev/ARCHITECTURE.md)             | The system from first principles: the wire contracts, GM-gating, guarded writes    |
| [REMOTE-ACCESS.md](docs/dev/REMOTE-ACCESS.md)           | Remote access setup and deploy templates                                           |
| [PI-SETUP.md](docs/dev/PI-SETUP.md)                     | Bringing up the Orange Pi home server                                              |
| [CHANGELOG.md](CHANGELOG.md) · [CREDITS.md](CREDITS.md) | Releases · attribution                                                             |

---

## Attribution

Built on top of [foundry-vtt-mcp](https://github.com/adambdooley/foundry-vtt-mcp) by Adam Dooley (MIT).
The MCP server and Foundry module packages are derived from that upstream project; the co-GM dashboard
(`packages/cogm-dashboard`) is original work. Full attribution in [CREDITS.md](CREDITS.md).

---

<p align="center">
  <img src="docs/images/brand/logo-reveal.gif" alt="Foundry AI Tool" width="540">
</p>

---

Foundry AI Tool is an independent project, not affiliated with or endorsed by Foundry Gaming LLC.
