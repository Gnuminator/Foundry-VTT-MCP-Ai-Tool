# Scene Controls and Canvas Layers

> Status: DRAFT from documentation and the local v14 source; not yet verified on the running client. The click-through pass stamps "verified on Foundry 14.368 / dnd5e 6.0.5, <date>".

Scope: the left-hand scene control column, every control group and tool (GM view and player
view), the canvas-layer model behind it, the Token / Tile / Drawing HUDs, placeable palettes,
and Scene Region behaviors at summary level. Labels are the English strings from the v14 core
`en.json` (and dnd5e `lang/en.json` where noted). Tool order is the `order` field in each
layer's `prepareSceneControls()`.

## How to reach it

- **Where**: in a world (`/game`), the scene controls sit on the left edge of the screen,
  inside `#ui-left`. The element is `<aside id="scene-controls">` with two menus: the group
  buttons (`#scene-controls-layers`) and the tools of the active group
  (`#scene-controls-tools`). [unverified]
- **Needs a canvas**: the buttons do nothing unless a scene is viewed and `canvas.ready` is
  true (the click handlers return early otherwise). If the world has no viewed scene, open
  Sidebar > Scenes tab and view one first. Players cannot view a scene on their own; they
  see the active scene. [unverified]
- **Group buttons**: one button per group; the accessible name is the group title (for
  example **Token Controls**), `role="tab"`, `aria-pressed="true"` on the active group. [unverified]
- **Tool buttons**: one per tool; the accessible name is the tool title (for example
  **Select Tokens**); `aria-pressed="true"` marks the active tool or an enabled toggle. The
  tool column wraps into more columns when a group has many tools (Walls, Regions). [unverified]
- **Three kinds of tool**: a *tool* becomes the active mode; a *toggle* flips on/off and
  leaves the active tool alone; a *button* runs once (often a dialog or a world update) and
  never stays pressed. The kind decides whether a click is safe (see Safety). [unverified]
- **Hover help**: tools show a tooltip, or a "toolclip" (short video + key hints) when the
  client setting **Show Toolclips on Hover** is on (Settings > Game Settings > Core; needs a
  reload). Toolclips load lazily on first hover. [unverified]
- **Default group**: **Token Controls** with **Select Tokens** active after load. [unverified]
- **No layer hotkeys**: core registers no keys that switch groups. Related core keys:
  `R` ruler, `T` target hovered token, `U` toggle unconstrained movement (GM), `Delete` /
  `Backspace` delete selected, `Ctrl+Z` undo on the active layer, `Ctrl+C/X/V` copy, cut,
  paste, `Ctrl+A` select all, `[` / `]` send to back / bring to front, `Alt` highlight
  objects, `Esc` dismiss, `Space` pause (GM), `Tab` cycle view. [unverified]

Sources: `C:/FoundryTest/app/client/applications/ui/scene-controls.mjs`,
`C:/FoundryTest/app/templates/ui/scene-controls-layers.hbs`,
`C:/FoundryTest/app/templates/ui/scene-controls-tools.hbs`,
`C:/FoundryTest/app/client/helpers/interaction/client-keybindings.mjs`,
`C:/FoundryTest/app/client/game.mjs` (setting `showToolclips`),
https://foundryvtt.com/api/v14/classes/foundry.applications.ui.SceneControls.html

## Canvas layers (the model behind the controls)

- The canvas is a PIXI scene graph split into groups: `hidden`, `rendered` > `environment`
  (> `primary`, `effects`), `visibility`, `interface`, and `overlay`. Placeable layers live in
  the `interface` group; `weather` is in `primary`. (`CONFIG.Canvas.groups`) [unverified]
- `CONFIG.Canvas.layers` lists the layers: `weather`, `grid`, `regions`, `drawings`,
  `templates` (deprecated in v14), `tiles`, `walls`, `tokens`, `sounds`, `lighting`, `notes`,
  `controls`. Every *interaction* layer can contribute one control group. [unverified]
- Exactly one interaction layer is active at a time. Clicking a group button activates its
  layer (`canvas.activeLayer`); only the active layer's objects take clicks and drags. Objects
  of inactive layers still render (walls, lights and sounds only show their editing icons on
  their own layer). [unverified]
- Each placeable is an embedded document of the Scene: `tokens`, `tiles`, `drawings`, `walls`,
  `lights`, `sounds`, `regions`, `notes` (plus `levels` in v14). Anything created, moved or
  deleted on a layer is a world-data change. [unverified]
- v14 **Scene Levels**: a scene can have several levels. Placeables belong to one or more
  levels, and the canvas shows the viewed level (`canvas.level`). The "Clear" buttons only
  touch objects on the viewed level when the scene has more than one level. [unverified]
- v14 removed Measured Templates as a usable document type; area templates are now Regions
  (see Regions). The old `templates` layer still exists for compatibility but its control
  group is hidden. [unverified]
- The older KB layer article describes a v9-era stack (background, tiles, foreground,
  overhead tiles, templates). That stack no longer matches v14. [unverified]

Sources: `C:/FoundryTest/app/client/config.mjs` (`CONFIG.Canvas.groups`,
`CONFIG.Canvas.layers`), `C:/FoundryTest/app/client/canvas/layers/base/interaction-layer.mjs`,
`C:/FoundryTest/app/client/canvas/layers/base/placeables-layer.mjs`,
`C:/FoundryTest/app/common/documents/scene.mjs`, https://foundryvtt.com/article/canvas-layers/,
https://foundryvtt.com/releases/14.353

## Control groups at a glance (v14.368 order)

