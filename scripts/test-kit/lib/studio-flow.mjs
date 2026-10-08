/**
 * The flows of Actor Studio, built on the low-level driver in studio.mjs: the Spells tab, the end
 * of a window, creating a hero and levelling one up. See studio.mjs for how the module is driven.
 */
import { KitAssertion } from './errors.mjs';
import { studioPump } from './studio-pump.mjs';
import {
  KIT_ABILITIES,
  STUDIO_ROOT,
  applyStudioSettings,
  clickTab,
  closeStudio,
  nameDocuments,
  narrowSources,
  openCreationWindow,
  packOfUuid,
  pickFromSelect,
  rootOf,
  shownAs,
  typeAbilities,
  until,
  windowState,
} from './studio.mjs';

/** @param {number} ms */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Press a footer button (the module listens for mousedown) by class name or by its text.
 * @param {import('playwright-core').Page} page
 * @param {string} what
 */
export async function pressFooter(page, what) {
  return page.evaluate(
    ({ root, what }) => {
      const r = document.querySelector(root);
      const buttons = [...(r?.querySelectorAll('.footer-container button') ?? [])];
      const target =
        buttons.find(b => !b.disabled && b.classList.contains(what)) ??
        buttons.find(b => !b.disabled && b.textContent.toLowerCase().includes(what));
      if (!target) return false;
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      return true;
    },
    { root: STUDIO_ROOT, what }
  );
}

/**
 * Pick spells in the Spells tab until its counters are full, then press Finalize. The pick
 * follows the kit's rotation rule over the spells the tab offers, in the order it lists them.
 * @param {import('playwright-core').Page} page
 * @param {{rotation: number, log?: (m: string) => void}} o
 * @returns {Promise<{cantrips: number, spells: number, names: string[]}>}
 */
