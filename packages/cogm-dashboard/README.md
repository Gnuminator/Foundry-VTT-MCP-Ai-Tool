# The dashboard

A standalone live **dashboard with AI commentary** for the Foundry VTT MCP bridge. It watches the
running game, streams an AI Game Master's-assistant commentary to a browser
dashboard, and can optionally post a chosen comment back to Foundry chat.

> **Why a separate app?** MCP / Claude Desktop can only respond when _you_
> prompt it — it cannot react to the game on its own. To get genuinely live,
> autonomous reactions, this dashboard **pulls** the game feed off the bridge's
> control channel and drives the **Anthropic Messages API** itself.

## What it does

- **Live event feed** — polls the bridge's `get-recent-events` delta (~every 4s)
  using the returned `latestTimestamp` as an incremental cursor.
- **Combat tracker** — initiative order, HP bars, conditions, and death saves
  from `get-combat-state`.
- **Streaming AI commentary** — when something significant happens (damage,
  death, conditions, combat start/turn, resource spend), the AI streams one
  short tactical or narrative comment. Comments are **batched and rate-limited**,
  never one-per-event.
- **Ask the AI** — type a question and get a streamed answer grounded in the
  current game state.
- **Post to chat** _(the only thing that mutates the game)_ — push a chosen
  comment into Foundry as a GM whisper.
- **Live module diagnostics** — polls `get-module-errors` and streams other
  modules' errors/warnings to a diagnostics pane; the AI can offer a likely
  cause/fix on new errors (toggleable "Diag AI", rate-capped, and deferred so it
  never preempts combat commentary).

Everything else is strictly read-only.

## Architecture

```text
 Foundry VTT  ──►  MCP backend  ──(JSON-lines TCP 127.0.0.1:31414)──►  Dashboard
  (browser)        (bridge)              control channel                   │
                                                                           ├─ PollingGameFeed  (get-recent-events / get-combat-state / get-module-errors)
                                                                           ├─ GameState        (bounded rolling window + combat snapshot)
                                                                           ├─ CoGm             (@anthropic-ai/sdk, streaming + prompt caching)
                                                                           ├─ CommentaryEngine + ErrorCommentaryEngine (batch / debounce / cap)
                                                                           └─ Express + SSE    ──►  browser dashboard (4 panes)
```

The feed sits behind a `GameFeed` interface (`src/feed/types.ts`), so the
polling implementation can later be swapped for a push source
without touching the rest of the app.

### Files

| Path                             | Role                                                              |
| -------------------------------- | ----------------------------------------------------------------- |
| `src/feed/mcp-control-client.ts` | Reconnecting JSON-lines client for the control channel            |
| `src/feed/polling-feed.ts`       | `GameFeed` impl — incremental event + combat polling              |
| `src/state.ts`                   | Bounded view of the game (rolling events + combat snapshot)       |
| `src/ai/prompt.ts`               | Persona / 5e reference, event-significance rules, prompt assembly |
| `src/ai/anthropic-co-gm.ts`      | Streaming Messages API wrapper with prompt caching                |
| `src/ai/commentary.ts`           | Batches/debounces events into paced comments                      |
| `src/ai/error-commentary.ts`     | Batches module errors into paced diagnostics comments             |
| `src/sse.ts`                     | Server-Sent Events hub                                            |
| `src/server.ts`                  | Express wiring, REST + SSE endpoints                              |
| `public/`                        | Vanilla-JS dashboard (no build step)                              |
| `web/`                           | The React dashboard (preview at `/next/`, built by Vite)          |

## Setup

From the repo root (installs all workspaces including this one):

```bash
npm install
```

Then configure this package:

```bash
cd packages/cogm-dashboard
cp .env.example .env
# edit .env and set ANTHROPIC_API_KEY
```

## Run

Make sure the **MCP bridge is running** (it owns the control channel on
`127.0.0.1:31414`) and Foundry is open with your world loaded. Then:

```bash
# from packages/cogm-dashboard
npm run dev
```

Open **<http://localhost:3000>**.

Other scripts: `npm run build` (compile to `dist/`), `npm run start` (run the
built server), `npm run typecheck`, `npm run lint`.

> Tip: from the repo root you can run it without `cd` via
> `npm run dev --workspace=packages/cogm-dashboard`.

## The React dashboard (preview at `/next/`)

