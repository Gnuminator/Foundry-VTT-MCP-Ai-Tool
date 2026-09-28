# Combat Tracker

> Status: DRAFT from documentation and the local v14 source; not yet verified on the running client. The click-through pass stamps "verified on Foundry 14.368 / dnd5e 6.0.5, <date>".

Scope: the **Combat Encounters** sidebar tab (the combat tracker) in Foundry 14.368 with dnd5e
6.0.5: encounters (create, switch, name, link, end), combatants (add, remove, hide, defeat),
initiative (single, all, NPCs, reset, manual edit), turn and round flow, the combatant and
encounter menus, the **Combat Tracker Settings** window, the Token HUD combat toggle, and the
dnd5e layer on top (initiative formula, roll dialog, group initiative, grouped rows).

Terms used below: *GM* = Gamemaster or Assistant GM; *player* = Player or Trusted Player.
*Viewed encounter* = the Combat the tracker shows (`ui.combat.viewed`, also `game.combat`).
*Row* = one combatant line. Labels are the English strings from core `public/lang/en.json`
and dnd5e `lang/en.json`; icons are Font Awesome class names from the templates.

## How to reach it

- **Combat Encounters** (sidebar tab button, crossed-swords icon `fa-swords`) - right-hand
  sidebar, icon column, second button (after Chat). Click shows the tracker. If the sidebar
  is collapsed, clicking any tab button also expands it. GM and players. UI only, nothing is
  saved. Selector `#sidebar-tabs button[data-tab="combat"]`, `role="tab"`,
  `aria-pressed="true"` when shown. The KB describes a fist icon; v14 uses swords. [unverified]
- **Pop-out** - right-click the same tab button. Opens a floating window titled **Combat
  Tracker** (element id `combat-popout`) that mirrors the sidebar tracker (same viewed
  encounter). Close with its window close button. UI only. [unverified]
- **Collapse** / **Expand** (caret button at the bottom of the tab column) - hides or shows
  the sidebar content. When collapsed, the tracker rows are not on screen, so screenshots and
  clicks by coordinate fail; `read_page` may still list them. [unverified]
- Console equivalents (UI only, no world write): `ui.combat.activate()` switches to the tab
  and expands the sidebar; `ui.combat.renderPopout()` opens the pop-out.
- Other entry points covered below: Token HUD **Enter Combat**; Settings tab > **Game
  Settings** > **Core** > **Combat Tracker**; Settings tab > **Game Settings** > dnd5e
  category > **Configure Combat**; the dnd5e actor sheet initiative roll.
- Needs a viewed scene for anything token-related (add via HUD, pan, ping, click-to-select).
  Encounters themselves can exist without a scene.

Sources: `C:/FoundryTest/app/client/applications/sidebar/sidebar.mjs`,
`C:/FoundryTest/app/client/applications/sidebar/sidebar-tab.mjs`,
`C:/FoundryTest/app/templates/sidebar/tabs.hbs`, `C:/FoundryTest/app/client/config.mjs`
(`CONFIG.Combat.sidebarIcon`), `C:/FoundryTest/app/public/lang/en.json` (`DOCUMENT.Combats`,
`COMBAT.SidebarTitle`), https://foundryvtt.com/article/combat/

## Encounter bar (top of the tracker, GM only)

The bar is `nav.encounters` with aria-label "Combat Encounters Navigation". Players never see
it. It has three layouts, chosen by how many encounters apply to the current scene
(unlinked encounters plus those linked to the viewed scene):

- **No encounters**: one wide **Create Combat** button (plus icon and text). There is no gear
  button in this layout; open the settings through Game Settings instead (see below). [unverified]
- **1 to 7 encounters**: a plus icon button (aria-label **Create Combat**), one numbered button
  per encounter (**1**, **2**, ...; the current one has class `active`; tooltip and accessible
  name are the encounter name when it has one, otherwise only the number), then a gear icon
  (aria-label **Combat Tracker Settings**). [unverified]
- **8 or more encounters**: plus icon, caret **Activate Previous Combat**, a counter
  "current / total", caret **Activate Next Combat**, gear. [unverified]

Controls:

- **Create Combat** - creates an empty Combat document and makes it the active encounter.
  In v14 a new encounter is not linked to any scene, so it shows on every scene (a v13
  change; the KB still says new encounters link to the active scene). World write. Undo:
  **End Combat** (deletes it). [unverified]
- Numbered encounter button / **Activate Previous Combat** / **Activate Next Combat** -
  makes that encounter active (world write on the `active` flag). Players' trackers follow
  the active encounter. Reversible by switching back. [unverified]
