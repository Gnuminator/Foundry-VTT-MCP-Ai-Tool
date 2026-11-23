# dnd5e System Settings and Menus

> Status: DRAFT from documentation and the local v14 source; not yet verified on the running client. The click-through pass stamps "verified on Foundry 14.368 / dnd5e 6.0.5, <date>".

Scope: every dnd5e 6.0.5 entry in **Game Settings** under **Dungeons & Dragons Fifth Edition**
(6 sub-menu buttons + 23 settings = 29 for a GM), the six sub-menu windows, the
**Welcome to D&D 5e** window, the **Compendium Browser**, and the dnd5e additions to the
Settings sidebar tab. Setting keys are given as `dnd5e.<key>` so the console checks below
can find them.

Conventions used on this page:

- "GM" = Gamemaster, or any user whose role has **Modify Configuration Settings**
  (Assistant GM has it by default). "Player" = Player or Trusted Player.
- "world" scope = stored in the world database, applies to everyone. "client" scope =
  stored in this browser only (the browser pane keeps its own copy). "user" scope =
  stored per user in the world.
- "Reload" = after **Save Changes** a **Reload Application?** dialog appears (buttons
  **Yes** / **No**; **No** is the default). For world settings, **Yes** reloads every
  connected client.

Sources for this section: `C:/FoundryTest/app/client/applications/settings/config.mjs`,
`C:/FoundryTest/app/common/constants.mjs` (SETTINGS_MODIFY default role),
`C:/FoundryTest/data/Data/systems/dnd5e/dnd5e.mjs` (`registerSystemSettings`),
https://foundryvtt.com/article/settings/

## How to reach it

- **Settings** sidebar tab - the gear icon at the bottom of the right-hand icon column;
  the icon button has aria-label "Settings". Path: right sidebar > Settings. All users.
  Gotcha: if the sidebar is collapsed, clicking a tab icon also expands it; the collapse
  toggle is the caret button below the icons ("Expand"/"Collapse"). [unverified]
- **Game Settings** - button under the heading "Settings and Configuration" in the
  Settings tab. Opens the window titled **Game Settings** (id `settings-config`). All users;
  what each user sees depends on role (below). [unverified]
- **Dungeons & Dragons Fifth Edition** - category in the left column of the Game Settings
  window, always second (after **Core**, before modules), followed by a count such as
  `[29]`. Path: Settings > Game Settings > Dungeons & Dragons Fifth Edition. The count is
  29 for a GM and 7 for a Player (the Calendar menu plus the six client settings). [unverified]
- Search box at the top of the left column (aria-label "Filter", placeholder is a
  magnifier glyph, gets focus when the window opens). Typing hides non-matching rows in
  every category and updates each category count. [unverified]
- **Save Changes** (footer, right pane) saves every changed field in every category, then
  closes the window. **Reset Defaults** (bottom of the left column) refills every field of
  every category with defaults but saves nothing until **Save Changes**. Closing with the
  window X discards unsaved edits. [unverified]
- Row order in the dnd5e category: the six sub-menu buttons first (registration order),
  then the 23 settings (registration order), exactly as listed in the next two sections. [unverified]

Sources: `C:/FoundryTest/app/client/applications/sidebar/sidebar.mjs`,
`C:/FoundryTest/app/client/applications/sidebar/tabs/settings.mjs`,
`C:/FoundryTest/app/templates/sidebar/tabs.hbs`,
`C:/FoundryTest/app/templates/sidebar/tabs/settings.hbs`,
`C:/FoundryTest/app/client/applications/api/category-browser.mjs`,
`C:/FoundryTest/app/templates/category-browser/{sidebar,main,reset}.hbs`,
`C:/FoundryTest/app/templates/settings/config-category.hbs`,
`C:/FoundryTest/app/public/lang/en.json` (SIDEBAR.SETTINGS.*, SETTINGS.*, PACKAGECONFIG.*),
https://foundryvtt.com/api/v14/classes/foundry.applications.settings.SettingsConfig.html

## Settings sidebar additions (dnd5e)

- **Game System** block - dnd5e replaces the core system line with its own block: a D&D
  badge image (tooltip "Dungeons & Dragons Fifth Edition"), the version `6.0.5`, and links
  **Notes**, **Issues**, **Wiki**, **Discord** (open external pages in a new tab). Path:
  Settings tab, below the Foundry build info. All users. Read-only. [unverified]
- **Welcome Screen** - button directly under the Game System block; opens the
  **Welcome to D&D 5e** window (see its section). All users (players get a read-only
  form). Gotcha: closing that window as GM saves its form. [unverified]

Sources: `dnd5e.mjs` `renderSettings()` and `_generateLinks()` (about line 81374-81426),
`C:/FoundryTest/data/Data/systems/dnd5e/lang/en.json` (DND5E.WELCOME.Button, DND5E.Notes etc.)

## Sub-menu buttons in the dnd5e category (6)

Each row shows a label on the left and a button on the right. The button text is the
bold label. All open a separate window with its own **Save Changes** button except
Configure Sources (instant save, see below).

- **Configure Sources** (row "Compendium Browser Sources", key
  `dnd5e.packSourceConfiguration`) - chooses which compendium packs feed the Compendium
  Browser. GM only (restricted). Reversible by re-ticking. Gotcha: every tick saves at
  once; there is no Save or Cancel. [unverified]
