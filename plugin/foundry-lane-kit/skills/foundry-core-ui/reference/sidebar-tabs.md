# Sidebar Tabs

> Status: DRAFT from documentation and the local v14 source; not yet verified on the running client. The click-through pass stamps "verified on Foundry 14.368 / dnd5e 6.0.5, <date>".

Scope: every tab of the right-hand sidebar in Foundry 14.368 with dnd5e 6.0.5, in on-screen
order. Labels in **bold** are the exact English strings from `C:/FoundryTest/app/public/lang/en.json`
or `C:/FoundryTest/data/Data/systems/dnd5e/lang/en.json`. The Combat Tracker is only summarised
here; see `combat-tracker.md` for detail.

## How to reach it

- The sidebar lives on the right edge of the `/game` view (`<aside id="sidebar">`). Its tab
  strip is a vertical column of icon buttons (`#sidebar-tabs`), one per tab, plus a caret button
  at the bottom. [unverified]
- **The sidebar starts collapsed** (v13 and later): only the icon column shows. Clicking any tab
  icon selects that tab and expands the panel. Source: `Sidebar#_onFirstRender` creates
  `#sidebar-content` without the `expanded` class; `Sidebar#_onClickTab` calls `expand()`.
  [unverified]
- The caret button at the bottom of the strip toggles the panel. Its label reads **Expand** while
  collapsed and **Collapse** while expanded. [unverified]
- Clicking the tab that is already active does not collapse the panel in the v14 source (the
  click is ignored, then `expand()` runs if needed). A v13 note says a second click collapses;
  the verifier should confirm which is true on 14.368. [unverified]
- **Right-click** (aux click) on a tab icon pops the tab out into its own window, titled
  e.g. **Actor Directory** (`SIDEBAR.DirectoryTitle` = "{type} Directory"). Close it with the
  window's close button. [unverified]
- Every directory has a matching `ui.*` application: `ui.chat`, `ui.combat`, `ui.scenes`,
  `ui.placeables`, `ui.actors`, `ui.items`, `ui.journal`, `ui.tables`, `ui.cards`, `ui.macros`,
  `ui.playlists`, `ui.compendium`, `ui.settings`. `ui.<tab>.activate()` selects and expands it.
  [unverified]

## Tab strip (order, labels, visibility)

Each tab button is `button[data-action="tab"][data-tab="<id>"]` with `role="tab"`,
`aria-pressed` set on the active one, and the tooltip text as `aria-label`.

| #   | `data-tab`   | Tooltip / aria-label  | Icon class        | Who sees it                                                                   |
| --- | ------------ | --------------------- | ----------------- | ----------------------------------------------------------------------------- |
| 1   | `chat`       | **Chat Messages**     | `fa-comments`     | everyone                                                                      |
| 2   | `combat`     | **Combat Encounters** | `fa-swords`       | everyone                                                                      |
| 3   | `scenes`     | **Scenes**            | `fa-map`          | GM only (`gmOnly: true`)                                                      |
| 4   | `placeables` | **Placeables**        | `fa-puzzle-piece` | hidden when core setting "Disable Game Canvas" (`noCanvas`) is on; new in v14 |
| 5   | `actors`     | **Actors**            | `fa-user`         | everyone                                                                      |
| 6   | `items`      | **Items**             | `fa-suitcase`     | everyone                                                                      |
| 7   | `journal`    | **Journal**           | `fa-book-open`    | everyone                                                                      |
| 8   | `tables`     | **Rollable Tables**   | `fa-table-list`   | everyone                                                                      |
| 9   | `cards`      | **Card Stacks**       | `fa-cards`        | everyone                                                                      |
| 10  | `macros`     | **Macros**            | `fa-code`         | everyone                                                                      |
| 11  | `playlists`  | **Playlists**         | `fa-music`        | everyone                                                                      |
| 12  | `compendium` | **Compendium Packs**  | `fa-book-atlas`   | everyone                                                                      |
| 13  | `settings`   | **Settings**          | `fa-gears`        | everyone                                                                      |

- Tooltips come from each Document's plural label, except Journal (**Journal**), Compendium
  (**Compendium Packs**), Placeables and Settings, which have fixed strings. [unverified]
- A tab whose app refuses to render has its `<li>` set `hidden` (for example Scenes for a
  player). [unverified]
- A small notification pip next to the Chat icon lights up when a message arrives while the chat
  tab is not showing. [unverified]
- Source: `C:/FoundryTest/app/client/applications/sidebar/sidebar.mjs` (`static TABS`),
  `C:/FoundryTest/app/templates/sidebar/tabs.hbs`, `C:/FoundryTest/app/client/config.mjs`
  (`sidebarIcon`).

## Common directory layout (Scenes, Actors, Items, Journal, Rollable Tables, Card Stacks, Macros, Playlists)

All eight document tabs share one class (`DocumentDirectory`) and one header template.

### Header buttons

- **Create <Document>** - opens the create dialog for that tab. Exact labels: **Create Scene**,
  **Create Actor**, **Create Item**, **Create Entry** (Journal), **Create Table** (Rollable
  Tables), **Create Card Stack**, **Create Macro**, **Create Playlist**. Path: tab > header, first
  button (`button.create-entry`). Shown only if the user may create that document type (GM
  always; players depend on permissions). Creates world data if confirmed; closing the dialog
  creates nothing. [unverified]
- **Create Folder** - opens a folder form (fields **Folder Name**, **Folder Color**, **Sorting
  Mode** with radios **Alphabetical** / **Manual**; submit button **Create Folder**). GM only.
  Closing the window without submitting creates nothing. Max nesting depth 4
  (`CONST.FOLDER_MAX_DEPTH`). [unverified]
- Core create dialog (Scenes, Journal, Tables, Cards, Macros, Playlists): fields **Name**,
  **Type** (only if the document has subtypes), **Folder** (only if folders exist); the confirm
  button repeats the title, e.g. **Create Scene**. On confirm the document is created at once and
  its sheet opens. An empty name gets a default like "New Scene". [unverified]
- dnd5e create dialog (Actors and Items): a name field at the top, a folder select, and a grid of
  type cards with radio inputs; confirm button **Create Actor** / **Create Item**. dnd5e Actor
  types: **Player Character**, **Non-Player Character**, **Vehicle**, **Group**, **Encounter**.
  Source: `CreateDocumentDialog` in `dnd5e.mjs`. [unverified]
