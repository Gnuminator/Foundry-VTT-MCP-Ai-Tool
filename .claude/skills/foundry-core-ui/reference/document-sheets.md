# Core Document Sheets and Config Windows

> Status: DRAFT from documentation and the local v14 source; not yet verified on the running client.

Scope: v14 core sheets and configuration windows that are not actor/item system sheets: the
**Actor**/**Item** core frame (window controls only; dnd5e's own tabs and fields are in
`dnd5e-actor-sheets.md`), **Journal Entry** sheet and its page editor, **Scene Configuration**,
**Token Configuration** / **Prototype Token**, **Roll Table** sheet, **Playlist** / **Playlist
Sound** config, the **Compendium** pack window and pack configuration, **Macro** config, **Cards**
/ **Card** config, **Folder** config, **Sheet Configuration**, and the window header buttons shared
by document sheets (Configure Sheet, Prototype Token, Copy UUID/ID, Import).

Conventions:

- **Bold** text is the exact English label from `C:/FoundryTest/app/public/lang/en.json`, read via
  its dotted key (e.g. `SCENE.TABS.SHEET.basics`).
- "GM" means `game.user.isGM`. Most sheets require at least Owner permission on the document to
  edit (`editPermission`, usually `OWNER`); Observer can view read-only.
- All of these are ApplicationV2 sheets (`HandlebarsApplicationMixin(DocumentSheetV2)` or similar):
  they auto-save per field in some cases (`form.submitOnChange: true`, e.g. the Journal Entry
  frame) and only on an explicit save button in others (`form.closeOnSubmit: true` with a footer
  **Save**/**Update** button, e.g. Scene/Token/Playlist/Macro/Cards config). Check each entry below.
- Related pages: `configuration-menus.md` (Settings sidebar and its windows), `sidebar-tabs.md`
  (directories that list and create these documents), `dnd5e-actor-sheets.md` (Actor/Item content).

## How to reach it

- Every entry here opens from a sidebar directory tab (Journal, Scenes, Actors, Items, Tables,
  Playlists, Compendium packs, Macro hotbar/directory, Cards, Folders) or from a placeable on the
  canvas: double-click (or single-click a name in a directory) opens the document's own sheet;
  right-click opens a context menu with **Edit**, **Configure Ownership**, **Duplicate**,
  **Delete**, and per-type extras (below). [unverified]
- **Configure Sheet** / **Prototype Token** / **Copy UUID** / **Import** are not separate menu
  items — they live in the sheet's own window header (title bar icon buttons, or a dropdown behind
  the header's "Toggle Controls" gear/ellipsis button). See "Window header buttons". [unverified]
- Scene/Token/Grid config can also open from the canvas: right-click the scene tab in Navigation,
  or right-click a placed token and choose **Configure Token** (`fa-solid fa-cog` in the token HUD)
  or double-click it. [unverified]
- Sources: `C:/FoundryTest/app/client/applications/api/document-sheet.mjs`,
  `C:/FoundryTest/app/client/applications/api/application.mjs`, https://foundryvtt.com/kb/

## Actor and Item core frame

- Both `ActorSheetV2` and `ItemSheetV2` (`C:/FoundryTest/app/client/applications/sheets/{actor,item}-sheet.mjs`)
  are thin ApplicationV2 base classes; dnd5e supplies the actual tabs/fields (`dnd5e-actor-sheets.md`).
- **Configure Token** — Actor sheet header control (title-bar dropdown), icon person-circle,
  label `DOCUMENT.Token` = "Token". Only shown when the actor sheet is editable **and** the actor
  is a synthetic token-actor (`actor.isToken`). Opens **Token Configuration** for that placed
  Token. GM/Owner. Reversible (a document update). [unverified]
- **Prototype Token** — Actor sheet header control, icon filled person-circle, label
  `TOKEN.TitlePrototype` = "Prototype Token". Shown when the sheet is editable and the actor is
  **not** a token-actor (i.e. normal world/compendium actor). Opens **Prototype Token Config** for
  `actor.prototypeToken`, positioned to the left of the actor sheet. GM/Owner. Reversible.
  [unverified]
- **Show Portrait Artwork** / **Show Token Artwork** — Actor sheet header controls, icon image;
  labels `SIDEBAR.CharArt` / `SIDEBAR.TokenArt`. Hidden when the portrait/token image is still the
  default silhouette. Opens an `ImagePopout` (read-only, closable, no side effects). GM/Owner.
  [unverified]
- Item sheet adds no extra header controls beyond the shared document-sheet ones (below).
  [unverified]
- Both sheets support drag-and-drop of Active Effects (Item) and Items/Effects/Folders (Actor);
  dropping is blocked when `!isEditable`. [unverified]
- Sources: `C:/FoundryTest/app/client/applications/sheets/{actor,item}-sheet.mjs`,
  https://foundryvtt.com/article/actors/, https://foundryvtt.com/article/items/

## Journal Entry sheet

`JournalEntrySheet` (classes `journal-sheet journal-entry`; default 960x800, resizable; the whole
frame auto-saves, `form.submitOnChange: true`). Two-column layout: a **sidebar** (table of
contents) on the left and the **pages** viewport on the right.