- **Configure Bastions** (row "Bastions", key `dnd5e.bastionConfiguration`) - turns the
  2024 DMG bastion system on and sets turn options. GM only. Reversible. [unverified]
- **Configure Calendar** (row "Calendar", key `dnd5e.calendarConfiguration`) - calendar
  HUD, calendar type, daily recovery, and per-user display preferences. Visible to
  **all users** (not restricted); players see only the preferences part. Reversible;
  changing the calendar type needs a reload. [unverified]
- **Configure Combat** (row "Combat", key `dnd5e.combatConfiguration`) - initiative,
  critical damage, NPC automation, downed conditions, encounter placement. GM only.
  Reversible. [unverified]
- **Configure Variant Rules** (row "Variant Rules", key
  `dnd5e.variantRulesConfiguration`) - rests, proficiency, leveling, encumbrance,
  currency weight, optional ability/attribute scores. GM only. Reversible; Honor and
  Sanity need a reload. [unverified]
- **Configure Visibility** (row "Visibility", key `dnd5e.visibilityConfiguration`) -
  what players see of DCs, attack results, bloodied state and NPC item descriptions. GM
  only. Reversible. [unverified]

Sources: `dnd5e.mjs` `registerSystemSettings()` `registerMenu` calls (about line
57667-58000); `lang/en.json` (SETTINGS.DND5E.*.Label/Name, DND5E.*.Configuration.*,
DND5E.CompendiumBrowser.Sources.*)

## Top-level settings in the dnd5e category (23)

Listed in on-screen order. "Default" is the value on a fresh world.

### Rules

- **Rules Version** (`dnd5e.rulesVersion`, world, select) - switches system behavior
  between the 2024 and 2014 rule sets (spell lists, rules references, exhaustion,
  languages, some condition effects, terminology such as Species/Race). Options:
  **Modern Rules (2024)** (default), **Legacy Rules (2014)**. GM only. Reversible, but
  needs a world reload. Test world is on Modern. Gotcha: do not change it in the test
  world unless the test needs it; it changes rules for every actor. [unverified]

### Automation and canvas (world, GM only)

- **Movement Automation** (`dnd5e.movementAutomation`, select) - how much token movement
  the system automates. Options: **Full** (default; difficult terrain plus token
  blocking), **Partial** (difficult terrain only), **None**. Reversible, no reload.
  [unverified]
- **Disable Falling Automation** (`dnd5e.disableFalling`, checkbox, default off) - stops
  the system tracking the falling state of tokens. Reversible. [unverified]
- **Sync Token Size** (`dnd5e.tokenSizeSync`, checkbox, default on) - token width,
  height and scale follow the actor's size category. Reversible; needs a reload.
  [unverified]
- **Sync Senses to Token Vision** (`dnd5e.senseVisionSync`, checkbox, default on) - token
  vision range, vision mode and detection modes follow the actor's senses. Saving it
  redraws the canvas. Reversible. [unverified]
- **Grid-Aligned Square Templates** (`dnd5e.gridAlignedSquareTemplates`, checkbox,
  default on) - square areas created by spells or items snap to the grid and cannot be
  rotated. Reversible. [unverified]

### Character automation (world, GM only)

- **Disable level-up automation** (`dnd5e.disableAdvancements`, checkbox, default off) -
  no prompts for character-creation or level-up choices. Reversible. [unverified]
- **Disable concentration tracking** (`dnd5e.disableConcentration`, checkbox, default
  off) - turns off automatic concentration tracking. Reversible. [unverified]
- **Disable exhaustion automation** (`dnd5e.disableExhaustion`, checkbox, default off) -
  exhaustion levels stop applying their automatic penalties. Reversible; needs a reload.
  [unverified]

### Chat display (client, every user, this browser only)

- **Summary Chat Cards** (`dnd5e.chatCardSummary`, checkbox, default on) - some results
  are appended as short summaries instead of full cards. Reversible. [unverified]
- **Collapse Item Cards in Chat** (`dnd5e.autoCollapseItemCards`, checkbox, default off) -
  item card descriptions start collapsed; re-renders the chat log. Reversible. [unverified]
- **Collapse Trays in Chat** (`dnd5e.autoCollapseChatTrays`, select) - when damage, hit
  and effect trays collapse. Options in order: **Never Collapse** (value `manual`),
  **Collapse After Use** (value `never`), **Collapse Older Trays** (value `older`,
  default), **Collapse All** (value `always`). Gotcha: values and labels do not match
  (`never` means "Collapse After Use"). Reversible. [unverified]
- **Chat Log Theme** (`dnd5e.chatLogTheme`, select) - theme for the chat log only.
  Options: **Default** (follows the app theme; default), **Dark**, **Light**. Reversible.
  [unverified]

### Player permissions (world, GM only)

- **Allow Player Damage Application** (`dnd5e.allowPlayerDamageTray`, checkbox, default
  off) - players may apply damage from chat to tokens they own. Reversible. [unverified]
- **Allow Player Effect Application** (`dnd5e.allowPlayerEffectsTray`, checkbox, default
  off) - players may use the effect tray when their actor is a target. Reversible.
  [unverified]
