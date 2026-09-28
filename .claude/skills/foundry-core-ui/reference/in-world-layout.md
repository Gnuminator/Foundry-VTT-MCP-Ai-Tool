# The In-World Layout

> Status: DRAFT from documentation and the local v14 source; not yet verified on the running client.

Scope: everything on screen in `/game` for a GM and for a player in Foundry 14.368 — the
overall screen skeleton, scene controls column, scene navigation, the right sidebar's tab
column (mechanics only), players list, hotbar, chat input (layout only), notifications, the
pause overlay, camera (A/V) views, the Esc main menu, context menus, window header controls,
keyboard shortcuts, pings, and canvas pan/zoom. The scene-control **tools** themselves, the
sidebar **tab contents**, and document-sheet **header controls** are covered in depth by
`scene-controls-and-layers.md`, `sidebar-tabs.md`, `chat-and-rolls.md` and `document-sheets.md`
in this same folder; this page cross-references them rather than repeating them. Labels in
**bold** are exact English strings from `C:/FoundryTest/app/public/lang/en.json`.

## How to reach it

- **Where**: after joining a world from the Setup screen (a different area — see
  `join-auth-users.md`), the client loads the `/game` route and renders this whole layout.
  There is no separate "game view" toggle; it is simply what you see once a world is running
  and you're logged in. [unverified]
- **Top-level DOM**: `<div id="interface">` holds four regions — `#ui-left` (scene controls +
  players, then scene navigation), `#ui-middle` (a vertical strip: `#ui-top` for the loading
  bar, `#ui-bottom` for the hotbar and camera dock), and `#ui-right` (the sidebar). The pause
  banner, the Token/Tile/Drawing HUD, and the canvas board are siblings of `#interface`, not
  children. [unverified]
- **GM vs player**: the Scenes, Placeables, and Settings sidebar tabs, most scene-control
  groups (Tiles, Drawings\*, Walls, Lighting, Sounds, Regions\*), scene navigation's drag-to-
  reorder and right-click menu, the "Return to Setup" and "User Management" main-menu items,
  and several context-menu entries (Kick, Ban, Pull to Scene) are GM-only. (\*Drawings and
  Regions can be opened to a trusted player via the `DRAWING_CREATE` / `REGION_CREATE`
  permissions in World Settings.) Everything else (chat, hotbar, players list, notifications,
  pause banner, pings, camera views, main menu Reload/Logout) is shared. [unverified]
- **Nothing renders without a viewed scene**: scene controls and the canvas layers do nothing
  until `canvas.ready` is true. A brand-new world with no scene shows sidebar, hotbar, players
  and chat, but an inert control column. [unverified]

Sources: `C:/FoundryTest/app/templates/views/game.hbs`,
`C:/FoundryTest/app/public/css/foundry2.css` (`#interface`, `#ui-left`, `#ui-middle`,
`#ui-right`), https://foundryvtt.com/article/player-orientation/ (v10-era terms; the v13/v14
container names and the collapsed sidebar differ — see "What changed in v13/v14").

## Scene controls column (left)

Full per-layer tool inventory lives in `scene-controls-and-layers.md`. Here: only the column
itself as a piece of screen furniture.

