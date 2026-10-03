# The Co-GM Dashboard

A live, AI-assisted **co-GM screen** that runs in a browser next to Foundry VTT. It watches the
game as it happens — and now lets you **run the game from the dashboard**, too.

![The Co-GM dashboard during a combat](../images/cogm/overview.png)

---

## What it can do

### See the whole table at a glance

- **Live combat tracker** — initiative order, current turn, HP bars, conditions, and death saves,
  all updating in real time.
- **Live event feed** — damage, healing, deaths, conditions, spell slots and more, color-coded by
  type as they happen.
- **Module diagnostics** — a running log of Foundry module errors/warnings so you catch a broken
  module mid-session, with an optional AI "likely cause & fix."

### Before, during and after the session

The first screen follows the evening (the tabs in the header show where you are; click one to
look ahead or back):

- **Before** (no session running): Pre-flight's checks next to Prep (last session, open quests,
  next session notes, handouts waiting). **Ready for session** at the top of Pre-flight turns on,
  in one click, what tonight needs ("Allow Write Operations", the Handouts, Live play, Party
  and Tarokka switches, GM Actions); **End session** turns off again what it turned on. Only the dashboard's
  GM route can do this (the bridge's control method `session_switches`, never an MCP tool), so
  Claude can never switch on its own writes.
- **During** (a session is running, after **Start session**): the Live Feed with the roll
  breakdowns in the middle; the party, handouts with who has seen them, and Recent Changes with
  Undo beside it; the turn order as a slim strip at the top. Turns run in Foundry: the dashboard
  watches, remembers and can take back changes made through the tool.
- **After** (the session ended in the last 12 hours): what happened tonight in Prep, the
  handouts and the changes.

**Advanced** (top right) holds the rest: the Pre-flight, Prep, Party, Handouts and Tarokka panels
(a panel already on the screen is scrolled to; otherwise it opens over the page), the Tool Runner,
the AI co-GM and module diagnostics, and the AI settings (pause, diagnostics AI, tone, model).

### Themes

- **Theme** (in the header): the look for this world, picked by the GM and remembered per world.
  The players' page follows it live. **Neutral** is the Foundry AI Tool brand and suits any
  campaign. **The Veil** is the Curse of Strahd theme: grey-green mist, bone text, one warm
  lamplight for the main action, no red (danger is shown with words on an ink ground).
- **Mist** (shown with The Veil, on the dashboard and in the players' page footer): each screen
  picks its own. **Calm** (the default) is still mist, **Drifting** moves slowly, **Clear air**
  removes it. Drifting stops when the device asks for reduced motion.
- The theme is saved in `dashboard-themes.json` in `COGM_STATE_DIR` (default
  `~/.foundry-ai-tool`). Until the dashboard knows the world (a GM in Foundry), each screen keeps
  the theme it showed last.

### An AI co-GM that watches with you

- **Streaming commentary** — tactical or narrative call-outs when something significant happens
  ("the Goblin Boss is bloodied and prone — press the attack").
- **Ask the co-GM** — type a question like _"who's in trouble?"_ and get an answer grounded in the
  current board state.
- **Whisper to chat** — send any comment straight into Foundry as a GM whisper with one click.

### Run the game from the dashboard

![Multi-select combatants and act on them as a group](../images/cogm/combat-control.png)

- **Click combatants to multi-select**, then act on them as a group.
- **Roll initiative** for NPCs / everyone / just the ones missing it, **advance the turn**, or jump
  to a combatant.
- **Apply damage, healing or a condition** (planned, confirmed, with an **Undo** message after) and
  **roll saving throws** for the selected creatures.

### Do (almost) anything the bridge can do

![The Tool Runner exposes every Foundry bridge tool](../images/cogm/tool-runner.png)

- A built-in **Tool Runner** exposes _every_ Foundry MCP tool behind a simple form: spawn NPCs and
  monsters from compendiums, set the scene's mood/lighting, create quest journals, drop loot, manage
  tokens, and more.
- Tools are grouped by category and searchable, so you can find the one you need fast.

### Safe by default

![Every game-changing action asks for confirmation](../images/cogm/confirm.png)

- Watching the game is **always read-only**.
- Game-changing actions stay off until you flip the **GM Actions** switch (or click **Ready for
  session**, which turns it on for tonight; **End session** turns it off).
- **Every change can be undone.** The GM's own non-destructive dashboard actions apply in one click
  with an **Undo** message; plans from Claude or Obsidian always show a confirm window, and
  **destructive actions** (deletes, reveals) require an explicit second confirm, so there are no
  accidental table-wipes.

---

## Running it

The dashboard is a small standalone app that talks to the **Foundry MCP Bridge** module (so Foundry
must be open with the bridge connected).

```bash
cd packages/cogm-dashboard
# put your Anthropic API key in .env (ANTHROPIC_API_KEY=...) to enable the AI co-GM
npm run dev          # → http://localhost:3000
```

Without an API key the live feed, combat tracker, diagnostics and GM Actions all still work — only
the AI commentary is disabled.