- Card Stacks create dialog adds **Preset Config** (a select with **Poker Deck (Dark)** and
  **Poker Deck (Light)**); types **Deck**, **Hand**, **Pile**. [unverified]

### Search and filter row (`<search>` element)

- Search-mode toggle (left of the input) - aria-label shows the current mode: **Search by Name
  only** (magnifier icon) or **Full Text Search** (file-magnifier icon). Click to switch.
  Stored per browser in client setting `core.collectionSearchModes`; default is name-only.
  Reversible. [unverified]
- Search input - `input[type=search][name=search]`, placeholder **Search <Types>**, e.g.
  **Search Actors**, **Search Journal Entries**, **Search Rollable Tables**, **Search Card
  Stacks**. Filters as you type; matching folders auto-expand; clearing the text restores the
  list. No data change. [unverified]
- Sort toggle - aria-label **Sort Alphabetically** or **Sort Manually** (shows the current
  mode). Click to switch. Stored per browser in `core.collectionSortingModes`; default is
  alphabetical (`"a"`). Reversible. [unverified]
- **Collapse All Folders** - folder-tree icon at the right end; closes every open folder. UI
  state only. [unverified]
- Footer (GM only, only when invalid documents exist): a warning button such as **1 unavailable
  Actor document**; it opens **Support & Issues** on the Documents tab. [unverified]

### Entries

- Each entry is `li.directory-item.entry[data-entry-id="<id>"]` with an optional thumbnail and a
  name link (`a.entry-name`, action `activateEntry`). [unverified]
- Left-click the name - opens the document's sheet (Scene: the scene config sheet). Exceptions:
  Playlists toggle open/closed instead; dnd5e Items open in play or edit mode depending on the
  sheet's last mode. [unverified]
- Folder rows are `li.directory-item.folder[data-folder-id][data-uuid]`; click the
  `header.folder-header` to expand or collapse. Expanded state is kept per browser in
  `game.folders._expanded`. [unverified]
- Hovering a folder header shows two small buttons: create a subfolder (aria-label **Create
  Folder**, GM, only below max depth) and create an entry inside it (aria-label **Create
  <Document>**). [unverified]

### Entry context menu (right-click an entry)

Base order from `DocumentDirectory#_getEntryContextOptions`; hidden items are skipped. The menu
renders as `#context-menu` containing `li.context-item` rows; system items from dnd5e appear in
a separate group (`li.context-group`) at the end.

- **Edit** - opens the sheet. Anyone who can view it. No data change. [unverified]
- **Configure Ownership** - opens the ownership form (per-user levels None / Limited / Observer
  / Owner plus a default). GM only. Saving changes world data; closing does not. [unverified]
- (tab-specific extras are inserted here, see each tab) [unverified]
- **Export Data** - downloads the document as a JSON file. Owner only. Triggers a browser
  download (no data change). [unverified]
- **Import Data** - opens **Import Data: <name>** with a file picker; importing overwrites the
  document and cannot be undone. Owner only. [unverified]
- **Clear Folder** - moves the entry to the directory root. GM only, only when the entry is in a
  folder. Reversible by dragging back. [unverified]
- **Delete** - opens a confirm dialog titled **Delete <Type>: <name>** with **Yes** / **No**;
  **No** is the default button. Yes permanently deletes. Needs delete permission. [unverified]
- **Duplicate** - immediately creates a copy named "<name> (Copy)". Owner who can also create
  that type. Creates world data. [unverified]

### Folder context menu (right-click a folder header)

- **Edit Folder** - opens the folder form (submit **Update Folder**). GM only. [unverified]
- **Configure Ownership** - ownership for the folder's documents. GM only; not offered in the
  Scenes tab. [unverified]
- **Create Rollable Table** - asks for confirmation, then builds a new table whose results are
  the folder's documents. Offered for compendium-capable types. Creates world data. [unverified]
- **Export to Compendium** - opens **Export Content** (destination pack, **Keep Document IDs**,
  **Merge By Name**, **Keep Folder Structure**). Writes into an unlocked pack. [unverified]
- **Remove Folder** - confirm dialog; deletes only the folder and moves its contents to the
  parent. GM only. [unverified]
- **Delete All** - confirm dialog titled **Delete All: <name>**; deletes the folder, subfolders
  and every document inside. GM only. Not reversible. [unverified]

### Drag and drop

- Drag an entry onto another entry or into a folder to move it; in manual sort mode the drop
  position also sets `sort`. Moving changes world data (`folder`, `sort`). [unverified]
- Drag a folder onto another folder to nest it (blocked past depth 4 with **You may not nest
  Folders more than 4 levels deep.**) [unverified]
- Dropping a document from a compendium into a matching tab imports a copy. [unverified]
- Actors: dragging to the canvas creates a token (needs the Create Tokens permission). Items:
  drag onto an actor sheet to give the actor a copy. Macros: drag to the hotbar. Journal: drag to
  the canvas to place a map note. [unverified]
- Automation gotcha: HTML5 drag events are hard to synthesise from a browser tool; prefer
  checking drop results in JS, or skip drag checks. [unverified]

Sources: `C:/FoundryTest/app/client/applications/sidebar/document-directory.mjs`,
`C:/FoundryTest/app/templates/sidebar/directory/header.hbs`,
`C:/FoundryTest/app/templates/sidebar/partials/folder-partial.hbs`,
`C:/FoundryTest/app/client/applications/sheets/folder-config.mjs`,
https://foundryvtt.com/article/folders/,
https://foundryvtt.com/api/v14/classes/foundry.applications.sidebar.DocumentDirectory.html

## Chat Log (`chat`)

- Purpose: the message log. Tab body is `#chat` with `ol.chat-log`. [unverified]
- Where the input lives: when the sidebar is expanded and Chat is the active tab, the message
  input and controls sit at the bottom of the chat tab. Otherwise they float at the lower right
  inside `#chat-notifications`, where new messages also pop up briefly. [unverified]
- Message input - `prose-mirror#chat-message` (a rich-text editor, not a textarea), aria-label
  **Chat**, placeholder **Enter message**. Enter sends. Sending creates a ChatMessage (world
  data). Gotcha: fill it by clicking and typing, not by setting a value. [unverified]
