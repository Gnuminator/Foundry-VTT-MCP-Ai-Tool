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
      // The starting equipment choices read this list (any gaming set, a martial weapon).
      equipment: p.equipment ?? ['dnd5e.equipment24'],
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
 * The drop-down's options carry no uuid in the page (each is a div with a label and an index), so
 * the entry the plan names is found by what the page does expose: the label, the group heading
 * (source book and pack label) and the order. `choosePick` is the pure part, tested offline.
 *
 * Order of attempts: (1) a label equal to the full name ("Elf, High") inside the pack's group, when
 * the module shows lineages; (2) the shortened label ("Elf") by the entry's position among the
 * pack's same-type entries that shorten the same way, in pack order (the module sorts equal labels
 * stably, so pack order survives). When the counts do not line up the position cannot be trusted
 * and the pick fails loudly; the sheet judge (judgeSheet) checks the species item's origin too.
 * @param {{shown: Array<{label: string, group: string}>, name: string, uuid: string, group?: string,
 *   peers?: Array<{uuid: string, name: string}>}} o
 *   shown: the options in the order the page lists them; peers: same-type entries of the uuid's pack in pack order
 * @returns {{index: number, how: string} | {index: -1, why: string}}
 */
export function choosePick({ shown, name, uuid, group = '', peers = [] }) {
  const full = stripTags(name);
  const short = shownAs(name);
  const indexed = shown.map((s, index) => ({ ...s, index }));
  const inGroup = !!group && indexed.some(s => s.group === group);
  const pool = inGroup ? indexed.filter(s => s.group === group) : indexed;
  // Said in every answer, so the run log shows which heading matched (or that none did and the
  // whole list was searched, where a 2014 and a 2024 entry can share a label).
  const where = !group
    ? ''
    : inGroup
      ? ` in group "${group}"`
      : ` (no "${group}" group in the list, all ${indexed.length} entries searched)`;
  /** @param {typeof pool} hits @param {typeof peers} same @param {string} how */
  const byPosition = (hits, same, how) => {
    if (same.length <= 1) {
      // Without the pack's heading in the list (or with no pack at all, group '') the hits may come
      // from other books (a 2014 and a 2024 twin share a label), so several hits fail. A lone hit
      // is taken even though it may still be from another book; judgeSheet checks the item's origin.
      if (!inGroup && hits.length > 1) return null;
      return { index: hits[0].index, how: how + where };
    }
    if (hits.length !== same.length) return null;
    return { index: hits[same.findIndex(p => p.uuid === uuid)]?.index ?? -1, how: how + where };
  };
  if (full !== short) {
    const hits = pool.filter(s => s.label === full);
    if (hits.length) {
      const same = peers.filter(p => stripTags(p.name) === full);
      const got = byPosition(hits, same, `full label "${full}"`);
      if (got && got.index >= 0) return got;
      // The full name is on the list but cannot be placed: say so, instead of falling through to
      // the short label (which the list may not show at all).
      return {
        index: -1,
        why: `"${name}" cannot be told apart: the list has ${hits.length} "${full}" entries for ${same.length} in the pack${where}`,
      };
    }
  }
  const hits = pool.filter(s => s.label === short);
  const same = peers.filter(p => shownAs(p.name) === short);
  if (hits.length) {
    const got = byPosition(hits, same, `label "${short}" by position`);
    if (got && got.index >= 0) return got;
    return {
      index: -1,
      why: `"${name}" cannot be told apart: the list has ${hits.length} "${short}" entries for ${same.length} in the pack${where}`,
    };
  }
  return {
    index: -1,
    why: `"${name}" is not in the list (it shows: ${pool
      .slice(0, 12)
      .map(s => s.label)
      .join(', ')})`,
  };
}

/** A name without its "(Legacy)" and "[tag]" parts, as the module's first cleaning step leaves it. @param {string} name */
export function stripTags(name) {
  return String(name ?? '')
    .replace(/\s*[[(][\w\s]+[\])]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pick an entry from one of the window's drop-downs by its document uuid (see choosePick for how
 * the entry is found when the page shows no uuid).
 * @param {import('playwright-core').Page} page
 * @param {string} selectId
 * @param {string} uuid
 * @returns {Promise<string>}  how it was found
 */
export async function pickByUuid(page, selectId, uuid) {
  const target = await page.evaluate(async uuid => {
    const doc = await fromUuid(uuid);
    const packId = /^Compendium\.([^.]+\.[^.]+)\./.exec(uuid)?.[1];
    const pack = packId ? game.packs.get(packId) : null;
    const peers = pack
      ? [...pack.index.values()]
          .filter(e => e.type === doc?.type)
          .map(e => ({ uuid: e.uuid, name: e.name }))
      : [];
    const group = pack
      ? [pack.metadata?.flags?.dnd5e?.sourceBook, pack.metadata?.label]
          .map(v => (v == null ? '' : String(v).trim()))
          .filter(Boolean)
          .join(' ')
      : '';
    return { name: doc?.name ?? '', group, peers };
  }, uuid);
  if (!target.name) throw new KitAssertion(`Actor Studio: no document ${uuid}`);
  const select = rootOf(page).locator(`#${selectId}`);
  await select.locator('.selected-option').click();
  await sleep(400);
  await select.locator('.option .option-label').first().waitFor({ timeout: 15000 });
  const shown = await select.evaluate(el => {
    let group = '';
    /** @type {Array<{label: string, group: string}>} */
    const out = [];
    for (const n of el.querySelectorAll('.group-label, .option')) {
      if (n.classList.contains('group-label')) group = (n.textContent ?? '').trim();
      else out.push({ label: (n.querySelector('.option-label')?.textContent ?? '').trim(), group });
    }
    return out;
  });
  const pick = choosePick({ shown, uuid, ...target });
  if (pick.index < 0) {
    await page.keyboard.press('Escape');
    throw new KitAssertion(`Actor Studio, ${selectId}: ${'why' in pick ? pick.why : ''}`);
  }
  await select.locator('.option').nth(pick.index).click();
  await sleep(700);
  return 'how' in pick ? pick.how : '';
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
