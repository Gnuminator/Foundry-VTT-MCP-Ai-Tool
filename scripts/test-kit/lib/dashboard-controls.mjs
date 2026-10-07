/**
 * The dashboard control sweep's classification table (test kit slice 4).
 *
 * Every control the usage catalog names (shared/src/usage-catalog.generated.ts: entries with surface
 * 'dashboard' or 'player') is classified here by what a test may do with it in a real browser. The unit
 * test `test/dashboard-controls.test.mjs` fails when a catalog name has no row (a new control must be
 * classified on purpose) or a row names something the catalog no longer has. Module entries are out of
 * scope: the sweep reports them as skipped ("inside Foundry").
 *
 * The facts come from the front end itself: packages/cogm-dashboard/public/index.html, app.js,
 * player.html and player.js. A control is marked in the page with `data-track="<name>"`; the few that
 * are drawn without that attribute (pickers, the AI post button, the player's name buttons) have an
 * explicit `selector`.
 *
 * `how`:
 * - open      click it (after `reach`), then `expect` shows or `gone` is hidden
 * - read      click it (it only loads or reloads something), then `expect` shows
 * - toggle    click it, check the effect, click again to restore (`restore: false` leaves it)
 * - write     changes Foundry, the world or a saved setting: other flows cover it, the sweep never clicks it
 * - external  opens Obsidian, Foundry or another window, or writes the clipboard: the sweep only checks it
 *             is present, enabled and (for a link) has an address
 * - ai        needs Claude or an API key: present only
 * - view      a screen or panel as a whole: open it and check that it draws
 * - shortcut  press `key` on the page; `gone` is hidden afterwards
 * - error     an error toast or message: cannot be clicked
 * - skip      cannot be reached by a read-only test (`why` says why)
 *
 * Other fields:
 * - reach     names (of rows in this table) of controls to click first, in order
 * - expect    CSS selector that must be visible after the click
 * - gone      CSS selector that must be hidden or absent after the click
 * - changes   true: the clicked control's own label, class or pressed state must change; a selector: that element's
 * - key       the key for a shortcut
 * - why       for skip, write, external, ai and error: the reason
 * - optional  the control depends on data or a setting (a boss in combat, a stored reading, AI on):
 *             absent or disabled counts as a skip with a note, not a failure
 * - selector  CSS selector when the control carries no data-track attribute in the page
 * - fill      text to type into the control instead of clicking it
 * - at        click position {x, y} inside the element (the drawer backdrop is clicked beside the drawer)
 * - restore   false: do not click again to restore
 * - needs     'picker-tool': open a tool whose form has a "Pick..." button before the click
 * - theme     switch the theme select to this value first and put it back afterwards (the mist only shows
 *             with the Veil theme)
 * - slow      the control loads from the bridge: wait up to 60 s for `expect`
 * - idle      a selector that shows when the panel has finished loading; the sweep waits for it before
 *             the click, so a reload the previous row started does not redraw the panel under the click
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOWS = [
  'open',
  'read',
  'toggle',
  'write',
  'external',
  'ai',
  'view',
  'shortcut',
  'error',
  'skip',
];

/** @typedef {{
 *   name: string, how: string, reach?: string[], expect?: string, gone?: string, key?: string, why?: string,
 *   optional?: boolean, selector?: string, fill?: string, at?: {x: number, y: number}, restore?: boolean,
 *   needs?: string, theme?: string, slow?: boolean, changes?: boolean | string, idle?: string
 * }} ControlRow */

/** The reason every module entry is skipped. */
export const MODULE_SKIP_REASON = 'inside Foundry';

const ADV = 'dash.header.advanced';
const MOMENT_BEFORE = 'dash.moment.before';
const MOMENT_DURING = 'dash.moment.during';
const MOMENT_AFTER = 'dash.moment.after';