- Message-mode buttons (`#message-modes`, one pressed at a time), in order: **Public as User**,
  **Private to Gamemasters**, **Blind to Gamemasters**, **Self Only**, **Public as Character**.
  Stored per browser in client setting `core.messageMode`. Reversible. v14 renamed the old
  "roll mode" to "message mode". [unverified]
- **Export Chat Log** (floppy icon, GM only) - saves the log as `fvtt-log-<date>.txt`, a browser
  download. [unverified]
- **Clear Chat Log** (trash icon, GM only) - confirm dialog **Flush Chat Log** with **Yes** /
  **No**; Yes deletes every message permanently. [unverified]
- **Jump to Bottom** - down-arrow button, only shown when scrolled up. [unverified]
- Message context menu (right-click a message in the chat tab): **Pop Out Message** (if
  allowed), **Reveal To Everyone** (whispered/blind message; author or GM), **Make Private**
  (public message; author or GM), **Delete**. dnd5e adds, where relevant: **Apply As Damage**,
  **Apply As Healing**, **Apply As Temporary HP**, **Apply Double As Damage**, **Apply Half As
  Damage**, **Select Hit Targets**, **Select Missed Targets**, **Select All Outcomes**. Reveal,
  Make Private, Delete and the Apply items change world data. [unverified]
- Sources: `C:/FoundryTest/app/client/applications/sidebar/tabs/chat.mjs`,
  `C:/FoundryTest/app/templates/sidebar/tabs/chat/notifications.hbs`,
  `C:/FoundryTest/app/client/documents/collections/chat-messages.mjs`, `dnd5e.mjs`
  (`addChatMessageContextOptions`).

## Combat Tracker (`combat`) - summary only

- Purpose: encounter list, turn order and round controls. Detail in `combat-tracker.md`.
  [unverified]
- Header (GM): **Create Combat**, **Activate Previous Combat** / **Activate Next Combat**,
  **Roll All**, **Roll NPCs**, **Combat Tracker Settings**; shows **No Combat** or **Round
  {n}** / **Not Started**. [unverified]
- Footer: **Start Combat**, **Previous Round**, **Previous Turn**, **Next Turn**, **Next Round**,
  **End Combat** (players get **End Turn** on their own turn). All change world data.
  [unverified]
- dnd5e swaps in its own tracker class (`CombatTracker5e`). Source:
  `C:/FoundryTest/app/templates/sidebar/tabs/combat/*.hbs`.

## Scenes (`scenes`) - GM only

- Purpose: list of all world scenes. Players never see this tab. [unverified]
- Header: **Create Scene**, **Create Folder**, search (**Search Scenes**), sort, collapse.
  [unverified]
- Entries show a wide thumbnail with the name over it (`scene-partial.hbs`). Click opens the
  scene config sheet. [unverified]
- Entry context menu, in order (hidden items skipped):
  - **View** - loads the scene for you only. Hidden for the scene you are already viewing.
    Local only. [unverified]
  - **Activate** - makes it the active scene and pulls every connected user to it. Hidden if
    already active. World data. [unverified]
  - **Edit** - opens the scene config sheet (older docs call this "Configure"). [unverified]
  - **Scene Notes** - opens the linked journal page; only if the scene has one. [unverified]
  - **Preload** - tells all clients to preload the scene's assets. No data change. [unverified]
  - **Toggle Navigation** - adds or removes the scene from the top navigation bar. Hidden for
    the active scene. World data; reversible by toggling again. [unverified]
  - **Generate Thumbnail Image** - renders and uploads a new thumbnail file and saves it on the
    scene; success toast **Generated thumbnail image for Scene {name}.** Needs a background
    image and the canvas enabled. Writes a file and world data. [unverified]
  - **Export Data**, **Import Data**, **Clear Folder**, **Delete**, **Duplicate** as in the
    common menu. There is no **Configure Ownership** for scenes. [unverified]
- Folder menu: as common, minus **Configure Ownership**. [unverified]
- Source: `C:/FoundryTest/app/client/applications/sidebar/tabs/scene-directory.mjs`;
  https://foundryvtt.com/article/scenes/

## Placeables (`placeables`) - new in v14

- Purpose: lists the placeable objects on the viewed scene by type. Sub-tab row (icons) in this
  order: Tokens, Tiles, Drawings, Walls, Lights, Sounds, Regions, Notes (order values 100-800 in
  `CONFIG.<Doc>.sidebar`). Sub-tabs are disabled when no scene is viewed. [unverified]
- Switching a sub-tab also switches the left scene-control layer (`ui.controls.activate`).
  Changes the active tool; no data change. [unverified]
- Each sub-tab has a filter input (placeholder **Filter {name}**), filter buttons (e.g. **Viewed
  Only**, an **Advanced Filter** button: "Advanced Filters. Right-click to clear.") and a **+**
  create button when allowed. [unverified]
- Not in the older KB articles. Details belong in a placeables reference; listed here so the tab
  count matches. Source: `C:/FoundryTest/app/client/applications/sidebar/tabs/placeable-directory.mjs`,
  `.../placeable-tab.mjs`, `C:/FoundryTest/app/templates/sidebar/tabs/placeable/*.hbs`.

## Actors (`actors`)

- Purpose: all world actors (PCs, NPCs, vehicles, groups, encounters). Players see actors they
  have at least Limited ownership of. [unverified]
- Header: **Create Actor** (dnd5e dialog, see above), **Create Folder**, **Search Actors**,
  sort, collapse. [unverified]
- Entry context menu extras (inserted after **Configure Ownership**):
  - **View Character Artwork** - image popout of the portrait; only if it is not the default
    art. [unverified]
  - **View Token Artwork** - image popout of the prototype token image; only if non-default and
    not random. [unverified]
  - dnd5e group: **Restore Transformation** (polymorphed actors), **Set as Primary Party** (GM,
    group actors that are not the primary party), **Remove as Primary Party** (GM, the current
    primary party). Primary party changes the world setting `dnd5e.primaryParty`. [unverified]
- dnd5e marks the primary party entry with the CSS class `primary-party`. [unverified]
- Drag to canvas creates a token (world data). [unverified]
- Sources: `C:/FoundryTest/app/client/applications/sidebar/tabs/actor-directory.mjs`, `dnd5e.mjs`
  (`Actor5e.addDirectoryContextOptions`, `onRenderActorDirectory`),
  https://foundryvtt.com/article/actors/

