# dnd5e Character, NPC & Item Sheets

> Status: DRAFT from documentation and the local v14 source; not yet verified on the running client.

Scope: dnd5e system **6.0.5** on Foundry VTT **14.368** (`C:/FoundryTest`). Sheets are dnd5e's own ApplicationV2 windows; the core client only supplies outer window chrome [unverified, out of area]. Every quoted label is the literal string from `C:/FoundryTest/data/Data/systems/dnd5e/lang/en.json` for the localize key used in the cited template. 2024 ("modern") rules are the default; legacy 2014 labels are noted inline where they differ.

## How to reach it

- **Character/NPC sheet** — double-click the token or the actor's name in the **Actors** sidebar tab. GM: full edit always. Player: full edit only on an Owner-permission actor, else read-only. [unverified]
- **Item sheet** — double-click an item row on any actor tab (Inventory/Features/Spells), or an item in the **Items** sidebar/a compendium. Permission follows the item/parent actor. [unverified]
- **Activity sheet** — inside an item's **Activities** tab, click an activity row's pencil icon (or its context menu → Edit); a small dependent window, not a full document sheet. [unverified]
- **Group/Encounter/Vehicle sheets** — same double-click pattern; actor `type` is `group`/`encounter`/`vehicle`. Actor types on this install: `character, encounter, group, npc, vehicle` (`system.json` `documentTypes.Actor`). [unverified]

## Character sheet — header

Source: `templates/actors/character-header.hbs`.

- **Name** — Reach: top-left, Edit mode only (plain text in Play). Does: renames the actor. GM/Owner. Reversible: yes. Automation: `input[name="name"]` / `.document-name`. [unverified]
- **Class line** (`labels.class`, e.g. "Fighter 5 / Wizard 2") — read-only summary built from embedded class items; edited via Features tab, not here. Both read. Automation: `.class` text. [unverified]
- **Level badge** (aria "Level {level}") — total character level, read-only. Automation: `.level-badge`. [unverified]
- **Inspiration** (`DND5E.Inspiration`) — Reach: button by the level badge. Does: toggles `system.attributes.inspiration`. GM/Owner. Reversible: click again. Automation: `button[data-action="toggleInspiration"]`, state in `aria-pressed`. Gotcha: a plain on/off bit, not a counter. [unverified]
- **Epic Boons badge** — shown only when `system.details.xp.boonsEarned` > 0 (2024 rules, level 20+). Read-only here. Automation: `.boon-badge`. [unverified]
- **Rest buttons** (`CONFIG.restTypes`: Short Rest / Long Rest) — Reach: header, only if `showRests`. Does: opens the Rest dialog — Hit Dice to spend (short rest), recovery hints, and a GM-only "Rest Request" section to push the rest onto other party members instead. GM/Owner. Reversible: no, resolves immediately. Automation: `button[data-action="rest"][data-type="short|long"]`. [unverified]
- **XP bar** — Reach: header, only if `showExperience` (XP-advancement worlds). Does: editable current-XP number over a progress meter to next level. GM/Owner edits; players read. Automation: `input[name="system.details.xp.value"]`, `.xp-bar[aria-valuenow]`. [unverified]

## Character sheet — sidebar stats

Source: `templates/actors/character-sidebar.hbs`.

- **Portrait** — click opens the image picker (Edit) or a lightbox (Play); a toggle above swaps Portrait vs Token image for display. GM/Owner. Automation: `img[data-action]`, `input[name="flags.dnd5e.showTokenPortrait"]`. [unverified]
- **Exhaustion pips** (2024: 0–10 levels either side of AC) — click a pip to set that level; click the filled pip to reduce by one. GM/Owner. Reversible: yes. Automation: `button[data-action="togglePip"]` in `.pips[data-prop="system.attributes.exhaustion"]`. [unverified]
- **Armor Class badge** (`DND5E.ArmorClass`) — Play shows computed AC (hover for an attribution breakdown tooltip); Edit shows a gear → **Configure Armor** (calculation method, formulas, cover/shield, override). GM/Owner. Automation: `[data-attribution="attributes.ac"]`, `button[data-config="armorClass"]`. [unverified]
- **Initiative lozenge** (`DND5E.Initiative`) — Play: click rolls initiative; Edit: gear → **Configure Initiative** (bonus, ability override, tiebreaker). GM/Owner. Reversible: config yes, roll no. Automation: `div[data-action="roll"][data-type="initiative"]`. [unverified]
- **Speed lozenge** (`DND5E.Speed`) — Play shows primary speed+unit; Edit gear → **Configure Movement Speed** (per-type speeds, units, multiplier). Automation: `[data-attribution="attributes.movement"]`. [unverified]
- **Proficiency lozenge** — read-only proficiency bonus, no direct control. Automation: `.lozenge:last-child .value`. [unverified]
- **Hit Points meter** (`DND5E.HitPoints`) — current-HP text input, separate **TMP** box for temporary HP, Edit gear → **Configure Hit Points** (bonus formula, max override). GM/Owner. Automation: `input[name="system.attributes.hp.value"|"...hp.temp"]`. Gotcha: bar tints when `tempmax` is set. [unverified]
- **Hit Dice meter** (`DND5E.HitDice`) — read-only pool bar (current/max across classes); Edit gear → **Adjust Hit Dice**; actually spent from the Short Rest dialog, not here. Automation: `.meter.hit-dice`. [unverified]
- **Death Saves tray** (`DND5E.DeathSaveRoll`/`Show`/`Hide`) — collapsed skull tab slides open a tray: 3 success pips, a center roll button, 3 failure pips (click a pip to set it directly); Edit swaps the roll button for a gear → **Configure Death Saves**. GM/Owner. Reversible: pips yes, roll no. Automation: `button[data-action="toggleDeathTray"|"roll"][data-type="deathSave"]`, `.pips[data-prop="system.attributes.death.success|failure"]`. [unverified]
- **Favorites list** (`DND5E.Favorites`) — pinned item/activity/effect shortcuts with live value (uses, modifier, save DC, toggle); click the name activates it like its own tab would; "×" unpins only (no delete). GM/Owner. Automation: `li[data-favorite-id]`, actions `useFavorite`/`deleteFavorite`. [unverified]