// A drawer is "docked" (part of the page, no Close button, Escape leaves it alone) in the moments that
// place it: Pre-flight and Prep in Before; Party, Handouts in During; Prep, Handouts in After. The
// close, Escape and backdrop checks therefore pick a moment where the drawer is an overlay.
const TOOLS = [ADV, 'dash.header.tools'];
const TAROKKA = [ADV, 'dash.header.tarokka'];
const PREFLIGHT = [MOMENT_DURING, ADV, 'dash.header.preflight']; // overlay in During and After
const PREP = [MOMENT_DURING, ADV, 'dash.header.prep']; // overlay in During
/** The Prep drawer has finished loading (its Refresh button is disabled while it loads). */
const PREP_IDLE = '#prep-refresh:not([disabled])';
const PARTY = [MOMENT_BEFORE, ADV, 'dash.header.party']; // overlay in Before and After
const HANDOUTS = [MOMENT_BEFORE, ADV, 'dash.header.handouts']; // overlay in Before
const AI = [ADV, 'dash.header.show-ai'];
const PLAYER_LINKS = [ADV, 'dash.header.player-links'];
const EVERYONE = [MOMENT_DURING, 'dash.changes.tab-everyone'];
/** The undo window of the Everyone tab, open on the first change that can still be undone. */
const UNDO_WINDOW = [...EVERYONE, 'dash.changes.everyone-undo'];
const UNDO_APPLY = '#undo-actions [data-undo-key="apply"]';
const PICKER = [...TOOLS];
const PICKER_OPEN = [...TOOLS, 'dash.tools.pick-open'];
const LAYOUT_TOUR = [ADV, 'dash.header.layout-tour'];
const TAROKKA_REVEAL_FORM = '.tarokka-form:not([hidden]) [data-reveal-text]';

const WRITE_FLOW = 'a write flow: it changes the game or the world, so the write checks cover it';