- **Combat Tracker Settings** (gear) - opens the settings window, see
  [Combat Tracker Settings window](#combat-tracker-settings-window). [unverified]
- There is no **Delete Encounter** button in v14. Deleting an encounter is done with **End
  Combat**. [unverified]

Sources: `C:/FoundryTest/app/templates/sidebar/tabs/combat/header.hbs`,
`C:/FoundryTest/app/client/applications/sidebar/tabs/combat-tracker.mjs`
(`_prepareCombatContext`, `_onCombatCreate`, `_onCombatCycle`),
`C:/FoundryTest/app/client/documents/collections/combat-encounters.mjs` (`combats`),
https://foundryvtt.com/releases/13.334

## Encounter header (status row)

- **Roll All** (icon `fa-users`, GM only) - rolls initiative for every combatant you own that
  has no initiative yet. Disabled when the encounter has no combatants. No dialog in dnd5e.
  Posts one chat message per roll (rolls for hidden combatants go to GM-only chat). World
  write (combatant initiative + chat messages). Undo: **Reset Initiative** or **Clear
  Initiative**; the chat messages stay. KB name: "Roll All Combatants". [unverified]
- **Roll NPCs** (icon `fa-users-cog`, GM only) - same, limited to combatants with no player
  owner (or no actor). [unverified]
- Status text (`strong.encounter-title`) - **Round N** when started, **Not Started** before
  **Start Combat**, **No Combat** when there is no encounter. Shown to everyone. [unverified]
- Encounter name (`h2.encounter-name`) - shown above the status row only when the encounter
  has a name. [unverified]
- Encounter menu button (vertical ellipsis `fa-ellipsis-vertical`, right end of the status
  row) - a LEFT click opens the encounter menu (not a right click). Disabled for players and
  when there is no encounter. It has no aria-label and no tooltip, so an accessibility-tree
  search by name will not find it; use the selector `button.encounter-context-menu`. [unverified]

Sources: `C:/FoundryTest/app/templates/sidebar/tabs/combat/header.hbs`,
`C:/FoundryTest/app/client/documents/combat.mjs` (`rollAll`, `rollNPC`, `rollInitiative`),
`C:/FoundryTest/app/client/documents/combatant.mjs` (`isNPC`)

## Encounter menu (ellipsis button, GM only)

Entries in this order; each appears only when its condition holds. Menu items render as
`#context-menu li.context-item` (list items, not buttons); find them by text.

- **Edit Name** - dialog **Edit Combat Encounter Name** with one field **Combat Name** and a
  **Confirm** button. An empty value removes the name. World write, reversible. [unverified]
- **Reset Initiative** - clears every combatant's initiative (the d20 buttons come back) and
  keeps the current turn on the same combatant. Shown when the encounter has combatants. No
  confirm. World write; undo only by rolling again (new values). [unverified]
- **Clear Movement Histories** - erases the recorded movement paths of all combatants'
  tokens. Shown when there are combatants. No confirm, not reversible. [unverified]
- **Link to Viewed Scene** (shown when unlinked) / **Unlink from Scene** (shown when linked) -
  ties the encounter to the scene you are viewing (it then only lists on that scene) or makes
  it global again. Linking fails with the error "You cannot link the Combat Encounter to a
  Scene that doesn't contain all its Combatants." when a combatant sits on another scene.
  Reversible. This replaces the old link toggle icon. [unverified]
- **End Combat** - same as the footer button: confirm dialog, then deletes the encounter. [unverified]

Sources: `C:/FoundryTest/app/client/applications/sidebar/tabs/combat-tracker.mjs`
(`_getCombatContextOptions`, `#onEditName`), `C:/FoundryTest/app/client/documents/combat.mjs`
(`resetAll`, `toggleSceneLink`, `clearMovementHistories`),
`C:/FoundryTest/app/client/applications/ux/context-menu.mjs`,
https://foundryvtt.com/releases/13.338

## Combatant rows

Each row (`li.combatant[data-combatant-id]`) shows the token image, the name, a line of small
buttons, an optional resource value and the initiative column. Row classes: `active` = the
current turn; `hide` = hidden combatant (the GM sees it dimmed, players do not see it unless
they own it); `defeated` = defeated (dimmed).

Row buttons:

- **Hide** / **Show** (eye-slash `fa-eye-slash`, GM only; label depends on state, class
  `active` when hidden) - toggles the combatant's hidden flag (not the token's). Initiative
  rolls for hidden combatants go to GM-only chat. World write, reversible. [unverified]
- **Mark Defeated** / **Unmark Defeated** (skull `fa-skull`, GM only) - sets the combatant's
  defeated flag and also toggles the **Dead** status as a large overlay on the actor (an
  Active Effect; for a linked actor this changes the world actor). With **Skip Defeated** on,
  turns skip the combatant. Reversible with the same button. [unverified]
- **Ping Token** (`fa-bullseye-arrow`) - pings the token's spot on the canvas for all users.
  Shown only when the combatant is on the scene you view and your role may ping. No world
  write. Shows the warning "This Combatant is not visible to you." if you cannot see the
  token. [unverified]
- **Pan to Combatant** (`fa-arrows-to-eye`) - players only (the GM does not get this button;
  the GM clicks the row instead). Pans the camera to the token. Same visibility warning. [unverified]
- Effect icons - small icons for temporary effects (and effects set to always show); the
  tooltip lists them. [unverified]

Initiative column:

- **Roll Initiative** (d20 image button) - shown when the combatant has no initiative and you
  own it. In dnd5e it opens the actor's **Initiative Roll** dialog with **Advantage**,
  **Normal** and **Disadvantage** buttons; from the tracker the dnd5e skip-dialog keys
  (Shift/Alt/Ctrl) do not apply because the click event is not passed on. No dialog when the
  dnd5e **Initiative Score** setting gives this actor a fixed score. The dnd5e path rolls for
  every combatant of that actor still lacking initiative and may add the actor's other tokens
  on the scene to the encounter. [unverified]
- Initiative field (text input, aria-label **Initiative Value**) - GM: click, type, then
  Enter or click away. A plain number sets the value; `+N` / `-N` adjusts it; `=N` sets it;
  an empty value clears it. Players see it read-only. When any combatant has a fractional
  initiative (for example with **Dexterity Tiebreaker** on), all values render as plain text
  and cannot be edited inline; use **Update Combatant** instead. [unverified]
- Resource value (`.token-resource`) - shown when **Tracked Resource** is set and you have at
  least Observer permission on the combatant. [unverified]

Mouse behaviour on a row:

- Hover - highlights the token on the canvas (and shows its movement history if you control
  it). [unverified]
- Single click (not on a button or the field) - selects (controls) the token, releasing
  others, and pans to it. Only when the token is on the viewed scene and you may control it. [unverified]
- Double click - opens the actor sheet (needs Observer permission). [unverified]
- Right click - opens the combatant menu (next section). [unverified]

