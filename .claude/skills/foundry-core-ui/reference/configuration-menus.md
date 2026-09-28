# Configuration Menus

> Status: DRAFT from documentation and the local v14 source; not yet verified on the running client. The click-through pass stamps "verified on Foundry 14.368 / dnd5e 6.0.5, <date>".

Scope: the buttons on the **Settings** sidebar tab and every window they open in Foundry 14.368
with dnd5e 6.0.5: **Game Settings** (categories, search, every Core sub-menu, Reset Defaults,
Save Changes, reload prompt), **Controls Configuration**, **Module Management**, **World
Configuration**, **User Management**, **Tour Management**, **Welcome Screen** (dnd5e),
**Support & Issues**, and the **Documentation** / **Community Wiki** links.

Conventions:

- **Bold** text is the exact English label from `C:/FoundryTest/app/public/lang/en.json` (core) or
  `C:/FoundryTest/data/Data/systems/dnd5e/lang/en.json` (dnd5e). Keys are resolved the way Foundry
  does (flat dotted keys and nested objects are merged).
- "GM" means `game.user.isGM` (Gamemaster or Assistant GM). "Full GM" means the Gamemaster role
  only (`game.user.hasRole("GAMEMASTER")`). "Can modify settings" means the `SETTINGS_MODIFY`
  permission, which defaults to Assistant GM and above (`common/constants.mjs`).
- Scope: **world** = saved in the world database for everyone; **client** = saved in this browser's
  localStorage only (the default when a setting names no scope); **user** = saved per user.
- Related pages: `sidebar-tabs.md` (the tab strip and the Settings tab summary) and
  `dnd5e-settings.md` (every dnd5e setting, its sub-menus and the Welcome window in depth).

## How to reach it

- Open `/game` as `Claude` (GM). The sidebar starts collapsed. Click the tab icon whose
  aria-label is **Settings** (`#sidebar-tabs button[data-tab="settings"]`, gear icon, last in the
  strip). Clicking a tab expands the sidebar. [unverified]
- The Settings tab content is `ui.settings` (class `foundry.applications.sidebar.tabs.Settings`).
  Its buttons all carry `data-action="openApp"` and a `data-app` value (below). [unverified]
- Top to bottom on the tab (GM view):
  1. Info block: **Foundry Virtual Tabletop**, the version line, **Build Version** `368`,
     **Active Modules** with a count. dnd5e removes the core system row. [unverified]
  2. dnd5e block: heading **Game System**, D&D badge with `6.0.5`, links **Notes**, **Issues**,
     **Wiki**, **Discord**. [unverified]
  3. **Welcome Screen** button (dnd5e, inserted right after its block, above the next
     divider). [unverified]
  4. Divider **Settings and Configuration**: **Game Settings**, **Controls Configuration**,
     **Module Management**, **World Configuration**, **User Management**, **Tour Management**.
     [unverified]
  5. Divider **Help and Documentation**: **Support & Issues** (with `(N)` when issues exist),
     **Documentation**, **Community Wiki**. [unverified]
  6. Divider **Game Access**: **Invitation Links**, **Log Out**, **Return to Setup** (out of scope
     here; see Safety). The lower sections may need a scroll in a short window. [unverified]
- Sources: `C:/FoundryTest/app/templates/sidebar/tabs/settings.hbs`,
  `C:/FoundryTest/app/client/applications/sidebar/tabs/settings.mjs`,
  `C:/FoundryTest/data/Data/systems/dnd5e/dnd5e.mjs` (`renderSettings`),
  https://foundryvtt.com/article/settings/,
  https://foundryvtt.com/api/classes/foundry.applications.sidebar.tabs.Settings.html

## Settings tab buttons (what each opens)

| Label | `data-app` | Opens | Who sees the button |
|-------|-----------|-------|---------------------|
| **Game Settings** | `configure` | window **Game Settings** (`#settings-config`) | everyone |
| **Controls Configuration** | `controls` | window **Controls Configuration** (`#controls-config`) | everyone |
| **Module Management** / **Active Modules** | `modules` | window **Module Management** (`#module-management`) | everyone; label is **Active Modules** for users who cannot modify settings |
| **World Configuration** | `world` | window **Edit World: AI Tool Test** (`#world-config`) | full GM only |
| **User Management** | `players` | full page `/players` (leaves the game view) | GM |
| **Tour Management** | `tours` | window **Tour Management** (`#tours-management`) | everyone |
| **Support & Issues** | `support` | window **Support & Issues** (`#support-details`) | everyone |
| **Documentation** | (link) | https://foundryvtt.com/kb/ in a new tab | everyone |
| **Community Wiki** | (link) | https://foundryvtt.wiki/ in a new tab | everyone |
| **Welcome Screen** | (none, dnd5e) | window **Welcome to D&D 5e** (`#dnd5e-welcome-screen`) | everyone (fields disabled for non-GMs) |

- All rows above: [unverified]
- In demo mode the GM-only buttons are hidden and Module Management shows as **Active Modules**.
  Not relevant to the test world. [unverified]
- Sources: as above; https://foundryvtt.com/api/classes/foundry.applications.sidebar.apps.ModuleManagement.html

## Game Settings window (layout and common controls)

- **Game Settings** - window title; id `settings-config`; 780 x 680, resizable; opened from
  Settings tab > **Game Settings** or `game.settings.sheet.render({force: true})`. Everyone.
  [unverified]
- Layout (v14 "category browser"): a left column with a search box and a vertical list of
  category buttons, and a right pane with the entries of the selected category. Opens on
  **Core**. [unverified]
- Search box - `input[type=search]` with id `settings-config-search-filter`, a magnifier glyph
  as placeholder and aria-label **Filter**. Filters as you type (about 200 ms debounce) across
  all categories: it matches each row's label, hint and any `[data-searchable]` text. Rows that
  do not match are hidden; each category's `[N]` count updates; a category with no match gets the
  class `no-matches` (dimmed). Clearing the box restores everything. [unverified]
- Category buttons - `nav.tabs button[data-tab="<id>"]`, text = label plus `[N]`:
  **Core** (`core`) first, then the system **Dungeons & Dragons Fifth Edition** (`system`), then
  one per active module that registers visible settings, sorted by title (for example
  **Foundry AI Tool**, id `foundry-mcp-bridge`, if active). Settings from an unknown namespace go
  under **Unmapped**. [unverified]
- Row types in a category: sub-menu rows come first (a label, a button with icon and text, a
  hint), then plain settings (checkbox, number/range, select, text, or file picker). Input names
  are `<namespace>.<key>`, e.g. `core.chatBubbles`. [unverified]
- **Reset Defaults** - button at the bottom of the left column (`button.reset-defaults`,
  `data-action="resetDefaults"`). Sets every setting input in the form (all categories, not only
  the shown one) back to its registered default and shows the toast **Reset all settings back to default values. Click "Save Changes"
  to confirm.** Nothing is saved yet; closing the window discards it. Reversible until you save.
  [unverified]