/** @type {ControlRow[]} the run order: groups (second part of the name) run in order of first appearance */
export const DASHBOARD_CONTROLS = [
  // --- the page ---
  { name: 'dash.main.view', how: 'view', expect: '.topbar' },
  { name: MOMENT_BEFORE, how: 'toggle', restore: false, expect: '#moment-before' },
  { name: MOMENT_DURING, how: 'toggle', restore: false, expect: '#moment-during' },
  { name: MOMENT_AFTER, how: 'toggle', restore: false, expect: '#moment-after' },

  // --- the header and the Advanced menu ---
  { name: ADV, how: 'open', expect: '#advanced-menu' },
  { name: 'dash.header.guides', how: 'open', reach: [ADV], expect: '#pane-help' },
  { name: 'dash.header.preflight', how: 'open', reach: [ADV], expect: '#preflight-drawer' },
  { name: 'dash.header.prep', how: 'open', reach: [ADV], expect: '#prep-drawer' },
  { name: 'dash.header.party', how: 'open', reach: [ADV], expect: '#party-drawer' },
  { name: 'dash.header.handouts', how: 'open', reach: [ADV], expect: '#handouts-drawer' },
  { name: 'dash.header.tarokka', how: 'open', reach: [ADV], expect: '#tarokka-drawer' },
  { name: 'dash.header.combat-buttons', how: 'toggle', reach: [ADV], changes: true },
  { name: 'dash.header.layout-tour', how: 'open', reach: [ADV], expect: '#layout-tour' },
  { name: 'dash.header.tools', how: 'open', reach: [ADV], expect: '#tools-drawer' },
  { name: 'dash.header.show-ai', how: 'open', reach: [ADV], expect: '#pane-ai' },
  { name: 'dash.header.show-diagnostics', how: 'open', reach: [ADV], expect: '#pane-diagnostics' },
  { name: 'dash.header.player-links', how: 'open', reach: [ADV], expect: '#pane-links' },
  {
    name: 'dash.header.pause',
    how: 'toggle',
    reach: [ADV],
    changes: true,
    optional: true,
    why: 'disabled while the AI commentary is off (no API key)',
  },
  {
    name: 'dash.header.diag-ai',
    how: 'toggle',
    reach: [ADV],
    changes: true,
    optional: true,
    why: 'disabled while the AI commentary is off (no API key)',
  },
  { name: 'dash.header.tone', how: 'toggle', reach: [ADV] },
  { name: 'dash.header.model', how: 'toggle', reach: [ADV] },
  { name: 'dash.header.theme', how: 'toggle' },
  {
    name: 'dash.header.mist',
    how: 'toggle',
    theme: 'veil',
    optional: true,
    why: 'only shown with the Veil theme',
  },
  {
    name: 'dash.header.gm-actions',
    how: 'write',
    why: 'flips the master switch for game-changing actions; the write checks cover it',
  },

  // --- the During layout trial (before the layout buttons: picking a layout hides the trial card) ---
  {
    name: 'dash.trial.start',
    how: 'open',
    reach: [MOMENT_BEFORE],
    expect: '#layout-tour',
    optional: true,
    why: 'the card is gone once a layout was picked',
  },
  { name: 'dash.trial.view', how: 'view', reach: LAYOUT_TOUR, expect: '#layout-tour' },
  { name: 'dash.trial.next', how: 'open', reach: LAYOUT_TOUR, changes: '#layout-tour-step' },
  { name: 'dash.trial.stop', how: 'open', reach: LAYOUT_TOUR, gone: '#layout-tour' },
  {
    name: 'dash.trial.use',
    how: 'write',
    why: 'keeps the layout for the world (saved screen choice, layoutPicked cannot be reset in the screen)',
  },
  {
    name: 'dash.trial.skip',
    how: 'write',
    why: 'keeps Cards for the world (saved screen choice, layoutPicked cannot be reset in the screen)',
  },

  // --- the During screen ---
  {
    name: 'dash.during.layout-layered',
    how: 'toggle',
    reach: [MOMENT_DURING],
    restore: false,
    expect: '#moment-during[data-layout="layered"]',
  },
  {
    name: 'dash.during.layout-toggle',
    how: 'toggle',
    reach: [MOMENT_DURING],
    restore: false,
    expect: '#moment-during[data-layout="toggle"]',
  },
  {
    name: 'dash.during.layout-auto',
    how: 'toggle',
    reach: [MOMENT_DURING],
    restore: false,
    expect: '#moment-during[data-layout="auto"]',
  },
  {
    name: 'dash.during.full-toggle',
    how: 'toggle',
    reach: [MOMENT_DURING, 'dash.during.layout-toggle'],
    changes: true,
  },
  {
    name: 'dash.during.hint-dismiss',
    how: 'write',
    why: 'saves hintDismissed for the world; only shown during a session before a layout was picked',
  },
  { name: 'dash.help.during-layouts', how: 'open', reach: [MOMENT_DURING], expect: '#pane-help' },

  // --- Recent Changes ---
  { name: 'dash.changes.refresh', how: 'read', reach: [MOMENT_DURING], expect: '#changes-body' },
  {
    name: 'dash.changes.show-diff',
    how: 'toggle',
    reach: [MOMENT_DURING],
    expect: '#changes-body .change-diff',
    optional: true,
    why: 'needs a recent change with diff lines',
  },
  {
    name: 'dash.changes.open-obsidian',
    how: 'external',
    reach: [MOMENT_DURING],
    optional: true,
    why: 'opens Obsidian; shown only with a recent change and a known vault',
  },
  { name: 'dash.changes.undo', how: 'write', why: WRITE_FLOW },
  // The Everyone tab (I-109): the toolbar shows once the bridge serves list-changes; the person
  // select shows with the Everyone tab. Undo opens the undo window (a plan, nothing changes before
  // Apply); Redo asks in the confirm window first, like Undo in the AI tab. The sweep puts the AI tab
  // back before every row (resetDashboard).
  {
    name: 'dash.changes.tab-everyone',
    how: 'open',
    reach: [MOMENT_DURING],
    expect: '#changes-person',
    optional: true,
    why: 'the Everyone tab shows only when the bridge serves list-changes',
  },
  { name: 'dash.changes.tab-ai', how: 'open', reach: EVERYONE, gone: '#changes-person' },
  {
    name: 'dash.changes.person',
    how: 'toggle',
    reach: EVERYONE,
    why: 'has more than one option only with a change by a person in the last 7 days',
  },
  {
    name: 'dash.changes.everyone-show-lines',
    how: 'toggle',
    reach: EVERYONE,
    expect: '#changes-body .change-diff',
    optional: true,
    why: 'needs a change in the last 7 days with diff lines',
  },
  {
    name: 'dash.changes.everyone-undo',
    how: 'open',
    reach: EVERYONE,
    expect: '#undo-backdrop',
    optional: true,
    slow: true,
    why: 'needs a change in the last 7 days that can still be undone (and GM Actions on)',
  },
  {
    name: 'dash.changes.everyone-redo',
    how: 'write',
    why: 'puts an undone change back after the confirm window; the guarded undo checks cover it',
  },

  // --- the combat strip (only with a live combat; the buttons need GM Actions and Combat buttons on) ---
  {
    name: 'dash.combat.boss-prompts',
    how: 'toggle',
    reach: [MOMENT_DURING],
    changes: true,
    optional: true,
    why: 'only shown while a boss is in the combat',
  },
  {
    name: 'dash.combat.reaction',
    how: 'toggle',
    reach: [MOMENT_DURING],
    changes: true,
    optional: true,
    why: 'only shown with Boss prompts on and a combat',
  },
  {
    name: 'dash.combat.select-combatant',
    how: 'toggle',
    reach: [MOMENT_DURING],
    expect: '.combatant.selected',
    optional: true,
    why: 'only with a combat, GM Actions on and Combat buttons on',
  },
  {
    name: 'dash.combat.selection-clear',
    how: 'toggle',
    reach: [MOMENT_DURING, 'dash.combat.select-combatant'],
    restore: false,
    expect: '.ca-hint',
    optional: true,
    why: 'needs a selected combatant',
  },
  {
    name: 'dash.combat.selection-condition',
    how: 'open',
    reach: [MOMENT_DURING, 'dash.combat.select-combatant'],
    expect: '#tool-detail',
    optional: true,
    why: 'needs a selected combatant (opens the tool form, runs nothing)',
  },
  {
    name: 'dash.combat.selection-damage',
    how: 'open',
    reach: [MOMENT_DURING, 'dash.combat.select-combatant'],
    expect: '#tool-detail',
    optional: true,
    why: 'needs a selected combatant (opens the tool form, runs nothing)',
  },

  // --- the Tool Runner ---
  { name: 'dash.tools.view', how: 'view', reach: TOOLS, expect: '#tools-drawer' },
  { name: 'dash.tools.close', how: 'open', reach: TOOLS, gone: '#tools-drawer' },
  {
    name: 'dash.drawer.backdrop',
    how: 'open',
    reach: TOOLS,
    at: { x: 10, y: 300 },
    gone: '#tools-drawer',
  },
  {
    name: 'dash.tools.search',
    how: 'read',
    reach: TOOLS,
    fill: 'get',
    expect: '#tool-list .tool-item',
  },
  { name: 'dash.tools.open-tool', how: 'open', reach: TOOLS, expect: '#tool-detail' },
  {
    name: 'dash.tools.back',
    how: 'open',
    reach: [...TOOLS, 'dash.tools.open-tool'],
    expect: '#tool-browser',
  },
  {
    name: 'dash.tools.pick-open',
    how: 'open',
    reach: PICKER,
    needs: 'picker-tool',
    selector: '#tool-form .ref-open',
    expect: '#tool-form .ref-menu',
    // Required: the tool runner always has tools with a Pick button (plan-actor-change and more).
  },
  {
    name: 'dash.tools.pick-choice',
    how: 'read',
    reach: PICKER_OPEN,
    needs: 'picker-tool',
    selector: '#tool-form .ref-item',
    optional: true,
    why: 'needs a picker with at least one choice (fills the field, runs nothing)',
  },
  {
    name: 'dash.tools.show-all-actors',
    how: 'read',
    reach: PICKER_OPEN,
    needs: 'picker-tool',
    selector: '#tool-form .ref-all',
    expect: '#tool-form .ref-list',
    optional: true,
    why: 'only on a picker that narrows actors to the tool kinds',
  },
  {
    name: 'dash.tools.enable-gm-actions',
    how: 'write',
    why: 'turns GM Actions on; only shown while they are off, and the write checks cover it',
  },

  // --- Handouts ---
  { name: 'dash.handouts.view', how: 'view', reach: HANDOUTS, expect: '#handouts-drawer' },
  { name: 'dash.handouts.close', how: 'open', reach: HANDOUTS, gone: '#handouts-drawer' },
  { name: 'dash.handouts.refresh', how: 'read', reach: HANDOUTS, expect: '#handouts-queue' },
  { name: 'dash.handouts.queue-page', how: 'open', reach: HANDOUTS, expect: '#tool-detail' },
  { name: 'dash.handouts.show-now', how: 'toggle', reach: HANDOUTS },
  {
    name: 'dash.handouts.reveal-next',
    how: 'write',
    why: 'reveals the next queued page to the players',
  },
  { name: 'dash.handouts.unqueue', how: 'write', why: 'removes a page from the reveal queue' },

  // --- Prep ---
  { name: 'dash.prep.view', how: 'view', reach: PREP, expect: '#prep-drawer' },
  { name: 'dash.prep.close', how: 'open', reach: PREP, gone: '#prep-drawer' },
  { name: 'dash.prep.refresh', how: 'read', reach: PREP, expect: '#prep-last' },
  {
    name: 'dash.prep.all-beats',
    idle: PREP_IDLE,
    how: 'read',
    reach: PREP,
    expect: '#prep-last',
    optional: true,
    why: 'only shown when the last session has beats',
  },
  {
    name: 'dash.prep.show-beats',
    idle: PREP_IDLE,
    how: 'toggle',
    reach: PREP,
    expect: '#prep-last .prep-beats ul',
    optional: true,
    why: 'only shown when the last session has beats',
  },
  {
    name: 'dash.prep.open-journal',
    idle: PREP_IDLE,
    how: 'external',
    reach: PREP,
    optional: true,
    why: 'opens a journal in the GM Foundry window; only shown when the digest names one',
  },
  {
    name: 'dash.prep.open-preflight',
    how: 'open',
    reach: PREP,
    expect: '#preflight-drawer',
    optional: true,
    why: 'only shown when the digest has a pre-flight result',
  },

  // --- Party ---
  { name: 'dash.party.view', how: 'view', reach: PARTY, expect: '#party-drawer' },
  { name: 'dash.party.close', how: 'open', reach: PARTY, gone: '#party-drawer' },
  { name: 'dash.party.refresh', how: 'read', reach: PARTY, expect: '#party-members' },
  {
    name: 'dash.party.group',
    how: 'toggle',
    reach: PARTY,
    optional: true,
    why: 'only shown when the world has more than one party',
  },
  {
    name: 'dash.party.open-actor',
    how: 'external',
    reach: PARTY,
    optional: true,
    why: 'opens the actor in the GM Foundry window; only shown when there are members',
  },
  { name: 'dash.party.add-to-combat', how: 'write', why: 'puts the party into a combat' },
  { name: 'dash.party.pace', how: 'write', why: 'sets the party travel pace' },
  { name: 'dash.party.place', how: 'write', why: 'places the party tokens on the scene' },
  { name: 'dash.party.rest-long', how: 'write', why: 'requests a long rest' },
  { name: 'dash.party.rest-short', how: 'write', why: 'requests a short rest' },

  // --- Pre-flight and Ready for session ---
  { name: 'dash.preflight.view', how: 'view', reach: PREFLIGHT, expect: '#preflight-drawer' },
  { name: 'dash.preflight.close', how: 'open', reach: PREFLIGHT, gone: '#preflight-drawer' },
  {
    name: 'dash.preflight.run',
    how: 'read',
    reach: PREFLIGHT,
    expect: '#preflight-summary',
    slow: true,
  },
  { name: 'dash.preflight.manual-tick', how: 'toggle', reach: PREFLIGHT },
  {
    name: 'dash.preflight.clear-ticks',
    how: 'toggle',
    reach: [...PREFLIGHT, 'dash.preflight.manual-tick'],
    restore: false,
    gone: '#preflight-manual input:checked',
  },
  {
    name: 'dash.preflight.show-findings',
    how: 'toggle',
    reach: PREFLIGHT,
    expect: '#preflight-findings li',
    optional: true,
    why: 'only shown when the scan has findings',
  },
  { name: 'dash.ready.turn-on', how: 'write', why: 'turns the module switches and GM Actions on' },
  {
    name: 'dash.ready.turn-off',
    how: 'write',
    why: 'turns the switches Ready turned on off again',
  },
  {
    name: 'dash.ready.start-log',
    how: 'write',
    why: 'starts a play session (writes the bridge session log)',
  },

  // --- Tarokka ---
  { name: 'dash.tarokka.view', how: 'view', reach: TAROKKA, expect: '#tarokka-drawer' },
  { name: 'dash.tarokka.close', how: 'open', reach: TAROKKA, gone: '#tarokka-drawer' },
  { name: 'dash.tarokka.refresh', how: 'read', reach: TAROKKA, expect: '#tarokka-body' },
  { name: 'dash.tarokka.show-cards', how: 'toggle', reach: TAROKKA },
  { name: 'dash.tarokka.import', how: 'write', why: 'stores a reading from tarokka-reading' },
  { name: 'dash.tarokka.roll', how: 'write', why: 'deals and stores a new reading' },
  {
    name: 'dash.tarokka.open-obsidian',
    how: 'external',
    reach: TAROKKA,
    optional: true,
    why: 'opens Obsidian; shown only with a known vault and world',
  },
  {
    name: 'dash.tarokka.open-document',
    how: 'external',
    reach: TAROKKA,
    optional: true,
    why: 'opens a document in the GM Foundry window; only shown for a linked position',
  },
  {
    name: 'dash.tarokka.link',
    how: 'open',
    reach: TAROKKA,
    expect: '.tarokka-form:not([hidden]) [data-link-query]',
    optional: true,
    why: 'needs a stored reading',
  },
  {
    name: 'dash.tarokka.link-search',
    how: 'read',
    reach: [...TAROKKA, 'dash.tarokka.link'],
    expect: '.tarokka-candidates > *',
    optional: true,
    why: 'needs a stored reading',
  },
  { name: 'dash.tarokka.link-pick', how: 'write', why: 'links a search result to a card position' },
  {
    name: 'dash.tarokka.reveal',
    how: 'open',
    reach: TAROKKA,
    expect: TAROKKA_REVEAL_FORM,
    optional: true,
    why: 'needs a stored reading',
  },
  {
    name: 'dash.tarokka.show-now',
    how: 'toggle',
    reach: [...TAROKKA, 'dash.tarokka.reveal'],
    optional: true,
    why: 'needs a stored reading',
  },
  {
    name: 'dash.tarokka.plan-reveal',
    how: 'write',
    why: 'plans a reveal of a card to the players',
  },

  // --- the Before screen's feature cards ---
  { name: 'dash.features.read-more', how: 'open', reach: [MOMENT_BEFORE], expect: '#pane-help' },

  // --- the After screen ---
  { name: 'dash.after.refresh', how: 'read', reach: [MOMENT_AFTER], expect: '#stat-cards' },
  {
    name: 'dash.after.copy-stats',
    how: 'external',
    reach: [MOMENT_AFTER],
    optional: true,
    why: 'writes the clipboard; disabled until a session has stats',
  },
  {
    name: 'dash.after.open-note',
    how: 'external',
    reach: [MOMENT_AFTER],
    optional: true,
    why: 'opens Obsidian; shown only with a session note and a known vault',
  },
  {
    name: 'dash.notes.read',
    how: 'read',
    reach: [MOMENT_AFTER],
    expect: '#pane-help',
    optional: true,
    why: 'only shown when the latest session has notes',
  },
  {
    name: 'dash.notes.about-switch',
    how: 'open',
    reach: [MOMENT_AFTER],
    expect: '#pane-help',
    optional: true,
    why: 'only shown when the Session notes switch is off and notes wait',
  },
  { name: 'dash.notes.put', how: 'write', why: 'puts the session notes into Foundry' },
  { name: 'dash.notes.approve', how: 'write', why: 'approves the session notes' },
  { name: 'dash.notes.undo', how: 'write', why: 'takes the session notes out of Foundry again' },

  // --- the session marker in the header ---
  {
    name: 'dash.session.toggle',
    how: 'write',
    why: 'starts or ends a play session (writes the bridge session log)',
  },
  {
    name: 'dash.session.open-obsidian',
    how: 'external',
    optional: true,
    why: 'opens Obsidian; shown only with a known vault and world',
  },

  // --- player links ---
  {
    name: 'dash.links.copy',
    how: 'external',
    reach: PLAYER_LINKS,
    optional: true,
    why: 'writes the clipboard; shown only for a player with a link',
  },
  { name: 'dash.links.make', how: 'write', why: 'makes a player link' },
  {
    name: 'dash.links.replace',
    how: 'write',
    why: 'replaces a player link (the old one stops working)',
  },
  { name: 'dash.links.remove', how: 'write', why: 'removes a player link' },

  // --- AI commentary ---
  {
    name: 'dash.ai.ask',
    how: 'ai',
    reach: AI,
    expect: '#ask-form',
    why: 'asking needs Claude through the API; the sweep only checks the form is there',
  },
  {
    name: 'dash.ai.post-to-chat',
    how: 'ai',
    reach: AI,
    selector: '#ai-body .btn-post',
    optional: true,
    why: 'posts a comment to the Foundry chat; shown only under a finished AI comment',
  },
  {
    name: 'dash.ai.error',
    how: 'error',
    why: 'the message under an AI comment that failed; cannot be clicked',
  },

  // --- help ---
  { name: 'dash.help.view', how: 'view', reach: [ADV, 'dash.header.guides'], expect: '#pane-help' },

  // --- toasts and the confirm window ---
  { name: 'dash.toast.error', how: 'error', why: 'an error toast; cannot be clicked' },
  { name: 'dash.toast.undo', how: 'write', why: 'undoes the change the toast reports' },
  {
    name: 'dash.modal.cancel',
    how: 'write',
    why: 'the confirm window opens only from a write flow; its checks cover it',
  },
  { name: 'dash.modal.confirm', how: 'write', why: 'confirms a write; the write checks cover it' },
  {
    name: 'dash.modal.destructive-check',
    how: 'write',
    why: 'the destructive tick of the confirm window; the write checks cover it',
  },

  // --- the undo window (I-109, from Undo on the Everyone tab) ---
  // Its stages: choose (Just this / Everything since, only when later changes touched the same
  // thing), confirm (Cancel / Undo = apply), and under Advanced the table rewind: rewind-1
  // (Continue) and rewind-2 (the destructive tick, then apply). Every step but Apply only plans
  // (a read) or moves on; Apply changes the game and stays with the guarded undo checks.
  {
    name: 'dash.undo.cancel',
    how: 'open',
    reach: UNDO_WINDOW,
    gone: '#undo-backdrop',
    optional: true,
    why: 'needs the undo window',
  },
  {
    name: 'dash.undo.just-this',
    how: 'open',
    reach: UNDO_WINDOW,
    expect: UNDO_APPLY,
    optional: true,
    why: 'shown only when later changes touched the same thing',
  },
  {
    name: 'dash.undo.everything-since',
    how: 'open',
    reach: UNDO_WINDOW,
    expect: UNDO_APPLY,
    optional: true,
    slow: true,
    why: 'shown only when later changes touched the same thing',
  },
  {
    name: 'dash.undo.advanced',
    how: 'toggle',
    reach: UNDO_WINDOW,
    expect: '.undo-advanced [data-undo-key="rewind"]',
    optional: true,
    why: 'the Advanced fold shows only when the change is the latest on its thing or asks to choose',
  },
  {
    name: 'dash.undo.rewind',
    how: 'open',
    reach: [...UNDO_WINDOW, 'dash.undo.advanced'],
    expect: '#undo-actions [data-undo-key="next"]',
    optional: true,
    slow: true,
    why: 'under Advanced in the undo window; it only plans the rewind',
  },
  {
    name: 'dash.undo.next',
    how: 'open',
    reach: [...UNDO_WINDOW, 'dash.undo.advanced', 'dash.undo.rewind'],
    expect: '#undo-destructive-check',
    optional: true,
    why: 'the second rewind question; its Apply stays disabled until the tick',
  },
  {
    name: 'dash.undo.destructive-check',
    how: 'toggle',
    reach: [...UNDO_WINDOW, 'dash.undo.advanced', 'dash.undo.rewind', 'dash.undo.next'],
    optional: true,
    why: 'the destructive tick of the rewind; Apply is never clicked',
  },
  {
    name: 'dash.undo.apply',
    how: 'write',
    why: 'applies the undo plan: it changes the game; the guarded undo checks cover it',
  },

  // --- Escape ---
  {
    name: 'dash.shortcut.escape-handouts',
    how: 'shortcut',
    reach: HANDOUTS,
    key: 'Escape',
    gone: '#handouts-drawer',
  },
  {
    name: 'dash.shortcut.escape-modal',
    how: 'skip',
    why: 'closes the confirm window, which opens only from a write flow',
  },
  {
    name: 'dash.shortcut.escape-undo',
    how: 'shortcut',
    reach: UNDO_WINDOW,
    key: 'Escape',
    gone: '#undo-backdrop',
    optional: true,
    why: 'needs the undo window',
  },
  {
    name: 'dash.shortcut.escape-party',
    how: 'shortcut',
    reach: PARTY,
    key: 'Escape',
    gone: '#party-drawer',
  },
  {
    name: 'dash.shortcut.escape-picker',
    how: 'shortcut',
    reach: PICKER_OPEN,
    needs: 'picker-tool',
    key: 'Escape',
    gone: '#tool-form .ref-menu',
    optional: true,
    why: 'needs a tool whose form has a Pick button',
  },
  {
    name: 'dash.shortcut.escape-preflight',
    how: 'shortcut',
    reach: PREFLIGHT,
    key: 'Escape',
    gone: '#preflight-drawer',
  },
  {
    name: 'dash.shortcut.escape-prep',
    how: 'shortcut',
    reach: PREP,
    key: 'Escape',
    gone: '#prep-drawer',
  },
  {
    name: 'dash.shortcut.escape-tarokka',
    how: 'shortcut',
    reach: TAROKKA,
    key: 'Escape',
    gone: '#tarokka-drawer',
  },
  {
    name: 'dash.shortcut.escape-tools',
    how: 'shortcut',
    reach: TOOLS,
    key: 'Escape',
    gone: '#tools-drawer',
  },
];

