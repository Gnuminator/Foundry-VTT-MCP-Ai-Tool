/**
 * Drives the Actor Studio module (foundryvtt-actor-studio) the way a person at the table does:
 * through its own windows, with Playwright clicks on the GM page. A hero is made in two stages,
 * as Actor Studio makes it:
 *
 *   1. The creation window: the ability scores, a species, a background and a class (each picked
 *      from the window's own drop-downs), a name, then "Create Character". The window embeds the
 *      system's advancement dialogs; the answer pump (studio-pump.mjs) answers those.
 *   2. The level-up window, opened from the "level up" button on the character sheet, once per level:
 *      pick the class row, the subclass when the level gives one, then "Add Level".
 *
 * Nothing here is hidden from the module's own code: the pump only answers the questions the
 * system's advancement dialogs ask, with the kit's rotation rule, so a Studio hero and a raw kit
 * hero (createHero) make the same choices. Spells are picked in Actor Studio's Spells tab.
 *
 * The module is a Svelte app; the selectors below were read from its source (v2.10.5) and checked
 * live on Foundry 14.368 with dnd5e 6.0.5.
 */
import { KitAssertion } from './errors.mjs';

export const STUDIO_MODULE = 'foundryvtt-actor-studio';
export const STUDIO_ROOT = '#foundryvtt-actor-studio-pc-sheet';

/** The scores every kit hero starts from (the standard array, Constitution 13), as createHero uses. */
export const KIT_ABILITIES = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };

/** @param {number} ms */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Poll until `fn` returns a truthy value; throws a KitAssertion on timeout.
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{what: string, timeoutMs?: number, intervalMs?: number}} o
 * @returns {Promise<T>}
 */