- **Save Changes** - submit button at the bottom of the right pane. Writes every changed value
  (world values need the modify-settings permission) and closes the window. If any changed
  setting has `requiresReload`, the **Reload Application?** dialog follows (next section).
  Reversible only by setting the old value again. [unverified]
- Who sees what: world-scope settings and restricted sub-menus are hidden from users who cannot
  modify settings (Players by default). If the Assistant role has that permission removed,
  Assistant GMs still see a short allow-list (for example **Combat Tracker**,
  **Default Document Sheets**, **Scrolling Status Text**, **Automatic Token Rotation**, **Token
  Drag Vision**, **Animate Roll Tables**, **Grid Diagonals**). **User Permissions** is shown to
  the full GM role only. [unverified]
- Gotcha: the window is a singleton whose category list is built on first render; categories for
  a module enabled later may not appear until the page reloads. [unverified]
- Gotcha: the search box sits inside the form. Pressing Enter there may trigger the browser's
  implicit submit (= **Save Changes**, closes the window). Type the query and do not press Enter.
  [unverified]
- Sources: `C:/FoundryTest/app/client/applications/settings/config.mjs`,
  `C:/FoundryTest/app/client/applications/api/category-browser.mjs`,
  `C:/FoundryTest/app/templates/category-browser/{sidebar,main,reset}.hbs`,
  `C:/FoundryTest/app/templates/settings/config-category.hbs`,
  `C:/FoundryTest/app/common/documents/setting.mjs`,
  https://foundryvtt.com/api/classes/foundry.applications.settings.SettingsConfig.html,
  https://foundryvtt.com/article/settings/

## Reload prompt and confirm dialogs (shared)

- **Reload Application?** - modal dialog (id `reload-world-confirm`), body text starts "Some of
  the changed settings require a reload". Buttons **Yes** and **No**; **No** is the default
  (Enter picks No). [unverified]
  - **Yes** after a client-scope change reloads this browser only. [unverified]
  - **Yes** after a world-scope change (and you can modify settings) also tells every connected
    client to reload, including any Player session and the tab running the bridge module.
    [unverified]
  - **No** keeps the saved value; it takes effect on the next reload. [unverified]
  - Who triggers it: Game Settings saves with reload-flagged settings, **Module Management**
    saves, **Audio/Video** conferencing-mode change, **Compendium Art** save, **Default Document
    Sheets** reset, closing **Additional Fonts** after a change, and the dnd5e Welcome window.
    [unverified]
- Generic confirms (`DialogV2.confirm`) show **Yes** / **No** with **No** focused by default.
  [unverified]
- Source: `SettingsConfig.reloadConfirm` in `C:/FoundryTest/app/client/applications/settings/config.mjs`;
  `C:/FoundryTest/app/client/applications/api/dialog.mjs`

## Game Settings > Core: sub-menu buttons (9 for a full GM)

Order is registration order in `C:/FoundryTest/app/client/game.mjs` `registerSettings()` plus the
`registerSetting(s)` helpers it calls. Row label and button text are the same string for all core
menus. Keys are `core.<key>` (`button[data-action="openSubmenu"][data-key="core.<key>"]`).

- **User Interface** (`core.uiConfigMenu`) - opens **User Interface Configuration**
  (`#ui-config`). Everyone; client scope. Fieldsets **Theme and Color Scheme** (**Interface**,
  **Applications**: Browser Default / Dark / Light), **Interface Size** (**Interface Scale**,
  **Font Size**), **Interface Fading** (**Inactive Opacity**, **Fade Speed**), **Other Settings**
  (**Chat Notifications**: Chat Cards / Notification Pip, **Chat Background**). Changes preview
  live. Buttons **Reset** (resets the form to defaults, preview only) and **Save Changes**.
  Closing without saving reverts the preview. Reversible. [unverified]
- **User Permissions** (`core.permissions`) - opens **User Permission Configuration**
  (`#permissions-config`). Full GM only; world scope. A grid: one row per permission (sorted by
  label, with hint), one checkbox column per role **Player**, **Trusted Player**, **Assistant
  Gamemaster**, **Gamemaster** (required roles are read-only). Buttons **Reset Defaults** and
  **Save Configuration**. Gotcha: **Reset Defaults** writes the defaults immediately with no
  confirm (toast "Reset User role permission configuration to default values."). Save shows
  "Updated User role permission configuration." Also reachable from User Management >
  **Configure User Permissions**. [unverified]
- **Audio/Video** (`core.webrtc`) - opens **Audio/Video Configuration** (`#av-config`).
  Everyone. Tabs **General**, **Devices**, **Server** (Server tab GM only). General holds
  **Conferencing Mode** (world, GM only, needs SSL to change) and client options such as **Voice
  Broadcasting**, **Dock Position**, **Nameplates**. Button **Save Changes**. Changing
  Conferencing Mode triggers the world reload prompt. Do not enable A/V in the test world.
  [unverified]
- **Prototype Token Overrides** (`core.prototypeTokenOverrides`) - opens **Prototype Token
  Overrides** (`#prototype-token-overrides`). Restricted (modify settings); world scope. Tabs
  **[All Types]** plus one per actor type (dnd5e types), each with sub-tabs **Basics** and **Turn
  Marker**; a blank field means "no override". Buttons **Reset Defaults** (confirm dialog titled
  **Reset Defaults**, text "Are You Sure? This action will remove all configured overrides.", then
  writes immediately) and **Save Overrides**. [unverified]
- **Additional Fonts** (`core.fonts`) - opens **Additional Fonts** (`#font-config`). Restricted;
  world scope. A preview line, the list of defined fonts (click to select, x icon titled **Remove
  font**), fields **Font Type** (**File** / **System**), **Font Family**, **Font Weight**, **Font
  Style**, **Font File**, and an **Add font** button. Gotcha: **Add font** and **Remove font** save
  immediately; closing the window after any change asks to reload all clients. [unverified]
- **Combat Tracker** (`core.combatTrackerConfig`) - opens **Combat Tracker Settings**
  (`#combat-tracker-config`). Everyone sees the button; players only get **Combat Theme**
  (client) with a play button to preview sounds. Users who can modify settings also see
  **Token Turn Markers** (**Enable Markers**, **Animation**, **Media Source**, **Disposition
  Tint**), **Tracked Resource**, **Skip Defeated** (world). Button **Save Tracker Settings**.
  Reversible by re-saving. [unverified]
- **Dice** (`core.diceConfiguration`) - opens **Dice Configuration** (`#dice-config`). Everyone;
  client scope. **Default Method** plus one select per die (manual vs digital fulfillment).
  Button **Save Changes**. Reversible. [unverified]