| # | Group label | `name` | Icon class | Shown to |
|---|---|---|---|---|
| 0 | Measurement Controls | `templates` | `fa-ruler-combined` | nobody (hidden in v14) |
| 1 | **Token Controls** | `tokens` | `fa-user-large` | everyone |
| 2 | **Tile Controls** | `tiles` | `fa-cubes` | GM / Assistant GM |
| 3 | **Drawing Tools** | `drawings` | `fa-pencil` | users with **Use Drawing Tools** (default Trusted Player+) |
| 4 | **Wall Controls** | `walls` | `fa-block-brick` | GM / Assistant GM |
| 5 | **Lighting Controls** | `lighting` | `fa-lightbulb` (regular) | GM / Assistant GM |
| 6 | **Ambient Sound Controls** | `sounds` | `fa-music` | GM / Assistant GM |
| 7 | **Region Controls** | `regions` | `fa-game-board` | users with **Create Regions** (default Player+) |
| 8 | **Journal Notes** | `notes` | `fa-bookmark` | everyone |

- A default **Player** therefore sees: Token Controls, Region Controls, Journal Notes. A
  **Trusted Player** also gets Drawing Tools and the **Create Map Note** tool. [unverified]
- dnd5e 6.0.5 adds no scene control groups or tools (no `getSceneControlButtons` hook in
  `dnd5e.mjs`). Modules can add groups via that hook. [unverified]
- The Journal Notes icon switches to a duotone style when the scene has notes visible to you. [unverified]

Sources: `C:/FoundryTest/app/client/canvas/layers/*.mjs` (`prepareSceneControls`),
`C:/FoundryTest/app/common/constants.mjs` (`USER_PERMISSIONS` default roles),
`C:/FoundryTest/app/public/lang/en.json` (`CONTROLS.*`, `PERMISSION.*`),
`C:/FoundryTest/data/Data/systems/dnd5e/dnd5e.mjs`

## Token Controls

Path: Scene controls > **Token Controls**. Default tool: **Select Tokens**.

- **Select Tokens** (`select`) - click a token to control it, drag a box to select several,
  Shift+click to add. Drag a token to move it (a ruler shows the path). Double-click opens the
  actor sheet; GM double right-click opens Token config; right-click opens the Token HUD.
  Everyone; players only control tokens they own. Moving a token is a world update, undo with
  Ctrl+Z. [unverified]
- **Select Targets** (`target`) - click or box-drag to target tokens (Shift adds). Targets are
  per user and not stored in the world; clicking again clears. Everyone. [unverified]
- **Measure Distance** (`ruler`) - drag on the canvas to measure; Ctrl+click places a
  waypoint, right-click removes the last one. Nothing is saved. Everyone (users need
  **Show Ruler** permission for others to see it). `R` toggles the ruler from any tool. [unverified]
- **Unconstrained Movement** (`unconstrainedMovement`, toggle, GM only) - when on, the GM's
  token moves ignore walls and impassable terrain. Stored as the client setting
  `core.unconstrainedMovement` (not world data). Hotkey `U`. [unverified]
- Delete key on a selected token asks for confirmation only when the token is in combat or
  has an attached Region. [unverified]
- Doors: door icons are clickable while on this layer. Click opens/closes (players too, if the
  game is not paused); GM right-click locks/unlocks; GM Alt+click does it silently. Secret
  doors are hidden from players. These are world updates. [unverified]

Sources: `C:/FoundryTest/app/client/canvas/layers/tokens.mjs`,
`C:/FoundryTest/app/client/canvas/containers/elements/door-control.mjs`,
https://foundryvtt.com/article/tokens/, https://foundryvtt.com/article/measurement/

## Token HUD (right-click a token)

Reach: Token Controls > Select Tokens > right-click a token you can control. The HUD is
`#token-hud` inside `#hud`, positioned over the token. Right-click again or press Esc to
close. dnd5e replaces the class with `TokenHUD5e` (same layout).

Left column:
- **Elevation** - text box; type a number and press Enter/Tab to change elevation. Disabled
  when the token is locked, or for players while paused. World update. [unverified]
- **Change Level** (`fa-layer-group`) - GM only and only if the scene has 2+ levels; opens a
  list of levels and moves the controlled tokens there. World update. [unverified]
- **To Front/Back** (`fa-bring-forward`) - one button that brings the token to front, or
  sends it to back if it is already in front (v14 merged the two older buttons). World
  update (`sort`). [unverified]
- **Lock** / **Unlock** - GM only; locked tokens cannot be moved or edited. World update. [unverified]
- **Open Configuration** (gear) - needs **Configure Token** permission (default Trusted
  Player+); opens the Token config sheet. [unverified]

Middle column:
- Two attribute bars (bar2 above, bar1 below) when the token shows bars. For dnd5e, bar1 is
  usually HP. Type a value, or `+5` / `-5` for relative change. Changes the actor. [unverified]

Right column:
- **Hide** / **Show** (eye) - GM only; toggles token visibility to players. World update. [unverified]
- **Assign Status Effects** - opens the status palette (`[data-palette="effects"]`). dnd5e
  lists its conditions (for example Blinded, Prone, Exhaustion, Concentrating). Left-click
  applies a condition (Exhaustion: adds a level); right-click applies it as the large overlay
  (Exhaustion: removes a level). A token with no actor shows a warning. Changes the actor's
  effects. [unverified]
- **Select Movement Action** - opens a list: "Default (…)", **Walk**, **Fly**, **Swim**,
  **Burrow**, **Climb**, **Crawl**, **Jump**, **Teleport (Blink)**, **Teleport (Displace)**.
  Sets the token's `movementAction`. World update. [unverified]
- **Target** / **Untarget** - toggles your target on this token (client/user state only). [unverified]
- **Enter Combat** / **Exit Combat** - adds/removes the controlled tokens to/from the
  current encounter (creates one if needed). World update. [unverified]

Sources: `C:/FoundryTest/app/templates/hud/token-hud.hbs`,
`C:/FoundryTest/app/client/applications/hud/token-hud.mjs`,
`C:/FoundryTest/app/client/applications/hud/placeable-hud.mjs`,
`C:/FoundryTest/data/Data/systems/dnd5e/dnd5e.mjs` (`TokenHUD5e`),
https://foundryvtt.com/article/tokens/, https://foundryvtt.com/releases/14.353