## Character sheet — ability scores & tab bar

- **Ability score boxes** (STR/DEX/CON/INT/WIS/CHA) — click the abbreviation to roll a check; Play shows the modifier, Edit swaps it for a gear → **Configure Ability** (override, bonuses, max) and makes the score a raw input. GM/Owner. Automation: `a[data-action="roll"][data-type="ability"]` in `.ability-score[data-ability]`. [unverified]
- **Edit / Play toggle** — a slide-toggle the system prepends to the sheet's own title bar, tooltip **"Edit"**/**"Play"** (`DND5E.SheetModeEdit`/`SheetModePlay`), shown when the sheet is editable. Switches the whole sheet between read/roll-focused Play and raw-field Edit; many fields (name, HP, ability scores, currency) have no `<input>` at all in Play mode. GM/Owner. Reversible: yes. Automation: `.window-header slide-toggle.mode-slider[data-action="changeMode"]`; also a configurable keybinding (`toggleSheetMode`). Source: `dnd5e.mjs` `_renderModeToggle`/`changeMode` (~line 2040). [unverified]
- **Tab bar** — 8 fixed tabs: **Details** (gear), **Inventory** (backpack), **Features** (list), **Spells** (book), **Effects** (bolt), **Biography** (feather), **Bastion** (chess-rook, conditional), **Special Traits** (star). Tab ids `details, inventory, features, spells, effects, biography, bastion, specialTraits` are stable across sessions. Source: `dnd5e.mjs` ~line 66738. [unverified]

## Character sheet — Details tab

Source: `templates/actors/tabs/character-details.hbs`.

- **Skills list** (`DND5E.Skills`) — a **proficiency-cycle** dot per row (click cycles Not Proficient → Proficient → Half Proficient → Expertise → back; `validValues=[0,1,.5,2]`), a name link that rolls the check, total modifier, and (Edit) a gear → **Configure Skill** (Play shows passive score instead). GM/Owner toggles/rolls. Automation: `<proficiency-cycle type="skill">`, `a.skill-name[data-action="roll"]`. Source: `dnd5e.mjs` `ProficiencyCycleElement` (~line 76846). [unverified]
- **Tools list** (`TYPES.Item.toolPl` = "Tools") — same proficiency-cycle + roll pattern as Skills, limited to owned tool items, each row's (Edit) gear → **Configure Tool Proficiency**; a separate header gear adds/removes tool proficiencies via the trait selector. [unverified]
- **Saving Throws** (`DND5E.ClassSaves` = "Saving Throws") — a 2-state proficiency-cycle (`validValues=[0,1]`, no Expertise), a roll link, and (Edit) a gear reusing **Configure Ability**; shows a concentration icon instead of the toggle while concentrating. Automation: `<proficiency-cycle type="ability">`, `a.saving-throw[data-action="roll"]`. [unverified]
- **Creature Type pill** — shows type (e.g. Humanoid); Edit gear → **Configure Creature Type**. Automation: `[data-config="creatureType"]`. [unverified]
- **Species pill** (`DND5E.Species.Add`, legacy "Add Race") / **Background pill** (`DND5E.BackgroundAdd`) — shows the embedded item; click opens its sheet; trash (Edit) deletes the embedded item only. GM/Owner. Reversible: only by re-adding. Automation: `[data-action="showDocument"|"deleteDocument"][data-item-id]`. [unverified]
- **Trait pill rows**: **Senses**, **Resistances**, **Immunities** (damage + condition), **Vulnerabilities**, **Damage Modification**, **Armor** (proficiencies), **Weapons** (proficiencies), **Languages** — read-only pills in Play; Edit adds a gear → matching **Configure {Trait}** multi-select. Automation: shared `dnd5e.actor-trait-pills` partial, one `[data-key]` container each (`senses, dr, di, ci, dv, dm, armor, weapon, languages`). [unverified]