- **Allow Individual Rests** (`dnd5e.allowRests`, checkbox, default on) - players may
  rest from their own sheets; when off they rest only when the GM requests it for the
  party. Reversible. [unverified]
- **Allow Transformation** (`dnd5e.allowPolymorphing`, checkbox, default off) - players
  may transform (polymorph) their own actors; they also need the core Create Actors and
  Create Tokens permissions. Reversible. [unverified]
- **Allow Summoning** (`dnd5e.allowSummoning`, checkbox, default off) - players may use
  summoning abilities; they also need the core Create Tokens permission. Reversible.
  [unverified]

### Units (world, GM only)

- **Use Metric Length Units** (`dnd5e.metricLengthUnits`, default off) - meters instead of
  feet as the default for movement and senses. Reversible. [unverified]
- **Use Metric Volume Units** (`dnd5e.metricVolumeUnits`, default off) - liters instead of
  cubic feet for container capacity. Reversible. [unverified]
- **Use Metric Weight Units** (`dnd5e.metricWeightUnits`, default off) - kg instead of lb,
  including encumbrance math. Reversible. [unverified]

### UI hints and NPC sheet (client, every user, this browser only)

- **Enable Control Hints** (`dnd5e.controlHints`, checkbox, default on) - shows mouse and
  keyboard hints in dnd5e windows. Reversible. [unverified]
- **Default Skills** (`dnd5e.defaultSkills`, multi-choice of skills, default none) -
  skills always listed on NPC sheets regardless of proficiency. Gotcha: client scope,
  so it applies only to the browser where it was set. Reversible. Exact control type
  (multi-select vs checkboxes) to be confirmed. [unverified]

Sources: `dnd5e.mjs` lines about 57396-58084; `lang/en.json` keys `SETTINGS.DND5E.*`,
`SETTINGS.5e*`, `DND5E.Controls.*`; https://github.com/foundryvtt/dnd5e/wiki/FAQ (rules
version effects)

## Sub-menu windows

All dnd5e sub-menu windows (except Configure Sources) are small forms with fieldsets and a
footer button **Save Changes**; saving closes the window and, if needed, shows the reload
dialog. Checkboxes in these windows are `<dnd5e-checkbox>` custom elements (role
checkbox), not native inputs. Field names have no `dnd5e.` prefix (e.g. `restVariant`).

### Configure Variant Rules (GM only)

Window title **Configure Variant Rules**. Settings are world scope and hidden from the main
list (`config: false`).

- **General** fieldset: [unverified]
  - **Allow Feats** (`allowFeats`, default on) - feat instead of ability score
    improvement at class levels. Shown only when Rules Version is Legacy. [unverified]
  - **Rest Variant** (`restVariant`) - **Player's Handbook (LR: 8 hours, SR: 1 hour)**
    (default), **Gritty Realism (LR: 7 days, SR: 8 hours)**, **Epic Heroism (LR: 1 hour,
    SR: 1 min)**. [unverified]
  - **Proficiency Variant** (`proficiencyModifier`) - **PHB: Bonus (+2, +3, +4, +5, +6)**
    (default) or **DMG: Dice (1d4, 1d6, 1d8, 1d10, 1d12)**. [unverified]
  - **Leveling Mode** (`levelingMode`) - **Level Advancement without XP**, **Experience
    Points**, **Experience Points with Epic Boons** (default). [unverified]
- **Encumbrance** fieldset: [unverified]
  - **Encumbrance Tracking** (`encumbrance`) - **None** (default), **Normal (max carrying
    capacity)**, **Variant (encumbered & heavily encumbered)**; applies status effects
    to overloaded characters. [unverified]
  - **Track Currency Weight** (`currencyWeight`, default on) - carried coins count toward
    encumbrance. [unverified]
- **Abilities** fieldset: **Honor Ability Score** (`honorScore`) and **Sanity Ability
  Score** (`sanityScore`), both default off, both need a world reload. [unverified]
- **Attribute Scores** fieldset: **Loyalty Score** (`loyaltyScore`) and **Piety Score**
  (`pietyScore`), both default off, no reload. [unverified]

### Configure Combat (GM only)

Window title **Configure Combat**. All world scope.

- **Initiative** fieldset: **Dexterity Tiebreaker** (default off; adds the raw DEX score
  to break ties), **Initiative Score** (**Always Roll for Initiative** default, **Use
  Score for GM NPCs**, **Use Score for Everyone**; score = 10 + bonus), **Roll Once per
  Creature** (default on; identical creatures share one roll), **Group Combatants**
  (default on; tracker groups combatants with the same initiative). [unverified]
- **Critical Damage** fieldset: **Multiply Modifiers** (default off), **Maximize Dice**
  (default off). [unverified]
- **NPCs** fieldset: **Recharge Abilities** (**Do not recharge automatically** default,
  **Recharge without creating chat card**, **Recharge and display chat card**; rolls at
  the start of the NPC's turn) and **Hit Points** (**Do not roll** default, **Roll
  without creating chat card**, **Roll and create chat card**; rolls NPC max HP when a
  token is created). [unverified]
- **Conditions** fieldset: **Auto-Apply Downed** - **Never** (default), **For NPCs (dead
  only)**, **For NPCs (dead and unconscious)**, **Always**; marks creatures at 0 HP in
  combat as Dead or Unconscious. [unverified]