export async function until(fn, { what, timeoutMs = 30000, intervalMs = 250 }) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end)
      throw new KitAssertion(`Actor Studio: timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(intervalMs);
  }
}

/**
 * What the module reports about itself, from the GM page.
 * @param {import('playwright-core').Page} page
 * @returns {Promise<{installed: boolean, active: boolean, version: string, title: string}>}
 */
export async function studioInfo(page) {
  return page.evaluate(id => {
    const m = game.modules.get(id);
    return {
      installed: !!m,
      active: !!m?.active,
      version: m?.version ?? '',
      title: m?.title ?? '',
    };
  }, STUDIO_MODULE);
}

/**
 * The settings a table sets up once for Actor Studio, so it builds from the same content the kit
 * does: the module's own compendium sources (it reads the 2014 SRD packs by default), the average
 * for hit points, milestone levelling (no XP), its spell tab on, equipment off (the raw kit hero
 * has none either) and no usage tracking (the module posts anonymous usage data to its author's
 * server unless the user switches it off).
 * @param {{packs: Record<string, string[]>}} profile
 */
export function studioSettingsFor(profile) {
  const p = profile.packs;
  return {
    compendiumSources: {
      races: p.species,
      racialFeatures: p.species,
      classes: p.classes,
      subclasses: p.subclasses,
      backgrounds: p.backgrounds,
      spells: p.spells,
      feats: p.feats,
      items: ['dnd5e.items'],
    },
    forceTakeAverageHitPoints: true,
    milestoneLeveling: true,
    enableSpellSelection: true,
    enableEquipmentSelection: false,
    enableEquipmentPurchase: false,
    enableLevelUp: true,
    allowManualInput: true,
    allowStandardArray: false,
    allowPointBuy: false,
    allowRolling: false,
    'usage-tracking': false,
    dontShowWelcome: true,
  };
}

/**
 * The module's compendium sources narrowed to the packs one hero is built from. The module lists
 * every class, species and background of every pack it is given; a profile that holds both the
 * 2024 and the legacy packs would show two "Fighter"s, so each hero gets exactly its own packs.
 * @param {ReturnType<typeof studioSettingsFor>['compendiumSources']} sources
 * @param {{species: string, background: string, class: string, subclass?: string}} packs  pack id per role
 */
export function narrowSources(sources, packs) {
  const only = (all, pack) => (pack && all.includes(pack) ? [pack] : all);
  return {
    ...sources,
    races: only(sources.races, packs.species),
    racialFeatures: only(sources.racialFeatures, packs.species),
    classes: only(sources.classes, packs.class),
    subclasses: only(sources.subclasses, packs.subclass ?? packs.class),
    backgrounds: only(sources.backgrounds, packs.background),
  };
}

/**
 * Settings that are switched off for good and never put back: the module posts anonymous usage data
 * to its author's server while `usage-tracking` is on (it defaults to on, per user). `kit init` turns
 * it off for the kit GM; a restore must not turn it on again.
 */
export const NEVER_RESTORE = ['usage-tracking'];

/**
 * What a restore may write: the saved values without the settings that stay off.
 * @param {Record<string, unknown>} before
 */
export function restorable(before) {
  return Object.fromEntries(Object.entries(before).filter(([key]) => !NEVER_RESTORE.includes(key)));
}

/**
 * Read module settings, without changing anything. Read them first, register the restore, and only
 * then write, so a write that fails halfway can still be undone.
 * @param {import('playwright-core').Page} page
 * @param {string[]} keys
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readStudioSettings(page, keys) {
  return page.evaluate(
    ({ id, keys }) =>
      Object.fromEntries(
        keys.map(key => [key, foundry.utils.deepClone(game.settings.get(id, key))])
      ),
    { id: STUDIO_MODULE, keys }
  );
}

/**
 * Write module settings and return what they were, so the caller can put them back. Some of the
 * module's settings need a reload (Foundry asks with a dialog); the page is reloaded when any
 * value changed, so the module reads the new settings.
 * @param {import('playwright-core').Page} page
 * @param {Record<string, unknown>} settings
 * @returns {Promise<Record<string, unknown>>} the previous values
 */
export async function applyStudioSettings(page, settings) {
  const { before, changed } = await page.evaluate(
    async ({ id, settings }) => {
      const before = {};
      let changed = 0;
      for (const [key, value] of Object.entries(settings)) {
        before[key] = foundry.utils.deepClone(game.settings.get(id, key));
        if (JSON.stringify(before[key]) !== JSON.stringify(value)) {
          await game.settings.set(id, key, value);
          changed += 1;
        }
      }
      return { before, changed };
    },
    { id: STUDIO_MODULE, settings }
  );
  if (changed) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.game?.ready === true, undefined, {
      timeout: 120000,
      polling: 250,
    });
    await sleep(1500);
  }
  return before;
}

/** The window locator. @param {import('playwright-core').Page} page */
export const rootOf = page => page.locator(STUDIO_ROOT);

/**
 * Open the creation window with the sidebar button, as a person would: the Actors tab, then the
 * Actor Studio button in its header.
 * @param {import('playwright-core').Page} page
 */
export async function openCreationWindow(page) {
  await closeStudio(page);
  await page.evaluate(() => ui.sidebar.changeTab('actors', 'primary'));
  const button = page.locator('#gas-sidebar-button');
  await button.waitFor({ state: 'attached', timeout: 15000 });
  // The module listens for mousedown, not click.
  await button.dispatchEvent('mousedown');
  await rootOf(page).waitFor({ state: 'attached', timeout: 20000 });
  await rootOf(page).locator('.tabs-list button').first().waitFor({ timeout: 20000 });
}

/**
 * Close the window if it is open (a clean close: no "unfinished advancements" dialog) and any
 * stray dialog it left.
 * @param {import('playwright-core').Page} page
 */
export async function closeStudio(page) {
  await page.evaluate(async id => {
    const app = Object.values(ui.windows ?? {}).find(w => w?.id === id);
    if (app?.setClosingFromGasHook) {
      app.setClosingFromGasHook(true);
      await app.close();
    }
    document.getElementById(id)?.remove();
  }, STUDIO_ROOT.slice(1));
}

/**
 * Click a tab in the window by its label.
 * @param {import('playwright-core').Page} page
 * @param {string} label
 */
export async function clickTab(page, label) {
  const tab = rootOf(page).locator('.tabs-list button', {
    hasText: new RegExp(`^\\s*${label}\\s*$`),
  });
  await tab.first().click();
  await sleep(500);
}

/**
 * Type the six ability scores into the Abilities tab. The module debounces its input handler
 * (300 ms, one timer for all six fields), so each field gets its own pause, as a typist would.
 * @param {import('playwright-core').Page} page
 * @param {Record<string, number>} scores
 */
export async function typeAbilities(page, scores = KIT_ABILITIES) {
  await clickTab(page, 'Abilities');
  for (const [key, value] of Object.entries(scores)) {
    const input = rootOf(page).locator(`input[name="${key}"]`);
    await input.fill(String(value));
    await sleep(450);
  }
}

/**
 * Pick an entry from one of the window's drop-downs (species, background, class, subclass) by the
 * name it shows.
 * @param {import('playwright-core').Page} page
 * @param {string} selectId  race-select, background-select, characterClass-select or subClass-select
 * @param {string} name
 */
export async function pickFromSelect(page, selectId, name) {
  const select = rootOf(page).locator(`#${selectId}`);
  await select.locator('.selected-option').click();
  await sleep(400);
  const labels = select.locator('.option .option-label');
  await labels.first().waitFor({ timeout: 15000 });
  const shown = (await labels.allInnerTexts()).map(s => s.trim());
  const index = shown.findIndex(s => s === name);
  if (index < 0) {
    await page.keyboard.press('Escape');
    throw new KitAssertion(
      `Actor Studio: "${name}" is not in the ${selectId} list (it shows: ${shown.slice(0, 12).join(', ')})`
    );
  }
  await select.locator('.option').nth(index).click();
  await sleep(700);
}