export async function completeSpellsTab(page, { rotation, log = () => {} }) {
  // The counters show when the level gives spells. At a level that gives none (a third caster's
  // fifth level) the tab shows no counters, only its Finalize or Skip button.
  const gotCounters = await until(
    async () => {
      const st = await windowState(page);
      if ((st.counters ?? []).length >= 2) return 'counters';
      return (st.footer ?? []).some(b => !b.disabled && /finali[sz]e|skip|continue/i.test(b.label))
        ? 'button'
        : null;
    },
    { what: 'the spell counters or a button to leave the Spells tab', timeoutMs: 40000 }
  );
  if (gotCounters === 'button') {
    await sleep(1500);
    if (((await windowState(page)).counters ?? []).length < 2) {
      await until(
        async () =>
          (await pressFooter(page, 'finalize')) ||
          (await pressFooter(page, 'skip')) ||
          (await pressFooter(page, 'continue')),
        { what: 'a button to leave the Spells tab', timeoutMs: 20000 }
      );
      log('spells tab: nothing to pick at this level');
      return { cantrips: 0, spells: 0, names: [] };
    }
  }
  const names = [];
  const counts = { cantrips: 0, spells: 0 };
  let guard = 0;
  let k = 0;
  const parse = s => {
    const m = /(\d+)\s*\/\s*(\d+)/.exec(s ?? '');
    return m ? { cur: Number(m[1]), max: Number(m[2]) } : { cur: 0, max: 0 };
  };
  while (guard++ < 80) {
    const st = await windowState(page);
    const cantrips = parse(st.counters?.[0]);
    const spells = parse(st.counters?.[1]);
    const needCantrip = cantrips.cur < cantrips.max;
    const needSpell = spells.cur < spells.max;
    if (!needCantrip && !needSpell) break;
    const picked = await page.evaluate(
      ({ root, wantCantrip, index }) => {
        const r = document.querySelector(root);
        // Open every collapsed spell level group first.
        for (const h of r.querySelectorAll('.spell-level-group .spell-level-header')) {
          if (h.textContent.includes('[+]'))
            h.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
        const groups = [...r.querySelectorAll('.spell-level-group')].filter(g => {
          const head = (g.querySelector('.spell-level-header')?.textContent ?? '').toLowerCase();
          return wantCantrip ? head.includes('cantrip') : !head.includes('cantrip');
        });
        const buttons = groups.flatMap(g => [
          ...g.querySelectorAll('button.add-btn:not([disabled])'),
        ]);
        if (!buttons.length) return null;
        const button = buttons[index % buttons.length];
        const row = button.closest('.spell-row');
        const name = (row?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
        button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return name;
      },
      { root: STUDIO_ROOT, wantCantrip: needCantrip, index: rotation + k }
    );
    if (picked === null) {
      await sleep(600);
      continue;
    }
    k += 1;
    names.push(picked);
    if (needCantrip) counts.cantrips += 1;
    else counts.spells += 1;
    await sleep(500);
  }
  log(`spells tab: ${counts.cantrips} cantrips, ${counts.spells} spells picked`);
  await until(() => pressFooter(page, 'finalize'), {
    what: 'the Finalize Spells button',
    timeoutMs: 20000,
  });
  return { ...counts, names };
}

/**
 * One step in the Equipment tab (the 2024 rules' starting equipment, shown when the module's
 * equipment selection is on), run inside the page. In order: take "Equipment + gold" over the gold
 * only option for the background and the class (`wealth`), pick an option in an open item picker,
 * open a picker that has nothing picked yet, pick in a "Choose one..." group, and last press the
 * footer's Confirm. The module listens for mousedown on the gold options and the footer button,
 * click on the rest. Picks follow the kit's rotation rule (`index`).
 * @param {{root: string, wealth: 'equipment'|'gold', index: number}} a
 * @returns {{did: 'gold'|'pick'|'open'|'choose'|'confirm'|'', what: string}}
 */
function equipmentStep({ root, wealth, index }) {
  const r = document.querySelector(root);
  if (!r) return { did: '', what: 'the window is closed' };
  const visible = el => el.offsetParent !== null;
  const press = (el, type) =>
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  const text = el => (el?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  for (const group of r.querySelectorAll('.gold-section .equipment-group')) {
    const options = [...group.querySelectorAll('button.option')].filter(visible);
    if (!options.length || options.some(o => o.classList.contains('selected'))) continue;
    const want = options.find(o => /equipment/i.test(text(o)) === (wealth === 'equipment'));
    const target = want ?? options[0];
    if (target.disabled) continue;
    press(target, 'mousedown');
    return { did: 'gold', what: `${text(group.querySelector('.group-label'))}: ${text(target)}` };
  }
  const dropdown = [...r.querySelectorAll('.options-dropdown')].find(visible);
  if (dropdown) {
    const options = [...dropdown.querySelectorAll('.option')].filter(visible);
    if (options.length) {
      const target = options[index % options.length];
      press(target, 'click');
      return { did: 'pick', what: text(target) };
    }
  }
  for (const item of r.querySelectorAll('.equipment-config-item')) {
    const select = item.querySelector('.equipment-select .selected-option');
    if (select && visible(select) && select.querySelector('.placeholder')) {
      press(select, 'click');
      return { did: 'open', what: text(item.querySelector('.name')) };
    }
  }
  for (const group of r.querySelectorAll('.equipment-flow .equipment-group')) {
    if (!/choose one/i.test(text(group.querySelector('.group-label')))) continue;
    const options = [...group.querySelectorAll('.equipment-item.option')].filter(
      o => visible(o) && !o.classList.contains('disabled')
    );
    if (!options.length) continue;
    const target = options[index % options.length];
    press(target, 'click');
    return { did: 'choose', what: text(target) };
  }
  // An "All of the following" group with an open item: a click opens the picker of "any gaming
  // set", and takes a plain gold line ("5 GP"), which some groups need before they count as done.
  // Gold lines come last: a group often marks its gold itself once the rest is picked.
  const unpicked = [...r.querySelectorAll('.equipment-flow .equipment-group')]
    .filter(g => /all of the following/i.test(text(g.querySelector('.group-label'))))
    .flatMap(g => [...g.querySelectorAll('.equipment-item.option')])
    .filter(
      o =>
        visible(o) &&
        !o.classList.contains('selected') &&
        !o.classList.contains('disabled') &&
        !o.hasAttribute('data-kit-clicked')
    );
  const gold = o => /^\d+\s*gp$/i.test(text(o));
  const open = unpicked.find(o => !gold(o));
  if (open) {
    open.setAttribute('data-kit-clicked', '1');
    press(open, 'click');
    return { did: 'choose', what: text(open) };
  }
  const confirm = [...r.querySelectorAll('.footer-container button')].find(
    b => visible(b) && !b.disabled && /confirm/i.test(text(b))
  );
  if (confirm) {
    press(confirm, 'mousedown');
    return { did: 'confirm', what: text(confirm) };
  }
  const coins = unpicked.find(gold);
  if (coins) {
    coins.setAttribute('data-kit-clicked', '1');
    press(coins, 'click');
    return { did: 'choose', what: text(coins) };
  }
  return { did: '', what: '' };
}

/**
 * Answer the Equipment tab: the gold choices, every equipment choice and item picker, then Confirm.
 * Returns what was picked and the planned inventory the tab showed before Confirm.
 * @param {import('playwright-core').Page} page
 * @param {{rotation: number, wealth?: 'equipment'|'gold', timeoutMs?: number, log?: (m: string) => void}} o
 * @returns {Promise<{picks: string[], inventory: string[]}>}
 */
export async function completeEquipmentTab(
  page,
  { rotation, wealth = 'equipment', timeoutMs = 90000, log = () => {} }
) {
  const end = Date.now() + timeoutMs;
  const picks = [];
  let inventory = [];
  let k = 0;
  let idle = 0;
  while (Date.now() < end) {
    inventory = await page.evaluate(
      root =>
        // The rows are icon, name, weight, quantity; the empty table has one "No items selected" cell.
        [...(document.querySelector(root)?.querySelectorAll('.inventory-table tbody tr') ?? [])]
          .map(row =>
            (row.querySelectorAll('td')[1]?.textContent ?? '').replace(/\s+/g, ' ').trim()
          )
          .filter(Boolean),
      STUDIO_ROOT
    );
    const step = await page.evaluate(equipmentStep, {
      root: STUDIO_ROOT,
      wealth,
      index: rotation + k,
    });
    if (step.did === 'confirm') {
      log(`equipment: ${picks.length} choices, ${inventory.length} items planned; confirmed`);
      return { picks, inventory };
    }
    if (step.did) {
      if (step.did !== 'open') picks.push(`${step.did}: ${step.what}`);
      if (step.did === 'pick' || step.did === 'choose') k += 1;
      idle = 0;
    } else if (++idle > 20) {
      break;
    }
    await sleep(step.did ? 700 : 500);
  }
  const st = await windowState(page);
  throw new KitAssertion(
    `Actor Studio: the Equipment tab did not reach Confirm (picks: ${picks.join('; ') || 'none'}; ` +
      `footer: ${(st.footer ?? []).map(b => b.label).join(', ')})`
  );
}

/** Whether the Equipment tab is the active tab and still open for input. @param {import('playwright-core').Page} page */
async function equipmentShowing(page) {
  return page.evaluate(root => {
    const r = document.querySelector(root);
    const active = r?.querySelector('.tabs-list button.active');
    return (
      !!active &&
      /equipment/i.test(active.textContent) &&
      !r.querySelector('.equipment-flow.readonly')
    );
  }, STUDIO_ROOT);
}

/** Whether the Spells tab is showing. @param {import('playwright-core').Page} page */
async function spellsShowing(page) {
  const st = await windowState(page);
  if (!st.open) return false;
  return (
    st.tabs.some(t => /spell/i.test(t.label) && t.active) ||
    st.footer.some(b => /finali[sz]e/i.test(b.label))
  );
}

/**
 * Wait for the window to finish what it is doing: it closes, answering the Spells tab when that
 * shows. Throws when it stands still too long.
 * @param {import('playwright-core').Page} page
 * With `equipment`, the Equipment tab is answered when it shows (the module's equipment selection on).
 * @param {{rotation: number, equipment?: boolean, timeoutMs?: number, log?: (m: string) => void}} o
 */
export async function finishWindow(
  page,
  { rotation, equipment = false, timeoutMs = 240000, log = () => {} }
) {
  const end = Date.now() + timeoutMs;
  let spells = null;
  /** @type {{picks: string[], inventory: string[]} | null} */
  let gear = null;
  for (;;) {
    const st = await windowState(page);
    if (!st.open) return { closed: true, spells, equipment: gear };
    if (equipment && !gear && (await equipmentShowing(page))) {
      gear = await completeEquipmentTab(page, { rotation, log });
    }
    if (!spells && (await spellsShowing(page))) {
      spells = await completeSpellsTab(page, { rotation, log });
    }
    if (Date.now() > end) {
      const labels = (st.tabs ?? []).map(t => t.label + (t.active ? '*' : '')).join(', ');
      const foot = (st.footer ?? []).map(b => b.label).join(', ');
      throw new KitAssertion(
        `Actor Studio: the window did not finish in ${timeoutMs} ms (tabs: ${labels}; footer: ${foot})`
      );
    }
    await sleep(700);
  }
}

/** @param {import('playwright-core').Page} page */
export const pumpStatus = page => page.evaluate(studioPump, { op: 'status' });

/**
 * Create one hero in the creation window and run it to the end of level 1.
 * @param {import('playwright-core').Page} page
 * @param {{name: string, classUuid: string, speciesUuid: string, backgroundUuid: string, rotation: number,
 *   featPackIds?: string[], subclassUuid?: string, abilities?: Record<string, number>,
 *   prefer?: Record<string, string[]>, equipment?: boolean, log?: (m: string) => void}} o
 * @returns {Promise<{actorId: string, pump: any, spells: any, equipment: {picks: string[], inventory: string[]} | null}>}
 */
export async function createInStudio(page, o) {
  const log = o.log ?? (() => {});
  const docs = await nameDocuments(page, {
    species: o.speciesUuid,
    background: o.backgroundUuid,
    class: o.classUuid,
  });
  const before = await page.evaluate(() => game.actors.map(a => a.id));
  await openCreationWindow(page);
  await typeAbilities(page, o.abilities ?? KIT_ABILITIES);
  await clickTab(page, '(Species|Race)');
  await pickFromSelect(page, 'race-select', shownAs(docs.species.name));
  await clickTab(page, 'Background');
  await pickFromSelect(page, 'background-select', shownAs(docs.background.name));
  await clickTab(page, 'Class');
  await pickFromSelect(page, 'characterClass-select', shownAs(docs.class.name));
  // A class that gets its subclass at level 1 shows the subclass drop-down in this tab.
  await sleep(1500);
  if (o.subclassUuid && (await windowState(page)).subclassSelect) {
    const sub = await nameDocuments(page, { subclass: o.subclassUuid });
    await pickFromSelect(page, 'subClass-select', shownAs(sub.subclass.name));
  }
  await rootOf(page).locator('.character-name-input').fill(o.name);
  await sleep(500);
  await page.evaluate(studioPump, {
    op: 'start',
    rotation: o.rotation,
    subclassUuid: o.subclassUuid ?? '',
    featPackIds: o.featPackIds ?? [],
    prefer: o.prefer ?? {},
  });
  log(`creating ${o.name} in Actor Studio`);
  await until(() => pressFooter(page, 'gas-create-character-btn'), {
    what: 'the Create Character button',
    timeoutMs: 20000,
  });
  const done = await finishWindow(page, { rotation: o.rotation, equipment: o.equipment, log });
  await sleep(1500);
  const actorId = await page.evaluate(
    ({ before, name }) => {
      const made = game.actors.filter(a => !before.includes(a.id) && a.name === name);
      return made.length ? made[made.length - 1].id : '';
    },
    { before, name: o.name }
  );
  if (!actorId) throw new KitAssertion(`Actor Studio: no actor named "${o.name}" after creation`);
  return { actorId, pump: await pumpStatus(page), spells: done.spells, equipment: done.equipment };
}

/** Stop the answer pump and return what it picked. @param {import('playwright-core').Page} page */
export const stopPump = page => page.evaluate(studioPump, { op: 'stop' });

/**
 * Raise a hero one level in the level-up window: open it from the character sheet's button, pick
 * the class row, the subclass when this level asks for one, then "Add Level".
 * @param {import('playwright-core').Page} page
 * @param {{actorId: string, subclassUuid?: string, rotation: number,
 *   log?: (m: string) => void}} o
 * @returns {Promise<{level: number, spells: any}>}
 */
export async function levelUpInStudio(page, o) {
  const log = o.log ?? (() => {});
  await closeStudio(page);
  const level = await page.evaluate(async actorId => {
    const actor = game.actors.get(actorId);
    await actor.sheet.render(true);
    return actor.system.details.level;
  }, o.actorId);
  const button = page.locator('button.level-up').first();
  await button.waitFor({ state: 'visible', timeout: 20000 });
  await button.click();
  await rootOf(page).waitFor({ state: 'attached', timeout: 20000 });
  const row = rootOf(page).locator('.class-row[role="button"]').first();
  await row.waitFor({ timeout: 20000 });
  await sleep(500);
  await row.click();
  // The window shows either the subclass drop-down (this level asks for one) or the Add Level button.
  const st = await until(
    async () => {
      const now = await windowState(page);
      const add = (now.footer ?? []).some(b => b.cls.includes('gas-add-level-btn') && !b.disabled);
      return now.subclassSelect || add ? now : null;
    },
    { what: 'the subclass drop-down or the Add Level button', timeoutMs: 20000 }
  );
  if (st.subclassSelect && o.subclassUuid) {
    const doc = await nameDocuments(page, { subclass: o.subclassUuid });
    await pickFromSelect(page, 'subClass-select', shownAs(doc.subclass.name));
  } else if (st.subclassSelect) {
    throw new KitAssertion('Actor Studio asks for a subclass at this level and none was given');
  }
  await until(() => pressFooter(page, 'gas-add-level-btn'), {
    what: 'the Add Level button',
    timeoutMs: 20000,
  });
  const done = await finishWindow(page, { rotation: o.rotation, log });
  await sleep(1200);
  await page.evaluate(async actorId => {
    await game.actors.get(actorId)?.sheet?.close();
  }, o.actorId);
  const now = await page.evaluate(id => game.actors.get(id).system.details.level, o.actorId);
  if (now !== level + 1)
    throw new KitAssertion(
      `Actor Studio: the hero went from level ${level} to ${now}, not ${level + 1}`
    );
  return { level: now, spells: done.spells };
}

/**
 * Build one hero the whole way in Actor Studio: narrow the module's packs to the hero's own, create
 * the hero at level 1, raise it one level at a time to the target, stop the pump.
 * @param {import('playwright-core').Page} page
 * @param {{name: string, level: number, classUuid: string, subclassUuid?: string, speciesUuid: string,
 *   backgroundUuid: string, rotation: number, featPackIds: string[], settings: any,
 *   abilities?: Record<string, number>, prefer?: Record<string, string[]>, log?: (m: string) => void}} o
 * @returns {Promise<{actorId: string, picks: any[], warnings: string[], errors: string[], spells: Array<{level: number, cantrips: number, spells: number, names: string[]}>, seconds: number}>}
 */
export async function buildHeroInStudio(page, o) {
  const log = o.log ?? (() => {});
  const started = Date.now();
  const packs = {
    species: packOfUuid(o.speciesUuid),
    background: packOfUuid(o.backgroundUuid),
    class: packOfUuid(o.classUuid),
    subclass: packOfUuid(o.subclassUuid ?? ''),
  };
  await applyStudioSettings(page, {
    ...o.settings,
    compendiumSources: narrowSources(o.settings.compendiumSources, packs),
  });
  const spells = [];
  const before = await page.evaluate(() => game.actors.map(a => a.id));
  try {
    const made = await createInStudio(page, {
      name: o.name,
      classUuid: o.classUuid,
      speciesUuid: o.speciesUuid,
      backgroundUuid: o.backgroundUuid,
      subclassUuid: o.subclassUuid,
      rotation: o.rotation,
      featPackIds: o.featPackIds,
      abilities: o.abilities,
      prefer: o.prefer,
      log,
    });
    if (made.spells) spells.push({ level: 1, ...made.spells });
    for (let level = 2; level <= o.level; level += 1) {
      const up = await levelUpInStudio(page, {
        actorId: made.actorId,
        subclassUuid: o.subclassUuid,
        rotation: o.rotation,
        log,
      });
      if (up.spells) spells.push({ level: up.level, ...up.spells });
    }
    const pump = await stopPump(page);
    return {
      actorId: made.actorId,
      picks: pump?.picks ?? [],
      warnings: pump?.warnings ?? [],
      errors: pump?.errors ?? [],
      spells,
      seconds: Math.round((Date.now() - started) / 1000),
    };
  } catch (err) {
    await recoverPage(page, before, o.name);
    throw err;
  }
}

/**
 * After a failed build: stop the pump, close the window, delete the half-made actor and reload the
 * page, so the next hero starts from a clean page (a stuck dialog would block every later click).
 * @param {import('playwright-core').Page} page
 * @param {string[]} before  actor ids from before the build
 * @param {string} name
 */
async function recoverPage(page, before, name) {
  await stopPump(page).catch(() => {});
  await closeStudio(page).catch(() => {});
  await page
    .evaluate(
      async ({ before, name }) => {
        const strays = game.actors.filter(a => !before.includes(a.id) && a.name === name);
        for (const actor of strays) await actor.delete();
      },
      { before, name }
    )
    .catch(() => {});
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page
    .waitForFunction(() => globalThis.game?.ready === true, undefined, { timeout: 120000 })
    .catch(() => {});
  await sleep(1500);
}

/**
 * Delete an actor that Actor Studio made, flagged or not (a hero that failed before it was adopted
 * has no kit flag). Never throws.
 * @param {import('playwright-core').Page} page
 * @param {string} actorId
 */
export async function discardActor(page, actorId) {
  await page
    .evaluate(async id => {
      await game.actors.get(id)?.delete();
    }, actorId)
    .catch(() => {});
}