- **Scene Controls** (`<aside id="scene-controls">`, inside `#ui-left-column-1`, top-aligned
  above the players list) — a two-menu widget: `#scene-controls-layers` (one icon per canvas
  layer group, e.g. **Token Controls**, **Wall Controls**) and `#scene-controls-tools` (the
  active group's tools, appearing as a second column to its right). Click a layer icon to
  switch groups; click a tool icon to switch tools or fire a button/toggle tool. GM and player
  (fewer groups for players). Reversible (just re-click). Automation: buttons are
  `button.control[data-control="<name>"]` and `button.tool[data-tool="<name>"]`, both with
  `aria-label` = the localized title and `aria-pressed` reflecting active state — a good
  accessibility-tree search target. Gotcha: the tool column's width is set dynamically
  (`--control-columns` CSS var) from the tool count, so it can wrap into 2+ columns for groups
  with many tools (Walls, Regions). [unverified]
- **Toolclips**: hovering a tool shows either a plain tooltip or (if the client setting **Show
  Toolclips on Hover** is enabled) a short instructional video with key-binding hints, loaded
  lazily on first hover. GM and player. Not a state change — reversible by nature. [unverified]
- **Default on load**: group **Token Controls**, tool **Select Tokens**. [unverified]

Sources: `C:/FoundryTest/app/client/applications/ui/scene-controls.mjs`,
`C:/FoundryTest/app/templates/ui/scene-controls-layers.hbs`,
`C:/FoundryTest/app/templates/ui/scene-controls-tools.hbs`, `scene-controls-and-layers.md`.

## Scene navigation (top-left cluster)

Not covered elsewhere in this skill — full detail here.

- **Scene Navigation** (`<nav id="scene-navigation">`, `#ui-left-column-2`, immediately to the
  right of the control-icon column — **not** centered across the top of the screen in v14)
  lists scene "tabs": the currently active scene plus any other scene with **Navigation**
  enabled and visible ownership, sorted by `navOrder`. Clicking a tab views that scene for you
  (does not change what others see). GM and player. Reversible (click another tab).
  Automation: each tab is `li.scene[data-scene-id]` with `data-action="viewScene"`, tooltip =
  the scene's nav name. [unverified]
- **Expand/collapse arrow** (`#scene-navigation-expand`, caret icon, only present when there
  are hidden/inactive scenes) — toggles showing scenes that aren't active or currently viewed
  by anyone. Label toggles **Expand Navigation** / **Collapse Navigation**. GM and player.
  Reversible. [unverified]
- **Scene Levels row**: if the viewed scene has more than one Level (a v14 concept), a second
  row (`#scene-navigation-levels`) lists level names to switch the visible Level without
  changing scene. [unverified]
- **User pips**: colored initials on a tab/level show which connected users are currently
  viewing it (their first-letter avatar in their user color). Read-only indicator. [unverified]
- **GM right-click menu** on a scene tab (GM only): **View**, **Activate** (sets it as the
  world's active scene — changes what "Play" defaults to for new joins), **Pull Everyone**
  (forces every connected user's view to this scene/level — not reversible per-user, they can
  navigate away again), **Edit** (opens Scene Config — a document sheet, out of scope here),
  **Scene Notes** (opens the scene's linked Journal entry, if any), **Preload** (pre-caches
  scene assets for everyone — a performance action, not a state change), **Toggle Navigation**
  (removes/adds it from this bar for everyone). [unverified]
- **GM drag-and-drop**: dragging a scene tab onto another reorders `navOrder`. Reversible by
  dragging again. [unverified]

Sources: `C:/FoundryTest/app/client/applications/ui/scene-navigation.mjs`,
`C:/FoundryTest/app/templates/ui/scene-navigation.hbs`.

## Right sidebar tab column (mechanics)

Tab-by-tab content lives in `sidebar-tabs.md`. Here: only how the column itself behaves as a
layout element.

- **Sidebar** (`<aside id="sidebar">`, right edge, `#ui-right`) starts **collapsed** on load —
  only the vertical icon column (`#sidebar-tabs`) shows. Clicking a tab icon activates that tab
  and expands the panel over the canvas's right edge. GM and player (fewer tabs for players:
  Scenes, Placeables, Settings are GM-only). Reversible via the caret button. [unverified]
- **Collapse/expand caret** at the bottom of the icon column — label **Expand** /
  **Collapse**. Collapsing hides the panel but leaves the icon column and (for the Chat tab
  specifically) a floating message feed + input over the canvas — see `chat-and-rolls.md`.
  [unverified]
- **Right-click a tab icon** pops that tab's content out into its own window (its own
  `ui.<tab>` app instance gets a popout render). GM and player. Reversible (close the
  popout). [unverified]

Sources: `C:/FoundryTest/app/client/applications/sidebar/sidebar.mjs`,
`C:/FoundryTest/app/templates/sidebar/tabs.hbs`, `sidebar-tabs.md`.

## Players list (bottom-left)

- **Players** (`<aside id="players">`, directly under the scene-controls column, same
  `#ui-left-column-1`) shows one row per **currently connected** user, colored by their user
  color, formatted `Name (pronouns) [GM]` or `Name (pronouns) [CharacterName]`. Self always
  sorts first, then GMs/Assistant GMs, then players, alphabetically. GM and player (read-only
  list; the context menu differs). Automation: `li.player[data-user-id]`, `.idle` class marks
  an AFK user. [unverified]
- **Inactive players tray** (`#players-inactive`) — a hidden-by-default list of users who
  exist in the world but aren't connected right now. Toggled by the caret button
  (`#players-expand`, tooltip via `aria-label`, no fixed localized label found for this
  specific button — read its `aria-label` at runtime). Reversible. [unverified]