- **Encounters** fieldset: **Placement Options** - **Do Nothing** (default), **Add to
  Combat**, **Add to Combat and Roll Initiative**; what happens when an encounter's
  members are placed on a scene. [unverified]

### Configure Visibility (GM only)

Window title **Configure Visibility**, one fieldset **Configuration**. World scope.

- **Challenge Visibility** (`challengeVisibility`) - which roll DCs players see and
  whether success/failure is highlighted: **Show all**, **Show only from other players**
  (default), **Hide all**. [unverified]
- **Attack Result Visibility** (`attackRollVisibility`) - **Show results & target ACs**,
  **Show only results**, **Hide all** (default). [unverified]
- **Bloodied Status** (`bloodied`) - **Display for Friendly, Neutral, & Hostile Tokens**,
  **Only Display for Friendly Tokens** (default), **Never Display**. [unverified]
- **Conceal NPC Descriptions** (`concealItemDescriptions`, default off) - hides NPC item
  descriptions from players in chat unless the item has a chat description. [unverified]

### Configure Bastions (GM only)

Window title **Configure Bastions**, one fieldset **Configuration**. World scope, stored
as one object `dnd5e.bastionConfiguration`.

- **Enable Bastion Functionality** (`bastionConfiguration.enabled`, default off) - player
  characters of level 5+ get a Bastion tab on their sheets. [unverified]
- **Show Bastion Turn Button** (`bastionConfiguration.button`, default off) - adds a GM
  button next to the scene controls (id `bastion-turn`), labelled **Advance Bastion Turn**
  (or **Maintain Bastion** when the calendar is enabled). Only shows when bastions are
  enabled too. Gotcha: clicking it asks for confirmation and then changes every bastion.
  [unverified]
- **Bastion Turn Duration (days)** (`bastionConfiguration.duration`, default 7).
  [unverified]
- **Automatic Turn Reminder** (`bastionConfiguration.reminder`, default on) - chat
  reminder when enough in-game time has passed for a turn. [unverified]

### Configure Calendar (all users; GM part is GM only)

Window title **Configure Calendar**.

- **Configuration** fieldset (GM only; absent for players): [unverified]
  - **Enabled** (`calendarConfig.enabled`, default off) - shows the calendar HUD to all
    users. [unverified]
  - **Calendar** (`calendar`) - **Gregorian Calendar** (default), **Calendar of
    Greyhawk**, **Calendar of Harptos (Forgotten Realms)**, **Calendar of Khorvaire
    (Eberron)**. Needs a world reload. [unverified]
  - **Daily Recovery Mode** (`calendarConfig.dailyRecovery`) - **Default (tied to
    calendar enabled setting)**, **Calendar Recovery (via time passing)**, **Manual
    Recovery (via rest dialog)**; controls day/dawn/dusk item recovery. [unverified]
- **Calendar Preferences** fieldset (user scope, each user their own): **Display Calendar
  HUD** (default on), **Date Format** and **Time Format** (choices grouped as Date
  Formatters: **Month & Day**, **Month, Day, & Year**, **Approximate Date**; Time
  Formatters: **Hours & Minutes**, **Hours, Minutes, & Seconds**, **Approximate Time**;
  defaults Month & Day / Hours & Minutes). Disabled for players, with a warning note,
  until the GM enables the calendar. [unverified]
- Calendar HUD (id `calendar-hud`) - appears at the top centre of the game UI when
  Enabled and Display Calendar HUD are both on. GM buttons advance or reverse world time
  (default step 1 hour; other steps 7 days, 1 day, 8 hours, 10 min, 1 min) and **Set
  Date**. Gotcha: time changes are world data for everyone. [unverified]

### Configure Sources (GM only)

Window title **Configure Sources** (id `compendium-browser-source-config`), resizable,
800x650.

- Left column: **Filter Packages** search box, then **World**, **System**, and one row per
  module that has Actor or Item packs; each row has a checkbox (may be indeterminate) and
  a pack count. Clicking a row name selects that package. [unverified]
- Right side: **Items** and **Actors** cards listing that package's packs, each with a
  checkbox, plus an **all** checkbox when there is more than one pack. System packs show
  a tag **5.1** (2014 SRD) or **5.2** (2024 SRD). [unverified]
- Gotcha: each tick immediately rewrites the world setting and refreshes open Compendium
  Browsers. No Save/Cancel. Undo by ticking back. [unverified]
- On a world's first Welcome-screen save, dnd5e unticks the SRD packs of the other rules
  version (under Modern, the 5.1 packs). Expect that state in the test world. [unverified]

Sources: `dnd5e.mjs` classes `BaseSettingsConfig`, `BastionSettingsConfig`,
`CalendarSettingsConfig`, `CombatSettingsConfig`, `VariantRulesSettingsConfig`,
`VisibilitySettingsConfig` (about line 56361-56913), `BastionSetting` (56311),
`CalendarConfigSetting`/`CalendarPreferencesSetting` (56535-56591),
`CompendiumBrowserSettingsConfig` (38460), `BaseCalendarHUD`/`CalendarHUD` (3693, 3888),
bastion `initializeUI` (93807), `DND5E.calendar` (54936);
`templates/settings/{base-config,bastion-config}.hbs`,
`templates/compendium/{sources-sidebar,sources-packs}.hbs`, `system.json` (pack
sourceBook flags); https://github.com/foundryvtt/dnd5e/wiki/Calendar ,
https://github.com/foundryvtt/dnd5e/issues/5102

