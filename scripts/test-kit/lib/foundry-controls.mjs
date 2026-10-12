/**
 * The classification table of the module's controls inside the Foundry client (test kit, D-110
 * decision 5): everything the Foundry AI Tool module adds to Foundry's own screens. The
 * `foundry-controls` scenario walks it as the GM ("Kit GM") and as a player ("Kit Player"); the page
 * driver is lib/foundry-sweep.mjs. A unit test keeps the table in step with the usage catalog (every
 * `module.*` control has a row here) and with the driver (every row has a check).
 *
 * `how` says what the sweep does with the GM's control:
 * - `open`    opens a window or a dialog and checks what it shows, then closes it;
 * - `click`   clicks it and checks the result (a reload, a notice);
 * - `toggle`  changes it, checks the effect and puts it back;
 * - `write`   a change to the game or the world, always through the guarded path or a setting that is
 *             put back; a failure to put it back fails the row;
 * - `external` a link out of Foundry: the target is read, never followed;
 * - `skip`    cannot run in a kit world (the reason is in `why`).
 *
 * `player` says what a player must see: `hidden` (the control is not on the player's screen at all),
 * `works` (a player uses it), `none` (nothing to check on a player's screen).
 */

/** @typedef {'open' | 'click' | 'toggle' | 'write' | 'external' | 'skip'} FoundryHow */
/** @typedef {'hidden' | 'works' | 'none'} PlayerRule */
/** @typedef {{name: string, area: string, label: string, how: FoundryHow, player: PlayerRule, why?: string}} FoundryControl */

export const HOWS = ['open', 'click', 'toggle', 'write', 'external', 'skip'];

/** The areas in run order, with the heading the report shows. */
export const AREAS = [
  ['scene', 'Scene controls'],
  ['changes', 'Changes window'],
  ['handouts', 'Handouts window'],
  ['tarokka', 'Tarokka window'],
  ['settings', 'Settings and settings menus'],
  ['join-page', 'Join page look'],
  ['journal', 'Journal sheet'],
  ['chat', 'Chat cards'],
  ['player', 'What a player cannot do'],
  ['errors', 'Error counters'],
];

const SKIP_TAROKKA_MODULE =
  'needs the Tarokka deck module (tarokka-reading) active in the world; the kit worlds do not have it';