/**
 * The player page (/player). The sweep reloads it with no stored name before each row. The name
 * picker rows are required: every kit world has the kit player user, so the bridge always knows a
 * player name.
 */
export const PLAYER_CONTROLS = [
  { name: 'player.main.view', how: 'view', expect: '#combat' },
  {
    name: 'player.who.skip',
    how: 'toggle',
    selector: '#who-list .who-pick:text-is("Skip")',
    restore: false,
    expect: '#who',
  },
  {
    name: 'player.who.change',
    how: 'toggle',
    reach: ['player.who.skip'],
    restore: false,
    expect: '#who-picker',
  },
  {
    name: 'player.who.pick',
    how: 'toggle',
    reach: ['player.who.skip', 'player.who.change'],
    selector: '#who-list .who-pick:not(:text-is("Skip"))',
    restore: false,
    expect: '#who-name',
  },
  {
    name: 'player.handouts.open',
    how: 'toggle',
    expect: '#handouts details[open]',
    optional: true,
    why: 'needs a revealed handout',
  },
  {
    name: 'player.footer.mist',
    how: 'toggle',
    optional: true,
    why: 'only shown with the Veil theme',
  },
];

/** Both tables, dashboard first. */
export const CONTROLS = [...DASHBOARD_CONTROLS, ...PLAYER_CONTROLS];