- **Performance stats row** — **Latency** (`#latency`, color-coded good/fair/poor at 250 ms /
  1000 ms thresholds, computed from `game.time.averageLatency`) and **FPS** (`#fps`,
  color-coded at 50%/80% of max FPS, computed from `canvas.fps`). Both self-only, read-only,
  refreshed on an interval. Not present/meaningful before the canvas is ready (FPS shows
  `--`). [unverified]
- **Right-click a player row** (context menu): **User Configuration** (opens that user's
  sheet — self, or any user if you're GM), **View Player Avatar** (image popout, only if a
  custom avatar is set), and, GM-only against other users: **Pull To Scene**, **Kick Player**
  (temporarily drops their role to None then restores it — a soft, semi-reversible
  disconnect), **Ban Player** / **Un-Ban Player** (sets role to/from None — reversible only by
  a GM re-inviting/un-banning), and **Show User** (only appears if that user is blocked in your
  local A/V settings). [unverified]

Sources: `C:/FoundryTest/app/client/applications/ui/players.mjs`,
`C:/FoundryTest/app/templates/ui/players.hbs`,
`C:/FoundryTest/app/public/css/foundry2.css` (`#players`).

## Hotbar / macro bar (bottom-center)

- **Hotbar** (`<aside id="hotbar">`, `#ui-bottom`, centered at the bottom of the screen) shows
  10 macro slots per page (keys **1**–**9** then **0**), 5 pages total (50 macro slots).
  Left-click a filled slot to execute its Macro; left-click an empty slot to create a new chat
  Macro. GM and player (players can only use/create macros they own). Reversible in the sense
  that executing a macro is whatever the macro does — not itself a UI state change.
  Automation: `li.slot[data-slot]`, `.full` class = occupied, key badge shown in `.key`.
  [unverified]
- **Next Page** / **Previous Page** (up/down triangle + page number, right side) cycle the 5
  pages. Also bound to **Alt+1**…**Alt+5**. Reversible. [unverified]
- **Lock Hotbar** / **Unlock Hotbar** (padlock icon, left of page number) — when locked,
  macros can't be dragged/dropped/removed from the bar (prevents accidental rearranging); shows
  a warning notification if you try. Toggle, reversible, per-client setting
  (`core.hotbarLock`). [unverified]