- **Compendium Art** (`core.compendiumArtConfiguration`) - opens **Compendium Art**
  (`#compendium-art-config`). Restricted; world scope. Lists system/module art providers with
  on/off and priority order (may be empty in the test world). Button **Save Configuration**, which
  always triggers the world reload prompt. [unverified]
- **Default Document Sheets** (`core.sheetClasses`) - opens **Default Document Sheets**
  (`#default-sheets-config`), itself a category browser (one category per document type, one
  select per sub-type). Restricted (Assistant GM allowed); world scope. Left-column **Reset
  Defaults** writes the defaults immediately (no confirm) and then asks to reload all clients;
  **Save Changes** saves. [unverified]
- A Player sees 4 of these: **User Interface**, **Audio/Video**, **Combat Tracker**, **Dice**.
  [unverified]
- Sources: `C:/FoundryTest/app/client/game.mjs` (lines ~1116-1660),
  `C:/FoundryTest/app/client/applications/settings/menus/*.mjs`,
  `C:/FoundryTest/app/client/applications/apps/{permission-config,combat-tracker-config,compendium-art-config}.mjs`,
  `C:/FoundryTest/app/templates/settings/menus/*`, `C:/FoundryTest/app/templates/apps/permission-config.hbs`,
  https://foundryvtt.com/api/classes/foundry.helpers.ClientSettings.html

## Game Settings > Core: plain settings (22 for a full GM)

Listed in expected on-screen order (after the 9 sub-menu rows). "reload" = `requiresReload`.
Expected Core count for a full GM: **Core [31]**; for a Player: **Core [18]** (4 menus + 14 client
settings). Counts change if a module adds core-namespace settings. [unverified]

| # | Label | Key | Scope | Reload |
|---|-------|-----|-------|--------|
| 1 | **Universal Keybindings (experimental)** | `universalKeybindings` | client | yes |
| 2 | **Disable Game Canvas** | `noCanvas` | client | yes |
| 3 | **Language Preference** | `language` | client | yes |
| 4 | **Dynamic Token Rings** | `dynamicTokenRing` | world | yes |
| 5 | **Dynamic Token Rings Fit Modes** | `dynamicTokenRingFitMode` | world | yes |
| 6 | **Enable Chat Bubbles** | `chatBubbles` | client | no |
| 7 | **Pan to Token Speaker** | `chatBubblesPan` | client | no |
| 8 | **Scrolling Status Text** | `scrollingStatusText` | world | no |
| 9 | **Pixel Ratio Resolution Scaling** | `pixelRatioResolutionScaling` | client | yes |
| 10 | **Left-Click to Release Objects** | `leftClickRelease` | client | no |
| 11 | **Performance Mode** (Low / Medium / High / Maximum) | `performanceMode` | client | yes |
| 12 | **Maximum Framerate** (10-60, step 10) | `maxFPS` | client | no |
| 13 | **Photosensitivity Mode** | `photosensitiveMode` | client | yes |
| 14 | **Automatic Token Rotation** | `tokenAutoRotate` | world | no |
| 15 | **Token Drag Vision** | `tokenDragPreview` | world | no |
| 16 | **Token Vision Animation** | `visionAnimation` | client | no |
| 17 | **Light Source Animation** | `lightAnimation` | client | no |
| 18 | **Zoomed Texture Antialiasing** | `mipmap` | client | no |
| 19 | **Editor Autosave Frequency** (30-300 s) | `editorAutosaveSecs` | world | no |
| 20 | **Show Toolclips on Hover** | `showToolclips` | client | yes |
| 21 | **Animate Roll Tables** | `animateRollTable` | world | no |
| 22 | **Grid Diagonals** | `gridDiagonals` | world | yes |

- All rows: [unverified]
- Not in the window in v14 (config off or not registered): **Combat Theme** (moved into **Combat
  Tracker**), **Font Size** (moved into **User Interface**), cone/grid template shape settings
  (deprecated), **Show FPS Meter** and **Enable Soft Shadows** (strings remain in `en.json`, no
  setting registered). [unverified]
- Safest setting to exercise the reload prompt: **Show Toolclips on Hover** (client scope, reload).
  [unverified]
- Sources: `C:/FoundryTest/app/client/game.mjs`,
  `C:/FoundryTest/app/client/canvas/placeables/tokens/ring-config.mjs`,
  `C:/FoundryTest/app/client/documents/collections/roll-tables.mjs`,
  `C:/FoundryTest/app/client/helpers/client-settings.mjs` (default scope)

## Game Settings > system and module categories

- **Dungeons & Dragons Fifth Edition** - category `system`. For a full GM: 6 sub-menu rows
  (**Compendium Browser Sources** / **Configure Sources**, **Bastions** / **Configure Bastions**,
  **Calendar** / **Configure Calendar**, **Combat** / **Configure Combat**, **Variant Rules** /
  **Configure Variant Rules**, **Visibility** / **Configure Visibility**) and 23 settings, first
  of them **Rules Version** (world, reload; test world = **Modern Rules (2024)**). Players see
  **Calendar** plus the client settings only. Detail: `dnd5e-settings.md`. [unverified]
- Module categories - one per active module with visible settings. For this repo's module
  (**Foundry AI Tool**) the test-env skill names switches such as "Allow Write Operations"; this
  page does not list them. [unverified]
- Sources: `C:/FoundryTest/data/Data/systems/dnd5e/dnd5e.mjs` (settings registration ~57380-58090),
  `.claude/skills/foundry-test-env/SKILL.md`

## Controls Configuration

- **Controls Configuration** - window title; id `controls-config`; 780 x 680, resizable.
  Settings tab > **Controls Configuration**. Everyone; bindings are client scope (setting
  `core.keybindings` in this browser), so edits affect only this browser. [unverified]
- Layout: the same category browser as Game Settings. Left column: search box (aria-label
  **Filter**), categories **Core Keybindings**, **Core Mouse Controls**, **Dungeons & Dragons Fifth
  Edition**, then modules with keybindings, each with `[N]`; **Reset Defaults** at the bottom. No
  **Save** button: each edit saves on its own. [unverified]
- Each action row (`div.form-group[data-action-id="<namespace>.<action>"]`): the action name
  (e.g. **Pause Game**, **Toggle Menu / Dismiss All Windows**, **Undo Last Action**), its bindings
  as `<kbd>` chips (aria-label **Bound Key**, or "Potentially conflicts with ..." plus a warning
  icon), and a hint (reserved modifiers, **Gamemaster Only** for restricted actions). Restricted
  actions are hidden from players. [unverified]
- Per-binding buttons (icon only; use aria-label): **Add Binding** (on the first binding row),
  **Edit Binding**, **Delete Binding**; uneditable bindings show a disabled lock **Uneditable
  Binding**. Double-clicking a `<kbd>` also starts editing. [unverified]
- While editing: a text input captures the next key combo (every keydown is swallowed) and the
  row shows **Cancel Edit**, **Save Binding**, **Delete Binding**. Cancel restores the row;
  Save writes; Delete removes the binding immediately (no confirm). [unverified]