/** The surface a control name belongs to, from its prefix. */
export function surfaceOf(name) {
  if (name.startsWith('player.')) return 'player';
  if (name.startsWith('module.')) return 'module';
  return 'dashboard';
}

/** The group (second part of the name) a row is reported in: `dash.tools.close` is `tools`. */
export function groupOf(name) {
  return name.split('.')[1] ?? name;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * The usage catalog, read from the generated TypeScript file (there is no JavaScript build of it).
 * @param {string} [root]  repo root; default is the checkout this file is in
 * @returns {Array<{name: string, kind: string, surface: string, file: string}>}
 */
export function readUsageCatalog(root = repoRoot) {
  const text = readFileSync(path.join(root, 'shared', 'src', 'usage-catalog.generated.ts'), 'utf8');
  const re = /name:\s*'([^']+)',\s*kind:\s*'([^']+)',\s*surface:\s*'([^']+)',\s*file:\s*'([^']+)'/g;
  const out = [];
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push({ name: m[1], kind: m[2], surface: m[3], file: m[4] });
  }
  return out;
}

/**
 * What does not line up between the catalog and the table: catalog names (dashboard and player) with
 * no row, and rows whose name is not in the catalog.
 * @param {Array<{name: string, surface: string}>} catalog
 * @returns {Array<{name: string, problem: 'missing' | 'not in the catalog'}>}
 */
