# Setup Screen and Package Installs

> Status: DRAFT from documentation and the local v14 source; not yet verified on the running client.

Scope: the `/setup` screen and `/auth` admin login — Game Worlds, Game Systems and Add-on Modules
tabs, the Install Package dialog, Backups & Snapshots, Application Configuration, Update Software,
the License Key and EULA screens, setup Tours, and where packages live on disk. Bold labels are
the exact English strings from `C:/FoundryTest/app/public/lang/en.json` unless noted. Every entry
ends `[unverified]` because this pass reads source and docs only; nothing here has been clicked in
a live browser yet.

Ground truth came from the real client bundle, not just the source tree: every application class
below lives in `C:/FoundryTest/app/public/scripts/foundry.mjs` (un-minified, ~220k lines) —
`SetupMenu` 212682, `SetupPackages` 210183, `WorldCreate` 211409, `ServerSettingsConfig` 211892,
`BackupManager` 212341, `BackupList` 209719, `CompatibilityChecker` 212908, `SetupUpdate` 213394,
`InstallPackage` 213943, `ModuleConfig` 209201, `EULA` 208812, and `Setup extends Game` (the `game`
global on these screens) at 215348. Server route handlers: `C:/FoundryTest/app/dist/server/views/
*.mjs`. Templates: `C:/FoundryTest/app/templates/setup/`. Foundry version confirmed locally: 14.368
(`Data/worlds/ai-tool-test/world.json`, `coreVersion`).

## How to reach it

| Screen | Route | Shown when |
|---|---|---|
| License Key / EULA | `/license` | `config.license.needsSignature` is true (unsigned/invalid license); every other route redirects here first |
| Admin Login | `/auth` | No World is running, an admin password is set, and this browser hasn't authenticated as admin |
| **Setup Configuration and Setup** | `/setup` | No World is running and this browser is admin-authenticated (or no admin password is set at all) |
| Create World | `/create` | Reached only via the **Create World** button on the Worlds tab |
| Application Update | `/update` | Reached only via the cloud icon in the Setup menu bar |
| Join | `/join` | A World is running and this session isn't logged in as a User (out of scope here, see `join-auth-users.md`) |
| Quit | `/quit` | After confirming **Shut Down** from the Setup menu bar |

- With no admin password configured, `/auth` is skipped entirely and `/setup` opens directly —
  this is likely the state of the local test world unless a password was set. Check by loading
  `/setup` directly. [unverified]
- From inside a running World, a Gamemaster reaches this territory via **Log Out** (→ `/join`) or
  **Return to Setup** (→ world shutdown, then `/setup`); both are documented in `join-auth-users.md`,
  not here. `templates/setup/parts/join-setup.hbs` is the "Return to Setup" confirmation form
  (posts `action=worldShutdown` to `/setup`). [unverified]
- Server-side, each route is its own `View` subclass in `dist/server/views/` (`AuthView`,
  `SetupView`, `CreateView`, `ApplicationUpdateView`, `JoinView`, `QuitView`) that redirects you
  through this chain based on `config.license.needsSignature`, `game.world`, and admin-session
  state — confirmed by reading those files directly (they are not minified). [unverified]

