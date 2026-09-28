# Join, Users and Permissions

> Status: DRAFT from documentation and the local v14 source; not yet verified on the running client. The click-through pass stamps "verified on Foundry 14.368 / dnd5e 6.0.5, <date>".

Scope: the `/join` page and administrator login, Log Out and Return to Setup, Invitation Links,
the User Management page (`/players`), user roles, the Players list, User Configuration, the
User Permissions matrix, document ownership and the Configure Ownership dialog, and what a GM
sees compared with a player. Labels in **bold** are the exact English strings from
`C:/FoundryTest/app/public/lang/en.json` (or the dnd5e `lang/en.json`).

Test-world facts used below (from `.claude/skills/foundry-test-env/SKILL.md`): server
`http://localhost:30001`, world "AI Tool Test", users **Claude** (Gamemaster, no password),
**Player** (Player, no password) and **Gamemaster** (the GM's own account: never log in as it,
never edit or delete it). Related pages: `sidebar-tabs.md` (the Settings tab),
`dnd5e-settings.md` (dnd5e player-permission settings).

The join page and the User Management page are not in `C:/FoundryTest/app/client/`. Their
classes (`JoinGameForm`, `UserManagement`) only exist in the bundle
`C:/FoundryTest/app/public/scripts/foundry.mjs` (around lines 208900 and 213650); their
templates are in `C:/FoundryTest/app/templates/setup/parts/`.

## How to reach it

| What | Path | Who |
|------|------|-----|
| Join page | Open `http://localhost:30001/join`. Log Out also lands here. | anyone |
| Game Access buttons | Sidebar > **Settings** tab (gear icon, last in the strip) > section **Game Access** (at the bottom, may need a scroll) | Log Out: everyone. Invitation Links: GM and Assistant. Return to Setup: Gamemaster only |
| Main Menu | Press Esc when nothing else is open | everyone (items vary by role) |
| User Management | Settings tab > **User Management**, or Main Menu > **User Management**. The browser navigates to `/players` | Gamemaster and Assistant |
| User Configuration | Right-click a name in the Players list (bottom-left) > **User Configuration** | GM for anyone; a player for themself |
| User Permissions | Settings tab > **Game Settings** > category **Core** > row **User Permissions** > button **User Permissions**. Also `/players` > **Configure User Permissions** | Gamemaster only |
| Configure Ownership | Right-click a document or folder in a sidebar directory > **Configure Ownership**. Or open a document sheet > header ⋮ (**Toggle Controls**) > **Configure Ownership** | GM and Assistant |
| World Configuration (feeds the join page) | Settings tab > **World Configuration** | Gamemaster only |

- Clicking any sidebar tab icon also expands a collapsed sidebar
  (`C:/FoundryTest/app/client/applications/sidebar/sidebar.mjs`). [unverified]
- In the Settings tab, which buttons show depends on the role. The rules are in
  `Settings#_prepareContext`, `C:/FoundryTest/app/client/applications/sidebar/tabs/settings.mjs`
  (template `C:/FoundryTest/app/templates/sidebar/tabs/settings.hbs`). [unverified]