## Measurement and templates (v14 change)

- The **Measurement Controls** group (`templates`) is defined but hidden (`visible: false`),
  so no template tools appear in v14. Do not expect **Circle**, **Cone**, **Rectangle**,
  **Ray** or **Clear Templates** buttons from older docs. [unverified]
- Distance measuring moved to **Token Controls > Measure Distance** (and drag-measurement
  while moving a token). [unverified]
- Area templates are Regions: use **Region Controls > Measured Template Mode** (below). dnd5e
  6 activities with an area show **Place Measured Template** on the chat card; placing it
  creates a Region (`canvas.regions.placeRegions`). [unverified]

Sources: `C:/FoundryTest/app/client/canvas/layers/templates.mjs`,
`C:/FoundryTest/data/Data/systems/dnd5e/lang/en.json` (`DND5E.TARGET.Action.PlaceTemplate`),
https://foundryvtt.com/article/measurement/, https://foundryvtt.com/releases/14.353

## Tile Controls (GM only)

Path: Scene controls > **Tile Controls**. Default tool: **Select Tiles**.

- **Select Tiles** (`select`) - select, move, rotate (Shift/Ctrl+wheel), double-click to edit,
  right-click for the Tile HUD, Delete to delete. World updates, Ctrl+Z undoes. [unverified]
- **Place Tile** (`tile`) - drag a rectangle; the Tile config opens as a preview and the tile
  is only created when you save it (closing without saving creates nothing). [unverified]
- **Tile Browser** (`browse`, button) - opens the File Picker in tile mode; drag an image onto
  the canvas to create a tile (Shift = no snap, Alt = hidden). Opening it changes nothing. [unverified]
- **Force Snap to Grid Vertices** (`snap`, toggle) - client-side snapping aid; hidden on
  gridless scenes. [unverified]
- **Palette** (`togglePalette`, toggle) - opens the Tile palette window (`#tile-palette`). [unverified]
- No "Clear" button for tiles. Tile config tabs: **Position**, **Appearance**, **Overhead**. [unverified]