- **Table of Contents (sidebar)** — reached by opening any Journal Entry. Lists every page (and,
  if the entry has categories, groups pages under category headings) with a small ownership icon
  (`fa-eye-slash`/`fa-eye`/`fa-feather-pointed` for None/Observer/Owner). Clicking an entry scrolls
  to that page (`JOURNAL.NavLabel`). Drag-and-drop reorders pages (blocked while locked). GM sees
  all pages; players see only pages they can view. [unverified]
- **Single Page Mode** / **Multiple Page Mode** — toggle button in the sidebar header
  (`JOURNAL.ModeSingle` / `ModeMultiple`, icons `fa-note`/`fa-notes`). Single shows one page at a
  time with **Previous Page** / **Next Page** arrows; Multiple renders all pages in a scrollable
  column. Client-side view state only (no document write). Anyone with sheet access. [unverified]
- **Collapse Sidebar** / **Expand Sidebar** — `JOURNAL.ViewCollapse`/`ViewExpand`, caret icon;
  animates the sidebar width to 0. Purely visual, per-viewer. [unverified]
- **Lock/unlock table of contents** — icon+tooltip toggle (`JOURNAL.LockModeLocked` = "Table of
  contents locked. Click to unlock." / `LockModeUnlocked`); stored as the `core.locked` flag on the
  entry. While locked, pages cannot be drag-reordered. GM/Owner. Reversible (click again).
  [unverified]
- **Search** (magnifier icon in the sidebar) — two modes toggled by an icon next to the box:
  **Name** (`SIDEBAR.SearchModeName`) or **Full Text** (`SearchModeFull`, searches page content).
  Filters the visible ToC entries live; does not modify data. [unverified]
- **Add Page** — button labelled `JOURNAL.AddPage` at the bottom of the sidebar (visible only when
  editable). Opens a small creation dialog (name, type dropdown, category dropdown if the entry has
  categories) rather than the full page sheet; on submit it creates a `JournalEntryPage` and opens
  its editor. GM/Owner. Reversible (delete the created page). [unverified]
- **Page types** — Text (`text`, ProseMirror by default; Markdown/CodeMirror/HTML/plain "hbs"
  variants exist as separate sheet classes for the same `text` schema), **Image** (`image`),
  **PDF** (`pdf`), **Video** (`video`). Each has its own sheet class under
  `applications/sheets/journal/journal-entry-page-*-sheet.mjs`, all sharing the abstract
  `JournalEntryPageSheet` (`mode: "edit"|"view"`, 600x680 window when popped out standalone).
  [unverified]
- **Page context menu** (right-click a ToC entry): **Edit** (`SIDEBAR.Edit`, pencil) opens that
  page's editable sheet inline; **Configure Ownership** (`OWNERSHIP.Configure`, GM only) opens
  `DocumentOwnershipConfig` for that one page; **Show Players** (`JOURNAL.ActionShow`, only if you
  own the page) opens the "who to show" dialog (`Journal.showDialog`); **Jump to Pin**
  (`SIDEBAR.JumpPin`, only if the page has a linked scene note) pans the canvas to it; **Delete**
  (`SIDEBAR.Delete`, permanent, confirmation dialog); **Duplicate** (`SIDEBAR.Duplicate`, creates a
  "Copy of ..." page). GM sees all six; a player-Owner sees Edit/Show/Jump/Delete/Duplicate as
  permitted. [unverified]
- **Show Players** (window header control, `fa-eye`, GM only) — same "who to show" dialog for the
  whole Journal Entry rather than a single page. [unverified]
- **Configure Categories** (window header control, `fa-solid fa-chart-tree-map`, shown when
  editable) — opens **{Entry} Categories** (`JournalEntryCategoryConfig`, 480px wide,
  `submitOnChange: true`). Lists each category with an inline name field and **sort up/down**
  arrows (drag order is written on every keystroke/click), plus an **Add Page Category** button
  (`+` icon) and a per-row delete (trash) icon. Categories are their own embedded documents;
  deleting one un-categorizes its pages rather than deleting them. GM/Owner. Reversible per field.
  [unverified]
- **The page editor / "Save Entry"** — text-family pages (text/markdown/codemirror/html) render a
  footer with a feather-pen **Save Entry** button (`JOURNAL.Submit`) when opened for editing
  (double-click content, or the pencil **Edit Page** button that appears on hover in view mode).
  Other footer/field labels: `JOURNALENTRYPAGE.FIELDS.name.label` = "Page Name",
  `...category.label` = "Page Category", `...title.level.label` = "Heading Level",
  `...title.show.label` = "Display Page Title", `...text.format.label` = "Format". Image pages add
  `FIELDS.image.caption.label` = "Image Caption", `ShowImageOnly`/`ShowImageCaption`; Video pages
  add `VideoDimensions`, `VideoStartTime`, `FIELDS.video.autoplay/controls/loop/volume`. PDF pages
  add `PDFLoad` = "Load PDF". [unverified]
- Sources: `C:/FoundryTest/app/client/applications/sheets/journal/*.mjs`,
  `C:/FoundryTest/app/templates/journal/**`, `C:/FoundryTest/app/public/lang/en.json` (`JOURNAL.*`,
  `JOURNALENTRYPAGE.*`), https://foundryvtt.com/article/journal/ (describes an older 4-type,
  single-column layout without categories — v14 adds the category grouping and the lock/search
  toggles seen above; follow the source)