Sources: [KB Settings](https://foundryvtt.com/article/settings/),
[KB Users and Permissions](https://foundryvtt.com/article/users/),
`C:/FoundryTest/app/templates/sidebar/tabs/settings.hbs`,
`C:/FoundryTest/app/client/applications/ui/main-menu.mjs`.

## Join page (`/join`)

- **Loading `/join` logs you out of the world.** On every GET of `/join` the server ends this
  browser's world session (`sessions.logoutWorld` in `C:/FoundryTest/app/dist/server/views/join.mjs`).
  Treat "navigate to /join" as the same thing as Log Out. [unverified]
- Page title = the world title. The page is made of framed panels over the world background
  image. The page can look empty in a screenshot while it animates in; read the accessibility
  tree instead (see the test-env skill). [unverified]
- Panel **Join Game Session** (form `name="join"`, part `#join-game-form`):
  - User name **text field** (`#join-username`, `name="username"`, accessible name
    **Select User**, user icon). This is new since v11/v12, which used a dropdown. Focusing or
    typing opens an autocomplete list of the world's users, filtered by prefix. Users who are
    already connected appear greyed out (disabled). Picking one fills the name and moves focus
    to the password. [unverified]
  - Password field (`#join-password`, accessible name **User Password**, placeholder
    **Password**). Leave it empty for a user without a password (Claude, Player). [unverified]
  - Button **Join Game Session** (`button[name="join"]`, check icon). On success, toast
    **Login as {user} successful, joining game!**, then a redirect to `/game` after about 0.5 s.
    [unverified]
  - Error toasts: empty name gives **You must select a User in order to log in.** An unknown
    name gives **The requested User, "{user}", does not exist.** A wrong password gives
    **Invalid password provided for {user}!** A user with role None gives
    **{user} does not have permission to access this World!** [unverified]
  - The name is only pre-filled when the browser is admin-authenticated, nobody is connected
    and the world has exactly one user. Not the case in the test world (3 users). [unverified]
- Panel **Game Details** (`#join-game-details`): **Next Session** (localised date and time;
  blank when unset) and **Current Players** as "connected / total users". [unverified]
- Panel **World Description** (`#join-game-world`, scrollable `#world-description`): the
  world's description HTML. [unverified]
- Panel **Return to Setup** (`#join-game-setup`): see the next section. [unverified]
- With **Join Page Theme** = **Minimal** (World Configuration), only the Join Game Session and
  Return to Setup panels render (`JoinGameForm#_configureRenderOptions`). [unverified]
- GM and players see the same page. Joining is reversible (Log Out). [unverified]

Sources: `C:/FoundryTest/app/templates/setup/parts/join-form.hbs`, `join-details.hbs`,
`join-setup.hbs`, `join-world.hbs`; `C:/FoundryTest/app/public/scripts/foundry.mjs`
(`class JoinGameForm`); `C:/FoundryTest/app/dist/sessions.mjs` (`authenticateUser`);
[KB Game Worlds](https://foundryvtt.com/article/game-worlds/).

## Administrator login and Return to Setup

- Join page panel **Return to Setup** [unverified]:
  - If this browser session is already admin-authenticated, it shows only the hint
    **You are authenticated as a server administrator.** and the button.
  - Otherwise it shows an **Administrator Password** field (`#auth-password`,
    `name="adminPassword"`). If the server has an admin user name configured (a v14 option),
    it also shows **Administrator Username** (`#auth-username`). Then the button
    **Return to Setup** (lock icon).
  - **Never type into these fields.** The admin password stays with the GM (CLAUDE.md,
    test-env skill).
- If other users are connected, Return to Setup first opens a confirm dialog titled
  **Return to Setup**, saying how many users will be disconnected. [unverified]
- Page `/auth` (no world running): heading **Administrator Access Required**, password field,
  button **Log In**. It belongs to the setup flow and is out of scope here; never type into
  it. [unverified]
- In the game: Settings tab > Game Access > **Return to Setup** (house icon), or Main Menu >
  **Return to Setup**. Gamemaster role only (not Assistant). It needs no password. It asks for
  confirmation only when other users are connected (`Game#shutDown`,
  `C:/FoundryTest/app/client/game.mjs`). [unverified]
- Effect: shuts the world down for everyone and disconnects the test bridge. Only the setup
  screen (admin) can undo it by launching the world again. In the test world, do this only at
  the very end of a session, as the test-env skill says. [unverified]

Sources: `C:/FoundryTest/app/templates/setup/parts/join-setup.hbs`,
`C:/FoundryTest/app/templates/setup/setup-authentication.hbs`,
`C:/FoundryTest/app/client/game.mjs` (`shutDown`),
[KB Game Worlds](https://foundryvtt.com/article/game-worlds/) (Return to Setup on the join page).

## Log Out and the Main Menu

- **Log Out** (Settings tab > Game Access, door icon, `[data-action="openApp"][data-app="logout"]`):
  navigates straight to `/join`, with no confirmation (`Game#logOut`). Reversible: join again.
  Everyone has it. [unverified]
- Main Menu (`dialog#menu`, opened with Esc) [unverified]:
  - **Reload Application**: everyone; reloads the page and keeps the session.
  - **Log Out**: everyone.
  - **User Management**: GM and Assistant (hidden in demo mode); goes to `/players`.
  - **Return to Setup**: Gamemaster only.
  - Close it with Esc or the X button (**Close Main Menu**). Esc first closes context menus,
    tours and windows. The menu only opens when there is nothing else for Esc to dismiss.
- Browser Back while on `/game` raises a native `confirm()` (**Are you sure you want to exit
  the Foundry Virtual Tabletop game?**). Automation should never use history "back" from
  `/game`. [unverified]

Sources: `C:/FoundryTest/app/client/applications/ui/main-menu.mjs`,
`C:/FoundryTest/app/templates/ui/main-menu.hbs`,
`C:/FoundryTest/app/client/helpers/interaction/client-keybindings.mjs` (dismiss/Escape),
`C:/FoundryTest/app/client/game.mjs` (`logOut`, `#onWindowPopState`).

## Invitation Links

- Settings tab > Game Access > **Invitation Links** (wifi icon). GM and Assistant only. Opens
  the window **Game Invitation Links** (`#invitation-links`). [unverified]
- A hint paragraph explains the two kinds of link. [unverified]
- **Local Network**: the LAN URL, or "Unknown". [unverified]
- **Internet**: the public URL, masked like a password. The label has a status icon (open,
  closed or unknown; tooltips **Your connection appears to be open** / **...closed** /
  **We couldn't detect your connection status**) and a refresh link that re-checks. An eye
  icon shows or hides the URL. [unverified]
- **Internet (IPv6)**: only shown when an IPv6 address was found. [unverified]
- Clicking a link field copies it to the clipboard and shows the toast
  **Game invitation link copied to clipboard**. [unverified]
- Read-only: nothing is saved. The refresh asks the server to detect its addresses again, which
  may call an outside IP service. [unverified]
- Gotcha: do not unmask or screenshot the Internet link (it contains the public IP). Do not
  click refresh in tests. [unverified]

Sources: `C:/FoundryTest/app/client/applications/sidebar/apps/invitation-links.mjs`,
`C:/FoundryTest/app/templates/sidebar/apps/invitation-links.hbs`,
[KB Settings](https://foundryvtt.com/article/settings/).

## User Management page (`/players`)

Reach it from Settings tab > **User Management** (users icon), or Main Menu >
**User Management**. It is a full page, not a window: the browser leaves `/game`. Heading
**User Management**, container `#manage-players` (a `<form>`).

- Column headers: **User Name**, **Password**, **User Role**. [unverified]
- One row per user (`#player-list li.player[data-user-id]`) [unverified]:
  - A name text input (`users.<id>.name`).
  - A password input (`users.<id>.password`). It always holds a fixed placeholder string,
    whatever the real password is, so the page cannot tell you whether a password exists.
    Focusing the field selects all of it. Any key other than Shift, Ctrl, Alt or Tab reveals an
    eye button **Show Password**. Unchanged, the password is kept. Emptied and saved, the
    password becomes blank.
  - A role select (`users.<id>.role`) with options **None**, **Player**, **Trusted Player**,
    **Assistant Gamemaster**, **Gamemaster** (values 0-4).
  - Icon buttons **Login as User** (`[data-action="loginAsUser"]`) and **Delete User**
    (`[data-action="deleteUser"]`, trash icon). Their names are aria-labels, not visible text.
  - A world on first launch shows a warning under the first row:
    **Setting a password for the Gamemaster account is strongly recommended.**
- **Create Additional User** (`[data-action="createUser"]`): **creates the User document at
  once**, before any Save, named `Player<N>` with role Player, and adds a row. Undo: that row's
  trash button. [unverified]
- **Delete User**: a confirm dialog titled **Delete User: {name}** with **Are You Sure?**, a
  permanent-deletion warning, and an extra warning when the user is a GM. Buttons **Delete**
  and **Cancel**. Deletion is immediate and cannot be undone. [unverified]
- **Configure User Permissions** (`[data-action="configurePermissions"]`): only for a
  Gamemaster (or on first launch). Opens the User Permission Configuration window over the
  page. [unverified]
- **Save and Return** (**Save and Continue** on first launch; submit button): saves every
  changed name, password and role in one batch. At least one row must have the Gamemaster
  role, or you get **You must have at least one Game Master user within your World.** On
  success, toast **Game users updated successfully, returning to the game World.**, then
  `/game` after about 1 s. [unverified]
- **Login as User**: saves the pending edits first, then switches this browser to that user.
  The caller must be a Gamemaster (or an admin session); otherwise the error is
  **You must be a Gamemaster to log in as another user.** The GM session in this tab ends; to
  get it back, Log Out and join as Claude. [unverified]
- Assistant Gamemaster: sees the Settings button, but the data model does not let them raise
  anyone above their own role or change a Gamemaster's password, and they get no Configure
  User Permissions button. Whether the `/players` route itself opens for an Assistant is not
  confirmed. [unverified]
- A player (role below Assistant) cannot reach this page from the UI. [unverified]

Sources: `C:/FoundryTest/app/templates/setup/parts/user-management-form.hbs`,
`user-management-user.hbs`; `C:/FoundryTest/app/public/scripts/foundry.mjs`
(`class UserManagement`); `C:/FoundryTest/app/dist/sessions.mjs` (`loginAsUser`);
`C:/FoundryTest/app/common/documents/user.mjs` (`#canCreate`, `#canUpdate`, `#canDelete`);
[KB Users and Permissions](https://foundryvtt.com/article/users/).

## User roles

| Value | Label in v14 | What it means (from the source) |
|-------|--------------|---------------------------------|
| 0 | **None** | Cannot join (join error, see above). This is how "ban" works. |
| 1 | **Player** | Normal player. |
| 2 | **Trusted Player** | Player plus the Trusted defaults in the matrix below (drawing, file browser, journal creation...). |
| 3 | **Assistant Gamemaster** | `isGM` is true: sees every document as Owner, sees GM-only UI. No User Permissions, no World Configuration, no Return to Setup, no Login as User. |
| 4 | **Gamemaster** | Full control of the world. The world needs at least one. |

- `user.isGM` is true for both Assistant and Gamemaster. Code that needs the full GM uses
  `user.hasRole("GAMEMASTER")`. [unverified]
- The players-list tooltip and `user.roleLabel` show the labels above. [unverified]
- A user may also carry per-user permission overrides (`user.permissions`); core has no UI for
  them. [unverified]

Sources: `C:/FoundryTest/app/common/constants.mjs` (`USER_ROLES`),
`C:/FoundryTest/app/common/documents/user.mjs`,
[API User (v14)](https://foundryvtt.com/api/classes/foundry.documents.User.html),
[KB Users and Permissions](https://foundryvtt.com/article/users/).

## Players list (bottom-left)

- Element `aside#players`. Connected users are always listed (`#players-active`). Other users
  sit in `#players-inactive` and only show once the caret button `#players-expand` sets the
  `expanded` class. That button has no text or aria-label, so find it by selector. The panel
  also shows **Latency** and **FPS**. [unverified]
- Name format: `Name (pronouns) [GM]` for GM and Assistant users. `Name [Character name]` for a
  player with an assigned character. The dot uses the user's colour (grey when not
  connected). Hovering shows the role label. Your own row is listed first. [unverified]
- Right-click a row to get the context menu. Entries by visibility rule [unverified]:
  - **User Configuration**: a GM for any row; a player only for their own row.
  - **View Player Avatar**: anyone, when that user's avatar is not the default image. An empty
    avatar falls back to the assigned character's image, so a player with a character usually
    gets this entry (`C:/FoundryTest/app/client/documents/user.mjs`).
  - **Pull To Scene**: GM only; the target is connected and not you. Moves their view to your
    current scene.
  - **Kick Player**: GM only; the target is connected and not you. **No confirmation.** Sets the
    role to None and straight back, which disconnects them. Toast "User {user} has been kicked
    from the World."
  - **Ban Player**: GM only; not you; the target's role is not None. **No confirmation.** Sets
    the role to None.
  - **Un-Ban Player**: GM only; the target's role is None. Sets the role to **Player**, not to
    whatever role they had before.
  - **Show User**: only when you have hidden that user's A/V feed.
- Players see every user in this list (connected always, others when expanded). [unverified]

Sources: `C:/FoundryTest/app/client/applications/ui/players.mjs`,
`C:/FoundryTest/app/templates/ui/players.hbs`,
[API Players (v14)](https://foundryvtt.com/api/classes/foundry.applications.ui.Players.html).

## User Configuration window

- Title **User Configuration: {name}**. Window class `.user-config`, app id
  `UserConfig-User-<userId>`. [unverified]
- Fieldset **Player Information** [unverified]:
  - **Player Name**: disabled here; rename in User Management.
  - **Player Avatar**: image path. The file-picker button only appears when the viewing user
    has **Use File Browser** (Trusted and up by default).
  - **Player Color**: colour picker. Used for cursor, ruler and the players-list dot.
  - **Player Pronouns**: free text. Shown in the players list as `(pronouns)`.
- Fieldset **Player Character**: a select (`name="character"`) listing actors that the
  *configured* user can at least observe. Options are grouped **Owner** / **Observer** based on
  *your own* ownership, so a GM sees them all under Owner. Actors already assigned to another
  user are disabled. The blank option means no character. When a character is set, a portrait
  and a **Release Character** button (ban icon; the name is its tooltip) appear. The button
  clears the select, and the change is kept only when you save. [unverified]
- Footer **Save Player Configuration** saves and closes. Closing with the X discards changes.
  Reversible: edit again. [unverified]
- Rights: a Gamemaster can edit anyone. An Assistant can edit other users but not a
  Gamemaster's password. A player can edit only themself and never the name or role. [unverified]

Sources: `C:/FoundryTest/app/client/applications/sheets/user-config.mjs`,
`C:/FoundryTest/app/templates/sheets/user-config.hbs`,
`C:/FoundryTest/app/common/documents/user.mjs`,
[KB Users and Permissions](https://foundryvtt.com/article/users/) (User Configuration section).

## User Permissions matrix

- Reach it from Settings tab > **Game Settings** > category **Core** (left list) > row
  **User Permissions** > button **User Permissions** (shield icon). The Game Settings filter
  box also finds it. Or use `/players` > **Configure User Permissions**. **Gamemaster only**:
  `core.permissions` is a GM-only key, so the row is hidden for Assistants and players.
  [unverified]
- Window **User Permission Configuration** (`#permissions-config`, width 660). A hint at the top
  says that some GM permissions cannot be removed and some changes need a reload. [unverified]
- Header columns: **Permission**, **Player**, **Trusted Player**, **Assistant Gamemaster**,
  **Gamemaster** (there is no None column). One row per permission, sorted by label, each
  with a hint line. Checkbox names are `<KEY>.<roleValue>`, for example
  `FILES_UPLOAD.3`. [unverified]
- Cells for roles that always have a permission are `readonly` and look greyed. Whether a
  click on them is ignored is not confirmed. [unverified]
- **Reset Defaults** (`[data-action="reset"]`): **writes the defaults straight away**, with no
  confirmation. Toast "Reset User role permission configuration to default values."
  [unverified]
- **Save Configuration**: stores the world setting `core.permissions`, closes the window, shows
  the toast "Updated User role permission configuration." and re-renders the controls and
  sidebar for everyone. [unverified]
- A fresh world holds the full default map: the server writes the defaults the first time it
  reads the setting (`C:/FoundryTest/app/dist/database/documents/setting.mjs`). [unverified]

Default matrix (from `CONST.USER_PERMISSIONS`; "default from" is the lowest role ticked by
default; "locked" roles always have it):

| Row label | Key | Default from | Locked for |
|-----------|-----|--------------|------------|
| **Broadcast Audio** | BROADCAST_AUDIO | Trusted | - |
| **Broadcast Video** | BROADCAST_VIDEO | Trusted | - |
| **Configure Token Settings** | TOKEN_CONFIGURE | Trusted | Assistant, GM |
| **Create Actors** | ACTOR_CREATE | Assistant | Assistant, GM |
| **Create and Control Playlists** | PLAYLIST_CREATE | Assistant | Assistant, GM |
| **Create Cards** | CARDS_CREATE | Assistant | Assistant, GM |
| **Create Items** | ITEM_CREATE | Assistant | Assistant, GM |
| **Create Journal Entries** | JOURNAL_CREATE | Trusted | Assistant, GM |
| **Create Map Notes** | NOTE_CREATE | Trusted | Assistant, GM |
| **Create Regions** | REGION_CREATE | Player | Assistant, GM |
| **Create Tokens** | TOKEN_CREATE | Assistant | Assistant, GM |
| **Delete Tokens** | TOKEN_DELETE | Assistant | Assistant, GM |
| **Display Mouse Cursor** | SHOW_CURSOR | Player | - |
| **Display Ruler Measurement** | SHOW_RULER | Player | - |
| **Make Manual Rolls** | MANUAL_ROLLS | Trusted | - |
| **Modify Configuration Settings** | SETTINGS_MODIFY | Assistant | GM |
| **Modify Script Macros and Execute Script Region Behaviors** | MACRO_SCRIPT | Player | GM |
| **Open and Close Doors** | WALL_DOORS | Player | Assistant, GM |
| **Ping the Canvas** | PING_CANVAS | Player | - |
| **Query Users** | QUERY_USER | Player | Assistant, GM |
| **Upload Files** | FILES_UPLOAD | Assistant | GM |
| **Use Drawing Tools** | DRAWING_CREATE | Trusted | Assistant, GM |
| **Use File Browser** | FILES_BROWSE | Trusted | Assistant, GM |
| **Whisper Private Messages** | MESSAGE_WHISPER | Player | Assistant, GM |

- The table is in key order; the window sorts rows by label. [unverified]
- For this repo: **Query Users** is on for players by default. The bridge's M0 lockdown relies
  on its handlers not being in `CONFIG.queries`, not on this permission (see the test-env
  smoke checklist). [unverified]
- dnd5e adds player-permission switches of its own in Game Settings > **Dungeons & Dragons
  Fifth Edition** (**Allow Player Damage Application**, **Allow Player Effect Application**,
  **Allow Individual Rests**, **Allow Transformation**, **Allow Summoning**) and a
  **Configure Visibility** sub-menu. See `dnd5e-settings.md`. [unverified]

Sources: `C:/FoundryTest/app/client/applications/apps/permission-config.mjs`,
`C:/FoundryTest/app/templates/apps/permission-config.hbs`,
`C:/FoundryTest/app/common/constants.mjs` (`USER_PERMISSIONS`),
`C:/FoundryTest/app/client/game.mjs` (menu registration),
`C:/FoundryTest/app/common/documents/setting.mjs` (`_GAMEMASTER_ONLY_KEYS`),
[API PermissionConfig (v14)](https://foundryvtt.com/api/classes/foundry.applications.apps.PermissionConfig.html),
[KB Settings](https://foundryvtt.com/article/settings/),
`C:/FoundryTest/data/Data/systems/dnd5e/dnd5e.mjs` (settings registration).

## Document ownership levels

| Level | Value | Meaning in the UI |
|-------|-------|-------------------|
| **Inherit** | -1 | Embedded documents only (for example journal pages): use the parent's level. |
| **None** | 0 | Hidden: not listed in the sidebar directory, the sheet cannot be opened. |
| **Limited** | 1 | Listed; the sheet opens in a reduced form chosen by the sheet/system. dnd5e actor: portrait, name, public description, biography. |
| **Observer** | 2 | Full sheet, read-only. Enough to be picked as a Player Character. |
| **Owner** | 3 | Can edit; for actors, controls their tokens. |
| **Default** | UI only (-20) | Per-user row: fall back to the **All Players** level. |
| **No Change** | UI only (-10) | Folder dialog and the journal Show Players dialog: leave as is. |

- How a user's level is worked out: GM and Assistant are always Owner; role None is always
  None. Otherwise the user's own entry applies, else the `default` entry, else None. Inherit
  defers to the parent document. [unverified]
- Deleting is set per document type, not by ownership alone. Core defaults let only GM or
  Assistant delete most world documents (for example Actors). Items and Journal Entries can be
  deleted by their owners. [unverified]
- Compendium packs use role-based ownership instead (see the next section). [unverified]

Sources: `C:/FoundryTest/app/common/constants.mjs` (`DOCUMENT_OWNERSHIP_LEVELS`,
`DOCUMENT_META_OWNERSHIP_LEVELS`), `C:/FoundryTest/app/common/abstract/document.mjs`
(`getUserLevel`, `testUserPermission`), `C:/FoundryTest/app/common/documents/item.mjs`,
`journal-entry.mjs`, `actor.mjs`, `C:/FoundryTest/data/Data/systems/dnd5e/dnd5e.mjs`
(`LIMITED_PARTS`), `C:/FoundryTest/data/Data/systems/dnd5e/templates/actors/limited-*.hbs`,
[KB Users and Permissions](https://foundryvtt.com/article/users/) (Ownership Configuration),
lead only: [dnd5e issue #2869](https://github.com/foundryvtt/dnd5e/issues/2869).

## Configure Ownership dialog

Ways in (GM and Assistant only) [unverified]:
- Right-click an entry in the Actors, Items, Journal, Rollable Tables, Card Stacks, Macros or
  Playlists directory > **Configure Ownership** (user-lock icon).
- Right-click a folder header in those directories > **Configure Ownership**.
- Document sheet header ⋮ (**Toggle Controls**) > **Configure Ownership**. It shows only for a
  GM or Assistant, on an editable world document that has ownership. dnd5e 6 actor and item sheets inherit
  it.
- A journal sheet's page list: right-click a page > **Configure Ownership**.
- **Scenes** is the exception: the Scenes directory removes Configure Ownership from both entry
  and folder menus.

The dialog [unverified]:
- Title **Ownership Configuration: {name}**. Window class `.document-ownership`, app id
  `DocumentOwnershipConfig-<Type>-<id>`.
- A hint line (one text for documents, another for folders).
- Checkbox **Show GM Users** (`input[data-show-gm-toggle]`). GM and Assistant rows are hidden
  until it is ticked; they carry a crown icon.
- Row **All Players** (`select[name="default"]`): **None**, **Limited**, **Observer**,
  **Owner** (plus **Inherit** for embedded documents).
- One row per user (`select[name="<userId>"]`): **Default** plus the same levels. The row of
  the document's author shows the text **Author** instead of a select, so it cannot be changed
  here.
- Folder version: every select also offers **No Change**, which is the per-user starting
  value. Saving writes the chosen levels into every document directly in that folder (not
  sub-folders). There is no undo beyond setting the levels back by hand.
- **Save Changes** saves and closes. Closing with the X discards changes.

Related (changes ownership as a side effect): the journal **Show Players** dialog (title
**Show {name}**) has a **Configure Ownership** select, default **No Change**, that raises
ownership when set. [unverified]

Compendium packs: Compendium Packs tab > right-click a pack > **Configure Ownership** opens a
dialog titled **Ownership Configuration: {pack}** with one select per role
(**Assistant Gamemaster**, **Trusted Player**, **Player**; choices **Inherit from below**,
None to Owner). Buttons: **Reset to Default** and **Configure Ownership**. [unverified]

Sources: `C:/FoundryTest/app/client/applications/apps/document-ownership.mjs`,
`C:/FoundryTest/app/templates/apps/document-ownership.hbs`,
`C:/FoundryTest/app/client/applications/api/document-sheet.mjs`,
`C:/FoundryTest/app/client/applications/sidebar/document-directory.mjs`,
`C:/FoundryTest/app/client/applications/sidebar/tabs/scene-directory.mjs`,
`C:/FoundryTest/app/client/applications/sheets/journal/journal-entry-sheet.mjs`,
`C:/FoundryTest/app/client/applications/sheets/journal/dialog-show.mjs`,
`C:/FoundryTest/app/client/documents/collections/compendium-collection.mjs`,
[API DocumentOwnershipConfig (v14)](https://foundryvtt.com/api/classes/foundry.applications.apps.DocumentOwnershipConfig.html),
[KB Users and Permissions](https://foundryvtt.com/article/users/).

## World Configuration (what the join page shows)

- Settings tab > **World Configuration** (globe icon). Gamemaster only. Window
  **Edit World: {world}** (`#world-config`). [unverified]
- Fields: **World Title**, **Background Image** (join page background), **Join Page Theme**
  (**Default** / **Minimal**), **Next Session** (`datetime-local` input; clear it to remove),
  **World Description** (rich text). [unverified]
- Button **Update World** saves through the server (world metadata, not a document).
  Reversible by editing again. [unverified]
- **Reset User Passwords** and **Launch in Safe Configuration** only exist in the setup-screen
  version of this dialog. **Never use Reset User Passwords**: it clears every password,
  including the GM's own account. [unverified]

Sources: `C:/FoundryTest/app/client/applications/sidebar/apps/world-config.mjs`,
`C:/FoundryTest/app/templates/sidebar/apps/world-config.hbs`,
[KB Game Worlds](https://foundryvtt.com/article/game-worlds/).

## What a GM sees compared with a player

- Sidebar: the **Scenes** tab is GM and Assistant only. Directories list only documents the
  user can see at Limited or above. [unverified]
- Settings tab, player view [unverified]:
  - **Game Settings** (client-scope settings only).
  - **Controls Configuration**.
  - **Active Modules**: a read-only list; a user with Modify Configuration Settings sees
    **Module Management** instead.
  - **Tour Management**, **Support & Issues**, **Documentation**, **Community Wiki**.
  - **Log Out**.
  - Not shown: **World Configuration**, **User Management**, **Invitation Links**,
    **Return to Setup**.
- Game Settings for a player: world-scope settings and the **User Permissions** row are hidden.
  An Assistant sees world settings (with Modify Configuration Settings) but still not User
  Permissions. [unverified]
- Main Menu for a player: only **Reload Application** and **Log Out**. [unverified]
- Players list for a player: right-click on someone else offers at most **View Player Avatar**;
  on their own row, **User Configuration**. [unverified]
- Configure Ownership entries and header controls: GM and Assistant only. [unverified]
- dnd5e: a Limited actor opens as the limited sheet (see ownership levels). dnd5e's
  **Configure Visibility** settings decide what players see of attack results, DCs and NPC
  item descriptions (see `dnd5e-settings.md`). [unverified]
- To check the player view: Log Out, join as **Player** (no password), check, Log Out, join as
  **Claude**. One browser session holds one user. [unverified]

Sources: `C:/FoundryTest/app/client/applications/sidebar/sidebar.mjs` (`TABS`, `gmOnly`),
`C:/FoundryTest/app/client/applications/sidebar/tabs/settings.mjs`,
`C:/FoundryTest/app/client/applications/settings/config.mjs`,
`C:/FoundryTest/app/client/documents/abstract/client-document.mjs` (`visible`, `limited`),
[KB Settings](https://foundryvtt.com/article/settings/).

## Differences between the docs and the v14 source

- Join page: v14 has a **text field with autocomplete** for the user name. Older docs and guides
  describe choosing the user from a dropdown. [unverified]
- Settings tab labels, KB name (v13) to v14 name: "Configure Settings" is **Game Settings**,
  "Configure Controls" is **Controls Configuration**, "Manage Modules" is
  **Module Management** (or **Active Modules** for players), "Edit World" is
  **World Configuration**, "View Documentation" is **Documentation**, "Community Wiki Pages" is
  **Community Wiki**. [unverified]
- The KB's "Configure Permissions" is, in v14, the **User Permissions** row and button in Game
  Settings > Core, and the **Configure User Permissions** button on `/players`. [unverified]
- Role names in v14: **Trusted Player**, **Assistant Gamemaster**, **Gamemaster** (the KB says
  Trusted, Assistant, Game Master). [unverified]
- User Configuration: v14 has a **Player Character** select with Owner/Observer groups and a
  **Player Pronouns** field. The KB says "Select Character" and gives no detail on pronouns.
  [unverified]
- The KB says Trusted players can make measured templates. v14 replaced templates with Regions:
  the old TEMPLATE_CREATE permission is deprecated and maps to **Create Regions**, which
  defaults to Player. [unverified]
- Ownership dialog: v14 adds **Show GM Users**, the **All Players** default row and an
  **Author** row. The Scenes directory no longer offers Configure Ownership. [unverified]
- User Management: the KB says Save and Return reloads the world. In v14 it saves, then
  redirects to `/game`. **Create Additional User** writes the user to the database at once, not
  on Save. [unverified]
- The join page's admin section can ask for an **Administrator Username** as well as the
  password (v14 server option). [unverified]

Sources: [KB Users and Permissions](https://foundryvtt.com/article/users/) (page dated v13.350),
[KB Settings](https://foundryvtt.com/article/settings/) (v13.351),
[KB Game Worlds](https://foundryvtt.com/article/game-worlds/), and the local files cited above.

## Driving it from automation

Read-only console snippets (paste into the page console; none of them change data):

```js
// Which view, which user
({view: game.view, user: game.user?.name, role: game.user?.role,
  roleLabel: game.user?.roleLabel, isGM: game.user?.isGM,
  fullGM: game.user?.hasRole("GAMEMASTER")})

// All users (works on /join, /players and /game)
game.users.map(u => ({id: u.id, name: u.name, role: u.role, active: u.active,
  character: u.character?.name ?? null, pronouns: u.pronouns, color: u.color?.css}))

// UI state in /game
({sidebarTab: ui.sidebar.tabGroups.primary, sidebarExpanded: ui.sidebar.expanded,
  playersExpanded: ui.players.expanded, mainMenuOpen: !!ui.menu?.rendered,
  gameSettingsOpen: game.settings.sheet.rendered,
  gameSettingsCategory: game.settings.sheet.tabGroups?.categories})

// Open application windows (ids): look for "permissions-config", "invitation-links",
// "world-config", "settings-config", "UserConfig-User-<id>", "DocumentOwnershipConfig-..."
[...foundry.applications.instances.values()].map(a => [a.id, a.title, a.rendered])

// Role permission matrix as stored, and what the current user may do
game.settings.get("core", "permissions")
Object.fromEntries(Object.keys(CONST.USER_PERMISSIONS).map(k => [k, game.user.can(k)]))

// Ownership of a document and the level a given user gets
(() => { const d = game.actors.contents[0] ?? game.journal.contents[0];
  const p = game.users.getName("Player");
  return d && {name: d.name, ownership: d.ownership, playerLevel: d.getUserLevel(p),
    playerCanObserve: d.testUserPermission(p, "OBSERVER")}; })()

// Join-page content
({title: game.world.title, joinTheme: game.world.joinTheme ?? "default",
  nextSession: game.world.nextSession, admin: game.data.isAdmin})

// On /join: form state (password not read)
({name: document.forms.join?.elements.username.value,
  connected: game.users.filter(u => u.active).map(u => u.name)})

// On /players: rows as currently edited (password not read)
[...document.querySelectorAll('#player-list li.player')].map(li => ({id: li.dataset.userId,
  name: li.querySelector('input[name$=".name"]').value,
  role: li.querySelector('select').value}))
```

Do not print `game.data.addresses` (it holds the public IP).

Stable selectors and accessibility-tree names:

| Element | Selector | Accessible name / text |
|---------|----------|------------------------|
| Join name field | `#join-username` | "Select User" |
| Join password | `#join-password` | "User Password" |
| Join button | `button[name="join"]` | "Join Game Session" |
| Admin password (do not type) | `#auth-password` | "Administrator Password" |
| Return to Setup on /join | `#join-game-setup button[type=submit]` | "Return to Setup" |
| Settings tab button | `button[data-tab="settings"]` | "Settings" |
| Settings-tab actions | `[data-action="openApp"][data-app="configure\|controls\|modules\|world\|players\|tours\|support\|invitations\|logout\|setup"]` | button text as in "How to reach it" |
| Main Menu | `dialog#menu li.menu-item[data-menu-item="reload\|logout\|players\|world"]` | item text |
| Players list | `#players`, `#players-active li.player`, `#players-inactive li.player`, `li.player[data-user-id]` | name text |
| Players expand caret | `#players-expand` | none (no label) |
| User Management | `#manage-players`, `[data-action="createUser\|configurePermissions\|loginAsUser\|deleteUser"]`, `select[name="users.<id>.role"]` | "Create Additional User", "Configure User Permissions", "Login as User", "Delete User" |
| Permissions window | `#permissions-config`, `input[name="<KEY>.<role>"]`, `[data-action="reset"]` | "Reset Defaults", "Save Configuration" |
| Game Settings entry | `button[data-action="openSubmenu"][data-key="core.permissions"]` | "User Permissions" |
| Ownership dialog | `.document-ownership`, `select[name="default"]`, `input[data-show-gm-toggle]` | "All Players", "Show GM Users", "Save Changes" |
| User Configuration | `.user-config`, `select[name="character"]`, `[data-action="releaseCharacter"]` | "Save Player Configuration" |
| Invitation Links | `#invitation-links`, `#invitation-links-local`, `#invitation-links-internet` | "Local Network", "Internet" |
| App header controls | `button[data-action="toggleControls"]` | "Toggle Controls" |

Driving gotchas:
- Context menus open on right-click. They close on Esc or on a click elsewhere. [unverified]
- `/join` and `/players` are separate page loads. After each navigation, wait for the page,
  then read the tree again. [unverified]
- Toasts fade after a few seconds. Read them right after the action, or check the resulting
  state with the snippets above. [unverified]
- Confirm dialogs (Delete User, Return to Setup with others connected) are DialogV2 windows
  inside the page, not native dialogs. The only native dialog in this area is the history-back
  `confirm()`. [unverified]

Sources: `C:/FoundryTest/app/client/game.mjs` (`view`), `C:/FoundryTest/app/client/applications/api/application.mjs`
(`foundry.applications.instances`, Toggle Controls), `C:/FoundryTest/app/client/applications/api/document-sheet.mjs`
(app ids), `C:/FoundryTest/app/client/applications/api/category-browser.mjs` (tab group
`categories`), `C:/FoundryTest/app/templates/sidebar/tabs.hbs`.

## Safety in the test world

Actions that change world data:
- User Management: **Save and Return**, **Login as User** (it saves pending edits),
  **Create Additional User** (immediate), **Delete User** (immediate, permanent).
- Players list: **Kick Player**, **Ban Player**, **Un-Ban Player** (User role writes, no
  confirmation).
- **Save Player Configuration** in User Configuration.
- **Save Configuration** and **Reset Defaults** in User Permission Configuration (a world
  setting that applies to everyone).
- **Save Changes** in Configure Ownership (folders: every document in the folder).
- The **Configure Ownership** field of the journal **Show Players** dialog.
- **Update World** in World Configuration (world metadata).
- **Return to Setup** (shuts the world down).

Never do:
- Anything to the **Gamemaster** row or user (the GM's own account): no password, role, name
  or delete, no Login as User, no joining as it.
- Type any password: admin fields on `/join` or `/auth`, and user passwords in User
  Management. Tab through password fields without typing.
- **Reset User Passwords** (setup-screen Edit World).
- Kick or ban **Claude** from another session, or remove the last Gamemaster.
- Unmask or screenshot the Internet invitation link.
- **Return to Setup** in the middle of a test run (it stops the bridge's world); only at the
  end, as the test-env skill says.

How to undo:
- Before any write, record the state with the snippets above (users, `core.permissions`, a
  document's `ownership`).
- Created user: its trash button on `/players` > **Delete**.
- Changed role: set it back on `/players` > **Save and Return**. **Un-Ban Player** always
  restores to Player, so fix other roles on `/players`.
- User Configuration: open it again and restore colour, pronouns and character.
- Permissions: tick the recorded values back. **Reset Defaults** is a valid undo only if the
  recorded map equals the defaults.
- Ownership: reopen the dialog and set **All Players** and each user back to the recorded
  values (a user with no entry = **Default**).
- For ownership tests prefer a throwaway document (for example a Journal Entry named
  `zz-ownership-test`) and delete it afterwards.

Sources: `.claude/skills/foundry-test-env/SKILL.md`, `CLAUDE.md` (critical rules), and the
source files cited in each section above.

## Verification checklist

Start logged in as **Claude** on `http://localhost:30001/game`, unless a step says otherwise.
Before step 1, run the "All users" and "Role permission matrix" snippets from
"Driving it from automation" and keep the output. Steps marked (writes) change data; skip them
unless you also do the cleanup step.

1. Navigate to `http://localhost:30001/join`. Expected: the join page loads, you are no longer
   in the game, and the heading and button **Join Game Session** are visible. [unverified]
2. Read the accessibility tree. Expected: a text field named **Select User** (not a combobox),
   a password field **User Password** with placeholder **Password**, and the button
   **Join Game Session**. [unverified]
3. Click into the user name field. Expected: an autocomplete list with Claude, Gamemaster and
   Player; connected users greyed out. [unverified]
4. Look at the **Game Details** panel. Expected: **Next Session** (blank or a date) and
   **Current Players** as "N / 3". [unverified]
5. Look at the **World Description** panel. Expected: it is present (default theme), with
   the description or empty. [unverified]
6. Look at the **Return to Setup** panel (do not type). Expected: either the hint
   **You are authenticated as a server administrator.** or an **Administrator Password** field
   (maybe also **Administrator Username**), and a **Return to Setup** button. [unverified]
7. Click **Join Game Session** with the name empty. Expected: toast
   **You must select a User in order to log in.** [unverified]
8. Type `Nobody` as the name and click **Join Game Session**. Expected: toast
   **The requested User, "Nobody", does not exist.** [unverified]
9. Type `Claude`, leave the password empty, click **Join Game Session**. Expected: toast
   **Login as Claude successful, joining game!**, then `/game` loads. [unverified]
10. Look at the Players list (bottom-left). Expected: `Claude [GM]` in the connected list;
    hovering shows **Gamemaster**. [unverified]
11. Click the caret `#players-expand`. Expected: the players not connected (Gamemaster,
    Player) appear. Click again: they hide. [unverified]
12. Right-click your own row (Claude). Expected: **User Configuration**; no Kick, Ban or
    Pull To Scene. Press Esc. [unverified]
13. Expand the list and right-click **Player** (not connected). Expected: **User Configuration**
    and **Ban Player** (plus **View Player Avatar** if Player has an avatar or a character); no
    **Kick Player** or **Pull To Scene**. Press Esc without choosing.
    [unverified]
14. Right-click Claude > **User Configuration**. Expected: window
    **User Configuration: Claude** with **Player Information** (**Player Name** disabled,
    **Player Avatar**, **Player Color**, **Player Pronouns**), **Player Character**, and
    **Save Player Configuration**. [unverified]
15. Open the **Player Character** select. Expected: a blank option plus actors grouped under
    **Owner** (all of them, for a GM); actors assigned to others are disabled. Close the window
    with X (no save). [unverified]
16. Click the sidebar tab **Settings**. Expected: `ui.sidebar.tabGroups.primary === "settings"`,
    and the sections **Settings and Configuration**, **Help and Documentation** and
    **Game Access**. [unverified]
17. Scroll the Settings tab. Expected buttons: **Game Settings**, **Controls Configuration**,
    **Module Management**, **World Configuration**, **User Management**, **Tour Management**,
    **Support & Issues**, **Documentation**, **Community Wiki**, **Invitation Links**,
    **Log Out**, **Return to Setup** (do not click the last). [unverified]
18. Click **Invitation Links**. Expected: window **Game Invitation Links** with
    **Local Network** and **Internet** rows; the Internet value is masked. Do not click the
    eye or refresh. Close. [unverified]
19. Click **Game Settings**. Expected: window **Game Settings** with the **Core** category
    active and a row **User Permissions** with a **User Permissions** button. [unverified]
20. Click that **User Permissions** button. Expected: window **User Permission Configuration**
    with columns **Permission**, **Player**, **Trusted Player**, **Assistant Gamemaster**,
    **Gamemaster**, and buttons **Reset Defaults** and **Save Configuration**. [unverified]
21. Look at the row **Upload Files**. Expected: Assistant Gamemaster and Gamemaster ticked;
    the Gamemaster cell greyed (locked). Close the window with X (do not save or reset).
    Close Game Settings. [unverified]
22. Click **World Configuration**. Expected: window **Edit World: AI Tool Test** with
    **World Title**, **Background Image**, **Join Page Theme** (**Default**/**Minimal**),
    **Next Session**, **World Description**, and **Update World**. No
    **Reset User Passwords**. Close with X. [unverified]
23. Press Esc with nothing open. Expected: Main Menu with **Reload Application**, **Log Out**,
    **User Management**, **Return to Setup**. Press Esc: it closes. [unverified]
24. Settings tab > **User Management**. Expected: the browser goes to `/players`; heading
    **User Management**; columns **User Name**, **Password**, **User Role**; one row per user
    with the **Login as User** and **Delete User** icons; footer **Create Additional User**,
    **Configure User Permissions**, **Save and Return**. [unverified]
25. Open the role select on the **Player** row. Expected options: **None**, **Player**,
    **Trusted Player**, **Assistant Gamemaster**, **Gamemaster**. Press Esc; change nothing.
    [unverified]
26. Click **Configure User Permissions**. Expected: the same **User Permission Configuration**
    window over the page. Close it with X. [unverified]
27. (writes) Click **Create Additional User**. Expected: a new row `Player4` (or the next free
    number), role Player; `game.users.getName("Player4")` already exists before any Save.
    [unverified]
28. (writes, cleanup for 27) Click that row's **Delete User**. Expected: dialog
    **Delete User: Player4** with **Delete** / **Cancel**. Click **Delete**: the row
    disappears. [unverified]
29. Click **Save and Return** without other changes. Expected: toast
    **Game users updated successfully, returning to the game World.**, then `/game`.
    [unverified]
30. Open the **Journal** tab and right-click an entry (or a throwaway `zz-ownership-test` entry
    you created). Expected: a menu entry **Configure Ownership**. [unverified]
31. Click **Configure Ownership**. Expected: window **Ownership Configuration: {name}** with the
    hint, **Show GM Users** unticked, row **All Players** (None/Limited/Observer/Owner), a row
    for **Player** with **Default** as the first option, and **Save Changes**. [unverified]
32. Tick **Show GM Users**. Expected: Claude and Gamemaster rows appear with a crown icon; the
    author's row reads **Author** instead of a select. Close with X (no save). [unverified]
33. Open that document's sheet and click the header ⋮ (**Toggle Controls**). Expected: an entry
    **Configure Ownership**. Press Esc. [unverified]
34. In the Journal (or Actors) tab, right-click a folder header, if one exists. Expected:
    **Configure Ownership**; the dialog's selects include **No Change**. Close with X.
    [unverified]
35. Open the **Scenes** tab and right-click a scene. Expected: no **Configure Ownership** entry.
    Press Esc. [unverified]
36. Settings tab > **Log Out**. Expected: straight to `/join`, no confirmation. [unverified]
37. Join as `Player` (empty password). Expected: `/game` loads; the Players list shows Player;
    no **Scenes** tab in the sidebar. [unverified]
38. As Player, open the Settings tab. Expected: **Active Modules** instead of
    **Module Management**; no **World Configuration**, **User Management**,
    **Invitation Links** or **Return to Setup**; **Log Out** present. [unverified]
39. As Player, click **Game Settings**. Expected: no **User Permissions** row in **Core**.
    Close. [unverified]
40. As Player, press Esc with nothing open. Expected: Main Menu with only
    **Reload Application** and **Log Out**. Press Esc. [unverified]
41. As Player, expand the Players list and right-click **Claude**. Expected: no
    **User Configuration** (at most **View Player Avatar**). Right-click your own row:
    **User Configuration** is offered. Press Esc. [unverified]
42. As Player, check a directory against a document whose All Players level is None (from
    step 31). Expected: it is not listed. [unverified]
43. Settings tab > **Log Out**, then join as `Claude`. Expected: back in `/game` as GM; the
    `game.users` snapshot matches the one taken before step 1. [unverified]

## Sources

Official (foundryvtt.com):
- [KB: Users and Permissions](https://foundryvtt.com/article/users/) (page shows v13.350)
- [KB: Game Worlds](https://foundryvtt.com/article/game-worlds/)
- [KB: Settings](https://foundryvtt.com/article/settings/) (page shows v13.351)
- [API v14: User](https://foundryvtt.com/api/classes/foundry.documents.User.html)
- [API v14: DocumentOwnershipConfig](https://foundryvtt.com/api/classes/foundry.applications.apps.DocumentOwnershipConfig.html)
- [API v14: PermissionConfig](https://foundryvtt.com/api/classes/foundry.applications.apps.PermissionConfig.html)
- [API v14: Players](https://foundryvtt.com/api/classes/foundry.applications.ui.Players.html)
- [API v14 index](https://foundryvtt.com/api/)

Community and system (leads only; the wiki pages rendered empty through the fetch tool and
were not used for facts):
- [Community wiki: Setting up Players](https://foundryvtt.wiki/en/setup/Setting-up-Players)
- [Community wiki: Using Permissions in Foundry](https://foundryvtt.wiki/en/development/guides/permissions)
- [dnd5e issue #2869 (limited sheets)](https://github.com/foundryvtt/dnd5e/issues/2869)

Local v14 install (ground truth, read-only):
- `C:/FoundryTest/app/public/lang/en.json` (all core labels quoted here)
- `C:/FoundryTest/app/public/scripts/foundry.mjs` (`JoinGameForm`, `UserManagement`)
- `C:/FoundryTest/app/templates/setup/parts/join-form.hbs`, `join-details.hbs`, `join-setup.hbs`, `join-world.hbs`, `user-management-form.hbs`, `user-management-user.hbs`
- `C:/FoundryTest/app/templates/setup/setup-authentication.hbs`
- `C:/FoundryTest/app/dist/server/views/join.mjs`, `C:/FoundryTest/app/dist/sessions.mjs`, `C:/FoundryTest/app/dist/packages/world.mjs`, `C:/FoundryTest/app/dist/database/documents/setting.mjs`
- `C:/FoundryTest/app/client/game.mjs`
- `C:/FoundryTest/app/client/applications/ui/players.mjs`, `main-menu.mjs`; `C:/FoundryTest/app/templates/ui/players.hbs`, `main-menu.hbs`
- `C:/FoundryTest/app/client/applications/sidebar/tabs/settings.mjs`; `C:/FoundryTest/app/templates/sidebar/tabs/settings.hbs`
- `C:/FoundryTest/app/client/applications/sidebar/apps/invitation-links.mjs`, `world-config.mjs`; `C:/FoundryTest/app/templates/sidebar/apps/invitation-links.hbs`, `world-config.hbs`, `compendium-ownership.hbs`
- `C:/FoundryTest/app/client/applications/sheets/user-config.mjs`; `C:/FoundryTest/app/templates/sheets/user-config.hbs`
- `C:/FoundryTest/app/client/applications/apps/permission-config.mjs`, `document-ownership.mjs`; `C:/FoundryTest/app/templates/apps/permission-config.hbs`, `document-ownership.hbs`
- `C:/FoundryTest/app/client/applications/api/document-sheet.mjs`, `application.mjs`, `category-browser.mjs`
- `C:/FoundryTest/app/client/applications/settings/config.mjs`
- `C:/FoundryTest/app/client/applications/sidebar/sidebar.mjs`, `document-directory.mjs`, `tabs/scene-directory.mjs`
- `C:/FoundryTest/app/client/applications/sheets/journal/journal-entry-sheet.mjs`, `dialog-show.mjs`
- `C:/FoundryTest/app/client/documents/collections/compendium-collection.mjs`
- `C:/FoundryTest/app/client/documents/abstract/client-document.mjs`, `C:/FoundryTest/app/client/documents/user.mjs`
- `C:/FoundryTest/app/common/constants.mjs`, `C:/FoundryTest/app/common/documents/user.mjs`, `setting.mjs`, `actor.mjs`, `item.mjs`, `journal-entry.mjs`, `C:/FoundryTest/app/common/abstract/document.mjs`
- `C:/FoundryTest/app/client/helpers/interaction/client-keybindings.mjs`
- `C:/FoundryTest/data/Data/systems/dnd5e/dnd5e.mjs` (settings, `LIMITED_PARTS`, `ownershipConfig`), `C:/FoundryTest/data/Data/systems/dnd5e/templates/actors/limited-header.hbs`, `limited-body.hbs`, `C:/FoundryTest/data/Data/systems/dnd5e/lang/en.json`

Project:
- `.claude/skills/foundry-test-env/SKILL.md` (test world users, rules)
- `CLAUDE.md` (never type passwords; live ports)