## Items (`items`)

- Purpose: world items not owned by an actor. [unverified]
- Header: **Create Item** (dnd5e dialog; types include weapon, equipment, consumable, tool,
  loot, species/race, background, class, subclass, spell, feat, container, facility),
  **Create Folder**, **Search Items**, sort, collapse. [unverified]
- Entry context menu extras: **View Item Artwork** (non-default image only); dnd5e group:
  **Create Scroll** (spells only, needs item-create permission; creates a new scroll item).
  [unverified]
- dnd5e replaces the directory class (`ItemDirectory5e`): drops from other directories can move
  rather than copy an item, and a dropped container brings its contents. [unverified]
- Sources: `C:/FoundryTest/app/client/applications/sidebar/tabs/item-directory.mjs`, `dnd5e.mjs`
  (`ItemDirectory5e`, `Item5e.addDirectoryContextOptions`), https://foundryvtt.com/article/items/

## Journal (`journal`)

- Purpose: journal entries (multi-page documents). Tab tooltip **Journal**. [unverified]
- Header: **Create Entry**, **Create Folder**, **Search Journal Entries**, sort, collapse.
  [unverified]
- Entry context menu extra: **Jump To Pin** - pans the canvas to this entry's map note; only
  when the entry has a note on the viewed scene. No data change. [unverified]
- **Show Players** is not in the v14 directory menu. It is a header control on the open journal
  sheet (`JOURNAL.ActionShow` = **Show Players**) and in image popouts. [unverified]
- Sources: `C:/FoundryTest/app/client/applications/sidebar/tabs/journal-directory.mjs`,
  `C:/FoundryTest/app/client/applications/sheets/journal/journal-entry-sheet.mjs`,
  https://foundryvtt.com/article/journal/

## Rollable Tables (`tables`)

- Purpose: random tables. [unverified]
- Header: **Create Table**, **Create Folder**, **Search Rollable Tables**, sort, collapse.
  [unverified]
- Entry context menu: **Draw Result** comes first (d20 icon), then the common items. Draw Result
  rolls and posts the result to chat; if the table draws without replacement it also marks the
  result drawn. World data. [unverified]
- Folder menu **Create Rollable Table** (any tab) builds a table from a folder. [unverified]
- Sources: `C:/FoundryTest/app/client/applications/sidebar/tabs/roll-table-directory.mjs`,
  https://foundryvtt.com/article/roll-tables/

## Card Stacks (`cards`)

- Purpose: decks, hands and piles. [unverified]
- Header: **Create Card Stack** (types **Deck**, **Hand**, **Pile**; **Preset Config** select),
  **Create Folder**, **Search Card Stacks**, sort, collapse. [unverified]
- Entry context menu: the common items, but **Duplicate** shows only for a GM and only when the
  stack can be cloned (hands and piles must be reset first). [unverified]
- Sources: `C:/FoundryTest/app/client/applications/sidebar/tabs/cards-directory.mjs`,
  `C:/FoundryTest/app/templates/sidebar/cards-create.html`, https://foundryvtt.com/article/cards/

## Macros (`macros`)

- Purpose: the macro directory. In v13+ this is a normal sidebar tab; older docs describe it as a
  window opened from a folder icon beside the hotbar. [unverified]
- Header: **Create Macro**, **Create Folder**, **Search Macros**, sort, collapse. [unverified]
- Entry click opens the macro config sheet (run the macro from there or from the hotbar).
  Context menu: common items only. [unverified]
- Sources: `C:/FoundryTest/app/client/applications/sidebar/tabs/macro-directory.mjs`,
  https://foundryvtt.com/article/macros/

## Playlists (`playlists`)

- Purpose: music and ambience. Layout from top: header, **User Volume Controls** (collapsible;
  sliders **Music**, **Environment**, **Interface**, per browser), playlist list, and a
  currently-playing block pinned top or bottom (**Pin to top** / **Pin to bottom**, client
  setting `core.playlist.playingLocation`). [unverified]
- Header: **Create Playlist**, **Create Folder**, **Search Playlists**, sort, collapse.
  [unverified]
- Clicking a playlist header expands or collapses its sound list (it does not open a sheet).
  Use **Edit** in the context menu for the sheet. [unverified]
- Playlist row buttons (owner): **Add Sound** (not while playing), mode cycle button showing
  **Soundboard Only** / **Sequential Playback** / **Shuffle Tracks** / **Simultaneous
  Playback**, then **Play Playlist**, or while playing **Previous Sound**, **Next Sound**, **Stop
  Playlist**. Play/stop is world data and audible to all users. [unverified]
- Playlist context menu (right-click the playlist header): **Edit**, **Configure Ownership**,
  **Preload Sounds**, **Bulk Import Sounds**, **Export Data**, **Import Data**, **Clear
  Folder**, **Delete**, **Duplicate**. [unverified]
- Sound context menu (right-click a sound row): **Edit Sound**, **Preload Sound**, **Delete
  Sound**. [unverified]
- Sources: `C:/FoundryTest/app/client/applications/sidebar/tabs/playlist-directory.mjs`,
  `C:/FoundryTest/app/templates/sidebar/tabs/playlist/*.hbs`,
  https://foundryvtt.com/article/playlists/

## Compendium Packs (`compendium`)

- Purpose: all packs from the world, the system and modules, in folders. For this world dnd5e
  ships two pack folders, **D&D Modern Content** and **D&D Legacy Content** (from
  `system.json`). [unverified]
- Header (GM): **Create Compendium**, **Create Folder**. dnd5e appends **Open Compendium
  Browser** to the same row (for all users); it opens the dnd5e browser window. [unverified]
- Search row: a type filter button (aria-label **Filter Documents by Type**) instead of the
  search-mode toggle, the input (**Search Compendium Packs**), sort toggle, **Collapse All
  Folders**. [unverified]
  - Filter menu: one row per pack type (Active Effect, Actor, Adventure, Card Stack, Item,
    Journal Entry, Macro, Playlist, Rollable Table, Scene) plus **Clear Filters**; the icon
    changes while filters are active. [unverified]
  - Search needs at least 3 characters. It filters pack names and folder names and also appends
    up to 25 matching documents from inside packs; clicking a match's name opens its sheet, and
    its pack link opens the pack. [unverified]