## Welcome to D&D 5e window

- **Welcome to D&D 5e** - window (id `dnd5e-welcome-screen`, handshake icon, width 720).
  Opens by itself only for a GM on the world's first launch (setting `dnd5e.firstRun`)
  or after an adventure quick-start; otherwise via Settings > **Welcome Screen**. All
  users can open it; for players every field is disabled and nothing is saved.
  [unverified]
- Tabs **Welcome** and **Official Content**. [unverified]
- **Welcome** tab: banner image, intro with links (release changes, documentation wiki,
  Official Content hint, Discord/issues), then a **Settings** card with **Rules Version**,
  **Calendar** (the blank choice means calendar off), **Enable Bastion Functionality** and
  **Use Metric System** (sets all three metric settings; shows indeterminate if they
  differ). An **Adventure Options** card appears only after an adventure import.
  [unverified]
- **Official Content** tab: sections **Core Rulebooks**, **Expanded Rulebooks**,
  **Adventures**, **More Content**; each product shows **Not Installed** or an
  **Enabled** checkbox if the module is installed. [unverified]
- There is no Save button. Gotcha: closing the window as GM submits the form. Changed
  Rules Version, Calendar or module ticks then trigger the reload dialog; ticking a
  module rewrites the world's module list. On the first run it also sets the Compendium
  Browser sources and clears `firstRun`. Close without touching anything to avoid writes.
  The window also fetches a product list from raw.githubusercontent.com. [unverified]

Sources: `dnd5e.mjs` class `WelcomeScreen` (about line 81006-81367), ready hook and
`_handleMigration` (96504-96585); `templates/apps/welcome-{main,modules}.hbs`;
`json/official-content.json`; `lang/en.json` (DND5E.WELCOME.*)

## Compendium Browser (summary)

- **Open Compendium Browser** - button in the header of the **Compendium Packs** sidebar
  tab (book-atlas icon, aria-label "Compendium Packs"). All users. Also the keybinding
  **Open Compendium Browser** (default Shift+B; listed under Controls Configuration).
  Read-only browsing. [unverified]
- **Compendium Browser** - window (class `compendium-browser`, 850x700, resizable,
  minimizable). Several can be open. [unverified]
- Left vertical tabs (icon-only, names in tooltips/aria-labels): **Classes**,
  **Subclasses**, **Species** (reads Races under Legacy rules), **Feats**,
  **Backgrounds**, **Items** (initial tab), **Spells**, **Monsters**, **Vehicles**.
  [unverified]
- **Advanced** - slide toggle in the header. On: tabs become **Actors** and **Items** with
  a type list for filtering. Off: the category tabs above. UI state only. [unverified]
- Sidebar: search field (placeholder **Search results**) with a clear (x) button, a type
  list (advanced mode), and filters per tab (ranges, sets, yes/no filters). [unverified]
- Results list: clicking an entry opens that document's sheet. Loads in batches of 50
  while scrolling. [unverified]
- Gear icon in the window header (GM only, aria-label **Configure Sources**) - opens the
  Configure Sources window. [unverified]
- Selection mode (opened by the system for choices such as picking a class): locked
  filters, no mode toggle, footer shows "Selected: ..." and a **Select** button.
  [unverified]

Sources: `dnd5e.mjs` class `CompendiumBrowser` (about line 38814-40095, `injectSidebarButton`
about line 40076) and keybinding `openCompendiumBrowser` (57352);
`templates/compendium/browser-*.hbs`; `C:/FoundryTest/app/templates/sidebar/tabs/compendiums.hbs`;
https://github.com/foundryvtt/dnd5e/wiki/Compendium-Browser

## Hidden dnd5e settings (not in Game Settings; console only)

Useful for state checks; never edit them by hand.

- `systemMigrationVersion` (world) - last migrated system version. [unverified]
- `firstRun` (world) - true until the first Welcome save; controls the auto Welcome
  window. [unverified]
- `packSourceConfiguration` (world) - map of pack id to true/false for the browser.
  [unverified]
- `bastionTurns` (world), `primaryParty` (world; the primary party actor),
  `strictValidation` (world), `calendarPreferences` (user),
  `transformationSettings` and `defaultDocumentSubtypes` (client). [unverified]

Sources: `dnd5e.mjs` `registerSystemSettings()` / `registerDeferredSettings()`

## Driving it from automation