## Character sheet — Inventory tab

Source: `templates/actors/tabs/character-inventory.hbs` + `templates/inventory/inventory.hbs`.

- **Currency row** (`DND5E.CurrencyManager.Title` = "Manage Currency") — five number inputs (pp/gp/ep/sp/cp); coin-icon button opens **Manage Currency** to convert to highest denomination (explicitly not undoable) or transfer with another actor. GM/Owner. Automation: `input[name="system.currency.pp|gp|ep|sp|cp"]`, `[data-action="currency"]`. [unverified]
- **Encumbrance bar** (`DND5E.Encumbrance`) — read-only meter with Encumbered/Heavily-Encumbered breakpoints, plus Strength/Size/Multiplier readout. Automation: `.encumbrance .meter[role="meter"]`. [unverified]
- **Containers row** — quick-open buttons, shown only if the actor owns `container`/`backpack` items. [unverified]
- **Filter/Sort/Group bar** — an `item-list-controls` element per section header; client-side only, not saved to the document. [unverified]
- **Item row** — click the **name** to activate the item (see Item Use, below) or expand it; per-column values (uses, weight, price, quantity, roll shortcut) are their own click targets. GM/Owner acts. Reversible: using it generally isn't. Automation: `li.item[data-item-id][data-uuid]`, `.item-name[data-action]`. [unverified]
- **Expanded description row** — click the row (not the name) to show description + any activity "riders" inline; purely a UI expand, no document change. Automation: `.item-description.collapsible-content`. [unverified]

## Character sheet — Features tab

Source: `templates/actors/tabs/character-features.hbs` (+ `actor-classes.hbs`, shared `inventory.hbs`).

- **Class summary pills** — icon, name, subclass (if any), level dropdown (Edit); empty "Add Class" pill when none; deleting a class also removes its linked subclass. GM/Owner. Automation: `.class.pill-lg[data-item-id]`, `[data-action="findItem"][data-item-type="class"]`. [unverified]
- **Feature item rows** — same generic item-row pattern as Inventory (name activates/expands, favorite star, uses column, activity riders), filtered to `feat` items. [unverified]

## Character sheet — Spells tab

Source: `templates/actors/tabs/creature-spells.hbs` + `dnd5e.mjs` `_prepareSpellbook`/`_renderSpellbook`.

- **Spellcasting ability card** — one per casting method (e.g. Wizard, plus a separate Pact Magic card for a multiclass Warlock); shows **Ability** mod, **Attack** bonus, **Spell DC**, and a **Prepared** count/max where relevant; a radio button sets which class is primary for multiclass math. GM/Owner. Automation: `.spellcasting.card[data-ability]`, `button[data-action="setSpellcastingAbility"]`. [unverified]
- **Spell-level sections + slot pips** — one section per level the actor can cast (Cantrips, 1st–9th, per `DND5E.SPELLCASTING.SLOTS`) plus non-leveled methods (At-Will, Innate Spellcasting, Ritual Only, Pact Magic). Play: click a pip to toggle a slot expended/available without rolling; Edit: gear → **Configure Spell Slots**. GM/Owner. Reversible: yes. Automation: `.items-section[data-level][data-method] button[data-action="togglePip"]`, `data-prop="system.spells.<slot>.value"`. [unverified]
- **Spell item row** — same generic row pattern; a school-icon badge shows on the item's own sheet; clicking the row's name casts via its Cast activity; unprepared (but known) spells are dimmed rather than hidden. [unverified]
- **Preparation states** (`DND5E.SPELLCASTING.STATES`): **Not Prepared**, **Prepared**, **Always Prepared** — set on the spell item's own Details tab, not a direct actor-sheet control found this pass. [unverified]

## Character sheet — Effects / Biography / Bastion / Special Traits tabs