The dashboard pages are moving to React + TypeScript (D-109), one panel at a time. The new page
lives in `web/` and is served at **`/next/`**, next to the old page at `/`, until every panel has
moved and the default switches. It uses Radix UI primitives (unstyled), TanStack Query for the
data, and the old stylesheets and themes as they are (it links `styles.css`, `moments.css` and
`themes/` from `public/`), so it looks the same. It talks to the same routes with the same GM
token. Ported so far: Player links, Module diagnostics, Pre-flight (with Ready for session),
Prep, Party, Handouts, Tarokka, the Tool runner, the Advanced menu (its panel and tool entries;
Pre-flight stays in the header with its status) and the Before / During / After views, with
Pre-flight, Prep, Party and Handouts docked in them. Still on the old page only: the During
layouts and folds, Combat Tracker, Live Feed, Recent Changes, the After stats and session notes,
the feature cards, the AI commentary and the header's session marker, GM Actions switch and theme
picker.

- `npm run build` also builds it (Vite) into `dist/web`; the server serves that folder at
  `/next/`. The Docker image and the Pi get it with the rest of `dist/`.
- `npm run dev:web` runs Vite on <http://localhost:5173/next/> with hot reload and passes `/api`
  and the old assets to a running dashboard (`COGM_DEV_TARGET`, default the test dashboard on
  `http://127.0.0.1:3100`).
- `npm run test:e2e` runs the Playwright browser tests in `web/e2e` against the built server
  (no bridge; each test fakes the routes it needs). Build first. They need Playwright's Chromium
  (`npx playwright install chromium`) or `PLAYWRIGHT_CHANNEL=msedge`. CI runs them on Node 22.
- `npm run test:visual` runs the screenshot tests in Docker; see "Screenshot tests" below.
- Usage names go in `data-track="..."` as string literals, as on the old page;
  `npm run usage:catalog` scans `web/src` too.

### Building a panel

A new port starts from the components in `web/src/ui` (UI-02), not from raw markup:

- **Shell:** `Panel` is the one frame for a panel: a head (title, the "?" help, a line under the
  title, a status, the actions), a body and a foot. `Drawer` and `OverlayPane` are built on it, so
  a drawer or a pane over the page gets it for free; a panel docked in a view is a `Drawer` too.
  `Card`, `Section`, `Stat` and `Pill` are the pieces inside a body, and `Button` / `IconButton`
  are the buttons.
- **Radix set (UI-04):** the Radix primitives come from the `radix-ui` package (`import { Dialog,
Tooltip } from 'radix-ui'`), not the single `@radix-ui/react-*` ones. `web/src/ui` adds three styled
  wrappers on the tokens: `Tooltip` (one `TooltipProvider` at the root, in `main.tsx`), `Tabs`
  (`Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`) and `Popover`. Every icon-only button has a
  `Tooltip`: `IconButton` has one built in (the label, or `tip`), and the "?" in a pane's title is
  wrapped in it. A tooltip is a hint, not the name: keep the `aria-label` and drop the native
  `title`. It opens on hover and on a Tab stop, not when the page moves the focus itself, so it
  never shows in a screenshot. Storybook stories for these come with UI-03.
- **States:** a panel is in one of six: `ready`, `loading`, `empty`, `error`, `bridge-down` and
  `gated`. Give `Panel` (or `Drawer` / `OverlayPane`) a `state` and, if the default text does not
  fit, a `stateMessage`; anything but `ready` replaces the body. For data from a query, do not
  write "Loading…" and "Couldn't load ..." by hand: wrap the content in
  `<QueryState query={q} errorLabel="Couldn't load the party" isEmpty={...} empty="...">` (it
  takes a function of the data as its child), or call `panelStateOf(q)` to get the state for
  `Panel`. Inside a list use `as="li"`; `keepData` keeps showing older rows when a refetch fails;
  `detect` tells the bridge being down (`ApiError.kind === 'channel'`) and GM Actions being off
  from any other error. `EmptyState`, `ErrorState`, `LoadingState` and `Skeleton` are the blocks
  underneath.