- Pack rows: `li.directory-item.compendium[data-pack="<package>.<name>"]` with banner, title,
  status icons (eye = **Non-default ownership**, lock = **Locked**) and the source package in the
  footer. Click opens the pack window (its own directory; create buttons only when unlocked and
  owned). [unverified]
- **Create Compendium** dialog: **Compendium Name**, **Document Type**, **Folder** (if pack
  folders exist); confirm **Create Compendium**. Creates a world pack on disk. [unverified]
- Pack context menu (GM only; players get no menu):
  - **Configure Ownership** - per-role levels for Assistant, Trusted and Player (**Inherit from
    below**, None, Limited, Observer, Owner). Saves the world's compendium configuration.
    [unverified]
  - **Lock** / **Unlock** - one of the two shows. Lock applies at once. Unlock of a world pack
    (or a local module pack without a manifest) applies at once; for a system or module pack a
    warning dialog **Toggle Edit Lock: <pack>** offers **Duplicate**, **Unlock**, **Cancel**.
    Stored in world settings; reversible. [unverified]
  - **Import All Content** - dialog to import every document into a folder; not offered for
    Adventure packs. Creates many world documents. [unverified]
  - **Clear Folder** - only if the pack is in a folder. [unverified]
  - **Delete** - world packs only; confirm **Delete Compendium: <pack>**; deletes the pack
    permanently. [unverified]
  - **Duplicate** - dialog **Duplicate Compendium: <pack>** with **New Compendium Title**
    (default "<pack> (Copy)"), buttons **Duplicate** / **Cancel**; creates a world pack.
    [unverified]
- Folder menu for pack folders: only **Edit Folder** and **Remove Folder**. [unverified]
- Older KB names differ: "Toggle Edit Lock", "Toggle Visibility", "Configure Permissions",
  "Import Data". v14 uses the labels above; visibility is handled by ownership. [unverified]
- Sources: `C:/FoundryTest/app/client/applications/sidebar/tabs/compendium-directory.mjs`,
  `C:/FoundryTest/app/templates/sidebar/tabs/compendiums.hbs`,
  `C:/FoundryTest/app/templates/sidebar/partials/pack-partial.hbs`,
  `C:/FoundryTest/app/templates/sidebar/compendium-create.hbs`, `dnd5e.mjs`
  (`CompendiumBrowser.injectSidebarButton`), https://foundryvtt.com/article/compendium/,
  https://github.com/foundryvtt/dnd5e/wiki/Compendium-Browser

## Settings (`settings`)

Top to bottom, from `templates/sidebar/tabs/settings.hbs` plus the dnd5e `renderSettings` hook.

### Info block (`section.info`)

- **Foundry Virtual Tabletop** heading, then the version line **Version 14 Stable**. [unverified]
- **Build Version** 368. GM only: an alert pip appears if a core update exists; clicking it shows
  a toast telling you to return to setup. [unverified]
- **Active Modules** with the count of enabled modules. [unverified]
- Core also renders a game-system row, but dnd5e removes it and inserts its own section below
  the info block: heading **Game System**, a D&D badge image with the version (6.0.5), and links
  **Notes**, **Issues**, **Wiki**, **Discord** (external, new tab). Then a **Welcome Screen**
  button that reopens the dnd5e welcome window. [unverified]

### Settings and Configuration

- **Game Settings** - opens the **Game Settings** window (`game.settings.sheet`). Everyone;
  what you can change depends on permissions. Some settings need a reload prompt on save.
  [unverified]
- **Controls Configuration** - opens **Controls Configuration** (keybindings). Everyone;
  per-user. [unverified]
- **Module Management** (users with the modify-settings permission) or **Active Modules**
  (others) - opens **Module Management**. Saving asks to reload the app. [unverified]
- **World Configuration** - full Gamemaster role only (not Assistant). Opens **Edit World: AI Tool
  Test**. Saving changes the world manifest. [unverified]
- **User Management** - GM (incl. Assistant). Leaves the game and loads the `/players` page
  (full-page form; **Save and Return** saves). Browser Back or `/game` returns without saving.
  [unverified]
- **Tour Management** - opens **Tour Management** (start/reset tours). [unverified]

### Help and Documentation

- **Support & Issues** - opens **Support & Issues**; the button shows an issue count in
  brackets when there are problems. [unverified]
- **Documentation** - link to https://foundryvtt.com/kb/ (new tab). [unverified]
- **Community Wiki** - link to https://foundryvtt.wiki/ (new tab). [unverified]

### Game Access

- **Invitation Links** - GM only. Opens **Game Invitation Links** with **Local Network** and
  **Internet** addresses (internet one masked; eye button reveals; clicking a field copies it
  and shows **Game invitation link copied to clipboard**; a refresh icon re-checks the port).
  No data change. Privacy: do not reveal or screenshot the internet address. [unverified]
- **Log Out** - goes to `/join` immediately, no confirm. Rejoin as `Claude`. [unverified]
- **Return to Setup** - full Gamemaster role only. Shuts the world down for everyone and returns
  the server to the setup screen. Confirms only if other users are connected. Relaunching the
  world needs the admin login or `scripts/test-env/start.ps1`. [unverified]