export function unclassified(catalog) {
  const rows = new Set(CONTROLS.map(r => r.name));
  const all = new Set(catalog.map(c => c.name));
  const problems = [];
  for (const c of catalog) {
    if (c.surface === 'module') continue;
    if (!rows.has(c.name))
      problems.push({ name: c.name, problem: /** @type {const} */ ('missing') });
  }
  for (const r of CONTROLS) {
    if (!all.has(r.name))
      problems.push({ name: r.name, problem: /** @type {const} */ ('not in the catalog') });
  }
  return problems;
}

/**
 * The module entries of the catalog as skipped rows ("inside Foundry").
 * @param {Array<{name: string, surface: string}>} catalog
 * @returns {ControlRow[]}
 */
export function moduleSkips(catalog) {
  return catalog
    .filter(c => c.surface === 'module')
    .map(c => ({ name: c.name, how: 'skip', why: MODULE_SKIP_REASON }));
}

/**
 * The rows of a surface, grouped in run order.
 * @param {'dashboard' | 'player'} surface
 * @returns {Array<{group: string, rows: ControlRow[]}>}
 */
export function groupedRows(surface) {
  const rows = surface === 'player' ? PLAYER_CONTROLS : DASHBOARD_CONTROLS;
  /** @type {Map<string, ControlRow[]>} */
  const groups = new Map();
  for (const r of rows) {
    const g = groupOf(r.name);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)?.push(r);
  }
  return [...groups].map(([group, list]) => ({ group, rows: list }));
}

/** Rows by `how`. */
export function countByHow(rows = CONTROLS) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const h of HOWS) counts[h] = 0;
  for (const r of rows) counts[r.how] = (counts[r.how] ?? 0) + 1;
  return counts;
}