Tile HUD (right-click a tile with Select Tiles; `#tile-hud`):
- **Elevation** box, **To Front/Back**, **Hide**/**Show**, **Lock**/**Unlock**, and for video
  tiles **Play Video**/**Pause Video**. All except play/pause are world updates. [unverified]

Sources: `C:/FoundryTest/app/client/canvas/layers/tiles.mjs`,
`C:/FoundryTest/app/templates/hud/tile-hud.hbs`,
`C:/FoundryTest/app/client/applications/sheets/tile-config.mjs`,
https://foundryvtt.com/article/tiles/

## Drawing Tools (Trusted Player+ by default)

Path: Scene controls > **Drawing Tools**. Default tool: **Select Drawings**.

- **Select Drawings** (`select`) - select, move, rotate, edit (double-click), HUD
  (right-click), delete. [unverified]
- **Draw Rectangle** (`rect`), **Draw Ellipse** (`ellipse`) - click-drag; Alt+drag keeps
  proportions. Creates a Drawing on release. [unverified]
- **Draw Polygon** (`polygon`) - click to add points; double-click (or click the start point)
  to finish. [unverified]
- **Draw Freehand** (`freehand`) - drag to draw. [unverified]
- **Draw Text** (`text`) - drag a box, then type; with one drawing selected, picking this tool
  starts editing its text. [unverified]
- **Force Snap to Grid Vertices** (`snap`, toggle; hidden on gridless scenes). [unverified]
- **Palette** (`togglePalette`, toggle) - opens `#drawing-palette` (default stroke, fill, text). [unverified]
- **Clear Drawings** (`clear`, button) - confirm dialog **Clear All Objects** (GM) or **Clear
  All Owned Objects** (player); deletes all drawings on the viewed level. Optional **Delete
  Locked Objects** checkbox. Destructive. [unverified]
- Drawing config tabs: **Position**, **Lines**, **Fill**, **Text**. [unverified]

Drawing HUD (right-click a drawing with Select Drawings; `#drawing-hud`):
- **Elevation** box, **To Front/Back**, **Hide**/**Show**, **Lock**/**Unlock**. World updates. [unverified]

Sources: `C:/FoundryTest/app/client/canvas/layers/drawings.mjs`,
`C:/FoundryTest/app/templates/hud/drawing-hud.hbs`,
`C:/FoundryTest/app/client/applications/sheets/drawing-config.mjs`,
https://foundryvtt.com/article/drawings/

## Wall Controls (GM only)

Path: Scene controls > **Wall Controls**. Default tool: **Select Walls**.

- **Select Walls** (`select`) - select (Alt+click selects a connected chain), move
  (Shift+drag without snapping), double-click to edit, delete. [unverified]
- **Draw Wall** (`wall`) - click-drag to place a wall using the current wall preset;
  Ctrl+click chains segments. World create; Ctrl+Z undoes. [unverified]
- Preset buttons (all `button` kind; each sets the Wall palette preset used by **Draw Wall**,
  and a small pip marks the active preset; clicking one creates nothing):
  **Solid Wall** (`solid`), **Terrain Wall** (`terrain`), **Invisible Wall** (`invisible`),
  **Ethereal Wall** (`ethereal`), **Door** (`doors`), **Secret Door** (`secret`),
  **Window** (`window`). The preset is a client setting (`core.wallPalette`). [unverified]
- **Force Snap to Grid Vertices** (`snap`, toggle; hidden on gridless scenes). [unverified]
- **Palette** (`togglePalette`, toggle) - opens `#wall-palette` (preset editor). [unverified]
- **Close all Doors** (`closeDoors`, button) - closes every open door on the scene at once,
  no confirm, shows "Closed N doors". World update; it is recorded in the Walls layer
  history, so Ctrl+Z with Wall Controls active reopens them. [unverified]
- **Clear Walls** (`clear`, button) - confirm dialog, then deletes all walls on the viewed
  level. Destructive. [unverified]
- Older docs mention a **Clone** wall tool; v14 has none (the palette's **Clone** button copies
  a selected wall's settings into the preset instead). [unverified]

Sources: `C:/FoundryTest/app/client/canvas/layers/walls.mjs`,
`C:/FoundryTest/app/client/applications/sheets/palette/wall-palette.mjs`,
https://foundryvtt.com/article/walls/

## Lighting Controls (GM only)

Path: Scene controls > **Lighting Controls**. Default tool: **Select Light Sources**.

- **Select Light Sources** (`select`) - select, move, rotate, edit (double-click), delete. [unverified]
- **Draw Light Source** (`light`) - click-drag to set the radius; the light is created on
  release. Right-click an existing light toggles it on/off (its `hidden` flag; ignored when
  locked). World updates. [unverified]
- **Transition to Daylight** (`day`, button) - animates the scene's darkness to 0. No
  confirm; world update to the Scene; not on the Ctrl+Z history. Hidden when the scene has
  **Darkness Level Lock** on. [unverified]
- **Transition to Darkness** (`night`, button) - animates darkness to 1. Same caveats. [unverified]
- **Reset Fog of War** (`reset`, button) - confirm dialog **Reset Fog of War Exploration?**;
  wipes explored fog for all players on this scene. Not undoable. [unverified]
- **Palette** (`togglePalette`, toggle) - opens `#ambient-light-palette`. [unverified]
- **Clear Lights** (`clear`, button) - confirm, then deletes all lights on the viewed level. [unverified]
- Light config tabs: **Basic Configuration**, **Light Animation**, **Advanced Options**. [unverified]

Sources: `C:/FoundryTest/app/client/canvas/layers/lighting.mjs`,
`C:/FoundryTest/app/client/canvas/placeables/light.mjs`,
`C:/FoundryTest/app/client/applications/sheets/ambient-light-config.mjs`,
https://foundryvtt.com/article/lighting/

## Ambient Sound Controls (GM only)

Path: Scene controls > **Ambient Sound Controls**. Default tool: **Select Ambient Sounds**.

- **Select Ambient Sounds** (`select`) - select, move, edit, delete. [unverified]
- **Draw Ambient Sound** (`sound`) - click-drag a radius; the Sound config opens and the sound
  is created when saved. Right-click a sound toggles it on/off (not when locked). [unverified]
- **Preview Ambient Sounds** (`preview`, toggle) - hover the cursor to hear sounds as if a
  token stood there. Local only (`canvas.sounds.livePreview`), plays audio. [unverified]
- **Palette** (`togglePalette`, toggle) - opens `#ambient-sound-palette`. [unverified]
- **Clear Sounds** (`clear`, button) - confirm, then deletes all ambient sounds on the viewed
  level. [unverified]

Sources: `C:/FoundryTest/app/client/canvas/layers/sounds.mjs`,
`C:/FoundryTest/app/client/canvas/placeables/sound.mjs`,
https://foundryvtt.com/article/ambient-sound/

## Region Controls (Player+ by default)

Path: Scene controls > **Region Controls**. Default tool: **Select Regions**.

- **Select Regions** (`select`) - select one or more Regions (selected = solid color,
  unselected = striped), move, rotate, double-click to open Region config, delete. The Delete
  key asks for confirmation only when the Region has behaviors. [unverified]
- **Measured Template Mode** (`templateMode`, toggle) - when on, each shape you draw becomes
  its own new Region and the palette is ignored. Default is ON for non-GM users and OFF for
  GMs. Client-side state (`canvas.regions.templateMode`); flipping it re-renders the tool list
  (ellipse, polygon, holes and palette disappear in template mode). [unverified]
- Shape tools (click-drag; Alt+drag keeps proportions where supported). Outside template
  mode the shape is added to the selected Region, or a new Region is made if none is
  selected: **Draw Rectangle** (`rectangle`), **Draw Circle** (`circle`), **Draw Ellipse**
  (`ellipse`, hidden in template mode), **Draw Cone** (`cone`), **Draw Ring** (`ring`),
  **Draw Line** (`line`), **Draw Emanation** (`emanation`), **Draw Polygon** (`polygon`,
  hidden in template mode). World create/update. [unverified]
- **Create Holes** (`hole`, toggle; hidden in template mode) - new shapes cut holes where the
  Region's behaviors do not apply. [unverified]
- **Force Snap to Grid Vertices** (`snap`, toggle; hidden on gridless scenes). [unverified]
- **Palette** (`togglePalette`, toggle) - opens `#region-palette`; hidden in template mode and
  while a shape tool is active with a Region selected. [unverified]
- **Clear Regions** (`clear`, button) - confirm, then deletes Regions on the viewed level
  (players: only their own). [unverified]
- Region config tabs (v14): **Appearance**, **Shapes**, **Placement**, **Behaviors**. The KB
  article still names an "Identity" tab. [unverified]
- Hovering a shape and pressing Ctrl+C / Ctrl+X copies or cuts a single shape ("Copied Region
  shape."). [unverified]

### Region behaviors (summary)

Added on the **Behaviors** tab of Region config (GM; non-GMs cannot create behaviors). Core
v14 types:
- **Adjust Darkness Level**, **Apply Active Effect**, **Change Level** (moves tokens between
  scene levels), **Define Surface** (new in v14; a surface that blocks light, movement, sight,
  sound), **Display Scrolling Text**, **Execute Macro**, **Execute Script**, **Modify Movement
  Cost**, **Pause Game** (fires for non-GM tokens), **Suppress Weather**, **Teleport Token**,
  **Toggle Behavior**. [unverified]
- dnd5e 6.0.5 adds: **Apply Active Effect (5e)**, **Difficult Terrain**, **Rotate Area**. [unverified]
- Each behavior has its own config sheet and an enable/disable state. **Execute Script** and
  **Execute Macro** run code; do not create them in automated tests. [unverified]

Sources: `C:/FoundryTest/app/client/canvas/layers/regions.mjs`,
`C:/FoundryTest/app/client/applications/sheets/region-config.mjs`,
`C:/FoundryTest/app/client/config.mjs` (`CONFIG.RegionBehavior`),
`C:/FoundryTest/app/public/lang/en.json` (`TYPES.RegionBehavior.*`),
`C:/FoundryTest/data/Data/systems/dnd5e/system.json`,
`C:/FoundryTest/data/Data/systems/dnd5e/lang/en.json`,
https://foundryvtt.com/article/scene-regions/, https://foundryvtt.com/releases/14.353

## Journal Notes (everyone)

Path: Scene controls > **Journal Notes**. Default tool: **Select Notes**.

- **Select Notes** (`select`) - select and move notes; double-click a note to open its linked
  journal entry or page (if you have permission). [unverified]
- **Create Map Note** (`journal`) - needs **Create Map Notes** permission (default Trusted
  Player+). Click the canvas; a Note config dialog opens and the note is created on save.
  Dragging a Journal Entry or page from the sidebar onto the scene does the same. [unverified]
- **Toggle Notes Display** (`toggle`, toggle) - show notes on every layer, or only on this
  one. Per-user client setting `core.notesDisplayToggle` (default on). [unverified]
- **Palette** (`togglePalette`, toggle) - opens `#note-palette`. [unverified]
- **Clear Notes** (`clear`, button) - visible to everyone; confirm dialog; a GM deletes all
  notes on the viewed level, a player only notes they own. [unverified]

Sources: `C:/FoundryTest/app/client/canvas/layers/notes.mjs`,
https://foundryvtt.com/article/map-notes/

## Placeable palettes (v14, shared by most groups)

- The **Palette** toggle exists on Tiles, Drawings, Walls, Lighting, Sounds, Regions, Notes.
  It opens a floating window titled "<Type> Palette: Preset" (for example "Wall Palette:
  Preset"). Its ids: `#tile-palette`, `#drawing-palette`, `#wall-palette`,
  `#ambient-light-palette`, `#ambient-sound-palette`, `#region-palette`, `#note-palette`.
  `ui.placeablesPalette` points at the open one. [unverified]
- With a creation tool active, edits change the default data for new objects (a client
  setting such as `core.wallPalette`; not world data). [unverified]
- With the Select tool and objects selected, the title becomes "<Type> Palette: Edit [N]" and
  **Apply** writes the changes to all selected unlocked objects (world update). **Clone** copies
  the first selected object's settings into the preset. [unverified]
- The palette open/closed state carries across groups (`ui.controls.paletteOpen`). [unverified]

Sources: `C:/FoundryTest/app/client/applications/sheets/palette/*.mjs`,
`C:/FoundryTest/app/client/game.mjs` (palette settings, scope `client`),
`C:/FoundryTest/app/public/lang/en.json` (`PLACEABLE_PALETTE.*`)

## Related v14 additions (outside the control column)

- **Placeables** sidebar tab (`fa-puzzle-piece`, visible to players too) - lists the viewed
  scene's placeables per type (Tokens, Tiles, Drawings, Walls, Lights, Sounds, Regions,
  Notes) with Hide/Show, Lock/Unlock, level and Clear actions. It replaced the old Region
  Legend and follows the active layer. [unverified]
- Scene levels: switch levels from the Scene Navigation bar (shown when a scene has 2+
  levels) and move tokens with the Token HUD **Change Level**. [unverified]

Sources: `C:/FoundryTest/app/client/applications/sidebar/tabs/placeable-directory.mjs`,
`C:/FoundryTest/app/client/applications/sidebar/sidebar.mjs`,
`C:/FoundryTest/app/client/applications/ui/scene-navigation.mjs`,
https://foundryvtt.com/releases/14.353

## Driving it from automation

Read-only console checks (paste into the browser console on `/game`):

```js
// 1. Canvas and scene state
({ready: canvas.ready, scene: canvas.scene?.name, level: canvas.level?.name ?? null,
  gridless: canvas.grid?.isGridless, isGM: game.user.isGM, role: game.user.role})

// 2. Active group, tool and layer
({control: ui.controls.control?.name, tool: ui.controls.tool?.name,
  activeTool: game.activeTool, layer: canvas.activeLayer?.options.name})

// 3. Groups this user can see, in screen order, with labels
Object.values(ui.controls.controls).sort((a, b) => a.order - b.order)
  .map(c => `${c.order} ${c.name}: ${game.i18n.localize(c.title)}`)

// 4. Tools of the active group, with kind and state
Object.values(ui.controls.tools).sort((a, b) => a.order - b.order)
  .map(t => ({name: t.name, label: game.i18n.localize(t.title),
    kind: t.toggle ? 'toggle' : t.button ? 'button' : 'tool', active: !!t.active}))

// 5. Toggle states (all client-side)
({unconstrained: game.settings.get('core', 'unconstrainedMovement'),
  notesDisplay: game.settings.get('core', 'notesDisplayToggle'),
  forceSnap: canvas.forceSnapVertices, soundPreview: canvas.sounds.livePreview,
  templateMode: canvas.regions.templateMode, paletteOpen: ui.controls.paletteOpen,
  palette: ui.placeablesPalette?.id ?? null})

// 6. HUDs
({token: canvas.hud.token.rendered ? canvas.hud.token.object?.name : null,
  tile: canvas.hud.tile.rendered, drawing: canvas.hud.drawing.rendered})

// 7. Selection and targets
({controlled: canvas.activeLayer?.controlled?.map(o => o.id) ?? [],
  targets: [...game.user.targets].map(t => t.name)})

// 8. Placeable counts on the viewed scene (compare before/after a test)
Object.fromEntries(['tokens', 'tiles', 'drawings', 'walls', 'lights', 'sounds', 'regions',
  'notes', 'levels'].map(k => [k, canvas.scene?.[k]?.size]))

// 9. Viewport point of a placeable, for clicking it on the canvas
canvas.clientCoordinatesFromCanvas(canvas.tokens.placeables[0].center)
```

Client-only navigation helpers (change UI state, never world data):

```js
await ui.controls.activate({control: 'walls'});                 // switch group
await ui.controls.activate({control: 'tokens', tool: 'target'}); // switch tool
```

Stable selectors and labels:
- Group button: `#scene-controls-layers button[data-control="walls"]`; accessibility-tree
  search: the group label, for example "Wall Controls". [unverified]
- Tool button: `#scene-controls-tools button[data-tool="closeDoors"]`; search the tool label,
  for example "Close all Doors". Active state: `aria-pressed="true"`. [unverified]
- HUDs: `#hud`, `#token-hud`, `#tile-hud`, `#drawing-hud`; buttons by `data-action`
  (`visibility`, `locked`, `sort`, `config`, `target`, `combat`, `togglePalette`,
  `effect`, `movementAction`, `level`) or by label ("Hide", "Show", "Target", "Enter Combat",
  "Assign Status Effects", "Select Movement Action", "To Front/Back", "Open Configuration").
  Status icons: `#token-hud .effect-control[data-status-id="prone"]`. [unverified]
- Palettes: `#wall-palette`, `#region-palette`, etc. Confirm dialogs are DialogV2 windows
  with **Yes** / **No** buttons. [unverified]

Gotchas for automated driving:
- Placeables are drawn on a WebGL `<canvas>`; they are not DOM nodes. Find them with JS
  (query 9) and click by coordinates. Screenshot scale can differ from CSS pixels; convert
  with the page's `devicePixelRatio` and the screenshot scale factor.
- The canvas pans and zooms; recompute coordinates after any pan/zoom or window resize.
- The HUD opens on right-click only when the layer that owns the object is active and the
  Select tool (or a control-capable tool) is in use.
- Some groups hide tools by context: snap toggles on gridless scenes, day/night with
  **Darkness Level Lock**, region shapes in template mode, the regions palette with a shape
  tool plus selection. Re-read the tool list (query 4) instead of assuming.
- Tile, Sound and Note creation opens a config sheet first; nothing exists until you save.
- A paused game blocks non-GM moves, door clicks and undo.
- Tool changes cancel any drag in progress.
- Buttons like **Close all Doors**, **Transition to Daylight** act on the first click; there is
  no confirm.

Sources: `C:/FoundryTest/app/client/applications/ui/scene-controls.mjs`,
`C:/FoundryTest/app/client/canvas/board.mjs`,
`C:/FoundryTest/app/client/applications/hud/container.mjs`,
`C:/FoundryTest/app/client/canvas/placeables/placeable-object.mjs`,
https://foundryvtt.com/api/v14/classes/foundry.applications.ui.SceneControls.html

## Safety in the test world

Use the local test world only (`ai-tool-test` on localhost:30001, user `Claude`). Never the
live campaign, never the live bridge ports.

- **Client-only, safe to click freely**: switching groups and tools, **Select Targets**,
  **Measure Distance**, **Unconstrained Movement**, **Force Snap to Grid Vertices**,
  **Preview Ambient Sounds** (plays audio), **Measured Template Mode**, **Toggle Notes
  Display**, **Palette** open/close, the wall preset buttons (they only change your preset),
  **Tile Browser** (opens a picker), opening any HUD. [unverified]
- **World-data changes, undoable with Ctrl+Z**: any create, update or delete of a placeable
  that *you* make on the *viewed* scene is recorded in that document type's layer history
  (last 100 entries, this browser session). Ctrl+Z only undoes on the **active** layer, so
  pick the owning group first: door open/close and **Close all Doors** live in the Walls
  history even when clicked from Token Controls; light/sound on-off toggles in the Lighting /
  Sounds history; HUD elevation, sort, hide/show, lock and movement action in the owning
  layer's history. [unverified]
- **World-data changes with no Ctrl+Z**: **Transition to Daylight** / **Transition to
  Darkness** (a Scene update, not a placeable; undo by pressing the other one or restoring the
  old darkness in Scene config), HUD **Enter Combat** (use **Exit Combat**, then delete the
  encounter), status effects and HP bar edits (they change the actor; toggle or retype back).
  [unverified]
- **Destructive, avoid unless the scene is disposable**: every **Clear …** button (the deletes
  may land in the layer history, but do not rely on undo for a mass delete), **Reset Fog of
  War** (cannot be undone), deleting tokens that are in combat (deletes combatants).
  [unverified]
- **Do not create**: **Execute Script** / **Execute Macro** / **Pause Game** / **Teleport
  Token** behaviors during UI checks; they run code or interrupt the session. [unverified]
- **Palette with a selection**: **Apply** writes to every selected object. Deselect first
  (Esc or click empty canvas) when you only want to look at the palette. [unverified]
- Work on a throwaway scene (for example "UI Test Scene"), *view* it rather than *activate* it,
  and delete it when done. The test world currently holds one scene, "Foundry Virtual
  Tabletop" (read from the world database; verify it in the Scenes tab). [unverified]
- Compare placeable counts (query 8) before and after a check to prove nothing leaked.

Sources: `C:/FoundryTest/app/client/canvas/layers/base/placeables-layer.mjs` (`deleteAll`,
`undoHistory`, 100-entry history), `C:/FoundryTest/app/client/documents/scene.mjs`
(history recorded in `_pre*DescendantDocuments`),
`C:/FoundryTest/app/client/helpers/interaction/client-keybindings.mjs` (undo acts on the
active layer), `C:/FoundryTest/app/client/canvas/layers/lighting.mjs`,
`C:/FoundryTest/app/client/canvas/layers/walls.mjs`,
`.claude/skills/foundry-test-env/SKILL.md`

## Verification checklist

Run as `Claude` (GM) unless a step says Player. Before step 1, open Sidebar > Scenes and view
a disposable scene with a square grid; run console query 1 and expect `ready: true`.

1. Look at the left edge. Expect a column of group buttons in this order: Token Controls,
   Tile Controls, Drawing Tools, Wall Controls, Lighting Controls, Ambient Sound Controls,
   Region Controls, Journal Notes (no Measurement Controls).
2. Run query 3. Expect the same eight groups with orders 1-8 and no `templates` entry.
3. Hover **Token Controls**. Expect the tooltip "Token Controls"; the button has
   `aria-pressed="true"` after load.
4. Look at the tool column for Token Controls. Expect **Select Tokens**, **Select Targets**,
   **Measure Distance**, **Unconstrained Movement**, with Select Tokens pressed.
5. Hover **Select Tokens**. Expect a toolclip (video + hints) if Show Toolclips on Hover is on,
   else a plain tooltip.
6. Click **Unconstrained Movement**. Expect it to show pressed; query 5 gives
   `unconstrained: true`. Click again; expect `false`.
7. Click **Measure Distance**, drag across the canvas. Expect a ruler with a distance label;
   release clears it; placeable counts unchanged.
8. Place (or reuse) one token on the scene. With **Select Tokens**, right-click it. Expect
   `#token-hud` with Elevation, To Front/Back, Lock, Open Configuration (left), bars (middle),
   Hide, Assign Status Effects, Select Movement Action, Target, Enter Combat (right).
9. In the Token HUD click **Assign Status Effects**. Expect the dnd5e condition icons grid.
   Close it without clicking an icon.
10. In the Token HUD click **Select Movement Action**. Expect "Default (Walk)" plus Walk, Fly,
    Swim, Burrow, Climb, Crawl, Jump, Teleport (Blink), Teleport (Displace). Close without
    choosing.
11. In the Token HUD click **Target**. Expect the button to become **Untarget** and query 7 to
    list the token. Click again to clear.
12. Check that **Change Level** is absent on a single-level scene.
13. Press Esc. Expect the HUD to close (query 6: `token: null`).
14. Click **Tile Controls**. Expect **Select Tiles**, **Place Tile**, **Tile Browser**, **Force
    Snap to Grid Vertices**, **Palette**; no Clear button.
15. Click **Tile Browser**. Expect a File Picker in tile mode. Close it; counts unchanged.
16. Click **Palette**. Expect a window "Tile Palette: Preset" (`#tile-palette`); query 5 shows
    `paletteOpen: true`. Click **Palette** again; expect it to close.
17. Click **Drawing Tools**. Expect **Select Drawings**, **Draw Rectangle**, **Draw Ellipse**,
    **Draw Polygon**, **Draw Freehand**, **Draw Text**, **Force Snap to Grid Vertices**,
    **Palette**, **Clear Drawings**.
18. With **Draw Rectangle**, drag a small box. Expect a new drawing (drawings count +1). Press
    Ctrl+Z; expect the count back.
19. Draw one more rectangle, switch to **Select Drawings**, right-click it. Expect
    `#drawing-hud` with Elevation, To Front/Back, Hide, Lock. Press Esc; Ctrl+Z to remove it.
20. Click **Clear Drawings**. Expect a **Clear All Objects** confirm dialog. Click **No**;
    counts unchanged.
21. Click **Wall Controls**. Expect **Select Walls**, **Draw Wall**, **Solid Wall**, **Terrain
    Wall**, **Invisible Wall**, **Ethereal Wall**, **Door**, **Secret Door**, **Window**,
    **Force Snap to Grid Vertices**, **Palette**, **Close all Doors**, **Clear Walls** (may
    wrap into two columns).
22. Click **Door**. Expect no wall created, the Door button not left pressed, and a pip on it
    marking the active preset.
23. With **Draw Wall**, drag a short wall. Expect a door wall with a door icon (walls +1).
24. Switch to **Token Controls** and click the door icon. Expect it to open (icon changes).
25. Back on **Wall Controls**, click **Close all Doors**. Expect a notification "Closed 1
    doors" and the door closed. With Wall Controls still active, press Ctrl+Z three times
    (undo close, undo open, undo create); expect the walls count back to its start value.
26. Click **Clear Walls**; expect a confirm dialog; click **No**.
27. Click **Lighting Controls**. Expect **Select Light Sources**, **Draw Light Source**,
    **Transition to Daylight**, **Transition to Darkness**, **Reset Fog of War**, **Palette**,
    **Clear Lights** (day/night absent if Darkness Level Lock is set).
28. Click **Reset Fog of War**. Expect the dialog **Reset Fog of War Exploration?**. Click
    **No**.
29. With **Draw Light Source**, drag a radius. Expect a light (lights +1). Right-click it;
    expect it to turn off (its `hidden` flag becomes true; the icon shows it as off). With
    Lighting Controls active, press Ctrl+Z twice; expect the light gone.
30. Click **Ambient Sound Controls**. Expect **Select Ambient Sounds**, **Draw Ambient Sound**,
    **Preview Ambient Sounds**, **Palette**, **Clear Sounds**.
31. With **Draw Ambient Sound**, drag a radius. Expect the Ambient Sound config to open with no
    sound created yet; close it without saving; sounds count unchanged.
32. Click **Preview Ambient Sounds**. Expect it pressed and query 5 `soundPreview: true`. Click
    again to turn off.
33. Click **Region Controls**. Expect **Select Regions**, **Measured Template Mode** (not
    pressed for GM), **Draw Rectangle**, **Draw Circle**, **Draw Ellipse**, **Draw Cone**,
    **Draw Ring**, **Draw Line**, **Draw Emanation**, **Draw Polygon**, **Create Holes**,
    **Force Snap to Grid Vertices**, **Palette**, **Clear Regions**.
34. Click **Measured Template Mode**. Expect it pressed, query 5 `templateMode: true`, and
    Draw Ellipse, Draw Polygon, Create Holes and Palette to disappear. Click again to restore.
35. With **Draw Circle**, drag a circle. Expect a new Region (regions +1), selected after
    creation. If a Region config window opens by itself, note it and close it.
36. Switch to **Select Regions** and double-click the Region. Expect Region config with tabs
    **Appearance**, **Shapes**, **Placement**, **Behaviors**.
37. Open the **Behaviors** tab and start adding a behavior. Expect the type list to include
    the 12 core types plus **Apply Active Effect (5e)**, **Difficult Terrain**, **Rotate
    Area**. Cancel without adding. Close the config.
38. Select the Region and press Delete. Expect it deleted without a dialog (no behaviors).
    Counts back to the start.
39. Click **Journal Notes**. Expect **Select Notes**, **Create Map Note**, **Toggle Notes
    Display** (pressed), **Palette**, **Clear Notes**.
40. Click **Toggle Notes Display**. Expect query 5 `notesDisplay: false`; click again for
    `true`.
41. With **Create Map Note**, click the canvas. Expect a note config dialog; close it without
    saving; notes count unchanged.
42. Open Sidebar > **Placeables** tab. Expect sub-tabs per placeable type, following the
    active layer (Notes now). 
43. Run query 8 and compare with the value from before step 1. Expect equal counts.
44. Log in as `Player` (separate session). Expect only Token Controls, Region Controls and
    Journal Notes in the column.
45. As Player, open **Token Controls**. Expect **Select Tokens**, **Select Targets**,
    **Measure Distance**; no Unconstrained Movement.
46. As Player, open **Region Controls**. Expect **Measured Template Mode** pressed by default
    and no Draw Ellipse, Draw Polygon, Create Holes or Palette.
47. As Player, open **Journal Notes**. Expect **Select Notes**, **Toggle Notes Display**,
    **Clear Notes**; no **Create Map Note** (Player role lacks it by default).
48. As Player, right-click an owned token (if any). Expect the Token HUD without Hide, Lock
    or Change Level, and without Open Configuration (Player lacks Configure Token).
49. As GM, delete the disposable scene (or confirm it is left clean) and log the result.

## Sources

Local v14 / dnd5e source (read-only, ground truth):
- `C:/FoundryTest/app/client/applications/ui/scene-controls.mjs`
- `C:/FoundryTest/app/templates/ui/scene-controls-layers.hbs`
- `C:/FoundryTest/app/templates/ui/scene-controls-tools.hbs`
- `C:/FoundryTest/app/client/canvas/layers/base/interaction-layer.mjs`
- `C:/FoundryTest/app/client/canvas/layers/base/placeables-layer.mjs`
- `C:/FoundryTest/app/client/canvas/layers/tokens.mjs`, `templates.mjs`, `tiles.mjs`,
  `drawings.mjs`, `walls.mjs`, `lighting.mjs`, `sounds.mjs`, `regions.mjs`, `notes.mjs`
- `C:/FoundryTest/app/client/canvas/placeables/placeable-object.mjs`, `light.mjs`, `sound.mjs`
- `C:/FoundryTest/app/client/canvas/containers/elements/door-control.mjs`
- `C:/FoundryTest/app/client/canvas/board.mjs`
- `C:/FoundryTest/app/client/applications/hud/token-hud.mjs`, `tile-hud.mjs`,
  `drawing-hud.mjs`, `placeable-hud.mjs`, `container.mjs`
- `C:/FoundryTest/app/templates/hud/token-hud.hbs`, `tile-hud.hbs`, `drawing-hud.hbs`
- `C:/FoundryTest/app/client/applications/sheets/palette/*.mjs`
- `C:/FoundryTest/app/client/applications/sheets/region-config.mjs`, `tile-config.mjs`,
  `drawing-config.mjs`, `ambient-light-config.mjs`
- `C:/FoundryTest/app/client/applications/sidebar/sidebar.mjs`,
  `C:/FoundryTest/app/client/applications/sidebar/tabs/placeable-directory.mjs`
- `C:/FoundryTest/app/client/applications/ui/scene-navigation.mjs`
- `C:/FoundryTest/app/client/config.mjs`, `C:/FoundryTest/app/client/game.mjs`
- `C:/FoundryTest/app/client/helpers/interaction/client-keybindings.mjs`
- `C:/FoundryTest/app/common/constants.mjs`, `C:/FoundryTest/app/common/documents/scene.mjs`
- `C:/FoundryTest/app/public/lang/en.json`
- `C:/FoundryTest/data/Data/systems/dnd5e/dnd5e.mjs`, `lang/en.json`, `system.json`

Official docs and release notes:
- https://foundryvtt.com/article/canvas-layers/
- https://foundryvtt.com/article/tokens/
- https://foundryvtt.com/article/measurement/
- https://foundryvtt.com/article/tiles/
- https://foundryvtt.com/article/drawings/
- https://foundryvtt.com/article/walls/
- https://foundryvtt.com/article/lighting/
- https://foundryvtt.com/article/ambient-sound/
- https://foundryvtt.com/article/scene-regions/
- https://foundryvtt.com/article/map-notes/
- https://foundryvtt.com/api/v14/classes/foundry.applications.ui.SceneControls.html
- https://foundryvtt.com/releases/14.353
- https://foundryvtt.com/releases/14.368

Community: the foundryvtt.wiki has no v14 scene-controls page (a guessed URL returned 404);
nothing from it is relied on here.