- **Clear Hotbar** (trash icon) — confirmation dialog **Clear Hotbar**
  ("Clear all assigned Macros from your hotbar?"), then empties every slot on your hotbar.
  Confirmable/cancelable before the click; **not reversible** afterward (macros themselves
  aren't deleted, just unassigned from slots). [unverified]
- **Mute Volume** / **Unmute Volume** (speaker icon, far left) — toggles
  `game.audio.globalMute`, silencing all world/system audio for you only. Reversible,
  self-only. [unverified]
- **Main Menu** (bars icon, far left, next to Mute) — opens the Esc main menu (see below).
  [unverified]
- **Right-click a filled slot**: context menu with **Edit Macro** (owner only), **Remove
  Macro** (unassign — always available), **Delete Macro** (owner only, deletes the Macro
  document itself — not reversible without recreating it). [unverified]
- **Responsive sizing**: the bar shrinks its slot size/spacing at narrower effective viewport
  widths (breakpoints differ depending on whether the camera dock is docked vertically beside
  it). Automation gotcha: don't assume a fixed pixel layout when scripting clicks by
  coordinate; use the `data-slot` selectors instead. [unverified]

Sources: `C:/FoundryTest/app/client/applications/ui/hotbar.mjs`,
`C:/FoundryTest/app/templates/ui/hotbar.hbs`.

## Chat input (layout only)

Full behavior (rich-text input, roll-mode buttons, message rendering, rolls) is in
`chat-and-rolls.md`. As a layout element:

- When the sidebar is **expanded** on the Chat tab, the message input sits at the bottom of
  the sidebar panel, right edge of the screen. When the sidebar is **collapsed** (the default
  on load) or another tab is active, a slimmer floating copy of the log + input
  (`#chat-notifications`) appears over the canvas near the bottom, so you can still read and
  send chat without opening the sidebar. GM and player. [unverified]
- The input itself is a rich-text `<prose-mirror id="chat-message">` element, not a plain
  `<textarea>` — click into `.editor-content` before typing when scripting it. [unverified]
- A **Jump to Bottom** arrow button appears above the input only when you've scrolled the log
  away from the newest message. [unverified]

Sources: `chat-and-rolls.md`, `C:/FoundryTest/app/templates/sidebar/tabs/chat/notifications.hbs`.

## Notifications (toast queue)

- **Notifications** (`<ol id="notifications">`, prepended to `<body>`, so it floats above
  everything including sidebar/hotbar, typically top-of-screen depending on theme CSS) queues
  short messages from the client, other modules, or the server (permission errors, save
  confirmations, etc.). Up to 5 shown at once; each auto-dismisses after 5 seconds unless
  marked permanent or a progress bar. Click any notification to dismiss it early. GM and
  player — notifications are always local/self only; nothing here is broadcast. Reversible in
  that dismissing just removes it from your own screen. Automation: styled by type as
  `li.notification.info|warning|error|success`, optionally `.permanent` or `.progress`.
  [unverified]
- Progress-style notifications (used for e.g. asset preloading) expose a `--pct` CSS variable
  and update in place rather than queuing a new toast each tick. [unverified]

Sources: `C:/FoundryTest/app/client/applications/ui/notifications.mjs`.

## Pause overlay and unpausing

- **Game Paused banner** (`<figure id="pause">`) is a horizontal band fixed vertically at
  screen-center (not a full-screen dim/overlay), with a pulsing spin icon and the caption
  **GAME PAUSED**, shown to every connected client the instant `game.paused` becomes true.
  **`pointer-events: none`** — it never blocks clicks on the canvas or UI underneath it, so
  automation does not need to dismiss it before continuing to interact. [unverified]
- **Toggling pause**: Spacebar (keybinding `core.pause`, **restricted to GM/Assistant GM** —
  the keybinding does nothing for a plain player) or a module/macro calling
  `game.togglePause()`. Fully reversible (press Space again). [unverified]
- **Effect on players while paused**: a non-GM cannot move tokens while paused — they get the
  warning **"You cannot take this action while the game is currently paused."** — but a GM can
  still act normally. Other player actions (chat, opening sheets you own, sidebar browsing)
  are not blocked by pause; only token movement was found gated in the source. [unverified]

Sources: `C:/FoundryTest/app/client/applications/ui/game-pause.mjs`,
`C:/FoundryTest/app/public/css/foundry2.css` (`#pause`),
`C:/FoundryTest/app/client/canvas/placeables/token.mjs` (`GAME.PausedWarning` check),
`C:/FoundryTest/app/client/helpers/interaction/client-keybindings.mjs` (`core.pause`).

## Camera views (A/V)

- **Camera dock** (`ui.webrtc`, template slot `#camera-views`, docked to one edge of the
  screen — Top/Right/Bottom/Left, GM-configurable in World A/V settings, client can override
  position) shows a tile per connected user with an active camera/mic, only when A/V mode is
  enabled for the world (disabled by default unless configured — the test world likely has it
  off). GM and player. [unverified]
- **Per-tile controls** (hover a tile): **Toggle video**, **Configure Settings** (opens your
  A/V settings), **Send to Dock** / **Pop out** (pops that one camera into its own floating
  window, `CameraPopout`), plus GM-only moderation: **Block User Video**, **Block User Audio**,
  **Hide User**. All reversible. [unverified]
- **Self controls**: **Enable/Disable Your Video**, **Enable/Disable Your Audio (Mute)**,
  **Mute/Unmute Others' Audio**. Reversible, self-scoped except muting others (which only
  affects your own playback, not what others hear). [unverified]