- **Tokens:** the spacing (`--space-1` to `--space-8`, 4 px grid), type (`--text-2xs` to
  `--text-xl`), motion (`--dur-fast`, `--dur-base`, `--dur-slow`, `--ease-out`, `--ease-in-out`,
  and `--ease-mist`, which The Veil sets slower), layer (`--z-drawer`, `--z-drawer-top`,
  `--z-confirm`, `--z-popover`, `--z-toast`, ...) and focus (`--focus-ring`) tokens live in
  `public/themes/brand.css` (The Veil's overrides in `veil.css`). Use them in new rules instead of
  numbers; never write a `z-index` number in a component or in `next.css`.
- **Styles:** a new rule goes in a CSS Module next to its component (`Thing.module.css`, Vite
  built in) and reads the tokens. Do not edit `public/styles.css` or `public/moments.css`: the old
  page shares them. The components render the old class names (`.pane`, `.drawer`, `.pane-title`,
  `.empty`, `.btn`, ...), so those files still style them.
- **Keep what the tests and the guide rely on:** the outer classes, the DOM where an old CSS
  selector depends on it, every element `id`, every `data-track="dash...."` name (written out as a
  string literal at the call site, the test kit clicks them), roles and accessible names.
- **Prove it:** a screen that moves onto these components must leave `npm run test:visual` at zero
  diffs. Unit tests for the components render to a string with `react-dom/server`
  (`web/src/ui/*.test.tsx`, run by `npm test`).

### Screenshot tests

`web/visual` photographs the React page with Playwright's `toHaveScreenshot`: the three moments
(Before, During, After), every ported drawer and pane open over the page, the Advanced menu and
the version banner, each in the neutral and the Veil theme (mist calm) at 1440, 1080 and 390 pixels
wide. That is 78 baseline PNGs in `web/visual/__screenshots__/<width>/`. The fakes are the e2e
helpers (`web/e2e/support.ts`); the data in `web/visual/fixtures.ts` is made up, with the clock
fixed, animations off and the browser in UTC and en-US, so a run is the same every time. The same
screens also go through axe at 1440 (serious and critical violations fail; the ones already there
are listed with the reason in `web/visual/axe-known.ts`, and only a new one fails; an entry that
no longer matches on its screen and theme also fails, so the list shrinks as causes are fixed).
The comparison is near exact: `maxDiffPixels: 0` and a colour `threshold` of 0.02 (Playwright's
default is 0.2, which lets a nudged grey pass; at 0 the rounded edge of one pill, the Player links
header, flickered between runs). No `mask` is used today because the clock is fixed and all data
is faked; a port with values that move on their own (Combat Tracker, Live Feed) adds a `mask`
helper for those elements.

- **Run them in Docker, not on the host.** The baselines are made on Linux only, in the Playwright
  image `mcr.microsoft.com/playwright:v<version>-noble`, because fonts and anti-aliasing differ per
  operating system: a Windows or macOS run would differ from the PNGs and from CI.
  `scripts/visual-docker.mjs` takes the image tag from the installed `@playwright/test` version.
- `npm run build -w @gnuminator/cogm-dashboard` first (the container serves `dist/` from the repo),
  then `npm run test:visual -w @gnuminator/cogm-dashboard` to check. Extra arguments go to
  Playwright: `npm run test:visual -w @gnuminator/cogm-dashboard -- -g party`.
- `npm run test:visual:update -w @gnuminator/cogm-dashboard` writes new baselines after a change
  you meant. Look at the PNGs in the diff, then commit them with the change.
- The container mounts the repo at `/work` but keeps its own `node_modules` in two named Docker
  volumes (`foundry-ai-tool-visual-node-modules`, `foundry-ai-tool-visual-dashboard-node-modules`),
  filled by `npm ci --ignore-scripts` the first time and again when `package-lock.json` changes.
  Remove them with `docker volume rm` to start clean. Snapshots and `test-results/visual` are
  written into the repo.
- `npm run test:visual:ci` is what runs inside the container (CI uses it directly, in the job
  `dashboard-visual`). A diff fails that job. The report with the expected, actual and diff
  images is the artifact `dashboard-visual-report` on the run's summary page (kept 14 days). The
  job is advisory: it is not in the required checks. After a Playwright bump, change the image
  tag in `.github/workflows/ci.yml` too (the job's first step fails with a message when they
  differ) and refresh the baselines.

### Bundle budget

`npm run bundle:budget -w @gnuminator/cogm-dashboard` (after a build) reads `dist/web`, adds up
the first-load JavaScript (the entry script and the modulepreload links in `index.html`) and
checks it and every lazy chunk against a gzip limit recorded in `scripts/bundle-budget.mjs`: the
size on 2026-10-10 plus 10 percent, rounded up to the next KB. A lazy chunk is matched by its name
without the hash; an unlisted one gets a default limit. It fails when one is over, and CI runs it
after the build and writes the table to the job summary. To raise a limit on purpose, change the
constant in the same pull request and say why.

The dashboard runs **without** an API key too — you still get the live feed and
combat tracker; only the AI panes are disabled until a key is set.

## Configuration

All via `.env` (see `.env.example`):

| Variable                                | Default               | Purpose                                             |
| --------------------------------------- | --------------------- | --------------------------------------------------- |
| `ANTHROPIC_API_KEY`                     | —                     | Enables AI commentary / ask (never committed)       |
| `ANTHROPIC_MODEL`                       | `claude-opus-5-5`     | Default model (switchable live in the UI)           |
| `POLL_INTERVAL_MS`                      | `4000`                | Event-delta poll cadence                            |
| `COMBAT_POLL_INTERVAL_MS`               | = poll interval       | Combat-state poll cadence                           |
| `COMMENT_MIN_INTERVAL_MS`               | `20000`               | Minimum spacing between auto-comments               |
| `COMMENT_DEBOUNCE_MS`                   | `1500`                | Window that batches an event burst into one comment |
| `MCP_CONTROL_HOST` / `MCP_CONTROL_PORT` | `127.0.0.1` / `31414` | Bridge control channel                              |
| `PORT`                                  | `3000`                | Dashboard HTTP/SSE port                             |
| `COGM_TONE`                             | `tactical`            | Starting tone (`tactical` \| `narrative`)           |

Additional knobs (all optional — defaults shown; see `.env.example`):

| Variable                        | Default | Purpose                                                |
| ------------------------------- | ------- | ------------------------------------------------------ |
| `ERROR_POLL_INTERVAL_MS`        | `6000`  | Module-diagnostics poll cadence                        |
| `COGM_MAX_ERRORS`               | `100`   | Rolling module-error buffer size                       |
| `COGM_COMMENT_ON_ERRORS`        | `true`  | AI auto-comments on new module errors (UI: "Diag AI")  |
| `ERROR_COMMENT_MIN_INTERVAL_MS` | `60000` | Minimum spacing between diagnostics comments           |
| `MCP_REQUEST_TIMEOUT_MS`        | `15000` | Per-request timeout (a timeout forces a reconnect)     |
| `MCP_CONNECT_TIMEOUT_MS`        | `5000`  | TCP connect timeout                                    |
| `MCP_HEARTBEAT_INTERVAL_MS`     | `10000` | Heartbeat ping cadence (half-open detection)           |
| `MCP_STALENESS_THRESHOLD_MS`    | `30000` | Window after last reply before the channel reads stale |

## Player vs GM split (Phase 6)

The dashboard can serve a **read-only player view** alongside the full **GM view**, with all
GM-only data filtered **server-side** (never just hidden in the browser).

- **Opt-in.** With no `GM_DASHBOARD_TOKEN` and no `GM_EMAILS` set, the dashboard stays in
  single-user GM mode (today's zero-config localhost behavior). Setting either turns the split on.
- **GM view** (`/`) — everything, as before. When the split is on, open it once with
  `http://host:3000/?token=<GM_DASHBOARD_TOKEN>`; the token is remembered in that browser.
- **Player view** (`/player`) — public **combat order** + public **event feed** only. Filtered
  server-side: exact enemy/NPC HP is removed, GM-hidden combatants are dropped, event details
  (which carry HP before/after) are stripped, and module diagnostics, settings, the AI commentary,
  and the entire write/GM-action surface are never sent. Players still see the party's HP and the
  public feed.
- **Auth.** GM identity is proven by a token (header `X-CoGM-Token`, `?token=` query, or `cogm_token`
  cookie) **or** a Cloudflare Access email in `GM_EMAILS`. The write endpoints (`/api/ask`,
  `/api/control`, `/api/post-chat`, `/api/tools`, `/api/tool`) return 403 for non-GMs. The Anthropic
  key always stays server-side.

Configure via `.env` (see `.env.example`): `GM_DASHBOARD_TOKEN`, `PLAYER_DASHBOARD_TOKEN`,
`GM_EMAILS`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `PLAYER_SHOW_ENEMY_CONDITIONS`, `PLAYER_SHOW_ENEMY_HP_BANDS`.
For exposing this to a remote GM/players behind Cloudflare Access, see
[`docs/dev/REMOTE-ACCESS.md`](../../docs/dev/REMOTE-ACCESS.md).

## Cost control

- **Prompt caching.** The large static persona + 5e reference + campaign context
  carries a `cache_control` breakpoint and is byte-identical every request, so
  it is served from Anthropic's prompt cache after the first call. Tone and live
  game state live in the (uncached) user turn, so the cache stays warm across
  tone switches and turns. The UI shows `cache ✓` / `cache miss` and token counts
  per generation. (Note: prompt caching only kicks in once the cached prefix
  clears the model's minimum cacheable size — ~4 K tokens on Opus, ~2 K on
  Sonnet; the static block is sized with this in mind.)
- **Bounded context.** Each request is independent (no growing conversation) and
  includes only a combat snapshot plus a rolling window of recent events — never
  the full session history.
- **Batched, capped commentary.** Bursts are debounced into a single comment and
  spaced by `COMMENT_MIN_INTERVAL_MS`. Short `max_tokens` keep outputs tight.
- **Pause** stops auto-commentary entirely; **Haiku/Sonnet** in the model picker
  trade some quality for lower cost/latency.

## Guardrails

- **Read-mostly.** The only call that changes the game is the explicit
  _Post to chat_ button (a GM whisper via `send-chat-message`).
- **Resilient to a dead backend.** The control client reconnects with backoff,
  every request is timeout-bounded, and a failed poll downgrades the status badge
  and retries — it never crashes the dashboard.
- **Bounded model context** as described above.