## Scene Configuration

`SceneConfig` (class `scene-config`, 600px wide, `closeOnSubmit: true`). Footer (shown on every
tab): **Reset to Default Options** (`SCENE.Environment.Reset`, resets the environment/lighting
fields only) and **Save Changes** (`SETTINGS.Save`, submit). Six tabs (`SCENE.TABS.SHEET.*`), not
the four an older KB article describes — v14 split lighting into **Visibility**/**Environment** and
added the whole **Levels** tab (see note below).

| Tab (bold = exact label) | Key fields / controls                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Basics**               | Scene Name, **Show in Navigation** + **Permissions** (GM Only/All Players), Navigation Name, background image + color, grid size/type shortcut, Darkness Level, Weather Effect.                                                                                                                                                                                                                       |
| **Grid**                 | Grid Type (Gridless/Square/4 hex variants), Grid Size (px) with **Grid Configuration Tool** (drag-adjust via mousewheel/arrow keys), Distance + Units, Style + Thickness + Color + Opacity, Scene Dimensions (Width/Height, link/unlink toggle), Padding Percentage, X-/Y-Shift.                                                                                                                      |
| **Levels**               | New core feature (not a module): a scene can have multiple vertical **Levels**, each with its own background/foreground texture and an elevation range. **Add Level** (`+`), per-level **Edit Level** (pencil) / **Delete Level** (trash, disabled if only one level), **Initial View Position** (X/Y/Zoom + **Capture Current View**), **Initial Level** selector (only shown once >1 level exists). |
| **Visibility**           | **Token Vision** toggle, Fog of War **Exploration Mode** (None/Individual/Shared), Unexplored Image, Explored/Unexplored colors, **Global Illumination** enabled + darkness threshold.                                                                                                                                                                                                                |
| **Environment**          | Base Environment (Luminosity/Saturation/Shadows/Hue/Hue Intensity sliders), Darkness Level + **Darkness Level Lock**, Darkness Environment (**Blend Ambience** toggle + its own Luminosity/Saturation/Shadows/Hue/Intensity).                                                                                                                                                                         |
| **Miscellaneous**        | Linked **Journal Entry** + **Journal Entry Page**, **Scene Playlist** + **Playlist Sound**, **Transition Type** dropdown with a play (preview) button, Duration, **Active Only** toggle.                                                                                                                                                                                                              |

- Levels sub-editor: clicking **Edit Level** (or the info icon next to an inherited field on
  Basics) opens a per-level fieldset with `SCENE_LEVEL.FIELDS.*` — Background/Foreground
  texture+color+tint+alpha threshold, Elevation Range (Background/Foreground Elevation),
  positioning (Anchor/Offset/Scale/Rotation/Fit Mode), per-level Fog unexplored image, and
  **Visible Levels** (which other levels show through). GM only. Reversible per field; deleting the
  only remaining level is blocked (`SCENE_LEVEL.CannotDeleteOnlyLevel`). [unverified]
- Changing Width/Height on a scene that already has placed objects prompts **Change Scene
  Dimensions?** / **Distorted Scene Dimensions** confirmation dialogs before repositioning objects.
  [unverified]
- GM only to open (edit permission on Scene defaults to GM); reversible via re-editing except
  destructive dimension changes, which can shift already-placed tokens/walls. [unverified]
- Sources: `C:/FoundryTest/app/client/applications/sheets/scene-config.mjs`,
  `C:/FoundryTest/app/templates/scene/config/*.hbs`, `en.json` (`SCENE.*`, `SCENE_LEVEL.*`),
  https://foundryvtt.com/article/scenes/ (documents the pre-Levels 4-tab layout — v14 differs, use
  the source)

## Token Configuration / Prototype Token

Same UI (`TokenApplicationMixin`) backs two windows: **Token Configuration** (`TokenConfig`, for a
placed Token instance; title = the token's/actor's name) and **Prototype Token Config**
(`PrototypeTokenConfig`, title `"Prototype Token: {actor name}"`, for `actor.prototypeToken`, the
template new tokens are stamped from). 560px wide, `closeOnSubmit: true`. Five tabs
(`TOKEN.TABS.*`):

| Tab            | Key fields                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Identity**   | Token Name, Display Name (visibility level), Represented Actor / **Link Actor Data**, position fields (Token config only), Elevation, Rotation + **Lock Artwork Rotation**, Token Disposition (Hostile/Neutral/Friendly/Secret), Movement Action.                                                                                                                                                                  |
| **Appearance** | Image Path (+ **Randomize Wildcard Images** on the prototype only, with an image-cycle preview button), X-/Y-/Z-Size, Shape (varies by grid type: square grids get Rectangle variants, gridless gets Ellipse/Rectangle), Scale/Mirror via the texture fields, Tint Color, Token Opacity, and the Dynamic Token Ring group (**Ring Enabled**, Ring/Background Color, Ring Effects, Subject Scale, Subject Texture). |
| **Vision**     | **Vision Enabled**, Vision Range, Vision Angle, Vision Mode, Vision Color, Attenuation, Vision Brightness, Saturation, Contrast; plus a Detection Modes list (**Override Detection Mode** / remove-mode actions) with per-mode range and enabled toggle.                                                                                                                                                           |
| **Light**      | Same field set as the Ambient Light placeable's config (radius, angle, color, animation, darkness activation range) — the token itself emits light.                                                                                                                                                                                                                                                                |
| **Resources**  | **Display Bars**, Bar 1/Bar 2 Attribute pickers (populate from the actor's `getBarAttribute`), plus the Turn Marker group (**Mode**: Default/Disabled/Custom, Animation, Media Source, **Disposition Tint** — Custom-mode fields disable unless Mode = Custom).                                                                                                                                                    |

- Editing a placed Token's position/size live-previews the change on the canvas before you save
  (`_previewChanges`); closing without saving reverts the preview. GM/Owner (`TOKEN_CONFIGURE`
  permission for Token config). Reversible. [unverified]
- Reached from: right-click a placed token > **Configure Token** (or the token HUD gear), the
  Actor sheet's **Configure Token** / **Prototype Token** header buttons (Actor and Item core
  frame, above), or double-clicking a token art thumbnail in some sheets. [unverified]
- Sources: `C:/FoundryTest/app/client/applications/sheets/token/{mixin,token-config,prototype-config}.mjs`,
  `C:/FoundryTest/app/templates/scene/token/*.hbs`, `en.json` (`TOKEN.*`),
  https://foundryvtt.com/article/tokens/ (tab names/fields match v14 closely; detection-mode list
  and dynamic ring group are newer additions worth confirming live)

## Roll Table sheet

`RollTableSheet` (720px, resizable). Genuinely two different layouts depending on mode:

- **View mode** (`TABLE.ACTIONS.ChangeMode.View`, default once a table has results) — a single
  read-only-ish part: description, formula, and the results list with a **Draw Result**
  (`TABLE.ACTIONS.DrawResult`, dice-d20 icon) button in the footer. Players with Observer
  permission can draw if the table allows draws with replacement. [unverified]
- **Edit mode** (`TABLE.ACTIONS.ChangeMode.Edit`) — adds tabs **Summary** (`TABLE.TABS.summary`:
  Table Description, Roll Formula placeholder, **Draw with Replacement**, **Display Roll Formula to
  Chat**) and **Results** (`TABLE.TABS.results`: the editable rows). Toggle between modes with the
  view/edit icon button (`changeMode` action) in the header. GM/Owner only for Edit. [unverified]
- **Results table** (Edit mode) — each row: image, name/UUID details (click **Open Result Config**
  to edit type/text/document link/weight/range in `TableResultConfig`), Weight, Range (two number
  inputs), a lock icon to toggle **Toggle Drawn Status**, and a delete icon
  (`TABLE.ACTIONS.DeleteResult`). Footer buttons: **Add New Result** (`createResult`),
  **Normalize Result Ranges** (`normalizeResults`, rebalances ranges to weights), **Reset Results**
  (clears all drawn flags), **Update Roll Table** (submit). [unverified]
- Dropping an Actor/Item/JournalEntry/etc. onto the sheet body creates a **Document**-type result
  from it automatically. [unverified]
- Drawing animates a "roulette" highlight through the rows before landing (client-side only, toggled
  by the world setting `core.animateRollTable`). [unverified]
- Reversible: individual result edits/deletes are normal document writes; **Reset Results** only
  clears the `drawn` flags, it does not undo a draw's chat message. [unverified]
- Sources: `C:/FoundryTest/app/client/applications/sheets/{roll-table-sheet,table-result-config}.mjs`,
  `C:/FoundryTest/app/templates/sheets/roll-table/**`, `en.json` (`TABLE.*`, `TABLE_RESULT.*`),
  https://foundryvtt.com/article/roll-tables/

## Playlist and Playlist Sound config

- **Playlist Configuration** (`PlaylistConfig`, 480px, `closeOnSubmit: true`, footer **Update
  Playlist**) — Playlist Name, **Playback Mode** (Soundboard Only/Sequential/Shuffle/Simultaneous),
  Audio Channel, **Sort Mode** (Alphabetical/Manual), Fade Duration (ms), Playlist Description.
  Reached via the Playlists directory's per-playlist gear/edit icon or right-click **Edit**. GM
  only (playlists are GM-authored). Reversible. [unverified]
- **Playlist Sound Configuration** (`PlaylistSoundConfig`, 480px, `canCreate: true`, footer
  **Create Sound** or **Update Sound** depending on whether the sound exists yet) — Track Name
  (auto-filled from the filename when you pick Audio Source), Audio Source (file picker or direct
  URL), Sound Volume, Repeat, Fade Duration (ms), Audio Channel, Sound Description. Reached via
  **Add Sound** in a playlist, or the pencil icon on an existing track. GM only. Reversible.
  [unverified]
- Both are plain single-part forms (no tabs). [unverified]
- Sources: `C:/FoundryTest/app/client/applications/sheets/playlist-{config,sound-config}.mjs`,
  `C:/FoundryTest/app/templates/sheets/playlist/*.hbs`, `en.json` (`PLAYLIST.*`,
  `PLAYLIST_SOUND.*`), https://foundryvtt.com/article/playlists/

## Compendium pack window and its configuration

- **Opening a pack** — clicking a compendium's name in the Compendium sidebar tab opens a popout
  **Compendium** window (`Compendium` extends the same directory class as Actors/Items/etc.):
  header with the pack's localized document-type title, a directory list of its contents, search,
  and (if unlocked and you have Owner) a create-entry control. A lock/lock-open icon in the window
  icon reflects `pack.locked`. [unverified]
- **Copy Compendium ID** — a header title-bar button (`fa-solid fa-passport`,
  `COMPENDIUM.CopyId`) that copies the pack's collection id (`system.pack-name` form) to the
  clipboard and toasts `COMPENDIUM.IdCopiedClipboard`. Anyone who can open the pack. [unverified]
- **Entry context menu** (right-click an item inside the pack): **Import Entry**
  (`COMPENDIUM.ImportEntry`, world documents only, copies it into the world), for Adventures
  **Export/Edit** (opens the Adventure Exporter), for Scenes **Generate Thumbnail Image**
  (`SCENE.GenerateThumb`), **Delete Entry** (GM, unlocked packs only). [unverified]
- **Pack configuration is not its own sheet window** — it is the compendium's right-click menu in
  the sidebar **directory** (not inside the open pack window): **Configure Ownership**
  (`OWNERSHIP.Configure`, GM only) opens a Dialog (`configureOwnershipDialog`, not an
  ApplicationV2 sheet) letting you set the Assistant GM / Trusted Player / Player ownership default
  for the whole pack; **Lock Edits** / **Unlock Edits** (`COMPENDIUM.ToggleLocked.*`) toggles
  `pack.locked`; **Import All Documents** (`COMPENDIUM.ImportAll.Option`) opens an import-all
  dialog; **Clear Folder** (only if the pack is inside a compendium folder); **Delete Compendium**
  (world packs only, GM, permanent); **Duplicate Compendium** (prompts for a new label, copies the
  whole pack). GM only for all of these. Lock/unlock and ownership are reversible; delete is not.
  [unverified]
- Sources: `C:/FoundryTest/app/client/applications/sidebar/apps/compendium.mjs`,
  `C:/FoundryTest/app/client/applications/sidebar/tabs/compendium-directory.mjs`,
  `C:/FoundryTest/app/client/documents/collections/compendium-collection.mjs`, `en.json`
  (`COMPENDIUM.*`), https://foundryvtt.com/article/compendium/

## Macro config

`MacroConfig` (720x600, resizable, `canCreate: true`). Single form, no tabs. Fields: Name, Image,
**Macro Type** dropdown (`chat`/`script`), a CodeMirror **Command** editor whose language switches
HTML/JavaScript with the type. Footer: **Save Macro** (submit) and **Execute Macro**
(`execute` action, dice-d20 icon; disabled if the document can't yet be executed, e.g. a
script macro for a player without the `MACRO_SCRIPT` permission). Reached from the hotbar's
**Create Macro** slot, or right-click an existing macro > **Edit Macro** in the Macro Directory.
Script macros are GM-authoring-oriented (players need the `MACRO_SCRIPT` permission, set in
**Game Settings > Core > User Permissions**); chat macros anyone with Owner can run. Executing
saves first if there are pending edits; deleting a macro (`MACRO.Delete`, permanent) is separate,
via the directory context menu. [unverified]
Sources: `C:/FoundryTest/app/client/applications/sheets/macro-config.mjs`,
`C:/FoundryTest/app/templates/sheets/macro-config.hbs`, `en.json` (`MACRO.*`),
https://foundryvtt.com/article/macros/

## Cards config and Card config

Three sheet subclasses share one base (`CardsConfig`; 720px wide; view permission Observer),
picked automatically by the stack's `type`:

- **CardDeckConfig** ("deck" stacks) — the only one with tabs (`CARDS.TABS.*`): **Details**
  (Card Stack **Type**, Default Back Image, Description) and **Cards** (initial tab; each row: face
  image, name, type, suit, value, a **Drawn** checkbox (read-only), **Next Face**/**Previous Face**
  carets, **Edit Card**/**Delete Card** icons, plus a header **Create Card** `+` and a **Toggle Sort
  Mode** icon — `CARDS.ACTIONS.ToggleSortMode`, standard vs. shuffled order). Footer, left to
  right: **Shuffle**, **Deal** (opens a deal-to dialog), **Reset** (`CARDS.ACTIONS.Reset`, recalls
  every dealt card — confirmation dialog `CARDS.ResetConfirm`), **Save** (submit). [unverified]
- **CardHandConfig** / **CardPileConfig** ("hand"/"pile" stacks) — no tabs, just the card list
  (rows: face image, name, type/suit/value if `showFace`, Next/Previous Face, and a **Play Card**
  icon when editable) plus a **Toggle Sort Mode** icon on hands only. Footer: Hand adds **Draw**,
  **Pass**; Pile adds **Shuffle**, **Pass**; both keep the shared **Reset**/**Save**. Draw/Pass are
  disabled for a stack that lives inside a compendium. [unverified]