- Button labels differ from the v13 KB ("Configure Settings", "Configure Controls", "Manage
  Modules", "Edit World", "View Documentation", "Community Wiki Pages"). [unverified]
- Sources: `C:/FoundryTest/app/client/applications/sidebar/tabs/settings.mjs`,
  `C:/FoundryTest/app/templates/sidebar/tabs/settings.hbs`,
  `C:/FoundryTest/app/client/applications/sidebar/apps/invitation-links.mjs`,
  `C:/FoundryTest/app/client/game.mjs` (`shutDown`, `logOut`), `dnd5e.mjs` (`renderSettings`),
  https://foundryvtt.com/article/settings/,
  https://foundryvtt.com/api/classes/foundry.applications.sidebar.tabs.Settings.html

## Driving it from automation

Read-only console snippets (browser pane `javascript_tool`). None of them change state.

Sidebar state and visible tabs:

```js
({
  expanded: ui.sidebar.expanded,
  active: ui.sidebar.tabGroups.primary,
  tabs: [...document.querySelectorAll('#sidebar-tabs [data-tab]')]
    .filter(b => !b.closest('li').hidden)
    .map(b => `${b.dataset.tab}: ${b.getAttribute('aria-label')}`),
  popouts: Object.keys(ui.sidebar.popouts),
  release: `${game.release.display} build ${game.release.build}`,
  system: `${game.system.id} ${game.system.version}`,
});
```

Header of one directory (swap `ui.actors` for `ui.items`, `ui.journal`, ...):

```js
(d => ({
  create: d.element.querySelector('.header-actions .create-entry')?.textContent.trim(),
  folder: d.element.querySelector('.header-actions .create-folder')?.textContent.trim(),
  placeholder: d.element.querySelector('search input')?.placeholder,
  searchModeLabel: d.element
    .querySelector('[data-action=toggleSearch]')
    ?.getAttribute('aria-label'),
  sortLabel: d.element.querySelector('[data-action=toggleSort]')?.getAttribute('aria-label'),
  searchMode: d.collection.searchMode,
  sortMode: d.collection.sortingMode,
  entries: d.collection.size,
  folders: game.folders.filter(f => f.type === d.documentName).length,
}))(ui.actors);
```

Open context menu labels (run while a menu is open):

```js
[...document.querySelectorAll('#context-menu .context-item')].map(li => li.textContent.trim());
```

Open windows (after clicking a button that should open one):

```js
[...foundry.applications.instances.values()].map(a => `${a.constructor.name}: ${a.title}`);
```

Other checks:

- Settings window open: `game.settings.sheet.rendered`. [unverified]
- Chat mode: `game.settings.get('core', 'messageMode')` (`public|gm|blind|self|ic`). [unverified]
- Compendium lock state: `game.packs.get('dnd5e.spells24').locked`; filters:
  `[...ui.compendium.activeFilters]`. [unverified]
- Active vs viewed scene: `game.scenes.active?.name`, `canvas.scene?.name`. [unverified]
- Placeables sub-tab vs control: `ui.placeables.tabGroups.sheet`, `ui.controls.control?.name`.
  [unverified]
- Folder expansion memory: `Object.keys(game.folders._expanded)`. [unverified]

Stable selectors and accessibility-tree names:

- Tab buttons: `#sidebar-tabs button[data-tab="<id>"]`; a11y name = tooltip (table above). Use
  the `data-tab` selector when a name is ambiguous (**Settings** also names a section; **Items**,
  **Actors** also appear in compendium rows). [unverified]
- Collapse/expand: `#sidebar-tabs button[data-action="toggleState"]`, name **Expand** /
  **Collapse**. [unverified]
- Tab bodies: `section#chat`, `#combat`, `#scenes`, `#placeables`, `#actors`, `#items`,
  `#journal`, `#tables`, `#cards`, `#macros`, `#playlists`, `#compendium`, `#settings`. Popouts
  use `#<id>-popout`. [unverified]
- Directory header: `.header-actions .create-entry`, `.header-actions .create-folder`,
  `search input[name=search]`, `[data-action=toggleSearch]`, `[data-action=toggleSort]`,
  `[data-action=collapseFolders]`. Compendium filter: `button.filter[data-action=filter]`.
  [unverified]
- Entries: `li.directory-item[data-entry-id]`; folders: `li.directory-item.folder >
header.folder-header`; packs: `li.directory-item[data-pack]`; chat messages:
  `li.message[data-message-id]`. [unverified]
- Settings buttons: `#settings button[data-app="configure|controls|modules|world|players|tours|support|invitations|logout|setup"]`.
  [unverified]
- Context menus open on right-click (`contextmenu`) only; tab popouts open on right-click of the
  tab icon (`auxclick`). A browser-tool `right_click` should produce both. [unverified]

Gotchas:

- The sidebar is collapsed after every page load; select a tab (or call
  `ui.<tab>.activate()`) before looking for elements inside it. Hidden tab bodies still exist in
  the DOM but are not visible, so screenshots miss them. [unverified]
- Header and inline folder buttons are small icon buttons; find them by `aria-label` or
  `data-action`, not by coordinates. [unverified]
- Delete and flush dialogs default to **No**; pressing Enter cancels. [unverified]
- Duplicate, Draw Result, Activate and the playlist play buttons act immediately with no
  confirm. [unverified]
- The chat input is a ProseMirror element; `form_input` may not work on it. [unverified]
- `User Management`, `Log Out` and `Return to Setup` navigate away from `/game`. [unverified]

## Safety in the test world

World `ai-tool-test` on `http://localhost:30001` only, logged in as `Claude`.

- Safe (no world data): switching tabs, expanding/collapsing, popping out and closing tabs,
  search text, search-mode and sort toggles (per-browser client settings), collapsing folders,
  opening sheets and dialogs and closing them unsaved, message-mode buttons (client setting),
  **View** scene, **Preload**, **Jump To Pin**, opening Settings-tab windows without saving,
  **Invitation Links** (keep the internet address hidden).
- Changes world data, undo possible: **Clear Folder**, drag-moves, **Toggle Navigation**,
  **Activate** (re-activate the old scene), **Lock**/**Unlock** (toggle back), ownership edits
  (restore old values), **Set as Primary Party** (remove again), **Reveal To Everyone** /
  **Make Private** (toggle back), sending a chat message.
- Creates data: every **Create ...** confirm, **Duplicate**, **Create Rollable Table**,
  **Create Scroll**, **Import All Content**, **Draw Result** (chat message), **Duplicate**
  compendium, **Generate Thumbnail Image** (writes an image file). Clean-up would need a delete,
  so leave these to the GM or the AI Tool's guarded writes; the checklist only opens and cancels
  these dialogs.
- Destructive, never click Yes: **Delete**, **Delete All**, **Remove Folder**, **Clear Chat
  Log**, compendium **Delete**, **Import Data** (overwrites and cannot be undone).
- Browser downloads (**Export Data**, **Export Chat Log**): only with the user's explicit
  permission; checking the menu label is enough.
- Session-ending: **Return to Setup** only at the end of a session, as the test-env skill says;
  **Log Out** is harmless (rejoin as `Claude`); **User Management** leaves the game (come back
  without saving).
- Never touch the live bridge ports (31414-31416) or `mcp__foundry-mcp__*` tools; the test
  bridge is 31514-31515.

## Verification checklist

Start logged in as `Claude` (GM) at `http://localhost:30001/game`, fresh page load, no windows
open. Each step is one action; "expect" is what should happen.

1. Load `/game`. Expect the sidebar collapsed: only the icon column on the right;
   `ui.sidebar.expanded === false`.
2. Read the tab strip (snippet above). Expect 13 visible tabs in this order: chat, combat,
   scenes, placeables, actors, items, journal, tables, cards, macros, playlists, compendium,
   settings, with the aria-labels in the table.
3. Hover the Journal icon. Expect tooltip **Journal**; hover Rollable Tables: **Rollable Tables**.
4. Click the Actors icon. Expect the panel to expand with the Actors directory;
   `ui.sidebar.tabGroups.primary === 'actors'`.
5. Click the Actors icon again. Record whether the panel stays open (v14 source) or collapses
   (v13 note).
6. Click the caret at the bottom of the strip. Expect the panel to collapse and the caret label
   to become **Expand**. Click again to expand (label **Collapse**).
7. Actors header: read it (snippet). Expect **Create Actor**, **Create Folder**, placeholder
   **Search Actors**, search-mode label **Search by Name only**, sort label **Sort
   Alphabetically**.
8. Click **Create Actor**. Expect the dnd5e dialog titled **Create Actor** with a name field,
   type cards **Player Character**, **Non-Player Character**, **Vehicle**, **Group**,
   **Encounter**. Close it with the window close button; expect no new actor
   (`game.actors.size` unchanged).
9. Click **Create Folder**. Expect a folder form with **Folder Name**, **Folder Color**,
   **Sorting Mode** (**Alphabetical** / **Manual**) and **Create Folder**. Close it; expect no new
   folder.
10. Click the search-mode toggle. Expect label **Full Text Search**; click again to return to
    **Search by Name only**.
11. Click the sort toggle. Expect label **Sort Manually**; click again to return to **Sort
    Alphabetically**.
12. Type three letters of an existing actor name into the search box. Expect non-matching
    entries hidden; clear the box and expect all entries back.
13. Click **Collapse All Folders** (if folders exist). Expect all folders closed.
14. Right-click an actor entry. Expect a menu starting **Edit**, **Configure Ownership**, then
    art items if the art is custom, **Export Data**, **Import Data**, (**Clear Folder**),
    **Delete**, **Duplicate**, and possibly the dnd5e group. Press Escape or click elsewhere to
    close.
15. Right-click an actor, choose **Configure Ownership**. Expect an ownership window listing
    users with levels. Close without saving.
16. Right-click an actor, choose **Delete**. Expect **Delete Actor: <name>** with **Yes** and
    **No**. Click **No**; expect the actor still present.
17. Left-click an actor name. Expect its dnd5e sheet to open. Close it.
18. Right-click the Actors tab icon. Expect a separate **Actor Directory** window;
    `ui.sidebar.popouts` includes `actors`. Close it.
19. Items tab: click it. Expect **Create Item**, placeholder **Search Items**. Click **Create
    Item**; expect the dnd5e dialog **Create Item** with item type cards. Close it.
20. Journal tab: expect **Create Entry**, placeholder **Search Journal Entries**. Right-click an
    entry (if any); expect no **Show Players** item. Close the menu.
21. Rollable Tables tab: expect **Create Table**. Right-click a table (if any); expect **Draw
    Result** as the first item. Do not click it.
22. Card Stacks tab: expect **Create Card Stack**. Click it; expect **Create Card Stack** dialog
    with type options **Deck** / **Hand** / **Pile** and **Preset Config**. Close it.
23. Macros tab: expect **Create Macro** and **Search Macros**.
24. Playlists tab: expect **Create Playlist**, then **User Volume Controls** with **Music**,
    **Environment**, **Interface** sliders.
25. Click **User Volume Controls**. Expect the sliders to collapse; click again to expand.
26. Scenes tab: expect **Create Scene** and scene thumbnails. Right-click a scene. Expect **View**
    (unless viewed), **Activate** (unless active), **Edit**, **Preload**, **Toggle Navigation**
    (unless active), common items, and no **Configure Ownership**. Close the menu.
27. Right-click a folder header in any tab (if one exists). Expect **Edit Folder**, **Configure
    Ownership** (not in Scenes), **Create Rollable Table**, **Export to Compendium**, **Remove
    Folder**, **Delete All**. Close the menu.
28. Placeables tab: click it. Expect sub-tab icons (Tokens first); clicking the Walls sub-tab
    should also select the Walls scene control (`ui.controls.control?.name === 'walls'`). Click
    Tokens again to restore.
29. Compendium Packs tab: click it. Expect **Create Compendium**, **Create Folder** and dnd5e's
    **Open Compendium Browser** in the header row, placeholder **Search Compendium Packs**, and
    folders **D&D Modern Content** and **D&D Legacy Content**.
30. Click **Create Compendium**. Expect a dialog with **Compendium Name**, **Document Type** and
    a **Create Compendium** button. Close it; expect `game.packs.size` unchanged.
31. Click the filter button (**Filter Documents by Type**). Expect a menu of document types plus
    **Clear Filters**. Pick **Actor**; expect only Actor packs listed. Open the menu again and
    pick **Clear Filters**.
32. Type `fireball` in the compendium search. Expect matching packs plus document matches from
    inside packs (with pack links). Clear the box.
33. Right-click a dnd5e pack (e.g. **Spells**). Expect **Configure Ownership**, **Unlock**,
    **Import All Content**, **Duplicate**, and no **Delete** (system pack). Close the menu.
34. Right-click the same pack, choose **Unlock**. Expect the warning **Toggle Edit Lock:
    Spells** with **Duplicate**, **Unlock**, **Cancel**. Click **Cancel**; expect
    `game.packs.get('dnd5e.spells24').locked === true`.
35. Click the pack name. Expect the pack window to open, with a lock icon in its title bar.
    Close it.
36. Click **Open Compendium Browser**. Expect the dnd5e Compendium Browser window. Close it.
37. Chat tab: click it. Expect the message input (**Enter message** placeholder) and the five
    message-mode buttons at the bottom of the tab, plus **Export Chat Log** and **Clear Chat Log**
    icons.
38. Click the **Private to Gamemasters** mode button. Expect it pressed and
    `game.settings.get('core','messageMode') === 'gm'`. Click **Public as User** to restore.
39. Click **Clear Chat Log**. Expect confirm **Flush Chat Log**. Click **No**; expect messages
    unchanged.
40. Collapse the sidebar. Expect the chat input to move to the lower-right floating area
    (`#chat-notifications`). Expand again.
41. Settings tab: click it. Expect **Foundry Virtual Tabletop**, **Version 14 Stable**, **Build
    Version** 368, **Active Modules** with a count, then the dnd5e **Game System** block (badge,
    6.0.5, **Notes**, **Issues**, **Wiki**, **Discord**) and **Welcome Screen**.
42. Expect section headings **Settings and Configuration**, **Help and Documentation**, **Game
    Access**, and buttons **Game Settings**, **Controls Configuration**, **Module Management**,
    **World Configuration**, **User Management**, **Tour Management**, **Support & Issues**,
    **Documentation**, **Community Wiki**, **Invitation Links**, **Log Out**, **Return to Setup**.
43. Click **Game Settings**. Expect the **Game Settings** window; `game.settings.sheet.rendered`
    is true. Close it.
44. Click **Controls Configuration**. Expect **Controls Configuration**. Close it.
45. Click **Module Management**. Expect **Module Management** with module checkboxes. Close
    without saving.
46. Click **World Configuration**. Expect **Edit World: AI Tool Test**. Close without saving.
47. Click **Tour Management**. Expect **Tour Management**. Close it.
48. Click **Support & Issues**. Expect **Support & Issues**. Close it.
49. Click **Invitation Links**. Expect **Game Invitation Links** with **Local Network** and a
    masked **Internet** field. Do not reveal it. Close.
50. Click **Welcome Screen**. Expect the dnd5e welcome window. Close it.
51. Read the **Documentation** and **Community Wiki** hrefs (no click needed). Expect
    `https://foundryvtt.com/kb/` and `https://foundryvtt.wiki/`.
52. Optional, last: click **Log Out**. Expect `/join`. Rejoin as `Claude` (no password) and
    confirm `/game` loads. Do not click **Return to Setup** or **User Management** in this pass
    unless the session is ending (Return to Setup) or the GM asks.
53. Optional player view: join as `Player` in a separate session. Expect no Scenes tab, no
    **Create Folder**, no compendium context menu, and **Active Modules** instead of **Module
    Management** in Settings.

## Sources

- Local v14 source (ground truth):
  - `C:/FoundryTest/app/client/applications/sidebar/sidebar.mjs`
  - `C:/FoundryTest/app/client/applications/sidebar/sidebar-tab.mjs`
  - `C:/FoundryTest/app/client/applications/sidebar/document-directory.mjs`
  - `C:/FoundryTest/app/client/applications/sidebar/tabs/` (actor-, item-, journal-,
    roll-table-, cards-, macro-, scene-, playlist-, compendium-directory.mjs, chat.mjs,
    combat-tracker.mjs, placeable-directory.mjs, placeable-tab.mjs, settings.mjs)
  - `C:/FoundryTest/app/client/applications/sidebar/apps/invitation-links.mjs`, `compendium.mjs`
  - `C:/FoundryTest/app/client/applications/ux/context-menu.mjs`
  - `C:/FoundryTest/app/client/applications/sheets/folder-config.mjs`
  - `C:/FoundryTest/app/client/documents/abstract/client-document.mjs` (`createDialog`,
    `deleteDialog`, `importFromJSONDialog`)
  - `C:/FoundryTest/app/client/documents/abstract/directory-collection-mixin.mjs`
  - `C:/FoundryTest/app/client/documents/collections/chat-messages.mjs`,
    `compendium-collection.mjs`
  - `C:/FoundryTest/app/client/game.mjs` (`shutDown`, `logOut`, client settings)
  - `C:/FoundryTest/app/client/config.mjs` (`CONFIG.ui`, `sidebarIcon`, `ChatMessage.modes`)
  - `C:/FoundryTest/app/common/constants.mjs` (`FOLDER_MAX_DEPTH`, `COMPENDIUM_DOCUMENT_TYPES`)
  - `C:/FoundryTest/app/templates/sidebar/` (tabs.hbs, directory/_.hbs, partials/_.hbs,
    tabs/settings.hbs, tabs/compendiums.hbs, tabs/chat/_.hbs, tabs/playlist/_.hbs,
    tabs/placeable/\*.hbs, compendium-create.hbs, document-create.html, cards-create.html,
    apps/invitation-links.hbs)
  - `C:/FoundryTest/app/templates/sheets/folder-config.hbs`
  - `C:/FoundryTest/app/public/lang/en.json`
  - `C:/FoundryTest/data/Data/systems/dnd5e/dnd5e.mjs`, `system.json`, `lang/en.json`,
    `templates/apps/document-create.hbs`
- Official KB: https://foundryvtt.com/article/folders/, https://foundryvtt.com/article/actors/,
  https://foundryvtt.com/article/items/, https://foundryvtt.com/article/journal/,
  https://foundryvtt.com/article/roll-tables/, https://foundryvtt.com/article/cards/,
  https://foundryvtt.com/article/macros/, https://foundryvtt.com/article/playlists/,
  https://foundryvtt.com/article/compendium/, https://foundryvtt.com/article/scenes/,
  https://foundryvtt.com/article/settings/ (written for 13.351)
- API v14: https://foundryvtt.com/api/v14/classes/foundry.applications.sidebar.Sidebar.html,
  https://foundryvtt.com/api/v14/classes/foundry.applications.sidebar.DocumentDirectory.html,
  https://foundryvtt.com/api/v14/classes/foundry.applications.sidebar.tabs.CompendiumDirectory.html,
  https://foundryvtt.com/api/classes/foundry.applications.sidebar.tabs.Settings.html
- dnd5e: https://github.com/foundryvtt/dnd5e/wiki/Compendium-Browser
- Leads only (v13 behaviour notes): https://foundryvtt.com/releases/13.339,
  https://foundryvtt.com/packages/classic-ui
- Repo context: `.claude/skills/foundry-test-env/SKILL.md` (test world, users, shutdown rule)
