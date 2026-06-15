# Foundry AI Tool

Give AI models live access to your Foundry VTT session — and control it from a real-time co-GM dashboard.

---

## What it does

Foundry AI Tool is a three-part system: a **Foundry module** that exposes game data and actions over a local socket, an **MCP server** that translates those into Model Context Protocol tools, and a **co-GM dashboard** — a browser-based control surface that watches your session in real time and lets you act on it.

Claude Desktop (or any MCP-compatible client) connects to the MCP server and gets direct access to actors, combat, scenes, compendiums, journals, and more. The co-GM dashboard runs alongside Foundry as a second screen and adds streaming AI commentary, a live combat tracker, and a full tool runner — no AI client needed to use it.

---

## Features

### Co-GM Dashboard

The standout part of this project. A live session control surface that runs in a browser tab or on a tablet beside your table.

![Dashboard overview during combat](docs/images/cogm/overview.png)

- **Live combat tracker** — initiative order, current turn, HP bars, conditions, and death saves updating in real time
- **Live event feed** — damage, healing, deaths, conditions, spell slots, and more, color-coded as they happen
- **AI commentary** — streaming tactical and narrative call-outs when something significant happens; ask questions grounded in the current board state
- **Whisper to chat** — send any comment into Foundry as a GM whisper in one click

![Multi-select combatants and act on them as a group](docs/images/cogm/combat-control.png)

**Run the game from the dashboard:**

- Select combatants and act on them as a group
- Roll initiative for NPCs, advance the turn, jump to a combatant
- Apply damage or healing and roll saving throws for selected creatures

![The Tool Runner exposes every Foundry bridge tool](docs/images/cogm/tool-runner.png)

**Tool Runner** — every Foundry MCP tool is exposed behind a simple form, grouped by category and searchable: spawn NPCs from compendiums, generate AI battlemaps, set scene mood/lighting, create quest journals, drop loot, manage tokens, and more.

![Every game-changing action asks for confirmation](docs/images/cogm/confirm.png)

**Safe by default:**

- Watching the game is always read-only
- Game-changing actions are gated behind a GM Actions switch
- Every write action asks for confirmation; destructive actions (like deleting tokens) require an explicit second confirm

![Responsive layout on tablet](docs/images/cogm/mobile.png)

The layout adapts to phone/tablet width — keep it open on a second screen at the table.

---

### MCP Tools

A selection of the tools, across 8 categories, exposed to any MCP-compatible AI client:

| Category        | Tools                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------- |
| Character       | get-character, list-characters                                                                |
| Compendium      | search-compendium, get-compendium-item, list-creatures-by-criteria, list-compendium-packs     |
| Scene           | get-current-scene, get-world-info, list-scenes, switch-scene                                  |
| Actor creation  | create-actor-from-compendium, get-compendium-entry-full                                       |
| Quest / Journal | create-quest-journal, update-quest-journal, link-quest-to-npc, list-journals, search-journals |
| Campaign        | create-campaign-dashboard                                                                     |
| Ownership       | assign-actor-ownership, remove-actor-ownership, list-actor-ownership                          |
| Dice            | request-player-rolls                                                                          |
| Map generation  | generate-map, check-map-status, cancel-map-job                                                |

Map generation requires a ComfyUI backend.

---

### Supported Systems

- Dungeons & Dragons 5th Edition

Built for D&D 5e. System-specific logic (creature indexing, stat extraction, filters) lives
behind a registry + adapter interface, so support for another system is an adapter away — but
only the D&D 5e adapter ships today.

---

## Installation

### 1. Install the Foundry module

In Foundry VTT → Add-on Modules → Install Module, paste this manifest URL:

```
https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool/releases/latest/download/module.json
```

Enable the module in your world. It requires Foundry v13 or v14.

### 2. Set up the MCP server

Requires Node.js 18+.

```bash
git clone https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool.git
cd Foundry-VTT-MCP-Ai-Tool
npm install
npm run build
```

Add the server to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "foundry": {
      "command": "node",
      "args": ["/absolute/path/to/packages/mcp-server/dist/index.js"]
    }
  }
}
```

The MCP server connects to the Foundry module over a local WebSocket on `127.0.0.1:31414`. Foundry must be running with the module active.

### 3. Run the co-GM dashboard (optional)

```bash
cd packages/cogm-dashboard
# Optional: add ANTHROPIC_API_KEY=... to .env to enable AI commentary
npm run dev
# → http://localhost:3000
```

The dashboard works without an API key — live feed, combat tracker, and GM Actions all function. Only AI commentary requires one.

---

## Co-GM Dashboard

Full documentation: [docs/COGM-DASHBOARD.md](docs/COGM-DASHBOARD.md)

The dashboard is a standalone web app that reads from and writes to Foundry through the same bridge module the MCP server uses. It does not require Claude Desktop or any AI client to be running — it connects directly to the module socket.

Screenshots are in [docs/images/cogm/](docs/images/cogm/).

---

## Attribution

Built on top of [foundry-vtt-mcp](https://github.com/adambdooley/foundry-vtt-mcp) by Adam Dooley (MIT). The MCP server and Foundry module packages are derived from that upstream project. The co-GM dashboard (`packages/cogm-dashboard`) is original work. See [CREDITS.md](CREDITS.md) for full attribution.