- **Core Mouse Controls** is read-only reference (all bindings locked). [unverified]
- **Reset Defaults** - confirm dialog **Reset Default Keybindings** ("Are You Sure? Do you wish to
  reset all keybindings to their default values?"), **Yes** / **No**. Yes resets all bindings in
  this browser and toasts "All keybindings have been reset to their default values." [unverified]
- Gotcha: after clicking Edit, the input grabs keys; pressing Escape may be recorded as the
  binding instead of closing anything. Use **Cancel Edit**. [unverified]
- Sources: `C:/FoundryTest/app/client/applications/sidebar/apps/controls-config.mjs`,
  `C:/FoundryTest/app/templates/sidebar/apps/controls/{category,binding-input}.hbs`,
  `C:/FoundryTest/app/client/helpers/interaction/client-keybindings.mjs`,
  https://foundryvtt.com/article/keybinds/, https://foundryvtt.com/article/controls/,
  https://foundryvtt.com/api/classes/foundry.applications.sidebar.apps.ControlsConfig.html

## Module Management

- **Module Management** - window title; id `module-management`; width 680. Settings tab >
  **Module Management** (or **Active Modules** for users without the modify-settings permission,
  which opens the same window read-only with only active modules and no buttons). [unverified]
- Hint at the top: "Use this form to configure which Modules are active within your current
  World..." (editable) or "The Modules listed below are currently active within this World."
  (read-only). [unverified]
- Search box - placeholder and aria-label **Filter Modules**. Matches module id, title and
  author as you type. Same Enter caution as Game Settings (the footer holds a submit button).
  [unverified]
- Filters (editable view only) - three text anchors, not buttons: **All Modules (N)**, **Active
  Modules (N)**, **Inactive Modules (N)** (`a.filter[data-filter="all|active|inactive"]`). The
  current one has class `active`. Default filter: All. [unverified]
- Expand/collapse toggle - icon button with aria-label **Expand** / **Collapse**; shows or hides
  each module's description and metadata (**Author(s)**, **URL**, **Documentation**, **Bug or Issue
  Reports**, **Dependencies** tags). [unverified]
- Module rows (`li.package[data-module-id="<id>"]`) - a checkbox named after the module id, the
  title, a document-count subtitle when the module adds document types, version/compat tags.
  A checkbox is disabled when the world or system requires the module (tooltip **This module is
  required to be active**) or dependencies/system compatibility fail. Only modules compatible with
  dnd5e are listed. In the test world expect **Foundry AI Tool** (`foundry-mcp-bridge`). [unverified]
- Ticking a box whose module has dependencies opens **Dependency Resolution** (sections
  **Required Dependencies** / **Optional Dependencies**, buttons **Activate** or **Deactivate** and
  **Cancel**). Unticking a module that others require shows the error toast "This module cannot
  be disabled as it is required by the following: ..." and re-ticks it. [unverified]
- **Deactivate All Modules** - footer button; only unticks every enabled checkbox in the form.
  Nothing is saved until **Save Module Settings**. Closing the window discards it. [unverified]
- **Save Module Settings** - footer submit. Writes world setting `core.moduleConfiguration`,
  closes the window, and (if anything changed) opens **Reload Application?**. The setting is
  saved whether you answer Yes or No; **Yes** reloads every connected client. If an enabled
  module lacks a required dependency, saving fails with "You have enabled the module ..., but its
  dependencies ... are not enabled!". GM with modify-settings permission only. [unverified]
- Gotcha: unticking **Foundry AI Tool** and saving cuts the test bridge link for the world.
  [unverified]
- Sources: `C:/FoundryTest/app/client/applications/sidebar/apps/module-management.mjs`,
  `C:/FoundryTest/app/client/applications/settings/dependency-resolution.mjs`,
  `C:/FoundryTest/app/templates/sidebar/apps/module-management.hbs`,
  `C:/FoundryTest/app/templates/setup/impacted-dependencies.hbs`,
  https://foundryvtt.com/article/modules/,
  https://foundryvtt.com/api/classes/foundry.applications.sidebar.apps.ModuleManagement.html

## World Configuration (Edit World)

- **World Configuration** - Settings tab button, full GM only. Opens a window titled **Edit World:
  AI Tool Test** (`#world-config`, width 600). [unverified]
- Fields shown in-game: **World Title** (text), **Background Image** (file picker; join-page
  background), **Join Page Theme** (**Default** / **Minimal**), **Next Session** (browser
  date-time input, local time), **World Description** (rich-text editor). [unverified]
- Not shown in-game (setup screen only): **Data Path**, **Game System**, **Reset User
  Passwords**, **Launch in Safe Configuration**. [unverified]
- **Update World** - footer submit. Validates, then posts the change to the server's setup route
  (`action: "editWorld"`), which rewrites the world manifest (`world.json`); a spinner shows while
  it runs; the window closes. Errors appear as toasts. Reversible by editing again (note the old
  values first). The world title elsewhere in the UI may update only after a reload. [unverified]
- Sources: `C:/FoundryTest/app/client/applications/sidebar/apps/world-config.mjs`,
  `C:/FoundryTest/app/templates/sidebar/apps/world-config.hbs`,
  https://foundryvtt.com/article/game-worlds/

## User Management (/players page)

- **User Management** - Settings tab button, GM only. It does not open a window: it navigates the
  browser to `/players`, unloading the game client (canvas, sidebar and the bridge module stop in
  this tab). [unverified]
- Page heading **User Management**; column headers **User Name**, **Password**, **User Role**.
  One row per user (test world: `Claude`, `Player`, `Gamemaster`): name text box, password box
  (masked placeholder), a role `<select>` (**None**, **Player**, **Trusted Player**, **Assistant
  Gamemaster**, **Gamemaster**), and icon buttons **Login as User** and **Delete User**.
  [unverified]