- **Effects tab** (shared `templates/shared/active-effects.hbs`) — sectioned list (Temporary/Passive/Inactive); toggle enables/disables without deleting, pencil edits, trash deletes. GM mostly; Owners can toggle effects on items they own if permitted. Reversible: toggle yes, delete no. Automation: `li.effect[data-effect-id]`, `[data-action="toggleEffect"|"editEffect"|"deleteEffect"]`. [unverified]
- **Biography — Characteristics** (Alignment, Eyes, Height, Faith, Hair, Weight, Gender, Skin, Age — exact order from `dnd5e.mjs` `_prepareBiographyContext`) — plain text inputs under `system.details.<key>`. GM/Owner. Automation: `input[name="system.details.alignment|eyes|height|faith|hair|weight|gender|skin|age"]`. [unverified]
- **Biography — Ideals/Bonds/Flaws/Personality/Appearance** — small free-text boxes, `system.details.ideal|bond|flaw|trait|appearance`. [unverified]
- **Biography editor** (`DND5E.Biography`) — ProseMirror rich text for `system.details.biography.value`. Automation: `prose-mirror[name="system.details.biography.value"]`. [unverified]
- **Bastion tab** (`templates/actors/tabs/character-bastion.hbs`) — only if the world's "Enable Bastion Functionality" setting is on and the character is level 5+. Bastion name (text), Defenders roster (portraits, removable in Edit), Basic/Special Facility grids (built tiles show order progress and occupant slots; click an idle facility to issue an order — Craft/Trade/Research/etc.), Description editor. GM/Owner. Reversible: orders resolve over game-time, not instantly. Automation: `li.facility[data-item-id]`, `[data-action="useFacility"]`. [unverified]
- **Special Traits tab** (`templates/actors/tabs/creature-special-traits.hbs`) — a **Make Original Class** dropdown (legacy multiclass field) plus any module-added `flags.<module>.…` fields grouped by section; not stable across installs. GM/Owner. [unverified]

## NPC sheet — header

Source: `templates/actors/npc-header.hbs`. Differs from the PC header as follows.

- **Inline Death Saves** — shown only if `showDeathSaves`; numeric Success/Failure inputs (typed, not pips) plus a roll button over the portrait. GM. Automation: `input[name="system.attributes.death.success|failure"]`. [unverified]
- **Initiative** — same modifier roll as the PC sidebar, plus an optional raw **Initiative Score** display (`showInitiativeScore`, monster-stat-block style). [unverified]
- **Loyalty badge** (`DND5E.Loyalty`, 2024 "followers" mechanic) — plain number field, shown only if `showLoyalty`. GM. [unverified]
- **AC badge / HP meter** — same pattern as the PC sheet; NPCs additionally show an always-visible **Temp/Temp Max** split row (`system.attributes.hp.tempmax`) rather than hiding it in a dialog. [unverified]
- **Name / Size / Type / Alignment** — Size/Type via dropdown+gear (**Configure Creature Type**); Alignment is free text. GM. [unverified]
- **Challenge Rating badge** (`DND5E.ChallengeRating`, aria `DND5E.CRLabel`) — Edit is free text accepting fractions ("1/2"); does not auto-recompute XP or stats. GM. Automation: `input[name="system.details.cr"]`. [unverified]
- **Ability row with inline saves** — like the PC row, but each box also has a save-tab strip (2-state proficiency-cycle + modifier) to roll that save directly — NPCs have no separate Details tab for this. Automation: `.save-tab[data-action="roll"][data-type="ability"]`. [unverified]
- **Legendary Actions** (`DND5E.LegendaryAction.Label`) / **Legendary Resistance** — shown if the NPC has any, or in Edit mode; Play shows spent/available pips (click to spend), Edit shows a **Maximum** number input. GM. Reversible: pips toggle back. Automation: `.legact|.legres .pips button[data-action="togglePip"]`. [unverified]
- **Lair Actions** (`DND5E.LAIR`) — 2024: a **Has Lair** checkbox + **Inside Lair** toggle when triggered; legacy: a numeric **Lair Action Initiative Count** instead. GM. [unverified]
- **Embedded class pills** — reuses `actor-classes.hbs`, shown only if the NPC has class items (`hasClasses`, e.g. NPC spellcasters built from classes). [unverified]

## NPC sheet — sidebar & tabs

Source: `templates/actors/npc-sidebar.hbs`, `dnd5e.mjs` ~line 69247.

- **Sidebar trait pills** — Hit Dice (display only; no roll-die button per an in-template TODO), Speed, Skills, Senses, Resistances, Immunities, Vulnerabilities, Damage Modification, Languages, plus 2024 stat-block metadata **Habitat**, **Gear**, **Treasure** (mostly GM reference, each with a config gear). Reuses the same `dnd5e.actor-trait-pills` partial as the PC Details tab. [unverified]
- **Tabs** — 6, no Details/Bastion: **Features**, **Inventory**, **Spells**, **Effects**, **Biography**, **Special Traits**. Skills/saves/traits live in the header+sidebar instead of a Details tab. [unverified]
- **NPC Biography tab** (`npc-biography.hbs`) — a **Public** block any observer can read (GM edits, players read) and a GM-only **Details** block, each with its own edit-pencil rather than an always-editable field. Automation: `[data-action="editDescription"][data-target="system.details.biography.public|value"]`. [unverified]

## Group, Encounter & Vehicle actors (brief)