Sources: `C:/FoundryTest/app/dist/server/views/{setup,auth,create,update,quit}.mjs`,
`C:/FoundryTest/app/common/constants.mjs` (`SETUP_VIEWS`),
[KB: Installation](https://foundryvtt.com/article/installation/).

## Admin login (`/auth`)

- **Administrator Username** — text field `#auth-username`, shown only when an admin *username*
  (not just password) has been configured (`globalThis.ADMIN_USERNAME_REQUIRED`). Access: admin.
  Reversible: n/a (no write). [unverified]
- **Administrator Password** — password field `#auth-password`. Hint text repeats
  **SETUP.AdminPasswordPrompt** and links **SETUP.AdminCredentialsForgot** to
  `https://foundryvtt.com/article/reset-admin-password/`. Access: admin. Reversible: n/a.
  [unverified]
- **Log In** — submit button, `name="action" value="adminAuth"`, posts to `/auth`; on success the
  server sets an admin-authenticated session cookie and redirects to `/setup`. Reversible: yes
  (log out again). Automation gotcha: never type the real admin password from an automated
  session — see Safety below. [unverified]
- **Forgotten password**: per the KB, delete `admin.txt` from the `Config` subfolder of the data
  path (via "Browse User Data" on the desktop app, or manually) and relaunch; the next `/setup`
  visit lets you set a new one from **Configure**. [unverified]

Sources: `templates/setup/setup-authentication.hbs`, `foundry.mjs:212146` (`SetupAuthenticationForm`),
[KB: Reset Admin Password](https://foundryvtt.com/article/reset-admin-password/).

## Setup screen shell

Three independent `ApplicationV2` instances render into `<section id="setup">`
(`templates/views/setup.hbs`): `ui.setupMenu`, `ui.setupPackages`, `ui.setupSidebar` — all three
globals are set in `Setup#_setupView` (`foundry.mjs:215576-215588`) and are the right place to
start when scripting against this screen from the console.

- **Setup menu bar** (`#setup-menu`, class `SetupMenu`) — a floating row of icon buttons, rebuilt
  from `game.data` on every render, so buttons can disappear:
  - **Warnings** (`data-action="viewWarnings"`, always shown) — opens `SetupWarnings`
    (`#setup-warnings`) anchored under the icon, listing install/config errors per package with
    **Reinstall**/**Uninstall**/"manage" actions. A pip badge shows `game.issueCount.total`,
    colored red if any are errors. Access: admin. Reversible: uninstall/reinstall are as
    reversible as those actions generally are. [unverified]
  - **Configure** (`data-action="configure"`, always shown) — opens Application Configuration
    (below). Shows a `!` pip when no admin password is set yet. [unverified]
  - **Update** (`data-action="update"`, always shown) — navigates to `/update`. Shows a `!` pip
    when `game.data.coreUpdate.hasUpdate` is true on the testing/stable channel. [unverified]
  - **Manage Backups** (`data-action="backups"`, hidden entirely if the server was started with
    `noBackups`) — opens the Backup Manager (below). [unverified]
  - **Log Out** and **Shut Down** (`data-action="adminLogout"` / `"shutDown"`) — both are shown
    only `if (game.data.options.adminPassword)`, i.e. **with no admin password set, this row has
    no Log Out or Shut Down button at all**. Shut Down asks a confirm dialog, then `POST /quit`.
    [unverified]
- **Setup sidebar** (`#setup-sidebar`, class `SetupSidebar`) — two read-only panels fetched from
  foundryvtt.com: **Featured Content** (one item, `#featured-content`) and **News**
  (`#news-articles`, a scrollable list). Both show **No content recommendations were received…**
  when offline. Not interactive beyond following external links. GM/player: n/a (admin-only
  screen). Reversible: n/a. [unverified]
- **Setup Configuration Tabs** (aria-label on the primary tab nav, `SETUP.NavLabel`) — the
  Worlds / Systems / Modules tab strip, see next sections. [unverified]

Sources: `foundry.mjs:212682` (`SetupMenu`), `:212848` (`SetupSidebar`), `:212178` (`SetupWarnings`),
`templates/setup/parts/setup-menu.hbs`, `setup-warnings.hbs`, `setup-featured.hbs`, `setup-news.hbs`.

## Game Worlds tab

Header controls (`setup-packages-worlds.hbs`): a search field (placeholder
**Filter Worlds ({count})**), the **Create World** button, and three view-mode icon buttons
(Gallery / Tiles / Details, see below). Package rows render inside `#worlds-list`.

- **Create World** — button, `data-action="worldCreate"`. If no Game System is installed it
  refuses with a toast (**You must install a game System before you can create a new World**) and
  never navigates. Otherwise it does a full navigation to `/create` (its own page, class
  `WorldCreate`, id `world-create` — **not a dialog**). Access: admin. Reversible: the World isn't
  created until the form is submitted there. Automation: this is a page load, not a modal open —
  wait for navigation, don't poll for a dialog element. [unverified]
  - The `/create` page has its own system/adventure tile pickers (`templates/setup/create/systems.hbs`,
    `modules.hbs`) plus the same title/id/background/join-theme/next-session/description fields as
    World Configuration, with the data path shown as fixed prefix **Data/worlds/**. Submitting
    posts `action="createWorld"`; a **Cancel World Creation** button (data-action `cancel`) confirms
    then returns to `/setup`. [unverified]
- **View mode** buttons — `data-action="viewMode"`, `data-view-mode="GALLERY"|"TILES"|"DETAILS"`,
  localized **Gallery View** / **Tiles View** / **Details View**. The choice is per-tab and
  persisted in the `core.setupViewModes` client setting. Note: Tiles is the compact icon-grid, and
  Gallery is the larger-thumbnail grid — the opposite of what the names might suggest at a glance;
  confirm this against the running client. [unverified]
- Each world entry (`.package.world[data-package-id]`) shows a favorite star, a lock icon, a
  system badge, and (per `package-tags.hbs`) URL/author/compendium/version/verified tags. A
  **Launch** control (circle-play icon, `data-action="worldLaunch"`) appears only if the world is
  playable. Right-click opens a context menu built live by `SetupPackages#_setContextMenuItems`
  (`foundry.mjs:210625`):
  - **Launch World** (not shown if locked or unavailable) — starts the launch flow below.
  - **World Configuration** (`SETUP.WorldEdit`, not shown if locked) — opens `WorldConfig`
    (`#world-config`) pre-filled with the world's title/id/system (id and system are read-only once
    created)/background/join theme/next session/**Reset User Passwords**/**Launch in Safe
    Configuration** (disables modules, deactivates scenes, stops audio)/description. Submits
    `action="editWorld"`. Access: this same app is also reachable from inside a running World by
    its own GM (`ui.setupPackages.render()` is only called back if `game.view === "setup"`), and
    the server only accepts an in-world edit from a User with the **Gamemaster** role specifically.
    [unverified]
  - **Mark Favorite** / **Remove Favorite** — toggles a client setting, purely cosmetic sort/pin.
    Reversible: yes. [unverified]
  - **Lock {type}** / **Unlock {type}** — `PACKAGE.Lock`/`Unlock`, posts `action="lockPackage"`. A
    locked World can't be launched, edited, updated or uninstalled until unlocked. Reversible: yes.
    [unverified]
  - **Delete World** (`SETUP.WorldDelete`) — posts `action="uninstallPackage"`. Per the KB, deletion
    asks you to type the world's title into a confirm code box; **this cannot be undone.**
    Reversible: **no** — take a backup first. [unverified]
  - (unless backups are disabled) **Take Backup**, **Restore Latest Backup** (only if a backup
    already exists), **Manage Backups** — see the Backups section. [unverified]
- **Launching a World** (`SetupPackages#launchWorld`, `foundry.mjs:210827`): refuses if locked
  (**PACKAGE.LaunchLocked**). If the World's stamped `coreVersion`/`systemVersion` is older than
  what's installed, it shows a migration-warning dialog (**World Data Migration**) explaining core
  and/or system migration is about to happen, recommends **Create a backup before migrating?**,
  and requires **Begin Migration** — **this step is not reversible without a backup.** It then
  shows a live progress bar over a websocket and finally navigates to `/game`. Automation gotcha:
  a scripted "Launch" click can silently trigger a real, irreversible world-data migration if the
  installed core/system generation moved forward since the world last ran — check `world.coreVersion`
  first. [unverified]

Sources: `templates/setup/setup-packages-worlds.hbs`, `templates/sidebar/apps/world-config.hbs`,
`templates/setup/create/*.hbs`, `foundry.mjs:210183-211409` (`SetupPackages`, `WorldCreate`),
`foundry.mjs:210630-211409` (`WorldConfig` import & context menu),
[KB: Game Worlds](https://foundryvtt.com/article/game-worlds/).

## Game Systems and Add-on Modules tabs

Structurally identical to Worlds (search field, view-mode buttons, `.package` rows in
`#systems-list` / `#modules-list`, the same context-menu builder), with these differences:

- **Install System** / **Install Module** — button, `data-action="installPackage"`, calls
  `game.browsePackages(type)` which opens the Install Package dialog (below) filtered to that
  package type. Access: admin. Reversible: nothing happens until you actually install something.
  [unverified]
- **Update All** — button, `data-action="updateAll"`, disabled while an update-all run for another
  tab is already in progress (**An "update all" workflow is already in progress…**). Runs each
  unlocked package's update check and installs if newer, showing per-package spinners; if an
  update would make an installed package incompatible with a currently-installed System it prompts
  **This module update is incompatible with the following installed systems, do you want to
  continue?**. Reversible: no built-in rollback beyond restoring a backup. [unverified]
- **Create Module** — Add-on Modules tab only, gear-code icon button
  (`id="moduleCreate"`, `data-action="moduleCreate"`, tooltip **PACKAGE.ModuleCreate**). Opens
  `ModuleConfig` (`#module-config`), a 4-tab form (**Basic Details**, **Authors**, **Compendium
  Packs**, **Relationships**) for hand-authoring a module manifest — this scaffolds a new folder
  under `Data/modules/`, it does not install from a repository. Access: admin. Reversible: the
  module exists once you submit; deleting it afterwards is the normal Uninstall flow. [unverified]
- Per-entry: a per-package **update** control (rotate icon, `data-action="updatePackage"`, hidden
  if locked) alongside the same favorite/lock/tags as Worlds. The context menu adds **Edit Module**
  (Modules only, `PACKAGE.ModuleEdit`, opens the same `ModuleConfig` pre-filled) but has **no Edit
  option for Systems** — a System's manifest can only be changed by reinstalling it. Delete for
  both types is labeled **Uninstall**, not **Delete**. [unverified]
- Systems have no "Create System" button — only **Install System** and **Update All**.
  [unverified]

Sources: `templates/setup/setup-packages-systems.hbs`, `setup-packages-modules.hbs`,
`templates/setup/module-config/*.hbs`, `foundry.mjs:209201` (`ModuleConfig`),
[KB: Module Management](https://foundryvtt.com/article/modules/).

## Install Package dialog

Opened by **Install System** / **Install Module** / **Install World** or a failed search's
**Search Installable Packages** link; class `InstallPackage`, id `#install-package`
(`foundry.mjs:213943`). Layout: a left category rail, a top filter bar, and a scrolling result
list that loads in **batches of 50** via an `IntersectionObserver` — automation that reads the DOM
once and stops will miss anything past the first batch; scroll or wait for more `.package` nodes.

- **Search** field (`aria-label` **Filter**, key `PACKAGECONFIG.Filter`) plus, for systems/worlds
  that declare one, a **Providers** filter and a **Systems** filter (**Available for Installed
  Systems** / **No Restriction** / **Requires Specific System**). [unverified]
- Left rail: one button per category (`data-action="toggleCategory"`) with a live match **count**
  badge — categories come from `PACKAGE.TAGS` (Automation Enhancers, Combat Enhancements, Dice
  Rolling, etc.) plus author/provider groupings. Filter chips add **filterVisibility**
  (all/owned/installed/compatible). [unverified]
- Each result row (`.package[data-package-id]`): title, one-line description, a **Manifest URL**
  view-page link, tags for author/version/system/**Verified <n>** badge, and a right-hand control
  that is one of: **Installed** (disabled, check icon), **Install** (`data-action="installPackage"`,
  download icon), or a disabled lock icon with a tooltip explaining why (ownership/compatibility).
  Clicking the package label (`data-action="setManifestUrl"`) copies its manifest URL into the
  footer field instead of installing immediately. [unverified]
- Footer: **Manifest URL** text input + **Install** button (`data-action="installUrl"`) — installs
  directly from any manifest JSON URL, the mechanism third-party (non-listed) packages use. Access:
  admin. [unverified]
- If a manifest is for the wrong package type or fails a compatibility check, a **Compatibility
  Warning** dialog interrupts (**…is not compatible with the current version of Foundry Virtual
  Tabletop. Are you sure you wish to proceed with the installation?**) before continuing.
  [unverified]
- Installing a package with required dependencies prompts **Install Package Dependencies**, listing
  required vs. optional dependencies with **Install Dependency Automatically** /
  **Install Dependency Manually** choices; declining leaves a note that they must be installed by
  hand. Reversible: uninstall the package (and its auto-installed dependencies stay behind unless
  removed separately). [unverified]
- The built-in "Simple Worldbuilding" system's package id is literally `worldbuilding`
  (confirmed from the Installing-a-System tour's step selector
  `.package[data-package-id=worldbuilding]`), useful as a stable, always-installable test target.
  [unverified]

Sources: `templates/setup/install-package/*.hbs`, `foundry.mjs:213943-214917` (`InstallPackage`),
`public/tours/installing-a-system.json`, [KB: Module Management](https://foundryvtt.com/article/modules/).

## Backups and snapshots (v12+)

Two entry points, both gated off entirely if the server runs with `noBackups`: the **Manage
Backups** icon in the setup menu bar (`BackupManager`, id `#backup-manager`), and, per package, a
**Manage Backups**/**Take Backup**/**Restore Latest Backup** trio from that package's context menu
(`BackupList`, id `backup-list-<type>-<id>`).

- **Manage Backups** — a `CategoryBrowser` with four categories in this fixed order: **Snapshots**,
  **Worlds**, **Modules**, **Systems** (`SETUP.BACKUPS.TYPE.*`). A titlebar button
  **Create a Snapshot** is added dynamically and hidden if there are zero installed packages to
  snapshot. [unverified]
  - Per-package rows (Worlds/Modules/Systems categories): **Manage** (opens that package's
    `BackupList`), **Take Backup** (only if the package is still installed), **Restore Latest** —
    disabled with tooltip **This backup cannot be restored as it would render the package
    unusable** if the newest backup fails a compatibility check. [unverified]
  - **Snapshots** category: checkboxes + **Select All** + **Delete Selected**; each snapshot tags
    its originating core version, colored safe/warning/error depending on whether it's older,
    same, or (impossible to restore) newer than the running core generation; a **Restore** button
    per row. [unverified]
  - **Create a Snapshot** — confirms a package list, checks disk space first (warns
    **Insufficient Space** if it won't fit), then snapshots every installed World/System/Module in
    one operation. Per the KB, **snapshots only capture package-directory contents**, not assets
    stored elsewhere. Reversible: no — restoring one overwrites every package it touches.
    [unverified]
  - **Restore Snapshot** — explicit warning: **All versions and world states will be rolled back.
    This process cannot be undone.** Packages installed after the snapshot are left untouched.
    [unverified]
- Individual `BackupList` dialog: date-stamped backups for one package, a **Restore** button, and
  (unless every backup is snapshot-only) bulk select + **Delete Selected**. [unverified]
- Automation-relevant `game` methods: `listBackups()`, `createBackup(pkg, {dialog:true})`,
  `restoreLatestBackup(pkg, {dialog})`, `createSnapshot({dialog:true})`,
  `deleteSnapshots(ids, {dialog:true})`, `restoreSnapshot(data, {dialog:true})`, cached on
  `game.backupsCache`. All are destructive server-side writes — never call them "just to check".
  [unverified]

Sources: `templates/setup/backup-manager/*.hbs`, `backup-list.hbs`,
`foundry.mjs:209719` (`BackupList`), `:212341` (`BackupManager`),
[KB: Backups](https://foundryvtt.com/article/backups/).

## Application Configuration

Opened from the **Configure** gear icon; class `ServerSettingsConfig`, id
`#server-settings-config`. All changes require **Save Configuration**, which asks a confirm dialog
(**Modifying these configuration options will require you to restart your server…**) before
POSTing `action="adminConfigure"`; the response's `restart:true` triggers a persistent
notification telling you to restart. **cssTheme changes preview live** (the body's theme class
swaps as you pick a value) and are reverted on close if not saved.

- **Foundry VTT Configuration**: **Administrator Username** / **Administrator Password** (a plain
  input until a password exists, then a **Change Password** button that verifies the old password
  first, then lets you overwrite it before **Save Configuration**); **User Data Path** (relocates
  `Data/{worlds,systems,modules}` and `Config/`, requires restart); **Setup Theme** — **Foundry
  Virtual Tabletop** (`dark`, default), **Classic Fantasy** (`fantasy`), **Science Fiction**
  (`scifi`); **Default World**, **Default Language**. [unverified]
- **Server Configuration**: **Port** (default **30000**, must be 80/443/1024–65535) + inline
  **Enable UPnP**; **Unix Socket**; **Compress Static Files**/**Compress Web Socket Data**; **SSL
  Certificate**/**Key** paths (the class wires a `configureSSL` "generate self-signed cert" action,
  but the current `.hbs` shows no button for it — re-check live); **AWS Configuration Path**.
  [unverified]
- **Electron Application**: **Full-Screen Mode** (desktop build only). **Other Settings**: **Allow
  Sharing Usage Data** (also prompted once on first load), **Delete Migrated NEDB Files**,
  **Hot-Reload Package Files** (dev-only). [unverified]
- Not in this form at all (options.json/CLI-only): `hostname`, `routePrefix`, `proxyPort`,
  `proxySSL`; CLI flags include `--port`, `--world`, `--dataPath`, `--noupnp`, `--adminPassword`.
  [unverified]
- Access: admin only. Reversible: yes, but a bad **Port** or **Data Path** can make the server
  unreachable until fixed by hand-editing `options.json`. [unverified]

Sources: `templates/setup/server-settings-config.hbs`, `foundry.mjs:211892` (`ServerSettingsConfig`),
`C:/FoundryTest/app/common/config.mjs` (`ServerSettings` schema — confirms default port 30000),
`dist/server/views/setup.mjs` (`updateServerConfiguration`),
[KB: Configuration](https://foundryvtt.com/article/configuration/).

## Update Software

Reached via the cloud icon (navigates to `/update`, its own page — not a dialog); class
`SetupUpdate`, id `#setup-update`.

- **Current Version** — read-only, `{display} - Build {build}`. **Software Update Channel** —
  **Stable**/**Testing**/**Development** (Prototype is filtered out of this dropdown), each with
  its own hint. **Force Update** checkbox resets to the latest version on that channel, overwriting
  local state; reversible only via a prior snapshot. [unverified]
- **Check for Update** — disabled unless foundryvtt.com is reachable; posts `action="updateCheck"`.
  A found update opens **Release Notes: {release}** with **Create a Snapshot** (recommended before
  a generational update), **Preview Compatibility**, and **Begin Download**, which streams progress
  and restarts the app when done. [unverified]
- **Preview Compatibility** — opens `CompatibilityChecker` (`#compatibility-checker`), defaulting
  to the Systems category, forecasting each installed package as Compatible/Risk/Incompatible/
  Unverified against the *next* release. Read-only; installs nothing. [unverified]
- **Return to Setup** — back to `/setup`, no state changed. Access: admin. Automation gotcha:
  **Check for Update** and **Begin Download** hit the real foundryvtt.com service — never run these
  against the shared test install without the GM's go-ahead (see Safety). [unverified]

Sources: `templates/setup/setup-update.hbs`, `update-notes.hbs`,
`templates/setup/compatibility-checker/*.hbs`, `foundry.mjs:213247` (`UpdateNotes`), `:213394`
(`SetupUpdate`), `:212908` (`CompatibilityChecker`), `dist/server/views/update.mjs`.

## License key and EULA (`/license`)

- **License Key Activation** — plain server-rendered form (no JS class), text field `#key`
  (placeholder `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`) and **Submit Key**. Skipped once a key is on file.
  Access: admin/owner. [unverified]
- **End User License Agreement** — class `EULA`, id `#eula`; renders the literal contents of
  `license.html` (present locally, not reproduced here). Checkbox **I agree to these terms** gates
  **Agree**; **Decline** warns and redirects to foundryvtt.com. No close button. Reversible: n/a —
  declining just stops you using the software. [unverified]
- Neither screen should appear once already accepted; treat an unexpected visit here as a broken
  license state, not a routine screen. [unverified]

Sources: `templates/views/license.hbs`, `templates/setup/parts/eula-{content,form}.hbs`,
`foundry.mjs:208812` (`EULA`), `dist/server/views/license.mjs`.

## Setup Tours

Four tours are registered as `SetupTour` instances (`registerTours()`, `foundry.mjs:205636-205639`),
gated on `game.view === "setup"`, started from **Show me how** links in empty-state messages or
auto-offered as noted below — confirmed exact registered ids, not guessed from filenames:

- **Installing a System** (`core.installingASystem`) — switches to the Systems tab, warms the
  package cache, opens the Install Package dialog pre-searched for "Simple Worldbuilding".
  [unverified]
- **Creating a World** (`core.creatingAWorld`) — switches to the Worlds tab, builds a draft World
  in memory, opens `WorldConfig` (the *edit* dialog, not the full `/create` page) pre-filled with
  "My First World", submits and closes at the last step. [unverified]
- **Backups Overview** (`core.backupsOverview`) — auto-starts once on first `/setup` load if
  backups aren't disabled. **Compatibility Preview Overview**'s registered id is `core.compatOverview`
  (not the longer name its filename suggests) — points at `#compatibility-checker`'s summary,
  filters, and category sidebar. [unverified]
- All are one-shot (`canBeResumed: false`) and close every open window first. Access: admin.
  Reversible: click-through only; progress resets from Tour Management. [unverified]

Sources: `foundry.mjs:205314` (`SetupTour`), `:205633-205644` (`registerTours`),
`public/tours/{installing-a-system,creating-a-world,backups-overview,
compatibility-preview-overview}.json`, [KB: Tours](https://foundryvtt.com/article/tours/).

## Where packages live on disk

Confirmed against the local test install (`C:/FoundryTest/data/Data`):

- `Data/worlds/<world-id>/world.json` — one folder per World. Real example,
  `Data/worlds/ai-tool-test/world.json`: `{title, system, id, coreVersion, compatibility, systemVersion,
  lastPlayed, playtime, description, flags}`.
- `Data/systems/<system-id>/system.json` — one folder per System. Real example, dnd5e's:
  `compatibility: {minimum: "14.367", verified: "14"}`, `manifest`/`download` URLs on GitHub.
- `Data/modules/<module-id>/module.json` — one folder per Module. Real example, this project's own
  `Data/modules/foundry-mcp-bridge/module.json`: `compatibility: {minimum: "13", verified: "14",
  maximum: "14"}`.
- Each of the three top-level folders carries its own one-line `README.txt` — confirmed present in
  all three. [unverified]
- The app's own config lives outside `Data/`, under `<dataPath>/Config/`: `options.json`
  (Application Configuration's saved values) and, if a password is set, `admin.txt` — deleting the
  latter is the documented reset mechanism.
- A package's manifest fields (`id`, `title`, `version`, `compatibility.{minimum,verified,maximum}`,
  `authors`, `relationships`) are exactly what the Install Package list and compatibility badges
  read from, regardless of whether it came from the repository or a raw manifest URL.

Sources: local `Data/{worlds,systems,modules}/*/{world,system,module}.json` and `README.txt`,
`dist/server/views/setup.mjs` (`Config` folder writes), `common/config.mjs` (`ServerSettings`),
[KB: Installation](https://foundryvtt.com/article/installation/).

## Driving it from automation

Read-only console checks (safe — none of these mutate anything):

- `game.view` — the active `SETUP_VIEWS` id (`"auth"|"license"|"setup"|"create"|"update"|"join"|
  "players"|"quit"`). Confirms which screen you're actually on. [unverified]
- `game.data.options` — the server's own config object as sent to this client (password fields are
  redacted to a fixed placeholder string, never the real value). [unverified]
- `game.systems`, `game.worlds`, `game.modules` — live collections of installed packages, each
  entry exposing `.locked`, `.favorite`, `.availability`, `.compatibility`. [unverified]
- `game.issueCount` — `{error, warning, total}` package-warning counts shown as the Warnings pip.
  [unverified]
- `ui.setupMenu`, `ui.setupPackages`, `ui.setupSidebar` — the three top-level app instances; e.g.
  `ui.setupPackages.changeTab("systems", "primary")` switches tabs without a click, and
  `ui.setupPackages.search("dnd5e")` fills a tab's search box programmatically. [unverified]
- `ui.installPackage` — set only while the Install Package dialog is open (`game.browsePackages`
  creates it). `ui.context` — the currently-open context menu, if any. [unverified]

Stable selectors/labels for accessibility-tree or DOM search (confirmed from the bundle and
templates, not guessed):

- `[data-tab="worlds"|"systems"|"modules"]`, `[data-action="worldCreate"|"installPackage"|
  "updateAll"|"worldLaunch"|"moduleCreate"]`, `[data-action="viewMode"][data-view-mode="GALLERY"|
  "TILES"|"DETAILS"]`.
- `#setup-menu [data-action="backups"|"configure"|"update"|"viewWarnings"|"adminLogout"|
  "shutDown"]` (Log Out/Shut Down only render when an admin password is set).
- `#world-config [name="title"|"id"|"system"]`, `#world-config [type="submit"]` — confirmed by the
  Creating-a-World tour's own step selectors.
- `#install-package [data-action="installUrl"]`, `#<rootId>-manifestUrl`,
  `.package[data-package-id="worldbuilding"]` (Simple Worldbuilding, a stable test target).
- `#compatibility-checker ul.summary`, `nav.filters`, `aside` — confirmed by the Compatibility
  Preview tour's step selectors.
- `#auth-username`, `#auth-password`, `button[name="action"][value="adminAuth"]`.
- Every list row carries `data-package-id`; every tab section carries `data-package-type`. Every
  side-effect action reduces to `game.post({action, ...})` or a `game.<verb>Package(...)` method —
  grep `foundry.mjs` around `Setup extends Game` (line 215348) for the full list before scripting.

Gotchas: the Install Package list batches in 50s on scroll, so a one-shot DOM read under-counts;
**Launch World** can silently start an irreversible migration; buttons vanish based on server state
(no admin password → no Log Out/Shut Down; `noBackups` → no backup UI) so "not found" can mean
"not applicable here", not a bug.

## Safety in the test world

- This area needs **server administrator** access, a different credential from any in-world user.
  Never type the real admin password from an automated session — get it from the GM interactively.
  If none is set, `/setup` is reachable with no login; that's normal here, not something to "fix".
  [unverified]
- Never touch **Update Software** or generate a new **SSL Certificate** against `C:\FoundryTest`
  without asking first — it's the shared install the `foundry-test-env` skill depends on, and both
  changes affect every future test session.
- Treat **Delete World**, **Uninstall**, and any Restore/Delete backup or snapshot action as
  destructive even here — exactly as irreversible as in a real campaign. Prefer read-only checks
  (`listBackups`, opening dialogs to look) over actually restoring or deleting.
- Never edit the `ai-tool-test` world's files directly on disk while Foundry is running.
- Never launch a second Foundry process on this data path, and never touch ports 31414–31416 (the
  live bridge) — everything here happens on `localhost:30001`.

## Verification checklist

1. Open `http://localhost:30001/setup`. Expected: login form or the Setup screen loads directly
   (tells you whether an admin password is configured).
2. Look at the top-right icon row. Expected: **Warnings**/**Configure**/**Update** always present;
   **Manage Backups**/**Log Out**/**Shut Down** present only per the rules above.
3. Click **Warnings**. Expected: a panel titled **Package Warnings (n)**, or **You have no
   warnings!**.
4. Open the **Worlds** tab. Expected: `#worlds-list` shows `ai-tool-test` with a dnd5e system
   badge.
5. Click each view-mode icon (Gallery/Tiles/Details). Expected: layout changes each time and
   persists on revisit.
6. Search the worlds list for a nonsense string. Expected: empty list plus a **Search Installable
   Packages** link.
7. Right-click the `ai-tool-test` tile. Expected: context menu with **Launch World**, **World
   Configuration**, **Mark Favorite**, **Lock World**, **Delete World**, and (if enabled) backup
   actions.
8. Choose **World Configuration**. Expected: **Edit World: AI Tool Test** opens; System and Data
   Path are read-only, other fields editable.
9. Close it, then click **Create World**. Expected: full navigation to `/create` with system/
   adventure tile pickers and **Data/worlds/** shown as the fixed path prefix.
10. Click **Cancel World Creation**. Expected: confirm dialog, then return to `/setup`.
11. Open the **Game Systems** tab. Expected: dnd5e listed, plus **Install System** and
    **Update All** buttons.
12. Click **Install System**. Expected: `#install-package` opens filtered to systems, with a
    category rail, search box, and a Manifest URL field in the footer.
13. Search it for "worldbuilding". Expected: Simple Worldbuilding appears, **Installed** or
    **Install** depending on whether `Data/systems/worldbuilding` exists.
14. Close it, open **Add-on Modules**. Expected: `foundry-mcp-bridge` listed; an extra gear-code
    **Create Module** button appears (absent on Systems).
15. Right-click `foundry-mcp-bridge`. Expected: context menu includes **Edit Module** (absent on
    Systems' menu) plus Favorite/Lock/Uninstall/backup entries.
16. Click **Manage Backups**. Expected: categories **Snapshots**, **Worlds**, **Modules**,
    **Systems** in that order, plus a title-bar **Create a Snapshot** button.
17. Open **Manage** on the `ai-tool-test` row without clicking Restore/Delete. Expected: a
    per-world backup list with a **Take Backup** button.
18. Click **Configure**. Expected: sections **Foundry VTT Configuration**, **Server
    Configuration**, **Electron Application**, **Other Settings**, and **Save Configuration**.
19. Change **Setup Theme**. Expected: the page theme changes live, and reverts if closed unsaved.
20. Close Configure, click **Update**. Expected: `/update` shows **Current Version**, an
    update-channel dropdown, and **Check for Update** (do not click Begin Download/Force Update).
21. If **Preview Compatibility** is offered, click it. Expected: `#compatibility-checker` opens on
    the Systems category with a summary count row.
22. Click **Return to Setup**. Expected: back on `/setup`, nothing changed.
23. Look for a **Show me how** tour link on an empty Worlds/Systems tab. Do not complete it unless
    a real install/world as a side effect is wanted.
24. Confirm `/license` is unreachable by normal navigation. Expected: any appearance here means the
    license state is broken, not a routine screen.

## Sources

- Local v14 client, read-only: `C:/FoundryTest/app/public/scripts/foundry.mjs` (real class bodies —
  primary source for this file), `C:/FoundryTest/app/dist/server/views/*.mjs`,
  `C:/FoundryTest/app/templates/setup/**`, `C:/FoundryTest/app/templates/sidebar/apps/world-config.hbs`,
  `C:/FoundryTest/app/common/{constants,config}.mjs`, `C:/FoundryTest/app/public/lang/en.json`,
  `C:/FoundryTest/app/public/tours/*.json`, `C:/FoundryTest/app/license.html`.
- Local data, read-only: `C:/FoundryTest/data/Data/{worlds,systems,modules}/**`.
- [KB: Installation](https://foundryvtt.com/article/installation/)
- [KB: Game Worlds](https://foundryvtt.com/article/game-worlds/)
- [KB: Module Management](https://foundryvtt.com/article/modules/)
- [KB: Backups](https://foundryvtt.com/article/backups/)
- [KB: Configuration](https://foundryvtt.com/article/configuration/)
- [KB: Tours](https://foundryvtt.com/article/tours/)
- [KB: Reset Admin Password](https://foundryvtt.com/article/reset-admin-password/)
- [foundryvtt.wiki](https://foundryvtt.wiki/) — checked as a third-party lead (its Setup/Worlds
  pages render client-side and returned no static text to a plain fetch); nothing here depends on
  it that isn't also confirmed locally or in the official KB.