- **Push-to-talk**: default key **`** (backquote), held while speaking, if the world's voice
  mode is set to Push-to-Talk. [unverified]
- **Dock hides itself** automatically when every camera is popped out individually. [unverified]

Sources: `C:/FoundryTest/app/client/applications/apps/av/cameras.mjs`,
`C:/FoundryTest/app/client/applications/apps/av/camera-popout.mjs`,
`C:/FoundryTest/app/public/lang/en.json` (`WEBRTC.*`).

## The Esc main menu

- **Main Menu** (`<dialog id="menu">`, native `<dialog>` element, dark theme) opens on
  **Escape** (as a fallback — see "Escape's cascading behavior" below) or by clicking the
  hamburger icon on the hotbar. Items, in order: **Reload Application** (reloads the browser
  tab — no confirmation, in-progress input can be lost), **Log Out** (returns to the login/join
  screen), and GM-only: **User Management** (navigates to the relative path `./players`, a separate
  administrative page — leaves the game view), **Return to Setup** (`GAME.ReturnSetup`, shuts
  the world down for everyone and returns the GM to the Setup screen — **not reversible from
  here**; players are disconnected). GM and player (fewer items for players). [unverified]
- **Closing it**: Escape again, or click outside it (native `<dialog>` semantics plus the
  app's own close animation). Reversible (just reopen). [unverified]

Sources: `C:/FoundryTest/app/client/applications/ui/main-menu.mjs`,
`C:/FoundryTest/app/public/lang/en.json` (`MENU.*`, `GAME.ReturnSetup`).

## Context menus (general mechanics)

Applies to scene-navigation tabs, players, hotbar slots, sidebar directory entries, and
(elsewhere in this skill) document-sheet header controls.

- Default trigger is the browser's native `contextmenu` event (**right-click**); the header
  "Toggle Controls" button on windowed apps opens its menu on a normal left-click instead (see
  `document-sheets.md`). [unverified]
- The menu expands upward or downward from the click point depending on available vertical
  space (`expand-up` / `expand-down` classes); it closes on outside click, on **Escape** (see
  below), or after choosing an entry. GM and player, entries filtered per-item by a
  `visible()` check (e.g. GM-only rows simply aren't rendered for players). [unverified]

Sources: `C:/FoundryTest/app/client/applications/ux/context-menu.mjs`.

## Window header controls (generic)

Document-sheet-specific header buttons are covered in `document-sheets.md`. Every framed
`ApplicationV2` window (config dialogs, popouts, image viewers — not the frameless UI pieces
above, which set `window.frame: false`) shares this chrome:

- **Title bar** (`.window-header`): icon, title text, drag to move the window; **double-click
  the title bar** to minimize/maximize (collapses to just the header). Reversible. [unverified]
- **Toggle Controls** (ellipsis icon, `APPLICATION.TOOLS.ToggleControls`) — opens a context
  menu of app-specific actions plus, on every window, **Detach Window** / **Re-attach Window**
  (see "What changed in v13/v14"). [unverified]
- **Close Window** (x icon) — closes the window. Reversible by reopening from wherever it's
  launched (sidebar, sheet button, etc.); unsaved form edits may be lost depending on the app.
  [unverified]
- **Resize handle** (bottom-right corner) — only present when the app declares itself
  resizable. [unverified]

Sources: `C:/FoundryTest/app/client/applications/api/application.mjs` (`_renderFrame`,
`DEFAULT_OPTIONS.window.controls`), `document-sheets.md`.

## Keyboard shortcuts overview

These are the **default** core key bindings relevant to the in-world screen (namespace
`core`); see `configuration-menus.md` for the **Controls Configuration** editor that changes
them. All are per-client and player-editable unless marked GM-only.

| Key(s) | Action | Notes |
|---|---|---|
| `Escape` | Toggle Menu / Dismiss All Windows | see cascading behavior below; uneditable |
| `Space` | Pause Game | **GM/Assistant GM only** |
| `Tab` | Cycle Canvas View or Movement Action | repeatable |
| `Delete` / `Backspace` | Delete Objects | selected placeables on the active layer |
| `Ctrl+A` | Select All Objects | active layer; uneditable |
| `Ctrl+Z` | Undo Last Action | uneditable |
| `Ctrl+X` / `Ctrl+C` / `Ctrl+V` | Cut / Copy / Paste Objects | uneditable |
| `Alt` (hold) | Highlight Objects | shows/hides layer highlight while held |
| `[` / `]` | Send to Back / Bring to Front | selected placeables |
| `T` | Target Token | hovered token; Shift = keep other targets |
| `R` | Toggle Distance Ruler | Token layer only |
| `U` | Toggle Unconstrained Movement | GM-oriented (tool hidden for players) |
| `C` | Toggle Character Sheet | your assigned actor or selected token |
| `Shift+C` | Focus Chat | switches to Chat tab and focuses the input |
| `W A S D` (+ diagonals) | Move controlled token | Shift = rotate instead of move; repeatable |
| `E` / `Q` | Ascend / Descend Vertically | repeatable |
| Arrow keys / Numpad | Pan Canvas | Shift = half-speed pan; repeatable |
| `PageUp`/`+` , `PageDown`/`-` | Zoom In / Out | Shift = finer zoom step; repeatable |
| `F` | Place Ruler Waypoint | while dragging a token or the ruler is active |
| `1`-`9`, `0` | Execute Hotbar Slot _n_ | current hotbar page |
| `Alt+1`...`Alt+5` | Swap to Hotbar Page _n_ | |
| `` ` `` (backquote) | Push-to-Talk / Push-to-Mute | only if world voice mode uses PTT |