- Footer: **Create Additional User** (creates a `PlayerN` user in the database at once),
  **Configure User Permissions** (opens **User Permission Configuration**), **Save and Return**
  (label **Save and Continue** on a world's first launch). [unverified]
- **Save and Return** - saves changed names/roles/passwords (a world must keep at least one
  Gamemaster: "You must have at least one Game Master user within your World.") and redirects to
  `/game` after about 1 s. [unverified]
- **Delete User** - confirm dialog **Delete User: <name>** with **Delete** / **Cancel**; deleting
  is permanent. **Login as User** saves the form, then switches this browser's session to that
  user. [unverified]
- Leaving without saving: navigate to `http://localhost:30001/game` (or browser Back). [unverified]
- Sources: `C:/FoundryTest/app/client/applications/ui/main-menu.mjs` (`players` item),
  `C:/FoundryTest/app/public/scripts/foundry.mjs` (class `UserManagement`),
  `C:/FoundryTest/app/templates/setup/parts/user-management-{form,user}.hbs`,
  https://foundryvtt.com/article/users/

## Tour Management

- **Tour Management** - window title; id `tours-management`; 780 x 680, resizable. Settings tab >
  **Tour Management**. Everyone (restricted tours hidden from players). Tour progress is client
  scope (`core.tourProgress`). [unverified]
- Layout: category browser. Search (aria-label **Filter**), categories **Core [N]** then system and
  modules that register tours (dnd5e 6.0.5 registers none). Left-column **Reset Defaults**.
  [unverified]
- Core tours (titles from `public/tours/*.json`): **Welcome to Foundry Virtual Tabletop**, **UI
  Overview**, **The Sidebar**, **Canvas Controls**, and four setup-screen tours **Installing a
  System**, **Creating a World**, **Backups Overview**, **Compatibility Preview Overview**.
  [unverified]
- Each row: title with status in brackets (**Not Started**, **In Progress - x/y**,
  **Completed**; completed rows are dimmed), a play button (aria-label **Start Tour**, **Resume
  Tour** or **Start Tour from Beginning**) when the tour can start, and a reset button (aria-label
  **Reset Tour Progress**) once started. Setup-screen tours cannot start inside a world (no play
  button); **Canvas Controls** needs a viewed scene. [unverified]
- Starting a tour minimises the window and shows step popups (title, text, "Step n of m", arrow
  buttons, a close icon); an overlay blocks other input. Escape or the close icon exits and keeps
  the progress. [unverified]
- **Reset Defaults** - confirm dialog **Reset Tours** ("Do you wish to reset all tour
  progress?"), **Yes** / **No**; Yes toasts "Reset the completion status of all tours."
  Reversible in the sense that it only clears local progress. [unverified]
- Sources: `C:/FoundryTest/app/client/applications/sidebar/apps/tours-management.mjs`,
  `C:/FoundryTest/app/templates/sidebar/apps/tours-management-category.hbs`,
  `C:/FoundryTest/app/client/nue/{_module,tour}.mjs`, `C:/FoundryTest/app/templates/apps/tour-step.html`,
  https://foundryvtt.com/article/tours/

## Welcome Screen (dnd5e)

- **Welcome Screen** - dnd5e button on the Settings tab. Opens **Welcome to D&D 5e**
  (`#dnd5e-welcome-screen`, width 720). Also opens by itself for a GM on a world's first run.
  [unverified]
- Tabs **Welcome** (banner, links, fieldset **Settings**: **Rules Version**, **Calendar** when
  calendars exist, **Enable Bastion Functionality**, **Use Metric System**) and **Official
  Content** (official D&D modules with **Enabled** toggles or **Not Installed**). Non-GMs see the
  fields disabled. [unverified]
- No save button. Gotcha: closing the window as GM submits the form, writing the four settings
  and any module toggles; changed module toggles or a Rules Version change then prompt **Reload
  Application?**. Close it without touching anything. [unverified]
- The Official Content tab fetches a list from GitHub (network request). [unverified]
- Sources: `C:/FoundryTest/data/Data/systems/dnd5e/dnd5e.mjs` (class `WelcomeScreen`,
  `renderSettings`), `C:/FoundryTest/data/Data/systems/dnd5e/templates/apps/welcome-*.hbs`;
  detail in `dnd5e-settings.md`

## Support & Issues

- **Support & Issues** - Settings tab button (label gets ` (N)` when document, package or
  client issues exist). Opens **Support & Issues** (`#support-details`, 780 x 735). Everyone.
  [unverified]
- Tabs across the top: **Support Details**, **Document Issues**, **Client Issues**, **Module
  Issues**. [unverified]
- **Support Details** tab: fieldset **Places To Get Support** (Discord and contact-page links) and
  a report block (OS, client, screen/viewport, GPU, texture sizes, world/system/modules). Buttons
  **Copy Report to Clipboard** (toast **Report Copied**) and **Generate Full Report** (adds world
  and compendium size data; can take a while). Read-only. [unverified]
- **Document Issues** tab: invalid documents grouped by type, each with **Copy Document UUID** and
  **Delete Document** icons; or "No document issues were found.". Delete asks for confirmation and
  is permanent. [unverified]
- **Client Issues** / **Module Issues**: lists, or "No client issues were found." / "No module
  issues were found.". [unverified]
- Sources: `C:/FoundryTest/app/client/applications/sidebar/apps/support-details.mjs`,
  `C:/FoundryTest/app/templates/sidebar/apps/support-details/*.hbs`,
  https://foundryvtt.com/article/settings/, https://foundryvtt.com/releases/14.352

## Documentation and Community Wiki links

- **Documentation** - `<a class="button">` to https://foundryvtt.com/kb/, `target="_blank"`;
  appears as a link (not a button) in the accessibility tree. [unverified]
- **Community Wiki** - `<a class="button">` to https://foundryvtt.wiki/, new tab. [unverified]
- Verify by reading `href` rather than clicking; a click opens a new browser-pane tab to an
  external site. [unverified]
- Source: `C:/FoundryTest/app/templates/sidebar/tabs/settings.hbs`

## Driving it from automation

Read-only console snippets for the browser pane's `javascript_tool`. None change state.

Sidebar and Settings tab (v14 has no `ui.sidebar.activeTab`; use `tabGroups.primary`):

```js
({expanded: ui.sidebar.expanded, tab: ui.sidebar.tabGroups.primary, settingsTab: ui.settings.rendered})
```

Which application windows are open (ids from this page):

```js
[...foundry.applications.instances.values()].filter(a => a.rendered).map(a => a.id)
```

Game Settings window state and active category:

```js
({open: game.settings.sheet.rendered, category: game.settings.sheet.tabGroups.categories})
```

Expected Core sub-menus and settings (compare with the window):

```js
[...game.settings.menus.values()].filter(m => m.namespace === "core")
  .map(m => ({key: m.key, button: game.i18n.localize(m.label), restricted: !!m.restricted}))
```

```js
[...game.settings.settings.values()].filter(s => s.config && s.namespace === "core")
  .map(s => ({key: s.key, name: game.i18n.localize(s.name ?? ""), scope: s.scope, reload: !!s.requiresReload}))
```

Current user's rights (explains which buttons show):

```js
({user: game.user.name, role: game.user.role, isGM: game.user.isGM,
  fullGM: game.user.hasRole("GAMEMASTER"), canModifySettings: game.user.can("SETTINGS_MODIFY")})
```

Read a value before and after a test (examples):

```js
({chatBubbles: game.settings.get("core", "chatBubbles"), toolclips: game.settings.get("core", "showToolclips"),
  ui: game.settings.get("core", "uiConfig"), rules: game.settings.get("dnd5e", "rulesVersion")})
```

Modules:

```js
({active: game.modules.filter(m => m.active).map(m => m.id), saved: game.settings.get("core", "moduleConfiguration")})
```

World fields shown by Edit World:

```js
({title: game.world.title, background: game.world.background, joinTheme: game.world.joinTheme,
  nextSession: game.world.nextSession})
```

Tours:

```js
({inProgress: foundry.nue.Tour.tourInProgress, active: foundry.nue.Tour.activeTour?.id,
  tours: game.tours.contents.map(t => ({id: `${t.namespace}.${t.id}`, title: t.title, status: t.status, canStart: t.canStart}))})
```

Keybindings (client storage):

```js
({actions: game.keybindings.actions.size, pause: game.keybindings.bindings.get("core.pause"),
  custom: game.settings.get("core", "keybindings")})
```

The `(N)` on **Support & Issues** (same sum the tab computes):

```js
Object.values(game.issues.validationFailures).reduce((n, f) => n + Object.keys(f).length, 0)
  + Object.values(game.issues.packageCompatibilityIssues).reduce((n, {error}) => n + error.length, 0)
  + Object.keys(game.issues.usabilityIssues).length
```

Scene-control context (handy when a window changed the canvas):

```js
({control: ui.controls.control?.name, tool: ui.controls.tool?.name})
```

Stable selectors and accessibility-tree names (use `find` with the name; fall back to the
selector through `read_page` refs):

| Target | Accessible name to search | Selector |
|--------|---------------------------|----------|
| Settings tab icon | "Settings" | `#sidebar-tabs button[data-tab="settings"]` |
| Tab buttons | label text | `button[data-action="openApp"][data-app="configure\|controls\|modules\|world\|players\|tours\|support"]` |
| Welcome Screen | "Welcome Screen" | button right after `section.dnd5e2.sidebar-info` |
| Game Settings window | "Game Settings" | `#settings-config` |
| Settings search | "Filter" | `#settings-config-search-filter` |
| Settings category | "Core" / "Dungeons & Dragons Fifth Edition" | `#settings-config button[data-tab="core"\|"system"]` |
| Sub-menu button | e.g. "User Interface" | `button[data-action="openSubmenu"][data-key="core.uiConfigMenu"]` |
| A setting input | its label | `#settings-config [name="core.chatBubbles"]` |
| Reset Defaults (any category browser) | "Reset Defaults" | `button.reset-defaults` |
| Save Changes | "Save Changes" | `#settings-config button[type="submit"]` |
| Keybinding row | action name | `#controls-config [data-action-id="core.pause"]` |
| Binding buttons | "Edit Binding" etc. | `[data-action="editBinding\|addBinding\|deleteBinding\|saveBinding\|cancelEdit"]` |
| Module filter | "Filter Modules" | `#module-management input[type=search]` |
| Module checkbox | module title | `#module-management input[name="foundry-mcp-bridge"]` |
| Module filters | "Active Modules (N)" (text) | `#module-management a.filter[data-filter="active"]` |
| Tour row | tour title | `#tours-management [data-tour="core.uiOverview"]` |
| Reload dialog | "Reload Application?" | `#reload-world-confirm` |

- Window close buttons are icon buttons in the window header (aria-label **Close**). [unverified]
- Escape (**Toggle Menu / Dismiss All Windows**) closes every open framed window at once; with
  nothing open it opens the main menu. It also exits a running tour. Prefer each window's own
  close button when only one should close. [unverified]
- Source: `C:/FoundryTest/app/client/helpers/interaction/client-keybindings.mjs` (`dismiss`),
  https://foundryvtt.com/api/classes/foundry.applications.sidebar.Sidebar.html

## Safety in the test world

Changes that write world data (shared by every user; note the old value before testing):

- **Save Changes** in Game Settings for any world-scope row (see the Scope column). Undo: set the
  old value and save again.
- **User Permissions**: **Save Configuration**, and **Reset Defaults** (immediate, no confirm).
- **Prototype Token Overrides** (**Save Overrides**, **Reset Defaults**), **Additional Fonts**
  (**Add font** / **Remove font** save at once), **Compendium Art**, **Default Document Sheets**
  (**Reset Defaults** is immediate), world parts of **Combat Tracker Settings**, A/V
  **Conferencing Mode**.
- **Module Management** > **Save Module Settings**; never untick **Foundry AI Tool**
  (`foundry-mcp-bridge`) and never use **Deactivate All Modules** followed by save.
- **World Configuration** > **Update World** rewrites `world.json` on disk.
- **User Management**: never type in **Password** fields, never delete `Claude` or `Gamemaster`,
  never change their roles, avoid **Create Additional User** (it creates a user at once; clean-up
  means deleting it). **Login as User** switches this browser's session.
- dnd5e **Welcome to D&D 5e** writes its settings when closed.
- **Support & Issues** > **Delete Document** permanently deletes a document.
- Answering **Yes** to a world reload reloads every connected client (Player sessions and the
  bridge-module tab). Prefer **No** unless the test needs the reload.

Changes that stay in this browser only (safe to try, undo by reverting):

- Client-scope rows in Game Settings, **User Interface**, **Dice**, A/V device options,
  **Controls Configuration** edits (undo: **Reset Defaults** there, which also wipes any custom
  bindings), tour progress (undo: the per-tour reset button).

Avoid entirely during a UI survey:

- **Return to Setup** (shuts the world down for everyone and drops the bridge link),
  **Log Out**, **Invitation Links** screenshots (the Internet address is private).
- Pressing Enter inside search boxes of form windows (possible implicit save).
- Clicking the **Documentation** / **Community Wiki** / dnd5e links (external new tabs); read the
  `href` instead.

## Verification checklist

Log in as `Claude` at `http://localhost:30001/game` (see the foundry-test-env skill). Run the JS
snippets above to confirm results. Items 1-38 as GM; 39-40 are optional player-view checks.

1. Click the sidebar tab icon **Settings**. Expect the sidebar to expand (if collapsed) and the
   Settings tab to show; `ui.sidebar.tabGroups.primary === "settings"`.
2. Read the info block. Expect **Foundry Virtual Tabletop**, a version line, **Build Version**
   368, **Active Modules** N; then dnd5e's **Game System** block with 6.0.5 and **Notes**,
   **Issues**, **Wiki**, **Discord**; no separate core system row.
3. Read the button order. Expect **Welcome Screen**, then under **Settings and Configuration**:
   **Game Settings**, **Controls Configuration**, **Module Management**, **World Configuration**,
   **User Management**, **Tour Management**.
4. Read the lower sections. Expect **Help and Documentation** (**Support & Issues**,
   **Documentation**, **Community Wiki**) and **Game Access** (**Invitation Links**, **Log Out**,
   **Return to Setup**). Do not click the Game Access buttons.
5. Read the `href` of **Documentation** and **Community Wiki**. Expect https://foundryvtt.com/kb/
   and https://foundryvtt.wiki/ with `target="_blank"`.
6. Click **Game Settings**. Expect window **Game Settings** (`#settings-config`), search box
   **Filter**, categories **Core [N]**, **Dungeons & Dragons Fifth Edition [N]**, any module
   categories; **Core** selected; **Reset Defaults** bottom-left, **Save Changes** bottom-right.
7. In **Core**, read the rows. Expect the 9 sub-menu rows first (**User Interface** ...
   **Default Document Sheets**), then the 22 settings in the table order; the badge near
   **Core [31]**.
8. Type `token` in the search box (no Enter). Expect only matching rows, updated `[N]` counts,
   categories with no match dimmed.
9. Clear the search box. Expect all rows back.
10. Click **Dungeons & Dragons Fifth Edition**. Expect 6 **Configure ...** sub-menu buttons and
    **Rules Version** = **Modern Rules (2024)** among the settings.
11. Click **Reset Defaults** (left column). Expect the toast about clicking "Save Changes" and
    form values reset. Close the window with its close button (do not save). Reopen **Game
    Settings**: values unchanged (check `game.settings.get("core", "chatBubbles")` before/after).
12. Click **User Interface**. Expect **User Interface Configuration** with fieldsets **Theme and
    Color Scheme**, **Interface Size**, **Interface Fading**, **Other Settings** and buttons
    **Reset**, **Save Changes**. Close without saving.
13. Click **User Permissions**. Expect **User Permission Configuration** with role columns
    **Player**, **Trusted Player**, **Assistant Gamemaster**, **Gamemaster** and buttons **Reset
    Defaults**, **Save Configuration**. Close without clicking either.
14. Click **Audio/Video**. Expect **Audio/Video Configuration** with tabs **General**, **Devices**,
    **Server** and **Save Changes**. Close without saving.
15. Click **Prototype Token Overrides**. Expect tabs **[All Types]** plus dnd5e actor types, sub-tabs
    **Basics** / **Turn Marker**, buttons **Reset Defaults** and **Save Overrides**. Close.
16. Click **Additional Fonts**. Expect **Additional Fonts** with **Font Type**, **Font Family**,
    **Font File** and **Add font**. Close without adding.
17. Click **Combat Tracker**. Expect **Combat Tracker Settings** with **Token Turn Markers**,
    **Tracked Resource**, **Skip Defeated**, **Combat Theme** and **Save Tracker Settings**. Close.
18. Click **Dice**. Expect **Dice Configuration** with **Default Method** and one select per die,
    **Save Changes**. Close.
19. Click **Compendium Art**. Expect window **Compendium Art** with **Save Configuration**. Close
    without saving.
20. Click **Default Document Sheets**. Expect a category browser of document types with **Reset
    Defaults** and **Save Changes**. Close without clicking either.
21. (Reload prompt, client-only) In Core, untick **Show Toolclips on Hover**, click **Save
    Changes**. Expect **Reload Application?** with **Yes** / **No**; click **No**. Reopen, tick it
    again, save, click **No**. `game.settings.get("core", "showToolclips")` is `true` at the end.
22. Close **Game Settings** if open. Click **Controls Configuration**. Expect window **Controls
    Configuration** with categories **Core Keybindings**, **Core Mouse Controls**, **Dungeons &
    Dragons Fifth Edition** (no **All Actions**), search **Filter**, **Reset Defaults**, no Save
    button.
23. Type `pause` in the search box (no Enter). Expect the **Pause Game** row with its binding.
24. On **Pause Game**, click **Edit Binding**. Expect an input row with **Cancel Edit**, **Save
    Binding**, **Delete Binding**. Click **Cancel Edit**. Expect the row restored and
    `game.keybindings.bindings.get("core.pause")` unchanged.
25. Click **Core Mouse Controls**. Expect all bindings with a disabled lock (**Uneditable
    Binding**).
26. Click **Reset Defaults**. Expect dialog **Reset Default Keybindings** with **Yes** / **No**.
    Click **No**. Close the window.
27. Click **Module Management**. Expect window **Module Management**, the editable hint, search
    **Filter Modules**, filters **All Modules (N)**, **Active Modules (N)**, **Inactive Modules
    (N)**, an expand toggle, module rows, and footer **Save Module Settings**, **Deactivate All
    Modules**.
28. Click **Active Modules (N)**. Expect only active modules. Click **All Modules (N)** again.
29. Type `AI` in **Filter Modules** (no Enter). Expect the **Foundry AI Tool** row. Clear it.
30. Click the expand toggle (**Expand**). Expect descriptions and author/URL metadata. Close the
    window with its close button without saving; `game.settings.get("core",
    "moduleConfiguration")` unchanged.
31. Click **World Configuration**. Expect **Edit World: AI Tool Test** with **World Title**,
    **Background Image**, **Join Page Theme**, **Next Session**, **World Description** and **Update
    World**; no Data Path, Game System, Reset User Passwords or Safe Configuration fields. Close
    without updating.
32. Click **Tour Management**. Expect window **Tour Management**, category **Core [8]** (or
    similar), rows with statuses, play buttons missing on the four setup-screen tours, **Reset
    Defaults** bottom-left.
33. On **UI Overview**, click the play button (**Start Tour** or **Resume Tour**). Expect the
    window to minimise and a step popup "Step 1 of 6". Press Escape. Expect the tour to close;
    `foundry.nue.Tour.tourInProgress === false`.
34. Restore **Tour Management**. Expect **UI Overview** marked **In Progress - 1/6** (or similar)
    with a **Reset Tour Progress** button; click it. Expect **Not Started**.
35. Click **Reset Defaults** in Tour Management. Expect dialog **Reset Tours**; click **No**. Close.
36. Click **Support & Issues**. Expect tabs **Support Details**, **Document Issues**, **Client
    Issues**, **Module Issues** and buttons **Copy Report to Clipboard**, **Generate Full Report**.
    Click **Document Issues**: expect "No document issues were found." (fresh world). Close.
37. Click **Welcome Screen**. Expect **Welcome to D&D 5e** with tabs **Welcome** / **Official
    Content** and fields **Rules Version**, **Enable Bastion Functionality**, **Use Metric
    System** (and **Calendar** if present). Change nothing; close. Expect no reload prompt and
    `game.settings.get("dnd5e", "rulesVersion") === "modern"`.
38. Click **User Management** last. Expect the browser to load `/players` with heading **User
    Management**, rows `Claude`, `Player`, `Gamemaster`, columns **User Name** / **Password** /
    **User Role**, and **Create Additional User**, **Configure User Permissions**, **Save and
    Return**. Touch nothing; navigate to `http://localhost:30001/game`. Expect the game to load and,
    if the test bridge is running, "MCP Bridge connected successfully".
39. (Optional, Player session) As `Player`, open the Settings tab. Expect **Active Modules**
    instead of **Module Management**, and no **World Configuration**, **User Management**,
    **Invitation Links** or **Return to Setup**.
40. (Optional, Player session) Open **Game Settings**. Expect **Core [18]** (sub-menus **User
    Interface**, **Audio/Video**, **Combat Tracker**, **Dice** only) and no world-scope rows.

## Differences between the docs and the v14 source

- Sidebar button labels: the KB (13.351) uses **Configure Settings**, **Configure Controls**,
  **Manage Modules**, **Edit World**, **View Documentation**, **Community Wiki Pages**; v14 shows
  **Game Settings**, **Controls Configuration**, **Module Management**, **World Configuration**,
  **Documentation**, **Community Wiki**.
- The settings window is a two-pane category browser (Core / system / one per module, with
  counts and a **Filter** box, **Reset Defaults** in the left column), not the older
  Core/System/Module tabs.
- KB core settings not in the v14 window: **Font Size** (now in **User Interface**), **Combat
  Theme** (now in **Combat Tracker**), **Cone Template Type** (hidden, deprecated). "Disable Pixel
  Resolution Scaling" is now **Pixel Ratio Resolution Scaling** (checked = on). **Show FPS Meter**
  and **Enable Soft Shadows** strings exist but no setting is registered.
- Present in v14 but missing from the KB list: **Universal Keybindings (experimental)**, the
  **User Interface**, **Dice**, **Compendium Art**, **Default Document Sheets** sub-menus,
  **Dynamic Token Rings**, **Photosensitivity Mode**, **Grid Diagonals**, **Show Toolclips on
  Hover**.
- KB "Default Prototype Token Overrides" / "Configure Permissions" are **Prototype Token
  Overrides** / **User Permissions** in v14 (**Configure User Permissions** on the /players page).
- Controls: the KB mentions an **All Actions** category and an "Action Filter" box; v14 has no
  All Actions category and the box is labelled **Filter**.
- Tours: the KB puts **Reset All Tours** at the top; v14 uses the left-column **Reset Defaults**
  with a **Reset Tours** dialog (the "Reset All Tours" string is unused).
- Modules: the KB mentions reaching module configuration from the module panel; v14 module
  settings live only as categories in **Game Settings**.
- Edit World: the KB describes the setup-screen dialog; in-game v14 shows only title, background,
  join theme, next session and description.
- API: `ui.sidebar.activeTab` does not exist in v14 (use `ui.sidebar.tabGroups.primary`);
  `Sidebar#activateTab` is deprecated for `changeTab`; `ModuleManagement.CONFIG_SETTING` is
  deprecated for `SETTING` (`"moduleConfiguration"`); the `core.rollMode` setting is deprecated
  for `core.messageMode`.

## Sources

Local v14 install (ground truth, read-only):

- `C:/FoundryTest/app/templates/sidebar/tabs/settings.hbs`
- `C:/FoundryTest/app/client/applications/sidebar/tabs/settings.mjs`
- `C:/FoundryTest/app/client/applications/sidebar/sidebar.mjs`, `C:/FoundryTest/app/templates/sidebar/tabs.hbs`
- `C:/FoundryTest/app/client/applications/settings/config.mjs`
- `C:/FoundryTest/app/client/applications/settings/dependency-resolution.mjs`
- `C:/FoundryTest/app/client/applications/settings/menus/{ui-config,av-config,prototype-overrides,font-config,dice-config,default-sheets-config}.mjs`
- `C:/FoundryTest/app/client/applications/apps/{permission-config,combat-tracker-config,compendium-art-config}.mjs`
- `C:/FoundryTest/app/client/applications/api/{category-browser,dialog}.mjs`
- `C:/FoundryTest/app/client/applications/sidebar/apps/{controls-config,module-management,world-config,tours-management,support-details,invitation-links}.mjs`
- `C:/FoundryTest/app/client/applications/ui/main-menu.mjs`
- `C:/FoundryTest/app/client/game.mjs` (`registerSettings`)
- `C:/FoundryTest/app/client/helpers/client-settings.mjs`
- `C:/FoundryTest/app/client/helpers/interaction/client-keybindings.mjs`
- `C:/FoundryTest/app/client/nue/{_module,tour}.mjs`, `C:/FoundryTest/app/client/nue/tours/*.mjs`, `C:/FoundryTest/app/public/tours/*.json`
- `C:/FoundryTest/app/common/documents/setting.mjs`, `C:/FoundryTest/app/common/constants.mjs`
- `C:/FoundryTest/app/public/scripts/foundry.mjs` (bundled `UserManagement`, not present under `client/`)
- `C:/FoundryTest/app/templates/category-browser/*.hbs`, `C:/FoundryTest/app/templates/settings/**`, `C:/FoundryTest/app/templates/sidebar/apps/**`, `C:/FoundryTest/app/templates/setup/parts/user-management-*.hbs`, `C:/FoundryTest/app/templates/setup/impacted-dependencies.hbs`, `C:/FoundryTest/app/templates/generic/form-footer.hbs`, `C:/FoundryTest/app/templates/apps/tour-step.html`
- `C:/FoundryTest/app/public/lang/en.json`
- `C:/FoundryTest/data/Data/systems/dnd5e/dnd5e.mjs`, `C:/FoundryTest/data/Data/systems/dnd5e/lang/en.json`, `C:/FoundryTest/data/Data/systems/dnd5e/templates/apps/welcome-*.hbs`
- `C:/FoundryTest/data/Data/modules/foundry-mcp-bridge/module.json`, `C:/FoundryTest/data/Data/worlds/ai-tool-test/world.json`

Official knowledge base and API (v14 API = 14.365 Stable docs):

- https://foundryvtt.com/article/settings/ (updated for 13.351)
- https://foundryvtt.com/article/modules/
- https://foundryvtt.com/article/keybinds/
- https://foundryvtt.com/article/controls/ (updated for 13.350)
- https://foundryvtt.com/article/tours/
- https://foundryvtt.com/article/users/ (updated for 13.350)
- https://foundryvtt.com/article/game-worlds/
- https://foundryvtt.com/releases/14.352
- https://foundryvtt.com/api/classes/foundry.applications.settings.SettingsConfig.html
- https://foundryvtt.com/api/classes/foundry.helpers.ClientSettings.html
- https://foundryvtt.com/api/classes/foundry.applications.sidebar.tabs.Settings.html
- https://foundryvtt.com/api/classes/foundry.applications.sidebar.Sidebar.html
- https://foundryvtt.com/api/classes/foundry.applications.sidebar.apps.ModuleManagement.html
- https://foundryvtt.com/api/classes/foundry.applications.sidebar.apps.ControlsConfig.html

Community and system docs (leads only):

- https://foundryvtt.wiki/en/development/api/settings (setting scopes; page body did not render for fetch)
- https://foundryvtt.wiki/en/basics/Modules
- https://github.com/foundryvtt/dnd5e/wiki

Repo context:

- `.claude/skills/foundry-test-env/SKILL.md`
- `.claude/skills/foundry-core-ui/reference/sidebar-tabs.md`, `.claude/skills/foundry-core-ui/reference/dnd5e-settings.md`