Read-only console checks (run in the browser pane's page context). None of these write.

```js
// Sidebar state (v14 has no ui.sidebar.activeTab; use tabGroups)
ui.sidebar.tabGroups.primary      // "settings" or "compendium" when those tabs are open
ui.sidebar.expanded               // false = collapsed
ui.settings.active                // true when the Settings tab is showing

// Game Settings window
game.settings.sheet.rendered                     // window open?
game.settings.sheet.tabGroups.categories         // "system" = dnd5e category selected
document.querySelector('#settings-config button[data-tab="system"] [data-count]')?.textContent // "[29]" for GM

// What the dnd5e category should list for the current user
const canCfg = game.user.can("SETTINGS_MODIFY");
const menus = [...game.settings.menus.values()]
  .filter(m => m.namespace === "dnd5e" && (!m.restricted || canCfg)).map(m => m.key);
const rows = [...game.settings.settings.values()]
  .filter(s => s.namespace === "dnd5e" && s.config && (s.scope !== "world" || canCfg)).map(s => s.key);
({ menus, rows, total: menus.length + rows.length })   // GM: 6 + 23 = 29; Player: 1 + 6 = 7

// Snapshot of every dnd5e setting value (copy this before and after a test)
Object.fromEntries([...game.settings.settings.values()]
  .filter(s => s.namespace === "dnd5e")
  .map(s => { const v = game.settings.get("dnd5e", s.key); return [s.key, v?.toObject?.() ?? v]; }));

// Which dnd5e windows are open
[...foundry.applications.instances.values()].filter(a => a.rendered)
  .map(a => ({ id: a.id, cls: a.constructor.name, title: a.title }));
// Class of a sub-menu window, e.g. Combat (not all are exported under dnd5e.applications)
game.settings.menus.get("dnd5e.combatConfiguration").type.name  // "CombatSettingsConfig"

// Rules version, calendar and bastion state
dnd5e.settings.rulesVersion                       // "modern" | "legacy"
game.settings.get("dnd5e", "calendarConfig").enabled
dnd5e.settings.bastionConfiguration.toObject()
!!document.getElementById("calendar-hud"), !!document.getElementById("bastion-turn")
```

Programmatic opening (does not change data; prefer clicking in the pass):
`game.settings.sheet.render({force: true})` then
`game.settings.sheet.changeTab("system", "categories")`;
`new dnd5e.applications.CompendiumBrowser().render({force: true})`. Do not open the
Welcome window from code unless you will close it without edits (closing saves).

Stable selectors and accessible names:

| Element | Selector | Accessible name / text |
| --- | --- | --- |
| Settings tab icon | `#sidebar-tabs button[data-tab="settings"]` | "Settings" |
| Compendium tab icon | `#sidebar-tabs button[data-tab="compendium"]` | "Compendium Packs" |
| Game Settings button | `#settings button[data-app="configure"]` | "Game Settings" |
| Welcome Screen button | `#settings .sidebar-info + button` | "Welcome Screen" |
| Game Settings window | `#settings-config` | title "Game Settings" |
| dnd5e category | `#settings-config button[data-tab="system"]` | "Dungeons & Dragons Fifth Edition" |
| Filter box | `#settings-config input[type="search"]` | "Filter" |
| Sub-menu button | `#settings-config button[data-action="openSubmenu"][data-key="dnd5e.<menuKey>"]` | e.g. "Configure Combat" |
| Top-level field | `#settings-config [name="dnd5e.<key>"]` | row label, e.g. "Rules Version" |
| Save / Reset | `#settings-config button[type="submit"]`, `button[data-action="resetDefaults"]` | "Save Changes", "Reset Defaults" |
| Reload dialog | `#reload-world-confirm`, buttons `[data-action="yes"]` / `[data-action="no"]` | "Reload Application?", "Yes", "No" |
| Sub-menu fields | `[name="restVariant"]`, `[name="bastionConfiguration.enabled"]`, `[name="calendarConfig.enabled"]` ... | field labels as listed above |
| Welcome window | `#dnd5e-welcome-screen`, tabs `[data-tab="main"]`, `[data-tab="modules"]` | "Welcome to D&D 5e", "Welcome", "Official Content" |
| Open browser button | `#compendium button.open-compendium-browser` | "Open Compendium Browser" |
| Browser window | `.compendium-browser`; tabs `nav[data-group="primary"] a[data-tab]` | tab names via aria-label |
| Browser mode / search / gear | `[data-action="toggleMode"]`, `input[name="name"]`, `[data-action="configureSources"]` | "Advanced", "Search results", "Configure Sources" |
| Sources window | `#compendium-browser-source-config`, `input[name="filter"]` | "Configure Sources", "Filter Packages" |
| Calendar HUD / bastion button | `#calendar-hud`, `#bastion-turn` | "Advance Bastion Turn" / "Maintain Bastion" |

Driving gotchas:

- Accessibility-tree search: search "Game Settings" (button) and "Dungeons & Dragons
  Fifth Edition" (category button, its name includes the count). Row labels in the right
  pane are `<label>` elements next to the inputs.
- dnd5e sub-menu checkboxes are `dnd5e-checkbox` custom elements; click them rather than
  setting a value, and read state with `el.checked`.
- Only one Game Settings window exists (singleton). Sub-menu windows open on top of it and
  have auto-generated ids; find them by title.
- The Game Settings search does not look inside sub-menus (e.g. "encumbrance" finds
  nothing in the main list).
- After any **Save Changes** that touched a reload setting, a modal **Reload Application?**
  dialog blocks the page until **Yes** or **No**.

Sources: `C:/FoundryTest/app/client/applications/sidebar/{sidebar,sidebar-tab}.mjs`,
`C:/FoundryTest/app/client/helpers/client-settings.mjs` (`sheet`, `set`, `registerMenu`),
`C:/FoundryTest/app/client/applications/api/dialog.mjs` (`confirm`),
`dnd5e.mjs` (global `dnd5e`, `dnd5e.applications`, element ids above),
https://foundryvtt.com/api/v14/classes/foundry.helpers.ClientSettings.html

## Safety in the test world

- Only use world `ai-tool-test` on localhost:30001. Never the live campaign.
- Before changing anything, run the snapshot snippet above and keep the output; undo
  means setting each value back through the same window and saving.
- Opening windows, switching tabs, searching, hovering and closing with the X are safe,
  with one exception: closing **Welcome to D&D 5e** as GM saves its form.
- Changes that write world data (seen by everyone): every world setting above, anything in
  Configure Combat/Variant Rules/Visibility/Bastions/Calendar (GM part), every tick in
  Configure Sources, calendar HUD time buttons, and the bastion turn button.
- Client settings (chat display, Control Hints, Default Skills) change only the browser
  pane's storage; still restore them.
- Avoid unless the test needs it:
  - **Rules Version** (reloads all clients and changes rules for all actors).
  - **Reset Defaults** + **Save Changes**: resets every category, including Core and the
    "Foundry AI Tool" module switches such as "Allow Write Operations". If pressed by
    mistake, close the window with X instead of saving.
  - Ticking products on **Official Content** (rewrites the module list, forces reload).
  - **Advance Bastion Turn** / **Maintain Bastion** (advances every bastion's orders).
  - Calendar type change (reload; changes every displayed date).
  - Honor/Sanity scores (reload; adds ability scores to actors).
  - Unticking **System** in Configure Sources (empties most of the Compendium Browser).
- Saving the Game Settings window with no edits can still create stored records for
  settings that were at their defaults; values do not change.
- Answer **No** in the reload dialog only if you will restore the setting right away;
  otherwise the saved value takes effect on the next reload anyway.

Sources: `C:/FoundryTest/app/client/applications/settings/config.mjs` (`#onResetDefaults`,
`#onSubmit`, `reloadConfirm`), `C:/FoundryTest/app/client/helpers/client-settings.mjs`
(`#setWorld`, `#setClient`), `dnd5e.mjs` (`WelcomeScreen._preClose`,
`CompendiumBrowserSettingsConfig._onToggleSource`, `BaseSettingsConfig.commitChanges`),
`.claude/skills/foundry-test-env/SKILL.md`

## Verification checklist

Log in as the "Claude" GM unless noted. Do not save anything; close every window with its
X.

1. Click the Settings tab icon in the right sidebar. Expect the sidebar to expand and
   show the Foundry build info, a Game System block with the D&D badge and `6.0.5`, links
   Notes / Issues / Wiki / Discord, and a **Welcome Screen** button.
2. Click **Game Settings**. Expect a window titled **Game Settings** with categories
   **Core**, then **Dungeons & Dragons Fifth Edition [29]**, then modules.
3. Click **Dungeons & Dragons Fifth Edition**. Expect six button rows first:
   **Configure Sources**, **Configure Bastions**, **Configure Calendar**, **Configure
   Combat**, **Configure Variant Rules**, **Configure Visibility**.
4. Scroll the right pane. Expect the 23 settings in the order of the "Top-level settings"
   section, ending with **Enable Control Hints** and **Default Skills**.
5. Look at **Rules Version** without changing it. Expect **Modern Rules (2024)** selected;
   options Modern Rules (2024) and Legacy Rules (2014).
6. Open the **Movement Automation** dropdown and press Escape. Expect **Full**, **Partial**,
   **None**, with Full selected.
7. Open **Collapse Trays in Chat** and press Escape. Expect Never Collapse, Collapse After
   Use, Collapse Older Trays (selected), Collapse All.
8. Type `metric` in the filter box. Expect only the three **Use Metric ... Units** rows and
   the dnd5e count `[3]`. Clear the box; count returns to `[29]`.
9. Look at **Default Skills**. Record the control type (multi-select or checkboxes).
10. Click **Configure Variant Rules**. Expect window **Configure Variant Rules** with
    fieldsets General (Rest Variant, Proficiency Variant, Leveling Mode; no Allow Feats
    under Modern), Encumbrance, Abilities, Attribute Scores, and **Save Changes**. Close.
11. Click **Configure Combat**. Expect fieldsets Initiative (4 fields), Critical Damage (2),
    NPCs (2), Conditions (Auto-Apply Downed), Encounters (Placement Options). Close.
12. Click **Configure Visibility**. Expect Challenge Visibility, Attack Result Visibility,
    Bloodied Status, Conceal NPC Descriptions with the defaults listed above. Close.
13. Click **Configure Bastions**. Expect four fields; Enable Bastion Functionality off,
    duration 7, reminder on (unless changed on the Welcome screen). Close.
14. Click **Configure Calendar**. Expect a Configuration fieldset (Enabled, Calendar,
    Daily Recovery Mode) and a **Calendar Preferences** fieldset; if Enabled is off, a
    warning note in the preferences part. Close.
15. Click **Configure Sources**. Expect window **Configure Sources** with **Filter
    Packages**, **World**, **System** and module rows; System selected, Items and Actors
    cards with 5.1/5.2 tags. Record which packs are ticked. Do not click any checkbox.
    Close.
16. Close the Game Settings window with X. Expect no reload dialog.
17. In the console, run the "What the dnd5e category should list" snippet. Expect
    `total: 29`.
18. Run the snapshot snippet and keep the output as the baseline.
19. Click **Welcome Screen**. Expect window **Welcome to D&D 5e** with tabs **Welcome** and
    **Official Content**, and a Settings card with Rules Version, Calendar, Enable Bastion
    Functionality, Use Metric System. Record the blank Calendar choice's label.
20. Click the **Official Content** tab. Expect Core Rulebooks, Expanded Rulebooks,
    Adventures, More Content, products marked **Not Installed**. Touch nothing.
21. Close the Welcome window with X. Expect no reload dialog; re-run the snapshot and
    expect it to match the baseline.
22. Click the Compendium Packs tab icon. Expect **Open Compendium Browser** in the tab
    header.
23. Click **Open Compendium Browser**. Expect window **Compendium Browser**, Items tab
    active, an **Advanced** toggle and (GM) a gear icon in the header.
24. Hover each left tab icon. Expect Classes, Subclasses, Species, Feats, Backgrounds,
    Items, Spells, Monsters, Vehicles.
25. Type `fire` in **Search results**. Expect the list to narrow; click the x to clear.
26. Switch **Advanced** on. Expect only **Actors** and **Items** tabs plus a type list.
    Switch it off again.
27. Click the header gear. Expect **Configure Sources** to open. Close it, then close the
    browser.
28. Click the game canvas, press Shift+B. Expect the Compendium Browser to open. Close it.
29. Check the top centre of the screen. Expect no calendar HUD and no bastion button
    unless those features were enabled (`#calendar-hud`, `#bastion-turn` absent).
30. Optional, as user "Player": open Settings > **Game Settings** > Dungeons & Dragons
    Fifth Edition. Expect `[7]`: **Configure Calendar** plus Summary Chat Cards, Collapse
    Item Cards in Chat, Collapse Trays in Chat, Chat Log Theme, Enable Control Hints,
    Default Skills. **Configure Calendar** shows only Calendar Preferences.
31. Optional, as "Player": open the Compendium Browser. Expect no gear icon.

## Differences between docs and the v14 / 6.0.5 source

- KB article https://foundryvtt.com/article/settings/ (written for 13.351) names the
  sidebar tab "Game Settings" and the button "Configure Settings"; in 14.368 the tab's
  name is **Settings** and the button is **Game Settings**. Other renamed buttons:
  **Controls Configuration**, **Module Management**, **World Configuration**.
- The dnd5e Calendar wiki page calls the button "Calendar Configuration"; 6.0.5 shows row
  **Calendar** with button **Configure Calendar**.
- The dnd5e Compendium Browser wiki speaks of a "standard" mode; 6.0.5 only labels the
  toggle **Advanced** (off = the category tabs).
- Issue #5102 / release 4.3.0 describe smaller Combat and Variant Rules menus; 6.0.5 adds
  encumbrance, currency weight, leveling mode, loyalty/piety, group initiative, NPC
  recharge/HP, downed conditions and encounter placement, plus Visibility, Bastions,
  Calendar and Sources menus. Rules Version stays top-level as proposed.
- `ui.sidebar.activeTab` does not exist in v14; use `ui.sidebar.tabGroups.primary`.

## Sources

- https://foundryvtt.com/article/settings/ (Foundry 13.351)
- https://foundryvtt.com/api/v14/classes/foundry.applications.settings.SettingsConfig.html
- https://foundryvtt.com/api/v14/classes/foundry.helpers.ClientSettings.html
- https://github.com/foundryvtt/dnd5e/wiki/Compendium-Browser (up to date as of 6.0.0)
- https://github.com/foundryvtt/dnd5e/wiki/Calendar (up to date as of 6.0.0)
- https://github.com/foundryvtt/dnd5e/wiki/FAQ
- https://github.com/foundryvtt/dnd5e/issues/5102
- https://github.com/foundryvtt/dnd5e/releases/tag/release-4.3.0
- `C:/FoundryTest/data/Data/systems/dnd5e/dnd5e.mjs` (settings, menus, windows, HUD)
- `C:/FoundryTest/data/Data/systems/dnd5e/lang/en.json`
- `C:/FoundryTest/data/Data/systems/dnd5e/system.json`, `json/official-content.json`
- `C:/FoundryTest/data/Data/systems/dnd5e/templates/settings/`, `templates/apps/welcome-*.hbs`, `templates/compendium/`
- `C:/FoundryTest/app/client/applications/settings/config.mjs`
- `C:/FoundryTest/app/client/applications/api/category-browser.mjs`, `api/dialog.mjs`
- `C:/FoundryTest/app/client/applications/sidebar/sidebar.mjs`, `sidebar-tab.mjs`, `tabs/settings.mjs`
- `C:/FoundryTest/app/client/helpers/client-settings.mjs`
- `C:/FoundryTest/app/common/documents/setting.mjs`, `common/constants.mjs`
- `C:/FoundryTest/app/public/lang/en.json`
- `C:/FoundryTest/app/templates/category-browser/`, `templates/settings/config-category.hbs`, `templates/sidebar/`
- `.claude/skills/foundry-test-env/SKILL.md` (test world facts)