Sources: `C:/FoundryTest/app/client/helpers/interaction/client-keybindings.mjs`,
`C:/FoundryTest/app/public/lang/en.json` (`KEYBINDINGS.*`),
https://foundryvtt.com/article/keybinds/ (editor UI only — no defaults listed there).

### Escape's cascading behavior

A single **Escape** press does the first applicable of, in order: cancel an in-progress
drag/measurement; save pending fog-of-war and commit it; close the main menu if open; close an
open context menu; exit an active Tour; close open windowed apps (one Escape can close several
at once); release your controlled/targeted placeables; **then**, only if nothing above applied,
open the main menu. This means Escape is not a reliable single-purpose "close everything" key
for automation — check what's open first. [unverified]

Source: `C:/FoundryTest/app/client/helpers/interaction/client-keybindings.mjs` (`#onDismiss`).

## Pings

- **Trigger**: click-and-hold (long-press) the left mouse button on the canvas **while a Token
  Controls tool is active** (not on other layers) and you have the `PING_CANVAS` permission
  (granted to players by default in most worlds). Holding **Ctrl** suppresses it (reserved for
  other drag behavior). GM and player. [unverified]
- **Styles**: plain long-press = pulsing circle in your user color (**Pulse**); **Alt**+hold =
  a red pulsing triangle, an attention/warning ping (**Alert**); **Shift**+hold = a circle with
  a downward arrow (**Pull**) that also recenters the canvas — but only the GM's Pull ping
  recenters *other* players' cameras; a player's own Pull ping only recenters their own view.
  [unverified]
- **Off-screen pings** from other users draw a small arrow at the edge of your viewport
  pointing toward the ping's real location instead of the ping itself. [unverified]
- Not reversible/undoable (purely visual, auto-fades); no world-data change. [unverified]

Sources: `C:/FoundryTest/app/client/canvas/board.mjs` (`ping`, `handlePing`),
`C:/FoundryTest/app/client/canvas/layers/controls.mjs` (`_onLongPress`, `drawPing`,
`drawOffscreenPing`), https://foundryvtt.com/article/pings/ (matches source; calls the Pull
style "Drag Ping" and confirms it is GM/Assistant-GM limited).

## Canvas pan/zoom

- **Pan**: right-click-drag anywhere on the canvas; or arrow keys / numpad (Shift = half
  speed, repeatable while held). A plain right-click (no drag) is passed to the active layer
  instead (e.g. cancels a ruler waypoint) rather than panning. [unverified]
- **Zoom**: mouse wheel (±5% per tick, centered roughly on the cursor via the interaction
  layer) or `PageUp`/`NumpadAdd` and `PageDown`/`NumpadSubtract` (Shift = finer step,
  repeatable). [unverified]