/** How the module shows a name in its drop-downs (it strips "(Legacy)" and ", subtitle"). @param {string} name */
export function shownAs(name) {
  return String(name ?? '')
    .replace(/\s*[[(][\w\s]+[\])]/g, '')
    .replace(/\s*,\s*.*/g, '')
    .trim();
}

/** The compendium id inside a document uuid ("Compendium.dnd5e.classes24.Item.x" gives "dnd5e.classes24"). @param {string} uuid */
export function packOfUuid(uuid) {
  const m = /^Compendium\.([^.]+\.[^.]+)\./.exec(String(uuid ?? ''));
  return m ? m[1] : '';
}

/**
 * Names and packs of the documents a hero is built from, read in the page.
 * @param {import('playwright-core').Page} page
 * @param {Record<string, string>} uuids  role -> uuid
 * @returns {Promise<Record<string, {name: string, pack: string}>>}
 */
export async function nameDocuments(page, uuids) {
  const names = await page.evaluate(async list => {
    const out = {};
    for (const [role, uuid] of Object.entries(list)) {
      out[role] = (await fromUuid(uuid))?.name ?? '';
    }
    return out;
  }, uuids);
  /** @type {Record<string, {name: string, pack: string}>} */
  const out = {};
  for (const [role, uuid] of Object.entries(uuids)) {
    if (!names[role]) throw new KitAssertion(`Actor Studio: no document ${uuid} (${role})`);
    out[role] = { name: names[role], pack: packOfUuid(uuid) };
  }
  return out;
}

/**
 * A snapshot of the window: tabs, footer buttons, advancement dialogs and the Spells tab counters.
 * @param {import('playwright-core').Page} page
 */
export async function windowState(page) {
  return page.evaluate(root => {
    const r = document.querySelector(root);
    if (!r) return { open: false };
    const text = el => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return {
      open: true,
      tabs: [...r.querySelectorAll('.tabs-list button')].map(b => ({
        label: text(b),
        active: b.classList.contains('active'),
      })),
      footer: [...r.querySelectorAll('.footer-container .button-container button')].map(b => ({
        label: text(b),
        disabled: b.disabled,
        cls: b.className,
      })),
      dialogs: r.querySelectorAll('.gas-advancements').length,
      subclassSelect: !!r.querySelector('#subClass-select'),
      classRows: [...r.querySelectorAll('.class-row[role="button"]')].map(text),
      counters: [...r.querySelectorAll('.spells-tab .panel-header-grid .grid-item.value')].map(
        text
      ),
      addButtons: r.querySelectorAll('button.add-btn:not([disabled])').length,
    };
  }, STUDIO_ROOT);
}