- **Group** (`type: "group"`) — party wrapper. Tabs **Members/Inventory/Effects/Biography**. Header: Place Members (drops all members' tokens onto the scene), Short/Long Rest for the party, a **Travel Pace** card (Land/Water/Air speed from the slowest member; Slow/Normal/Fast), an XP/Advancement card with **Award** (`DND5E.Group.Distribute`) to split pooled XP/currency. GM. [unverified]
- **Encounter** (`type: "encounter"`) — disposable monster-group builder. Tabs **Members/Loot/Description**. Header: d20 **Roll Quantities** (resolves "2d4 goblins"-style formulas), Place Members, **Award XP & Currency**. GM. [unverified]
- **Vehicle** (`type: "vehicle"`) — Tabs **Cargo/Crew & Passengers (conditional)/Effects/Description**. Disallows `background/class/facility/race/spell/subclass` items (`unsupportedItemTypes`). GM. [unverified]

## Item sheet — header & tabs

Source: `templates/items/header.hbs`; `dnd5e.mjs` `ItemSheet5e.TABS` (~line 60564).

- **Image / Name** — same edit-image/rename pattern as the actor header. Automation: `img[data-action="editImage"]`, `.document-name` input. [unverified]
- **Type-specific subtitle chips** — e.g. a weapon shows type/rarity/attunement, a spell shows level+school; unidentified physical items conceal some chips from non-GM owners (`concealDetails`). [unverified]
- **Quantity / Weight / Price** — physical items only; plain inputs (Edit) or formatted text (Play); Price hidden from non-GMs on an unidentified item. GM/Owner. Automation: `input[name="system.quantity"|"system.price.value"|"system.weight.value"]`. [unverified]
- **Spell-school icon / Class-level badge** — read-only header decoration for `spell`/`class` items. [unverified]
- **Tabs (conditional on content existing)**: **Description** (always), **Details** (hidden pre-identification for non-GMs), **Activities**, **Effects**, **Advancement** — ids `description, details, activities, effects, advancement`; a `container` item adds a **Contents** tab first. Item types on this install: `weapon, equipment, consumable, tool, loot, race (Species), background, class, subclass, spell, feat, container, backpack, facility`. [unverified]

## Item sheet — Description tab

Source: `templates/items/description.hbs`.

- **Main description editor** — ProseMirror for `system.description.value`, what most players see; collapsible with its own edit-pencil. GM/Owner. [unverified]
- **Unidentified description** (`DND5E.DescriptionUnidentified`) — GM-only alternate text shown to non-GM owners while unidentified. [unverified]
- **Chat description** (`DND5E.DescriptionChat`) — optional shorter text used in the use-chat-card instead of the full description. GM/Owner. [unverified]
- **Active properties pills** — read-only tag row (e.g. Finesse, Light); hidden while unidentified. [unverified]

## Item sheet — Details tab (type-specific)

Source: `templates/items/details/*.hbs`, assembled by `details.hbs`; representative highlights only.

- **Weapon** — type/base item, damage formula(s)+type, versatile die, properties, 2024 mastery, proficiency, magical bonus. **Equipment** — armor type, AC formula/base, Strength requirement, stealth-disadvantage flag, proficiency. **Consumable** — subtype (potion/scroll/ammo/…), magic-item flag. **Tool** — type/base item, ability used. [unverified]
- **Spell** — level, school, components (V/S/M + material cost/consumed), ritual/concentration flags, class list. **Class/Subclass** — hit die, spellcasting progression (`DND5E.SPELLCASTING.METHODS`: At-Will, Innate Spellcasting, Ritual Only, Spellcasting Full/Half/Third/Artificer Caster, Pact Magic), identifier (used by Advancement level-limits), linked subclass. [unverified]
- **Species** (item type `race`) — size, movement/senses granted, type grant. **Background** — starting-equipment/feat grants, paired with Advancement. **Container** — capacity (weight/count), currency carried. **Facility** — Basic/Special category, size (Cramped/Roomy/Vast), build cost/time, defender/hireling capacity. **Loot** — only the common physical-item fields from the header. [unverified]

## Item sheet — Activities tab

Source: `templates/items/activities.hbs` + shared `templates/shared/activities.hbs`.

- **Activities list** (`DND5E.ACTIVITY.Title.other` = "Activities") — one row per Activity (icon, name, activation-cost subtitle, a **Charges** column for its own Limited Uses); pencil opens the Activity sheet, trash deletes, ⋮ opens a context menu (duplicate/favorite/etc.). GM/Owner edits; using it is not reversible (see Item Use, below). Automation: `li.item.activity[data-activity-id][data-uuid]`, `[data-action="editDocument"|"deleteDocument"]`. [unverified]
- **Rider activities** — activities nested under a parent (e.g. an Attack auto-triggering an on-hit Damage rider), shown indented under the parent row. [unverified]
- **Create Activity** — a "+" control opens a type picker before creating a new Activity. [unverified — control itself not present in the templates read this pass, inferred from the sheet's action-naming convention]

## Item sheet — Effects & Advancement tabs

- **Effects tab** — same shared `active-effects.hbs` pattern as the actor Effects tab (toggle/edit/delete); once the item is owned, its effects apply per their own transfer settings while equipped/attuned. [unverified]
- **Advancement tab** (`templates/items/advancement.hbs`; on `class, subclass, background, race, feat`) — one **Level group** header per grant level ("Level N" / "Any Level"), each with a ✓/⚠ status icon and (Edit, on an actor's copy) a gear → **Modify Choices**. Rows are the 9 advancement types: **Ability Score Improvement, Hit Points, Item Choice, Item Grant, Modify Item, Scale Value, Size, Subclass, Trait** (`DND5E.advancementTypes`); pencil opens the type's own config, trash deletes it from the template. GM (template); players only see resulting choice prompts, not this tab. Automation: `.items-section[data-level]`, `li.advancement-item[data-id][data-uuid]`, `button[data-action="modifyAdvancementChoices"]`. [unverified]

## Activity sheet

Source: `dnd5e.mjs` `ActivitySheet` (`PARTS`/`_getTabs`, ~line 14864/15280) + `templates/activity/*.hbs`. 3 top tabs on every type: **Identity**, **Activation** (sub-tabs **Time** / **Targeting** / **Consumption**), **Effect** (content varies by type).

- **Identity tab** — Name/Icon override; Description + Chat Flavor; Visibility gates: **Level Limit** (optionally scoped to one **Class Identifier**), **Require Attunement**, **Require Identification**. GM (template). [unverified]
- **Activation → Time** — activation type (Action/Bonus Action/Reaction/custom, from `CONFIG.DND5E.activityActivationTypes`) + cost + condition text; Duration (Instantaneous / a scalar or permanent time unit / Special). [unverified]
- **Activation → Targeting** (`DND5E.TARGET.FIELDS.target.label` = "Targeting") — Range, area-template shape/size, target count/"every"-vs-"any" wording. [unverified]
- **Activation → Consumption** (`DND5E.CONSUMPTION.FIELDS.consumption.label` = "Consumption") — optional **Consume Spell Slot** checkbox (spells); a repeatable consumption-target list, each with **Type**, **Amount**, and (Attribute/Item Uses/Material) a **Target** picker, plus optional per-level **Scaling** (Mode+Formula) and a **Consumption Scaling** max-levels cap. Types are **Activity Uses, Attribute, Hit Dice, Item Uses, Material, Spell Slots** (`DND5E.CONSUMPTION.Type`). Below it: the activity's own **Limited Uses** (Spent/Max) + **Recovery** list (Period + type + Formula, "+" to add another). GM (template). Automation: `[data-action="addConsumption"|"deleteConsumption"|"addRecovery"|"deleteRecovery"]`. [unverified]
- **Effect — Attack** (`DND5E.ATTACK`) — Ability (or formula override), flat Bonus, a **Flat** checkbox, Critical Threshold override, plus the shared damage-part list. [unverified]
- **Effect — Damage** (`DND5E.DAMAGE`) — repeatable damage parts (formula + type + optional versatile alternative); a "base" part from the weapon/spell is often locked (editable, not removable). [unverified]
- **Effect — Save** (`DND5E.SAVE`) — target Ability, save Bonus, DC **Calculation** (fixed formula, or automatic/locked-to-computed), plus its own damage-on-fail part list. [unverified]
- **Effect — Check** (`DND5E.CHECK`) — an optional Associated skill/tool, Ability, Bonus, and the same DC Calculation/formula pattern as Save. [unverified]
- **Effect — Heal** (`DND5E.HEAL`) — a healing formula + type, via the same shared damage-part editor in "heal" mode. [unverified]
- **Effect — Utility** (`DND5E.UTILITY` = "Use") — a free-form **Roll** (optional name + arbitrary formula) for anything that doesn't fit the other types; also hosts the shared Applied Effects list and Area-of-Effect Behaviors. [unverified]
- **Effect — Cast** (`DND5E.CAST`) — links another **Spell** item (drag onto the drop area, or remove it) that this activity casts. [unverified]
- **Effect — Enchant** (`DND5E.ENCHANT`) — two sub-tabs: **Enchantments** (ActiveEffects applied to the enchanted target) and **Restrictions** (item type/property limits on valid targets). [unverified]
- **Effect — Summon** (`DND5E.SUMMON`) — two sub-tabs: **Profiles** (which creature(s) can be summoned) and **Changes** (stat overrides on the summon, e.g. scaled HP/AC). [unverified]
- **Effect — Forward** (`DND5E.FORWARD`) — no Effect fields of its own; its Activation tab instead picks another activity on the same item to trigger immediately after this one. [unverified]
- Named for completeness, not detailed here (facility/vehicle-oriented, outside this task's ten types): **Order** (facility-only, not user-creatable), **Teleport**, **Transform**. [unverified]

## Item use & the Activity chooser

- **Single-activity item** — clicking the item's name (any row, or a Favorite) activates its one activity immediately, possibly after the Usage dialog below. GM/Owner. Reversible: no — can roll dice, spend uses/slots/HP, posts a chat card. [unverified]
- **Multi-activity item — chooser** (`templates/activity/activity-choices.hbs`) — an icon+name menu pops up first to pick which activity to run. Automation: `button[data-action="choose"][data-activity-id]`. [unverified]
- **Usage dialog** (`templates/activity/activity-usage-*.hbs`) — appears only when something needs configuring, up to 4 sections: **Consumption** (pick which optional targets to spend, warns if insufficient), **Concentration** (offers to end an existing effect if the new one would conflict), **Scaling** (pick an upcast slot, or a generic scaling amount — "Scaling Value" picker), **Creation** (auto-place a measured template). Canceling is fully reversible; confirming runs the activity. GM/Owner. [unverified]

## Uses, charges & slots — summary

- **Item-level Limited Uses** (`DND5E.LimitedUses`) — Spent/Max on the item itself plus its own Recovery rules (Period: Dawn/Dusk/Long Rest/Short Rest/Recharge/etc.); shown as the item row's **Charges** column. [unverified]
- **Activity-level Limited Uses** — same Spent/Max/Recovery pattern scoped to one activity on a multi-activity item; edited on Activation → Consumption. [unverified]
- **Spell Slots** — the actor's own per-level pool (`system.spells.spellN.value/max`), spent via a Consumption target of type Spell Slots or the Spells-tab slot pips; configured per-actor via **Configure Spell Slots**. [unverified]
- **Other consumption targets**: **Activity Uses** (another activity's pool), **Attribute** (arbitrary data path, e.g. exhaustion or pact slots), **Hit Dice**, **Item Uses** (another item's charges), **Material** (reduces a linked item's quantity). [unverified]

## Driving it from automation

- Prefer **tab ids** over label text: character `details|inventory|features|spells|effects|biography|bastion|specialTraits`; NPC `features|inventory|spells|effects|biography|specialTraits`; item `description|details|activities|effects|advancement|contents`; activity `identity|activation|effect` (+ `time|consumption|activation-targeting`).
- Prefer **`data-action`** values over CSS classes: `roll`, `toggleInspiration`, `showConfiguration`, `rest`, `togglePip`, `activity-use`, `editDocument`, `deleteDocument`, `currency`, `changeMode` — these back the sheet's own click delegation and won't drift with a reskin.
- Read-only, side-effect-free console checks (no bridge tools needed): `actor.system.attributes.hp`, `actor.system.attributes.ac.value`, `actor.system.attributes.hd`, `actor.system.spells`, `actor.itemTypes.spell`/`.weapon`, `item.system.activities` (a `Collection`), `activity.consumption.targets`. [unverified — not executed against a live world this pass; no console access in this task's toolset]
- Because most numeric widgets exist only in **Edit** mode, a script that must type a value (name, HP, ability score, currency, XP) needs to switch modes first, and probably back afterward.
- `<proficiency-cycle>` and pip buttons are custom elements/buttons, not native checkboxes — a generic form-filler will miss them; drive them by `data-action`/click instead.
- Every roll (ability/skill/save/initiative/death-save/activity use) posts to chat as a side effect and is not readable as a return value from the click itself.

## Safety in the test world

- All research for this reference was read-only against `C:/FoundryTest/app` and `C:/FoundryTest/data/Data/systems/dnd5e`; nothing was written under `C:/FoundryTest`.
- A future verification pass should use the `ai-tool-test` world and the passwordless **Claude** GM user (`.claude/skills/foundry-test-env/SKILL.md`) — never the live campaign or bridge ports 31414–31416.
- Use a throwaway actor for anything flagged not reversible above (Convert All Currency, deleting an embedded class/species/background item, spending an item's last use).
- Rolls mutate real state (HP, uses, slots) and post chat messages — plan for a world reset or disposable actors/items after any pass that exercises rolls rather than just opening tabs.

## Verification checklist

1. Open a level 5+ PC sheet; confirm all 8 tabs render and click through each once.
2. Click **Inspiration**; confirm `aria-pressed` flips and it toggles back.
3. Toggle **Edit/Play**; confirm name/ability-scores/HP/currency become raw inputs in Edit and the tooltip swaps.
4. In Edit mode, open the AC badge's **Configure Armor** gear; confirm the Calculation dropdown and formula list appear.
5. Click the Initiative lozenge in Play mode; confirm a roll posts to chat.
6. Click an exhaustion pip on and off; confirm `system.attributes.exhaustion` follows.
7. Edit HP and TMP fields; confirm current HP and the temp-HP bar tint update.
8. Open the Death Saves tray, set a success and a failure pip, then click the roll button; confirm a death save posts to chat.
9. Favorite an item from its row context menu; confirm it appears in the sidebar Favorites list with a correct info column.
10. Cycle a Skill's proficiency dot 4 clicks; confirm Not Proficient → Proficient → Half Proficient → Expertise → Not Proficient.
11. Click a Skill name; confirm a check roll posts and the passive score reflects the current proficiency.
12. Cycle a Saving Throw's dot; confirm only 2 states (no Expertise).
13. Confirm Senses/Resistances/Immunities/Vulnerabilities/Languages pills render on Details, each with a working config gear in Edit mode.
14. Edit a currency field and open **Manage Currency** from the coin icon; confirm both work.
15. Confirm the Encumbrance bar's current/max match Strength/Size and its two breakpoints are visible.
16. Click a single-activity item's name; confirm it activates. Click a multi-activity item's name; confirm the Activity chooser menu appears first.
17. Expand an item row (click the row, not the name); confirm description + activity riders show inline, then collapse.
18. Confirm class pills on Features show name/subclass/level and an "Add Class" pill appears with none present.
19. Confirm one spellcasting-ability card per casting class on Spells, each showing Ability/Attack/Spell DC (+Prepared where relevant).
20. Click a spell-level slot pip; confirm it toggles without rolling. In Edit mode confirm the gear opens **Configure Spell Slots** instead.
21. Cast a spell that offers a Scaling choice; confirm the Usage dialog appears and canceling consumes nothing.
22. Toggle an Active Effect off and on; confirm no deletion occurs.
23. Edit a Characteristic field and the Biography editor; confirm both persist after reopening the sheet.
24. If Bastion is enabled, open its tab; confirm Defenders and at least one Facilities grid render.
25. Open Special Traits; confirm the Make Original Class dropdown (multiclass) or an empty tab (single-class).
26. Open an NPC sheet; confirm CR, inline save-proficiency dots on the ability row, and any Legendary Action/Resistance pips render.
27. Click a Legendary Action pip; confirm one use is marked spent.
28. Confirm the NPC sheet has exactly 6 tabs and no Details/Bastion tab.
29. Open the NPC Biography tab; confirm separate Public and GM-only Details blocks each with their own edit-pencil.
30. Open a Group actor; confirm Members/Inventory/Effects/Biography tabs and a Travel Pace card.
31. Open an Encounter actor; confirm Members/Loot/Description tabs and a Roll Quantities button.
32. Open a Vehicle actor; confirm Cargo/Effects/Description tabs (Crew & Passengers only if it has crew).
33. Open a weapon's item sheet; confirm Description/Details/Activities/Effects tabs as applicable, and that an unidentified copy hides Details from a non-GM owner.
34. On an item's Activities tab, confirm the Charges column and Edit/Delete controls appear for an activity with Limited Uses.
35. Open an Attack activity; confirm Ability/Bonus/Flat/Critical-Threshold fields and a damage-part list render.
36. Open a Save activity; confirm Ability/Bonus/DC Calculation render, and the formula field locks when Calculation is automatic.
37. Open a Cast activity; confirm the spell drop area accepts a dragged spell and removal clears it.
38. Open Enchant and Summon activities; confirm their respective sub-tabs (Enchantments/Restrictions; Profiles/Changes) render.
39. Open a Forward activity; confirm it offers another activity to chain into, not its own Effect fields.
40. On Activation → Consumption, add a Spell Slots target and an Item Uses target; confirm the Target picker only appears where needed.
41. Open a class/background/feat item's Advancement tab; confirm level-group headers and at least one advancement type render with edit/delete.
42. Trigger a Usage dialog (e.g. upcast a spell); confirm the Scaling section offers the right levels and canceling changes nothing.

## Sources

Built entirely from the local install; no web browsing was performed in this pass (this task's tool set excludes browser/computer-use access):

- `C:/FoundryTest/data/Data/systems/dnd5e/dnd5e.mjs` (v6.0.5) — `activityTypes`, `advancementTypes`, `spellPreparationStates`, `SPELLCASTING`, `CONSUMPTION`, `proficiencyLevels`, per-sheet `TABS`, `ProficiencyCycleElement`, rest/mode-toggle logic.
- `C:/FoundryTest/data/Data/systems/dnd5e/lang/en.json` (v6.0.5) — every quoted label above.
- `C:/FoundryTest/data/Data/systems/dnd5e/templates/{actors,items,activity,inventory,shared}/**/*.hbs` — structure and `data-action` names.
- `C:/FoundryTest/data/Data/systems/dnd5e/system.json` — `documentTypes.Actor`/`.Item`.
- `C:/FoundryTest/app/client`, `C:/FoundryTest/app/public/lang/en.json` — Foundry 14.368 core, consulted only to confirm scope (ApplicationV2 windowing is core but not itself examined — out of this area).

Not consulted this pass, left as leads for a future cross-check per the task's trust order: `https://foundryvtt.com/kb/`, `https://foundryvtt.com/api/`, `https://foundryvtt.wiki/`, `https://github.com/foundryvtt/dnd5e/wiki`; no third-party guides were consulted. The ApplicationV2 sheet rewrite and the Activities/Consumption/Advancement systems documented here are recent (dnd5e 4.x–6.x); expect most existing third-party write-ups to describe the older "classic" v10–v12 sheet and to be silent on these — treat this local-source-derived document as authoritative over them wherever they conflict.