- Both are self-only, instantaneous, and fully reversible (there's no "camera state" saved
  anywhere by default beyond your own session, aside from a GM's Pull ping/"Pull Everyone"
  forcing other clients' views). [unverified]

Sources: `C:/FoundryTest/app/client/canvas/board.mjs` (`_onMouseWheel`, `_onDragRightMove`),
`C:/FoundryTest/app/client/helpers/interaction/client-keybindings.mjs` (`#handleCanvasPan`).

## What changed in v13/v14

- **v13** rebuilt every core UI piece listed on this page (scene controls, scene navigation,
  sidebar, players, hotbar, notifications, pause, main menu, camera dock) on the
  **ApplicationV2** framework, replacing the old jQuery/Handlebars v1 `Application` class.
  Practical effect: predictable `id`/class selectors, `data-action` attributes for every click
  target, and native light/dark theming. The sidebar became **collapsible by default**
  (previously always open), starting collapsed on load. [unverified]
- **v14** added **window Detach/Attach**: any framed ApplicationV2 window (a document sheet, a
  config dialog, a popout) can be popped into its own separate browser window via the header's
  "Toggle Controls" menu, and pulled back with "Re-attach Window". This was a community
  (Patreon) feature vote winner for v14, not present in v13. [unverified]
- **v14** added the **Placeables** sidebar tab and **Placeables Palette** — a filterable list
  of the active layer's objects in the sidebar, plus a bulk-edit/creation-preset palette next
  to the scene controls (`ui.placeablesPalette`, opened by a control's `togglePalette` tool).
  Neither existed in v13. [unverified]
- **v14** hid the old **Measured Template** scene-control group entirely (`visible: false` in
  source, comment: "Measured Templates are deprecated"); the older KB `/article/controls/`
  wording does not reflect this. [unverified]
- The `/article/player-orientation/` KB page still describes some v10/v12-era specifics (a
  "Default Roll Mode selector" as separate UI, "10 macros" phrased as a fixed cap rather than
  10-per-page-of-5, a spinning "clock" rather than the current pause icon) — treat it as a
  conceptual map, not a pixel-accurate v14 reference. [unverified]

Sources: `C:/FoundryTest/app/client/applications/ui/*.mjs` (all extend
`HandlebarsApplicationMixin(ApplicationV2)`), https://foundryvtt.com/releases/14.359 (first
v14 stable; Placeables tab + palette), WebSearch results on v13 release notes (ApplicationV2
UI overhaul, collapsible sidebar), https://foundryvtt.com/article/player-orientation/.

## Driving it from automation

Read-only console checks (run in the client's dev console, F12) — none of these change state:

```js
ui.controls.control.name      // active scene-control group, e.g. "tokens"
ui.controls.tool.name         // active tool, e.g. "select"
ui.nav.expanded                // scene navigation expanded?
ui.sidebar.expanded            // sidebar panel open?
ui.sidebar.tabGroups.primary   // active sidebar tab id
ui.players.expanded            // inactive-players tray open?
ui.hotbar.page                 // current hotbar page, 1-5
game.paused                    // pause state
ui.menu.rendered               // is the Esc main menu open?
game.user.isGM                 // GM vs player
canvas.ready                   // is a scene loaded?
canvas.stage.scale.x           // current zoom
canvas.stage.pivot             // current pan center {x, y}
game.settings.get("core", "hotbarLock")
game.webrtc.hidden             // camera dock auto-hidden?
```

Stable selectors/labels for accessibility-tree search (role/name pairs a browser-automation
tool can match on, taken straight from `aria-label`/tooltip strings above): **Token Controls**,
**Select Tokens**, **Scene Navigation**, **Expand Navigation** / **Collapse Navigation**,
**Latency**, **FPS**, **Action Bar** (hotbar's own `aria-roledescription`), **Lock Hotbar** /
**Unlock Hotbar**, **Clear Hotbar**, **Mute Volume** / **Unmute Volume**, **Main Menu**
(`Escape`), **Toggle Controls**, **Close Window**, **Expand** / **Collapse** (sidebar caret).
Element IDs that don't change across renders: `#scene-controls`, `#scene-navigation`,
`#sidebar`, `#players`, `#hotbar`, `#notifications`, `#pause`, `dialog#menu`,
`#camera-views`.

## Safety in the test world

- All checks below are read-only or trivially reversible (clicking a caret, opening/closing a
  menu). The only destructive-looking items are the hotbar's **Clear** button and a player
  Kick/Ban from the Players list context menu — do not click either during verification; just
  confirm the buttons exist and read their tooltips/dialog text. [unverified]
- **Return to Setup** in the main menu shuts the whole test world down for the GM session —
  do not click it during a verification pass; note its presence and label only. [unverified]
- Use the Claude "Claude" GM user on the `ai-tool-test` world (per `foundry-test-env` skill);
  never touch the live campaign world or its bridge ports. [unverified]
- Pings and pans are harmless; feel free to actually trigger them during verification. [unverified]

## Verification checklist

1. Load `/game` in `ai-tool-test`. Expect: scene controls at top-left, players list below it,
   scene navigation just right of the controls, sidebar collapsed to an icon column on the
   right, hotbar centered at the bottom.
2. Click a different scene-control layer icon (e.g. **Wall Controls**, if GM). Expect: the
   tool sub-row changes and `aria-pressed="true"` moves to the new layer icon.
3. Hover a scene-control tool with "Show Toolclips on Hover" on. Expect: a toolclip
   video/tooltip appears after a short delay.
4. Click a scene-navigation tab for a second scene (create one first if needed). Expect: your
   own canvas view switches; other users' views are unaffected.
5. Right-click a scene tab as GM. Expect: a context menu with **View**, **Activate**, etc.
6. Click the sidebar's Actors tab icon. Expect: the panel expands and shows the Actors
   directory; the icon shows `aria-pressed="true"`.
7. Click the sidebar collapse caret. Expect: panel hides; for the Chat tab, a floating
   input/log appears over the canvas instead.
8. Right-click a sidebar tab icon. Expect: that tab pops out into its own window.
9. Open the Players list and hover the latency/FPS readouts. Expect: numeric values update
   periodically and are color-coded.
10. Click the players "expand" caret with at least one disconnected user in the world. Expect:
    the inactive-players tray opens below.
11. Right-click your own row in the players list. Expect: **User Configuration** (and **View
    Player Avatar** if you have a custom avatar); GM-only rows absent for a self-row.
12. Click an empty hotbar slot. Expect: a new chat-type Macro sheet opens, pre-targeted at that
    slot.
13. Click the hotbar page-next triangle. Expect: the page number increments (wraps 5→1).
14. Click the hotbar lock icon. Expect: the icon and tooltip swap to the locked state; dragging
    a macro afterward shows the "hotbar is locked" warning instead of moving it.
15. Trigger any warning/info notification (e.g. an invalid action). Expect: a toast appears
    top-of-screen, colored by type, and disappears after ~5 s or on click.
16. As GM, press **Space**. Expect: the **GAME PAUSED** banner pulses into view for every
    connected client; clicking on the canvas underneath still works (banner doesn't block
    clicks).
17. As a player while paused, try to move a token. Expect: the move is blocked with the
    "cannot take this action while paused" warning.
18. Press **Space** again as GM. Expect: the banner disappears everywhere.
19. Open a document sheet (any). Expect: title bar, ellipsis "Toggle Controls" button, and a
    close (x) button; clicking the ellipsis shows **Detach Window** in the dropdown.
20. Click **Detach Window** on that sheet. Expect: it opens in a separate browser window; the
    dropdown there now offers **Re-attach Window**.
21. Right-click any placeable/tab/row that has a context menu. Expect: a menu appears anchored
    to the click, expanding up or down depending on space, and closes on Escape or an outside
    click.
22. Press **Escape** with nothing else open. Expect: the Esc main menu opens with **Reload
    Application**, **Log Out**, and (GM) **User Management**, **Return to Setup**.
23. Press **Escape** again. Expect: the main menu closes (does not open a second one).
24. With the Token Controls tool active, click-and-hold on empty canvas for ~1 second. Expect:
    a pulsing ping in your user color appears and fades; other connected clients see it too.
25. Repeat the long-press with **Alt** held. Expect: a red pulsing triangle instead of a
    circle.
26. Scroll the mouse wheel over the canvas. Expect: the view zooms in/out smoothly, roughly
    centered on the cursor.
27. Right-click-drag on empty canvas. Expect: the view pans to follow the drag.
28. If A/V is enabled in World Settings, open the camera dock and hover a tile. Expect:
    per-tile controls (video toggle, configure, pop out) appear.

## Sources

- Local v14 client: `C:/FoundryTest/app/client/applications/ui/*.mjs` (scene-controls,
  scene-navigation, hotbar, players, notifications, game-pause, main-menu),
  `C:/FoundryTest/app/client/applications/sidebar/sidebar.mjs`,
  `C:/FoundryTest/app/client/applications/apps/av/*.mjs`,
  `C:/FoundryTest/app/client/applications/api/application.mjs`,
  `C:/FoundryTest/app/client/applications/ux/context-menu.mjs`,
  `C:/FoundryTest/app/client/helpers/interaction/client-keybindings.mjs`,
  `C:/FoundryTest/app/client/canvas/board.mjs`,
  `C:/FoundryTest/app/client/canvas/layers/controls.mjs`,
  `C:/FoundryTest/app/client/canvas/layers/tokens.mjs` (pause/movement gate),
  `C:/FoundryTest/app/client/canvas/layers/{walls,tiles,drawings,lighting,sounds,regions,notes,templates}.mjs`.
- Local templates: `C:/FoundryTest/app/templates/views/game.hbs`,
  `C:/FoundryTest/app/templates/ui/*.hbs`, `C:/FoundryTest/app/templates/sidebar/tabs.hbs`,
  `C:/FoundryTest/app/templates/sidebar/tabs/chat/{input,notifications}.hbs`.
- Local styles: `C:/FoundryTest/app/public/css/foundry2.css` (`#interface`, `#ui-left`,
  `#ui-right`, `#ui-middle`, `#players`, `#pause`, `#scene-navigation`).
- Local labels: `C:/FoundryTest/app/public/lang/en.json`.
- Official KB: https://foundryvtt.com/article/player-orientation/,
  https://foundryvtt.com/article/controls/, https://foundryvtt.com/article/keybinds/,
  https://foundryvtt.com/article/tutorial/, https://foundryvtt.com/article/pings/.
- Official release notes: https://foundryvtt.com/releases/14.359,
  https://foundryvtt.com/releases/14.368.
- Sibling reference files in this skill: `scene-controls-and-layers.md`, `sidebar-tabs.md`,
  `chat-and-rolls.md`, `document-sheets.md`, `configuration-menus.md`.