/** @type {FoundryControl[]} */
export const FOUNDRY_CONTROLS = [
  // --- Scene controls ----------------------------------------------------------------------------
  {
    name: 'foundry.scene.group',
    area: 'scene',
    label: 'The "AI Tool" group in the scene controls',
    how: 'open',
    player: 'hidden',
  },
  {
    name: 'foundry.scene.changes',
    area: 'scene',
    label: 'Scene tool "Changes"',
    how: 'open',
    player: 'hidden',
  },
  {
    name: 'foundry.scene.handouts',
    area: 'scene',
    label: 'Scene tool "Handouts"',
    how: 'open',
    player: 'hidden',
  },
  {
    name: 'foundry.scene.tarokka',
    area: 'scene',
    label: 'Scene tool "Tarokka"',
    how: 'open',
    player: 'hidden',
  },

  // --- Changes window ----------------------------------------------------------------------------
  {
    name: 'foundry.changes.refresh',
    area: 'changes',
    label: 'Changes: Refresh',
    how: 'click',
    player: 'hidden',
  },
  {
    name: 'foundry.changes.filter',
    area: 'changes',
    label: 'Changes: Show (filter by person)',
    how: 'toggle',
    player: 'hidden',
  },
  {
    name: 'foundry.changes.more',
    area: 'changes',
    label: 'Changes: Show more',
    how: 'click',
    player: 'hidden',
  },
  {
    name: 'foundry.changes.details',
    area: 'changes',
    label: 'Changes: a row\'s "Changes (N)" details',
    how: 'toggle',
    player: 'hidden',
  },
  {
    name: 'foundry.changes.undo',
    area: 'changes',
    label: 'Changes: Undo (plan, confirm, apply, then undo from the window)',
    how: 'write',
    player: 'hidden',
  },
  {
    name: 'foundry.changes.undo-older',
    area: 'changes',
    label: 'Changes: Undo of an older change (Just this, Everything since, Cancel)',
    how: 'open',
    player: 'hidden',
  },
  {
    name: 'foundry.changes.undo-advanced',
    area: 'changes',
    label: 'Changes: Advanced, "Rewind the whole table to here" (shown, never clicked)',
    how: 'open',
    player: 'hidden',
  },
  {
    name: 'foundry.changes.redo',
    area: 'changes',
    label: 'Changes: Redo',
    how: 'write',
    player: 'hidden',
  },

  // --- Handouts window ---------------------------------------------------------------------------
  {
    name: 'foundry.handouts.refresh',
    area: 'handouts',
    label: 'Handouts: Refresh',
    how: 'click',
    player: 'hidden',
  },
  {
    name: 'foundry.handouts.show-now',
    area: 'handouts',
    label: 'Handouts: Show it now',
    how: 'toggle',
    player: 'hidden',
  },
  {
    name: 'foundry.handouts.reveal',
    area: 'handouts',
    label: 'Handouts: Reveal next',
    how: 'open',
    player: 'hidden',
  },
  {
    name: 'foundry.handouts.remove',
    area: 'handouts',
    label: 'Handouts: Remove (from the queue)',
    how: 'write',
    player: 'hidden',
  },

  // --- Tarokka window ----------------------------------------------------------------------------
  {
    name: 'foundry.tarokka.refresh',
    area: 'tarokka',
    label: 'Tarokka: Refresh',
    how: 'click',
    player: 'hidden',
  },
  {
    name: 'foundry.tarokka.show-cards',
    area: 'tarokka',
    label: 'Tarokka: Show cards',
    how: 'toggle',
    player: 'hidden',
  },
  {
    name: 'foundry.tarokka.reveal-form',
    area: 'tarokka',
    label: 'Tarokka: Reveal... (form, checks, Cancel)',
    how: 'open',
    player: 'hidden',
  },
  {
    name: 'foundry.tarokka.reveal',
    area: 'tarokka',
    label: 'Tarokka: Reveal (plan, confirm, apply, then undo)',
    how: 'write',
    player: 'hidden',
  },
  {
    name: 'foundry.tarokka.open-doc',
    area: 'tarokka',
    label: 'Tarokka: Open Journal / Scene / Actor / page',
    how: 'click',
    player: 'hidden',
  },

  // --- Settings ----------------------------------------------------------------------------------
  {
    name: 'foundry.settings.section',
    area: 'settings',
    label: 'The "Foundry AI Tool" section of Configure Settings',
    how: 'open',
    player: 'hidden',
  },
  {
    name: 'foundry.settings.feature-switches',
    area: 'settings',
    label: 'The nine "AI Tool: ..." feature switches',
    how: 'open',
    player: 'hidden',
  },
  {
    name: 'module.settings.save',
    area: 'settings',
    label: 'Configure Settings: Save Changes (a module setting, put back)',
    how: 'toggle',
    player: 'hidden',
  },
  {
    name: 'module.settings.help',
    area: 'settings',
    label: 'Settings menu: Open the GM guide',
    how: 'external',
    player: 'hidden',
  },
  {
    name: 'module.settings.enhanced-index-open',
    area: 'settings',
    label: 'Settings menu: Configure Enhanced Index',
    how: 'open',
    player: 'hidden',
  },
  {
    name: 'module.settings.enhanced-index-save',
    area: 'settings',
    label: 'Enhanced Index: Save Settings (put back)',
    how: 'toggle',
    player: 'hidden',
  },
  {
    name: 'module.settings.enhanced-index-rebuild',
    area: 'settings',
    label: 'Enhanced Index: Rebuild Creature Index',
    how: 'click',
    player: 'hidden',
  },

  // --- Join page look ----------------------------------------------------------------------------
  {
    name: 'foundry.join-page.dialog',
    area: 'join-page',
    label: 'Settings menu: Choose join page look (dialog, Cancel)',
    how: 'open',
    player: 'hidden',
  },
  {
    name: 'module.join-page.veil',
    area: 'join-page',
    label: 'Join page look: Apply The Veil (put back)',
    how: 'write',
    player: 'hidden',
  },
  {
    name: 'module.join-page.default',
    area: 'join-page',
    label: "Join page look: Back to Foundry's look",
    how: 'write',
    player: 'hidden',
  },

  // --- Journal sheet -----------------------------------------------------------------------------
  {
    name: 'module.campaign.status-toggle',
    area: 'journal',
    label: 'Journal: the campaign status toggle (GM cycles it, a player is refused)',
    how: 'toggle',
    player: 'works',
  },

  // --- Chat cards --------------------------------------------------------------------------------
  {
    name: 'module.chat.roll-button',
    area: 'chat',
    label: 'Chat: the roll request button (the player rolls, the card says who did)',
    how: 'write',
    player: 'works',
  },
  {
    name: 'module.tarokka.offer-confirm',
    area: 'chat',
    label: 'Dialog: offer a dealt Tarokka reading to the AI Tool (Yes)',
    how: 'skip',
    player: 'none',
    why: SKIP_TAROKKA_MODULE,
  },
  {
    name: 'module.tarokka.offer-decline',
    area: 'chat',
    label: 'Dialog: offer a dealt Tarokka reading to the AI Tool (No)',
    how: 'skip',
    player: 'none',
    why: SKIP_TAROKKA_MODULE,
  },

  // --- A player -----------------------------------------------------------------------------------
  {
    name: 'foundry.player.queries-locked',
    area: 'player',
    label: 'A player cannot call the bridge queries or the GM helper queries',
    how: 'open',
    player: 'works',
  },
];