Sources: `C:/FoundryTest/app/templates/sidebar/tabs/combat/tracker.hbs`,
`C:/FoundryTest/app/client/applications/sidebar/tabs/combat-tracker.mjs`
(`_prepareTurnContext`, `_onCombatantControl`, `_onCombatantMouseDown`, `_onUpdateInitiative`,
`_onToggleDefeatedStatus`), `C:/FoundryTest/data/Data/systems/dnd5e/dnd5e.mjs`
(`CombatTracker5e._onCombatantControl`, `Actor5e.rollInitiativeDialog`)

## Combatant menu (right-click a row, GM only)

All entries are GM-only; a player's right click shows no usable entries.

- **Update Combatant** - opens the combatant window (next section). [unverified]
- **Clear Initiative** - shown only when the combatant has initiative; empties it and the d20
  button returns. World write. [unverified]
- **Re-roll Initiative** - rolls again at once. In dnd5e this entry skips the **Initiative
  Roll** dialog (it calls the combat's roll directly). New chat message. KB spelling
  "Re-Roll Initiative". [unverified]
- **Clear Movement History** - shown only when the token has recorded movement; erases it and
  shows the notice "Cleared movement history for Token "<name>".". Not reversible. [unverified]
- **Remove Combatant** - deletes the combatant, no confirm. Core then clears that token's
  movement history, and dnd5e removes the actor's expired and combat-bound effects. Undo: add
  the token again (initiative is lost). [unverified]
- Hide and defeated are row buttons in v14, not menu entries. [unverified]

Sources: `C:/FoundryTest/app/client/applications/sidebar/tabs/combat-tracker.mjs`
(`_getEntryContextOptions`), `C:/FoundryTest/app/client/documents/combat.mjs` (`#onExit`,
`_clearMovementHistoryOnExit`), `C:/FoundryTest/data/Data/systems/dnd5e/dnd5e.mjs`
(`Combat5e._onExit`), https://foundryvtt.com/article/combat/

## Update Combatant window

- Title **Update Combatant: <name>**. Fields: **Represented Actor** (read-only), **Represented
  Token** (read-only; the template fills it with the actor name), **Displayed Name**,
  **Thumbnail Image** (file picker), **Initiative Value**, and **Combatant Status** with the
  checkboxes **Hidden** and **Defeated**. Button **Update Combatant** saves and closes; the
  window close button discards. World write, reversible by editing again. [unverified]
- Gotcha: the **Defeated** checkbox only sets the combatant flag; the skull row button also
  applies the **Dead** status to the actor. [unverified]

Sources: `C:/FoundryTest/app/client/applications/sheets/combatant-config.mjs`,
`C:/FoundryTest/app/templates/sheets/combatant-config.hbs`,
`C:/FoundryTest/app/public/lang/en.json` (`COMBATANT.*`)

## Turn controls (footer)

GM, encounter not started:

- **Start Combat** (swords icon plus text) - sets round 1 and gives the turn to the first row.
  Plays the start sound if a **Combat Theme** is chosen. dnd5e also recovers
  "encounter"-period uses and may whisper turn cards to owners. KB name "Begin Combat".
  Undo: **Previous Turn** from the first turn returns to **Not Started** (dnd5e recoveries
  stay). [unverified]

GM, encounter started (left to right):

- **Previous Round** (`fa-backward-step`) - back one round; the turn goes to the last row.
  From round 1 it returns to **Not Started**. In dnd5e the game clock goes back 6 seconds per
  round (not when returning to Not Started). [unverified]
- **Previous Turn** (`fa-arrow-left`) - back one turn; from the first turn it steps to the
  previous round; from round 1, first turn, it returns to **Not Started**. [unverified]
- **End Combat** (x icon plus text) - confirm dialog, then deletes the encounter. [unverified]
- **Next Turn** (`fa-arrow-right`) - next row (skips defeated rows when **Skip Defeated** is
  on); after the last row it moves to the next round. [unverified]
- **Next Round** (`fa-forward-step`) - next round, turn to the first row (first non-defeated
  row with **Skip Defeated**; if every row is defeated it warns "There are no Combatants
  remaining in this Combat Encounter that are not defeated."). In dnd5e the game clock moves
  forward 6 seconds per round (`CONFIG.time.roundTime = 6`, turn time 0). [unverified]

Player, when the current turn belongs to a combatant they own:

- **Previous Turn**, **End Turn** (check icon plus text), **Next Turn**. **End Turn** and
  **Next Turn** both pass the turn on. At other times the player footer is empty. [unverified]

Every turn or round change is a world write on the Combat (round, turn) and can advance the
world clock, fire dnd5e recoveries and chat cards, and move the turn marker. [unverified]

Sources: `C:/FoundryTest/app/templates/sidebar/tabs/combat/footer.hbs`,
`C:/FoundryTest/app/client/documents/combat.mjs` (`startCombat`, `nextTurn`, `previousTurn`,
`nextRound`, `previousRound`, `getTimeDelta`), `C:/FoundryTest/app/dist/database/backend/server-document.mjs`
(server applies the `worldTime` delta), `C:/FoundryTest/data/Data/systems/dnd5e/dnd5e.mjs`
(`CONFIG.time.roundTime = 6`, `Combat5e.startCombat`, `_onStartTurn`, `_onStartRound`)

## End Combat confirm dialog

- Modal dialog titled **End Combat** with the text "End this combat and empty the turn
  tracker?" and buttons **Yes** and **No**. **No** is the default button, so pressing Enter
  cancels. **Yes** deletes the Combat document; there is no undo. The tracker then shows the
  next applicable encounter or **No Combat**. dnd5e also clears expired and combat-bound
  effects on the combatants' actors, and core clears their tokens' movement history. [unverified]

Sources: `C:/FoundryTest/app/client/documents/combat.mjs` (`endCombat`, `_onDelete`),
`C:/FoundryTest/app/client/applications/api/dialog.mjs` (`confirm`),
`C:/FoundryTest/data/Data/systems/dnd5e/dnd5e.mjs` (`Combat5e.endCombat`)

## Adding and removing combatants from the canvas

- **Enter Combat** / **Exit Combat** (Token HUD button, swords icon `fa-swords`, class
  `active` when in combat) - Token controls layer, right-click a token to open the HUD
  (`#token-hud`), then click the button. It acts on every controlled token plus the HUD's
  token; the HUD token's state decides whether all are added or all removed. Adds to the
  viewed encounter. With no encounter, a GM gets a new active, unlinked encounter; a player
  gets the warning "There is no active Combat Encounter in your currently viewed Scene." A
  hidden token becomes a hidden combatant. KB name: "Toggle Combat State". World write,
  reversible with the same button. [unverified]
- Players can add or remove only tokens they own (Combatant create/delete needs Owner). [unverified]
- dnd5e actor sheet initiative roll (outside the tracker) - adds that actor's tokens to the
  encounter and rolls. If no encounter exists, a GM gets a new one linked to the viewed scene
  (unlike the tracker and HUD, which create unlinked ones). [unverified]
- dnd5e **Placement Options** (Configure Combat > Encounters) - can add, or add and roll, when
  an encounter-type actor's tokens are placed. Default **Do Nothing**. [unverified]
- Deleting a token that is in combat adds a warning to the delete confirmation. [unverified]

Sources: `C:/FoundryTest/app/client/applications/hud/token-hud.mjs` (`#onToggleCombat`),
`C:/FoundryTest/app/templates/hud/token-hud.hbs`, `C:/FoundryTest/app/client/documents/token.mjs`
(`createCombatants`, `deleteCombatants`), `C:/FoundryTest/app/common/documents/combatant.mjs`
(permissions), `C:/FoundryTest/app/client/documents/actor.mjs` (`rollInitiative`),
`C:/FoundryTest/app/client/canvas/layers/tokens.mjs`, https://foundryvtt.com/article/combat/

## Combat Tracker Settings window

Reach it by the gear in the encounter bar (GM, only when at least one encounter exists) or by
Settings tab > **Game Settings** > **Core** > **Combat Tracker** (a menu button; it is not
GM-restricted, so players can open it too but only see **Combat Theme**). Window title
**Combat Tracker Settings**, element id `combat-tracker-config`.

- Fieldset **Token Turn Markers** (users with settings permission only):
  - **Enable Markers** - checkbox, default on; draws a marker under the token whose turn it
    is. Unticking disables the next three fields. [unverified]
  - **Animation** - select: **None**, **Spin**, **Spin Pulse**, **Pulse**; default Spin. [unverified]
  - **Media Source** - image or video path with file picker; empty uses the default marker. [unverified]
  - **Disposition Tint** - checkbox, default off; tints the marker by token disposition. [unverified]
- **Tracked Resource** - select: **None** plus actor attributes (for dnd5e, entries such as
  `attributes.hp.value`); the value then shows in each row. Default None. [unverified]
- **Skip Defeated** - checkbox, default off; turn advance skips defeated rows. [unverified]
- **Combat Theme** - per-user sound set: **None** (default), **Epic**, **Fight Commentator**,
  with a play button to preview a sound. The play button's aria-label is the raw key
  `COMMON.Preview` (not localized in the template). [unverified]
- **Save Tracker Settings** - saves and closes. The turn marker fields, **Tracked Resource**
  and **Skip Defeated** form one world setting (`core.combatTrackerConfig`, needs settings
  permission); **Combat Theme** is a client setting (`core.combatTheme`). No reload needed.
  Closing the window without saving discards. Reversible by saving the old values. [unverified]
- Per-token turn marker overrides live in the Token configuration (out of scope here).

Sources: `C:/FoundryTest/app/client/applications/apps/combat-tracker-config.mjs`,
`C:/FoundryTest/app/templates/apps/combat-tracker-config.hbs`,
`C:/FoundryTest/app/client/data/combat-config.mjs`, `C:/FoundryTest/app/client/game.mjs`
(`registerMenu("core", "combatTrackerConfig")`, `combatTheme`),
https://foundryvtt.com/api/v14/classes/foundry.applications.apps.CombatTrackerConfig.html,
https://foundryvtt.com/releases/13.332

## dnd5e specifics

- dnd5e replaces the classes: tracker `CombatTracker5e`, documents `Combat5e`,
  `Combatant5e`, `CombatantGroup5e`. [unverified]
- Initiative formula: `1d20` + the actor's initiative modifier (Dexterity by default,
  `CONFIG.DND5E.defaultAbilities.initiative = "dex"`) + proficiency when the actor has it +
  initiative and ability-check bonuses + condition penalties; +5 for Alert only under the
  legacy (2014) rules flag. Advantage and disadvantage come from the actor's roll settings.
  A combatant without an actor rolls plain `1d20`. Core `CONFIG.Combat.initiative.formula`
  stays null; per-actor changes are on the actor sheet (**Configure Initiative**). [unverified]
- Settings: Settings tab > **Game Settings** > dnd5e category > row **Combat** > button
  **Configure Combat** (GM only). Window **Configure Combat**, fieldset **Initiative**:
  **Dexterity Tiebreaker** (default off; adds Dex score / 100, which makes initiative
  fractional), **Initiative Score** (**Always Roll for Initiative** default, **Use Score for
  GM NPCs**, **Use Score for Everyone**; score = 10 + bonus, no dice), **Roll Once per
  Creature** (default on), **Group Combatants** (default on). Also **Auto-Apply Downed** and
  **Placement Options**. **Save Changes**. World settings. Full detail in
  `dnd5e-settings.md`. [unverified]
- Group initiative (**Roll Once per Creature**): unlinked tokens of the same base actor, same
  disposition and same roll formula share one roll within a batch (Roll All, Roll NPCs, a
  multi-select roll). Before **Start Combat**, a later roll for such a token copies the value
  an identical token already has. Linked tokens (usually PCs) are never grouped. [unverified]
- Grouped rows (**Group Combatants**): two or more such combatants with the same whole-number
  initiative are wrapped in one collapsible row `li.combatant.combatant-group` named
  **<Name> Group**, with a count line **N combatants** (or **i of N combatants** when one of
  them has the turn). Clicking the group header expands or collapses it; groups start
  collapsed, and the open state is local to this browser session (not saved). [unverified]
- Core v14 has `CombatantGroup` documents but no core UI to create them; dnd5e honours them
  if a module creates them. [unverified]
- Turn flow side effects: start, each turn start or end, and each round start run dnd5e use
  recovery for non-defeated combatants and may whisper "turn" chat cards to owners. [unverified]
- Gotcha: dnd5e tries to hide the combatant menu on group header rows with the old
  `condition` key, which v14's context menu ignores when an entry has `visible`. Right-click
  on a group header may therefore show the menu; its actions find no combatant and do
  nothing. [unverified]
- Gotcha: dnd5e rounds displayed initiative only when the value is a number, but core has
  already turned it into text, so fractional values (Dexterity Tiebreaker) likely show with
  decimals. [unverified]

Sources: `C:/FoundryTest/data/Data/systems/dnd5e/dnd5e.mjs` (`CombatTracker5e`, `Combat5e`,
`Combatant5e`, `CombatantGroup5e`, `getInitiativeRollConfig`, `rollInitiativeDialog`,
`CombatSettingsConfig`, settings `initiative*`, `TokenDocument5e.getGroupingKey`),
`C:/FoundryTest/data/Data/systems/dnd5e/lang/en.json`,
`C:/FoundryTest/app/client/applications/ux/context-menu.mjs`,
https://github.com/foundryvtt/dnd5e/wiki/Hooks

## Driving it from automation

Read-only console checks (run with the javascript tool; none of these write world data):

```js
// Sidebar and tracker state
({ tab: ui.sidebar.tabGroups.primary, expanded: ui.sidebar.expanded,
   trackerShown: ui.combat.active, popout: !!ui.combat.popout?.rendered,
   layer: ui.controls.control?.name })              // "tokens" for Token controls

// Which classes are in play (dnd5e overrides)
({ tracker: ui.combat.constructor.name, combat: CONFIG.Combat.documentClass.name,
   combatant: CONFIG.Combatant.documentClass.name })

// All encounters in the world
game.combats.contents.map(c => ({ id: c.id, name: c.name, active: c.active,
  scene: c.scene?.name ?? null, round: c.round, turn: c.turn, size: c.combatants.size }))

// Encounters listed on this scene, and the viewed one
game.combats.combats.map(c => c.id); ui.combat.viewed?.id

// Turn order of the viewed encounter
(() => { const c = ui.combat.viewed; if ( !c ) return null;
  return { round: c.round, turn: c.turn, started: c.started, current: c.combatant?.name,
    rows: c.turns.map(t => ({ id: t.id, name: t.name, init: t.initiative, hidden: t.hidden,
      defeated: t.isDefeated, npc: t.isNPC, token: t.tokenId })) }; })()

// Settings
game.settings.get("core", "combatTrackerConfig")   // resource, skipDefeated, turnMarker{...}
game.settings.get("core", "combatTheme")
["initiativeDexTiebreaker", "initiativeScore", "initiativeGroupRoll",
 "initiativeGroupCombatants", "encounterPlacementBehavior"].map(k => [k, game.settings.get("dnd5e", k)])

// Clock (to confirm round changes moved time)
game.time.worldTime

// Open windows and menus
foundry.applications.instances.get("combat-tracker-config")?.rendered
[...foundry.applications.instances.values()].filter(a => a.rendered
  && a.constructor.name === "CombatantConfig").map(a => a.title)
document.querySelector("#context-menu")?.innerText   // entries of an open menu
canvas.tokens.controlled.map(t => ({ name: t.name, inCombat: t.inCombat }))
```

Stable selectors (inside `#combat` for the sidebar, `#combat-popout` for the pop-out):

| Element | Selector | Accessible name / text |
| --- | --- | --- |
| Tab button | `#sidebar-tabs button[data-tab="combat"]` | "Combat Encounters" (role tab) |
| Encounter bar | `nav.encounters` | "Combat Encounters Navigation" |
| Create | `[data-action="createCombat"]` | "Create Combat" |
| Encounter buttons | `[data-action="cycleCombat"][data-combat-id]` | "1", "2", ... or the encounter name |
| Settings gear | `[data-action="trackerSettings"]` | "Combat Tracker Settings" |
| Roll All / NPCs | `[data-action="rollAll"]`, `[data-action="rollNPC"]` | "Roll All", "Roll NPCs" |
| Status | `strong.encounter-title` | "Round N" / "Not Started" / "No Combat" |
| Encounter menu | `button.encounter-context-menu` | none (unnamed button) |
| Rows | `li.combatant[data-combatant-id]` (`.active`, `.hide`, `.defeated`) | combatant name |
| Row buttons | `[data-action="toggleHidden"]`, `"toggleDefeated"`, `"pingCombatant"`, `"panToCombatant"`, `"rollInitiative"` | "Hide"/"Show", "Mark Defeated"/"Unmark Defeated", "Ping Token", "Pan to Combatant", "Roll Initiative" |
| Initiative field | `input.initiative-input` | "Initiative Value" |
| dnd5e group row | `li.combatant-group[data-group-key]` (`.collapsed`) | "<Name> Group" |
| Footer | `nav.combat-controls [data-action="startCombat"]` (also `previousRound`, `previousTurn`, `endCombat`, `nextTurn`, `nextRound`) | "Start Combat", "Previous Round", "Previous Turn", "End Combat", "Next Turn", "Next Round", player "End Turn" |
| Menus | `#context-menu li.context-item` | entry text |
| Settings window | `#combat-tracker-config` | fields `core.combatTrackerConfig.resource`, `.skipDefeated`, `.turnMarker.enabled`, `.turnMarker.animation`, `.turnMarker.src`, `.turnMarker.disposition`, `core.combatTheme` |
| Token HUD toggle | `#token-hud [data-action="combat"]` | "Enter Combat" / "Exit Combat" |

Driving gotchas:

- Rows re-render and re-sort after every roll or edit; take a fresh `find` / `read_page`
  before each click instead of reusing refs or coordinates.
- The encounter menu opens on left click; the combatant menu on right click. Menu entries are
  list items; click them by their text ref.
- `ui.sidebar.activeTab` (older API) does not exist in v14; use `ui.sidebar.tabGroups.primary`
  or `ui.combat.active`.
- The GM has no **Pan to Combatant** button; click the row name to select and pan.
- Row single click needs the token on the viewed scene; otherwise nothing happens.
- Many buttons are icon-only with tooltips; hover shows the tooltip, the accessible name is
  the aria-label listed above.
- The End Combat dialog is modal and **No** is the default button.
- After a scene change the tracker re-infers the viewed encounter (active one, else the most
  recently changed one for that scene).

Sources: `C:/FoundryTest/app/client/applications/sidebar/tabs/combat-tracker.mjs`,
`C:/FoundryTest/app/client/applications/sidebar/sidebar-tab.mjs`,
`C:/FoundryTest/app/client/applications/_module.mjs` (`instances`),
`C:/FoundryTest/app/client/applications/ui/scene-controls.mjs` (`control`),
https://foundryvtt.com/api/v14/classes/foundry.applications.sidebar.tabs.CombatTracker.html,
https://foundryvtt.com/api/v14/classes/foundry.documents.Combat.html

## Safety in the test world

Only the local test world `ai-tool-test` on `http://localhost:30001`. Never the live
campaign, never the live bridge ports, never `mcp__foundry-mcp__*`.

World writes (seen by every user, saved to the world database):

- Creating, switching, naming, linking and ending encounters (Combat documents).
- **Enter Combat** / **Exit Combat**, **Remove Combatant** (Combatant documents).
- Every initiative roll (combatant initiative plus chat messages), inline initiative edits,
  **Clear Initiative**, **Reset Initiative**.
- **Hide** / **Show**, **Mark Defeated** (also adds or removes the **Dead** effect on the
  actor; on a linked actor that is the world actor).
- **Start Combat**, **Next/Previous Turn/Round** (Combat round and turn; round changes move
  the world clock by 6 s in dnd5e; dnd5e may recover item uses and post turn chat cards).
- **Clear Movement History** / **Clear Movement Histories** (token data, not reversible).
- **End Combat** and **Remove Combatant** (deletions; dnd5e also deletes expired and
  combat-bound effects from actors; core clears token movement history).
- **Save Tracker Settings** (world setting `core.combatTrackerConfig`); **Save Changes** in
  **Configure Combat** (dnd5e world settings). **Combat Theme** is client-only.

How to undo:

- There is no general undo for encounters or combatants; `Ctrl+Z` is not a safe way back.
  Reverse each action with its opposite (Exit Combat, Unmark Defeated, Show, Unlink, a new
  roll, **Previous Round** for the clock).
- Record `game.time.worldTime` and the settings values before testing; restore settings by
  saving the old values; step the clock back with **Previous Round** if you advanced it.
- Chat messages from rolls remain; leave them or let the GM clear chat.

Avoid:

- Testing on linked PC actors when marking defeated or ending combat (the Dead effect and
  dnd5e effect cleanup hit the world actor). Prefer unlinked NPC tokens you placed for the
  test.
- Ending or removing encounters and combatants you did not create in this session. Deleting
  anything the GM made is the GM's call.
- Leaving settings changed (Skip Defeated, Tracked Resource, turn markers, dnd5e initiative
  options) after the test.
- Pressing Enter in the End Combat dialog expecting it to confirm (it cancels).
- Leaving a Combat Theme on (it plays sounds on this client).

Sources: `C:/FoundryTest/app/client/documents/combat.mjs`,
`C:/FoundryTest/data/Data/systems/dnd5e/dnd5e.mjs`,
`.claude/skills/foundry-test-env/SKILL.md`

## Verification checklist

Setup (as the `Claude` GM at `http://localhost:30001/game`): a viewed scene; the Token
controls layer active; tokens you placed for this test: one linked token (T1, e.g. a Starter
Heroes character) and two unlinked tokens of the same NPC (T2, T3, e.g. Goblin from Monsters
(SRD)). Run `game.combats.size` and note it. If encounters already exist, the "no encounters"
layout of steps 2-3 will not show; note that and continue.

1. Click the sidebar tab button **Combat Encounters**. Expect the tracker; `ui.combat.active`
   is true; the sidebar is expanded.
2. With no encounters: expect one wide **Create Combat** button, status **No Combat**, **Roll
   All** and **Roll NPCs** disabled, the ellipsis button disabled, an empty footer.
3. Click **Create Combat**. Expect a button **1** in the encounter bar, status **Not
   Started**, footer **Start Combat**, a gear **Combat Tracker Settings**; the newest entry in
   `game.combats.contents` has `scene` null and `active` true.
4. Click the gear **Combat Tracker Settings**. Expect the window **Combat Tracker Settings**
   with fieldset **Token Turn Markers** (**Enable Markers**, **Animation**, **Media Source**,
   **Disposition Tint**), **Tracked Resource**, **Skip Defeated**, **Combat Theme** with a
   play button, and **Save Tracker Settings**. Close it with the window close button.
5. Settings tab > **Game Settings** > **Core**: click **Combat Tracker**. Expect the same
   window. Close it.
6. Settings tab > **Game Settings** > dnd5e category: click **Configure Combat**. Expect
   fieldset **Initiative** with **Dexterity Tiebreaker**, **Initiative Score**, **Roll Once
   per Creature**, **Group Combatants**. Close without saving.
7. Right-click T1 on the canvas. Expect the Token HUD; hovering the swords button shows
   **Enter Combat**. Click it. Expect a T1 row in the tracker; the HUD button is now active
   and named **Exit Combat**.
8. Select T2 and T3 together (drag a box or Shift+click), right-click T2, click **Enter
   Combat**. Expect two new rows.
9. Check the GM row buttons on a row: **Hide**, **Mark Defeated**, **Ping Token** (if on the
   viewed scene) and the d20 **Roll Initiative**; no **Pan to Combatant**.
10. Hover the T1 row. Expect T1 highlighted on the canvas.
11. Click the T1 row name. Expect T1 selected and the canvas panned to it.
12. Double-click the T1 row. Expect the actor sheet. Close it.
13. Click the d20 **Roll Initiative** on the T1 row. Expect the dnd5e **Initiative Roll**
    dialog with **Advantage**, **Normal**, **Disadvantage**. Click **Normal**. Expect a chat
    message "<name> rolls for Initiative!" and a number in place of the d20; rows re-sort.
14. Click **Roll NPCs**. Expect no dialog; T2 and T3 get initiative, the same value for both
    (Roll Once per Creature on); T1 unchanged.
15. Look for the dnd5e group row **<NPC name> Group** with **2 combatants**. Click its
    header. Expect it to expand (showing T2 and T3); click again to collapse.
16. Click **Roll All**. Expect nothing new (everyone already has initiative, no new chat
    messages).
17. Click T1's initiative field, type `+1`, press Enter. Expect the value to rise by 1. Type
    `=10`, press Enter. Expect 10. (If values show as plain text, fractional initiative is
    in play; record that.)
18. Right-click the T1 row. Expect **Update Combatant**, **Clear Initiative**, **Re-roll
    Initiative**, **Remove Combatant** (and **Clear Movement History** only if T1 moved).
    Press Escape.
19. Right-click T1 > **Update Combatant**. Expect **Update Combatant: <name>** with
    **Represented Actor**, **Represented Token**, **Displayed Name**, **Thumbnail Image**,
    **Initiative Value**, **Hidden**, **Defeated** and an **Update Combatant** button. Close
    without saving.
20. Right-click T1 > **Clear Initiative**. Expect the d20 button back on T1.
21. Right-click T1 > **Re-roll Initiative**. Expect a new chat roll and no dialog.
22. Click the ellipsis button (left click). Expect **Edit Name**, **Reset Initiative**,
    **Clear Movement Histories**, **Link to Viewed Scene**, **End Combat**. Press Escape.
23. Ellipsis > **Edit Name**. Expect dialog **Edit Combat Encounter Name** with **Combat
    Name**. Type `Checklist Test`, click **Confirm**. Expect the heading "Checklist Test" and
    the encounter button's tooltip showing it.
24. Ellipsis > **Link to Viewed Scene**. Expect `ui.combat.viewed.scene` to be the viewed
    scene; reopen the menu and expect **Unlink from Scene** instead.
25. Ellipsis > **Unlink from Scene**. Expect `ui.combat.viewed.scene` null.
26. Ellipsis > **Reset Initiative**. Expect every row back to the d20 button. Then click
    **Roll All** and expect all rows rolled (no dialog).
27. Note `game.time.worldTime`. Click **Start Combat**. Expect status **Round 1**, the first
    combatant's row (or its group row) with class `active`, footer **Previous Round**,
    **Previous Turn**, **End Combat**, **Next Turn**, **Next Round**; a turn marker under
    that token (markers are on by default).
28. Click **Next Turn**. Expect the second row active; world time unchanged.
29. Click **Next Round**. Expect **Round 2**, first row active; world time +6.
30. Click **Previous Round**. Expect **Round 1**, last row active; world time back to the
    step 27 value.
31. Click **Previous Turn** until round 1's first combatant has the turn (`ui.combat.viewed.turn`
    is 0 and `round` is 1). Click **Previous Turn** once more. Expect status **Not Started**
    and the footer **Start Combat** again; world time unchanged.