- All three: dragging a card within the list re-sorts it; dropping one from elsewhere passes it
  into this stack. GM/Owner to edit; Observer can view/play depending on world permissions.
  [unverified]
- **CardConfig** (a single embedded Card, opened via the row's **Edit Card** icon) — 480px, three
  tabs (`CARD.TABS.*`): **Details** (Suit, Value, Card Stack **Type**, Description), **Faces**
  (repeatable Face Name/Image/Text entries with **Add Face**/**Delete Face** — delete asks
  **Are you sure?** first), **Back** (Back Name/Image/Text). Footer **Save Card**. GM/Owner.
  Reversible except a confirmed face delete. [unverified]
- Sources: `C:/FoundryTest/app/client/applications/sheets/{cards-config,card-config}.mjs`,
  `C:/FoundryTest/app/templates/cards/**`, `en.json` (`CARDS.*`, `CARD.*`),
  https://foundryvtt.com/article/cards/

## Folder config

`FolderConfig` (480px, `closeOnSubmit: true`). Fields: Folder Name (falls back to a placeholder
default name if left blank on create), Folder Color, **Sorting Mode** (Alphabetical/Manual).
Footer button reads **Update Folder** for an existing folder or **Create Folder** for a new one.
Reached via a sidebar directory's **Create Folder** button or right-click **Edit Folder**. Renaming
live-updates the window's own title bar as you type. GM (folder creation/editing is GM-only in
most world directories; compendium folders need pack Owner). Reversible. Related directory actions
(not this window): **Export to Compendium**, **Create Rollable Table** from a folder's contents,
**Clear Folder** (unassigns compendium-only), **Delete All**/**Remove Folder** (permanent vs.
promote-contents-to-parent). [unverified]
Sources: `C:/FoundryTest/app/client/applications/sheets/folder-config.mjs`,
`C:/FoundryTest/app/templates/sheets/folder-config.hbs`, `en.json` (`FOLDER.*`),
https://foundryvtt.com/article/folders/

## Sheet Configuration

`DocumentSheetConfig` (id `sheet-config-{id}`, 500px, footer **Save Sheet Configuration**). Title
is `"{Document Type}: Sheet Configuration"`. Two fields: **Sheet** — a dropdown of every sheet
class registered for this document's type (each Document/Item/Actor sub-type can register more
than one, e.g. a system could add alternates) — and **Theme** — Light/Dark/whatever the chosen
sheet advertises via its `themes` option, disabled entirely if the sheet declares no theme support.
Hint text distinguishes **This Sheet** (only this document) from **Default Sheet** (GM-only,
changes the type-wide default from **Game Settings > Core > Default Document Sheets**). Reached
from the gear/"Toggle Controls" dropdown on almost any document sheet's header (see next section).
GM/Owner (visibility gated by `SheetRegistrationDescriptor.canConfigure`). Reversible.
[unverified]
Sources: `C:/FoundryTest/app/client/applications/apps/document-sheet-config.mjs`,
`C:/FoundryTest/app/templates/sheets/document-sheet-config.hbs`, `en.json` (`SHEETS.*`)

## Window header buttons (shared by document sheets)

Every `DocumentSheetV2` window header has, right to left: a **Toggle Controls** button (gear or
ellipsis, `APPLICATION.TOOLS.ToggleControls`) that opens a dropdown menu, plus individual icon
buttons placed directly in the title bar.

- **Toggle Controls dropdown** (`APPLICATION.TOOLS.ControlsMenu`) contains, when applicable:
  **Configure Sheet** (`SHEETS.ConfigureSheet`, gear icon — opens Sheet Configuration above, shown
  only if you can configure this document's sheet); **Configure Ownership**
  (`OWNERSHIP.Configure`, lock icon, GM/Owner — opens `DocumentOwnershipConfig` for per-user
  visibility of this one document); plus any sheet-specific extras merged in by subclasses (Actor
  sheets add **Token**/**Prototype Token**/**Show Portrait Artwork**/**Show Token Artwork**, listed
  under "Actor and Item core frame" above); the base ApplicationV2 also contributes **Detach
  Window** / **Re-attach Window** here when the host lets windows pop out. [unverified]
- **Copy Document UUID** — individual title-bar icon (`fa-solid fa-passport`,
  `APPLICATION.ACTIONS.CopyUuid`), shown once the document has an id; both left- and right-click
  copy the UUID to the clipboard. Read-only, no side effects. [unverified]
- **Import** — individual title-bar icon (`fa-solid fa-download`,
  `APPLICATION.ACTIONS.ImportDocument`), shown only when viewing a **world**-type document that
  currently lives **inside a compendium** and you can create that type; copies it into the world
  collection. GM/Owner. Reversible (delete the imported copy). [unverified]
- Compendium pack windows add **Copy Compendium ID** here too (see "Compendium pack window"
  above), and the standard window chrome (minimize, close) is separate from all of this.
  [unverified]
- Sources: `C:/FoundryTest/app/client/applications/api/{application,document-sheet}.mjs`, `en.json`
  (`APPLICATION.*`, `SHEETS.*`, `OWNERSHIP.*`)

## Driving it from automation

Read-only console snippets for the browser pane's `javascript_tool`. None change state.

Open sheet/config windows, by class name:

```js
[...foundry.applications.instances.values()]
  .filter(a => a.rendered)
  .map(a => ({ id: a.id, cls: a.constructor.name, title: a.title }));
```

Journal Entry view state and Scene Config's active tab (getters, not localized text — stable
across languages):

```js
const j = [...foundry.applications.instances.values()].find(
  a => a.document?.documentName === 'JournalEntry'
);
j && {
  mode: j.mode,
  isMultiple: j.isMultiple,
  locked: j.locked,
  sidebarExpanded: j.sidebarExpanded,
  pageId: j.pageId,
};

const sc = [...foundry.applications.instances.values()].find(
  a => a.constructor.name === 'SceneConfig'
);
sc && { tab: sc.tabGroups.sheet, sceneId: sc.document.id };
```

A document's registered sheet options (matches the Sheet Configuration dropdown):

```js
CONFIG.JournalEntry.sheetClasses.base;
CONFIG.Actor.sheetClasses.character; // typed documents key by sub-type
```

Compendium pack state (Lock/Unlock, Configure Ownership) and an Actor's header-control flags,
without opening any dialog:

```js
[...game.packs].map(p => ({
  id: p.collection,
  locked: p.locked,
  customOwnership: !!p.config.ownership,
}))({
  isToken: actor.isToken,
  canConfigureToken: actor.isOwner,
  protoTexture: actor.prototypeToken.texture.src,
});
```

Window header control **labels** are stable localization keys (`SHEETS.ConfigureSheet`,
`TOKEN.TitlePrototype`, `OWNERSHIP.Configure`, `APPLICATION.ACTIONS.CopyUuid`,
`APPLICATION.ACTIONS.ImportDocument`) — search the accessibility tree for those exact English
strings rather than icon glyphs or DOM order, which differ per sheet.

## Safety in the test world

- Scene/Token/Journal/Table/Playlist/Macro/Cards/Folder edits all write to the world database and
  are visible to every connected client immediately (or on save, for `closeOnSubmit` forms). Note
  the prior value before changing anything you plan to revert.
- **Change Scene Dimensions?** / **Distorted Scene Dimensions** — answering **Yes** can reposition
  every already-placed token/wall in that scene. Prefer **No** / cancel during a UI survey; only
  confirm on a disposable test scene.
- **Delete Compendium** (world packs only) and **Delete Entry**/**Delete Result**/**Delete
  Card**/**Delete Macro**/**Delete Folder** (with **Delete All**) are permanent. Never run these
  against anything other than scratch documents you created for the test.
- **Lock Edits** on a compendium blocks further writes to it (including by the bridge/MCP tools);
  remember to **Unlock Edits** again afterward if you toggle it.
- **Import All Documents** on a compendium and **Export to Compendium** from a folder both create
  many new world documents at once — clean up test-created copies afterward if the world should
  stay tidy.
- Never touch the live bridge ports (31414-31416) or `mcp__foundry-mcp__*` tools while doing this;
  use the `foundry-test-env` skill's test bridge (31514-31515) and the `ai-tool-test` world only.
- Reading a document's UUID (**Copy Document UUID**) and Compendium ID are safe, no-op reads.

## Verification checklist

Log in as `Claude` at `http://localhost:30001/game` (see the `foundry-test-env` skill).

1. Open any Journal Entry. Expect a two-column sheet with a table of contents sidebar and a page
   viewport; window ~960x800.
2. Click the sidebar's mode toggle. Expect it to switch between **Single Page Mode** and
   **Multiple Page Mode** (icon and tooltip change), with no document write.
3. Click **Add Page**. Expect a small dialog with Name/Type (and Category if any exist); cancel it.
4. Right-click a page in the table of contents. Expect **Edit**, **Configure Ownership**, **Show
   Players**, **Delete**, **Duplicate** (plus **Jump to Pin** if it has a scene note).
5. Click **Configure Categories** in the window header. Expect **{Entry} Categories** with an add
   button, per-row name field and sort arrows; close without changes.
6. Open a Scene's **Configure Sheet** equivalent (right-click a scene in Navigation or the Scenes
   directory > **Configure**). Expect six tabs: **Basics, Grid, Levels, Visibility, Environment,
   Miscellaneous**, and a footer with **Reset to Default Options** + **Save Changes**.
7. Click **Levels**. Expect an **Add Level** button and, with only one level, its delete icon
   disabled with tooltip "You cannot delete the only Level in this Scene." On **Grid**, click the
   ruler icon next to Grid Type and expect the **Grid Configuration Tool** to activate on canvas.
   Close without saving; confirm no document update fired (compare a field's value before/after).
8. Right-click a placed Token. Expect a **Configure Token** option opening **Token Configuration**
   with tabs **Identity, Appearance, Vision, Light, Resources**.
9. On an Actor sheet for a non-token actor, expect a **Prototype Token** header control; on a
   linked scene token's actor sheet, expect **Token** (Configure Token) instead.
10. Open a Roll Table with no results yet. Expect it to open directly in **Edit** mode with
    **Summary**/**Results** tabs. Add a result via **Add New Result**, add a second, then click
    **Normalize Result Ranges**: expect the two Range values to become contiguous and
    non-overlapping.
11. Switch that table to **View** mode. Expect the tab strip to disappear and a single **Draw
    Result** button to remain in the footer.
12. Open a Playlist's edit (gear) icon. Expect **Playlist Name**, **Playback Mode**, **Sort Mode**,
    Fade Duration, Description, footer **Update Playlist**.
13. Click **Add Sound** on a playlist. Expect **Playlist Sound Configuration** with footer
    **Create Sound** (not **Update Sound**) since it does not exist yet.
14. Open a Compendium pack from the sidebar. Expect a popout with a directory list and a title-bar
    **Copy Compendium ID** icon. Right-click that same pack in the sidebar (not the popout):
    expect **Configure Ownership**, a Lock/Unlock toggle, **Import All Documents**, **Delete
    Compendium** (world packs only), **Duplicate Compendium**.
15. Open a Macro (or create one). Expect **Macro Type** (chat/script), a code editor whose
    language switches with the type, footer **Save Macro** / **Execute Macro**.
16. Open a Cards **deck**. Expect tabs **Details**/**Cards**, a sort-mode toggle icon, footer
    **Shuffle**, **Deal**, **Reset**, **Save**. Open a **hand** or **pile** instead: expect no tabs
    and footer **Draw**+**Pass** (hand) or **Shuffle**+**Pass** (pile) plus **Reset**/**Save**.
17. Open (or create) a Card inside that stack. Expect tabs **Details, Faces, Back** and an **Add
    Face** button on the Faces tab.
18. Right-click a directory and choose **Create Folder**, or edit an existing one. Expect
    **Folder Name**, **Folder Color**, **Sorting Mode**, and the title bar updating live as you type.
19. On any open document sheet, click the header's **Toggle Controls** button. Expect a dropdown
    with at least **Configure Sheet** and (if GM) **Configure Ownership**. Click **Configure
    Sheet**: expect **Sheet Configuration** with a **Sheet** dropdown and a **Theme** dropdown
    (disabled if the current sheet declares no themes).
20. Click the title-bar **Copy Document UUID** icon on any sheet. Expect a clipboard copy (no
    error/toast failure; optionally confirm via `navigator.clipboard.readText()`).
21. Open a document that lives in an unlocked world-type compendium. Expect an **Import** icon in
    the title bar; click it and confirm the document now also exists in the matching world
    directory.

## Sources

Local v14 install (ground truth, read-only):

- `C:/FoundryTest/app/client/applications/sheets/journal/*.mjs`
- `C:/FoundryTest/app/client/applications/sheets/{scene-config,roll-table-sheet,table-result-config,macro-config,folder-config,playlist-config,playlist-sound-config,cards-config,card-config,base-sheet,actor-sheet,item-sheet}.mjs`
- `C:/FoundryTest/app/client/applications/sheets/token/{mixin,token-config,prototype-config}.mjs`
- `C:/FoundryTest/app/client/applications/apps/{document-sheet-config,document-ownership}.mjs`
- `C:/FoundryTest/app/client/applications/api/{application,document-sheet}.mjs`
- `C:/FoundryTest/app/client/applications/sidebar/apps/compendium.mjs`
- `C:/FoundryTest/app/client/applications/sidebar/tabs/compendium-directory.mjs`
- `C:/FoundryTest/app/client/documents/collections/compendium-collection.mjs`
- `C:/FoundryTest/app/templates/journal/**`, `C:/FoundryTest/app/templates/scene/{config,token}/**`,
  `C:/FoundryTest/app/templates/sheets/**`, `C:/FoundryTest/app/templates/cards/**`,
  `C:/FoundryTest/app/templates/sidebar/apps/compendium/**`
- `C:/FoundryTest/app/public/lang/en.json`

Official knowledge base and API:

- https://foundryvtt.com/article/journal/ (older 4-type layout; v14 adds categories/lock/search)
- https://foundryvtt.com/article/scenes/ (older 4-tab layout; v14 has 6 tabs incl. Levels)
- https://foundryvtt.com/article/tokens/
- https://foundryvtt.com/article/roll-tables/
- https://foundryvtt.com/article/playlists/
- https://foundryvtt.com/article/compendium/
- https://foundryvtt.com/article/macros/
- https://foundryvtt.com/article/cards/
- https://foundryvtt.com/article/folders/
- https://foundryvtt.com/article/actors/
- https://foundryvtt.com/article/items/
- https://foundryvtt.com/api/ (ApplicationV2/DocumentSheetV2 class docs)

Community and system docs (leads only):

- https://foundryvtt.wiki/
- https://github.com/foundryvtt/dnd5e/wiki (dnd5e sheet content is in `dnd5e-actor-sheets.md`)

Repo context:

- `.claude/skills/foundry-test-env/SKILL.md`
- `.claude/skills/foundry-core-ui/reference/{sidebar-tabs,configuration-menus}.md`