/** The error counters of the usage catalog: not controls, listed as skipped so the catalog is whole. */
export const ERROR_COUNTER_WHY = 'an error counter of the usage log, not a control';

/**
 * Rows for the catalog's `module.error.*` names (skipped).
 * @param {Array<{name: string, surface: string}>} catalog
 * @returns {FoundryControl[]}
 */
export function errorCounterRows(catalog) {
  return catalog
    .filter(c => c.surface === 'module' && c.name.startsWith('module.error.'))
    .map(c => ({
      name: c.name,
      area: 'errors',
      label: c.name,
      how: /** @type {const} */ ('skip'),
      player: /** @type {const} */ ('none'),
      why: ERROR_COUNTER_WHY,
    }));
}

/**
 * What does not line up between the usage catalog and the table: a `module.*` control (not an error
 * counter) with no row, and a `module.*` row that is not in the catalog.
 * @param {Array<{name: string, surface: string}>} catalog
 * @returns {Array<{name: string, problem: 'missing' | 'not in the catalog'}>}
 */
export function unclassifiedModule(catalog) {
  const rows = new Set(FOUNDRY_CONTROLS.map(r => r.name));
  const names = new Set(catalog.filter(c => c.surface === 'module').map(c => c.name));
  /** @type {Array<{name: string, problem: 'missing' | 'not in the catalog'}>} */
  const problems = [];
  for (const name of names) {
    if (name.startsWith('module.error.')) continue;
    if (!rows.has(name)) problems.push({ name, problem: 'missing' });
  }
  for (const r of FOUNDRY_CONTROLS) {
    if (r.name.startsWith('module.') && !names.has(r.name)) {
      problems.push({ name: r.name, problem: 'not in the catalog' });
    }
  }
  return problems;
}

/** Rows by `how`. */
export function countHows(rows = FOUNDRY_CONTROLS) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const h of HOWS) counts[h] = 0;
  for (const r of rows) counts[r.how] = (counts[r.how] ?? 0) + 1;
  return counts;
}

/** The rows of one area, in table order. */
export function rowsOf(area) {
  return FOUNDRY_CONTROLS.filter(r => r.area === area);
}