32. Click **Start Combat**. Expect **Round 1** again.
33. Expand the NPC group row if it is collapsed, then click the skull **Mark Defeated** on T3.
    Expect the T3 row dimmed, a Dead overlay on T3, the button now named **Unmark Defeated**.
    Click it again to undo.
34. Click the eye-slash **Hide** on T2. Expect the row dimmed for the GM and the button named
    **Show**. Click it again to undo.
35. Right-click the sidebar tab button **Combat Encounters**. Expect a pop-out window
    **Combat Tracker** showing the same encounter. Close it.
36. Right-click the T3 row > **Remove Combatant**. Expect the row gone with no confirm (the
    group row disappears too, since one NPC is left).
37. Right-click T2 on the canvas, click **Exit Combat** in the HUD. Expect T2's row gone.
38. Click **End Combat** in the footer. Expect the modal **End Combat** with **Yes** and
    **No**. Click **No**. Expect nothing changed.
39. Click **End Combat** again, then **Yes**. Expect the encounter gone, status **No Combat**
    (or another encounter shown), `game.combats.size` back to the value noted in Setup.
40. Optional, needs a second session as `Player` owning T1 (one browser-pane session is one
    user): the tracker has no encounter bar, no **Roll All**/**Roll NPCs**, a disabled
    ellipsis, **Pan to Combatant** on rows, a read-only initiative field; on T1's turn the
    footer shows **Previous Turn**, **End Turn**, **Next Turn**.
41. Clean-up check: `game.settings.get("core", "combatTrackerConfig")` and the dnd5e
    initiative settings match the values noted before; `game.time.worldTime` is back where
    it was (or the change is recorded).

Sources: every file listed in the sections above.

## Differences between docs and the v14 / 6.0.5 source

- KB "Create Encounter" is **Create Combat** in v14; KB "Delete Encounter" button no longer
  exists (use **End Combat**).
- KB says new encounters link to the active scene; since v13 they are unlinked by default.
  The link toggle icon became the menu entries **Link to Viewed Scene** / **Unlink from
  Scene**.
- KB "Toggle Combat State" (Token HUD) is **Enter Combat** / **Exit Combat** in v14.
- KB "Roll All Combatants" is **Roll All**; KB "Begin Combat" is **Start Combat**; KB
  "Configure Tracker" is the gear **Combat Tracker Settings** (also Game Settings > Core >
  **Combat Tracker**).
- KB shows **Reset Initiative** as a header button; v14 moved it into the encounter menu
  (release 13.338 moved the encounter buttons into a context menu).
- KB's sidebar icon is a fist; v14 uses crossed swords and the tab name **Combat
  Encounters**.
- KB menu "Re-Roll Initiative" is **Re-roll Initiative**; v14 adds **Clear Movement History**
  and **Clear Movement Histories**.
- KB settings list only resource and skip defeated; v14 adds **Token Turn Markers** and
  **Combat Theme** in the same window.
- v14 row buttons **Hide**/**Show**, **Mark Defeated**/**Unmark Defeated**, **Ping Token**,
  and the player-only **Pan to Combatant** are not in the KB.
- `ui.sidebar.activeTab` (pre-v13 API) is gone; use `ui.sidebar.tabGroups.primary`.
- dnd5e's group-row menu filter and whole-number initiative display do not take effect under
  v14 as written (see dnd5e gotchas).

## Sources

Official (Foundry VTT):

- https://foundryvtt.com/article/combat/ (KB "Combat Encounters"; screenshots from an older
  version)
- https://foundryvtt.com/releases/13.334 (combats unlinked by default)
- https://foundryvtt.com/releases/13.338 (Clear Movement Histories; encounter buttons moved
  into a context menu)
- https://foundryvtt.com/releases/13.332 (turn markers)
- https://foundryvtt.com/api/v14/classes/foundry.applications.sidebar.tabs.CombatTracker.html
- https://foundryvtt.com/api/v14/classes/foundry.documents.Combat.html
- https://foundryvtt.com/api/v14/classes/foundry.applications.apps.CombatTrackerConfig.html

dnd5e:

- https://github.com/foundryvtt/dnd5e/wiki/Hooks (initiative and combat recovery hooks)
- Sibling page `dnd5e-settings.md` (Configure Combat window)

Local v14 source (read-only, ground truth):

- `C:/FoundryTest/app/client/applications/sidebar/tabs/combat-tracker.mjs`
- `C:/FoundryTest/app/templates/sidebar/tabs/combat/header.hbs`, `tracker.hbs`, `footer.hbs`
- `C:/FoundryTest/app/client/applications/apps/combat-tracker-config.mjs`,
  `C:/FoundryTest/app/templates/apps/combat-tracker-config.hbs`
- `C:/FoundryTest/app/client/applications/sheets/combatant-config.mjs`,
  `C:/FoundryTest/app/templates/sheets/combatant-config.hbs`
- `C:/FoundryTest/app/client/data/combat-config.mjs`
- `C:/FoundryTest/app/client/documents/combat.mjs`, `combatant.mjs`, `combatant-group.mjs`,
  `token.mjs`, `actor.mjs`, `collections/combat-encounters.mjs`
- `C:/FoundryTest/app/common/documents/combat.mjs`, `combatant.mjs`
- `C:/FoundryTest/app/client/applications/hud/token-hud.mjs`,
  `C:/FoundryTest/app/templates/hud/token-hud.hbs`
- `C:/FoundryTest/app/client/applications/sidebar/sidebar.mjs`, `sidebar-tab.mjs`,
  `C:/FoundryTest/app/templates/sidebar/tabs.hbs`
- `C:/FoundryTest/app/client/applications/ux/context-menu.mjs`,
  `C:/FoundryTest/app/client/applications/api/dialog.mjs`
- `C:/FoundryTest/app/client/config.mjs`, `C:/FoundryTest/app/client/game.mjs`
- `C:/FoundryTest/app/dist/database/backend/server-document.mjs` (world-time delta)
- `C:/FoundryTest/app/public/lang/en.json` (`COMBAT.*`, `COMBATANT.*`, `HUD.*`,
  `SETTINGS.CombatConfigL`, `SETTINGS.CombatThemeN`, `SIDEBAR.SETTINGS.*`)
- `C:/FoundryTest/data/Data/systems/dnd5e/dnd5e.mjs`,
  `C:/FoundryTest/data/Data/systems/dnd5e/lang/en.json`

Leads only (not relied on): https://foundryvtt.wiki/en/basics/Token-HUD (page content did
not load for reading).
