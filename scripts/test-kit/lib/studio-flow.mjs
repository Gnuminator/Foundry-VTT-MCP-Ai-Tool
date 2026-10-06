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
 * @param {{rotation: number, timeoutMs?: number, log?: (m: string) => void}} o
 */
export async function finishWindow(page, { rotation, timeoutMs = 240000, log = () => {} }) {
  const end = Date.now() + timeoutMs;
  let spells = null;
  for (;;) {
    const st = await windowState(page);
    if (!st.open) return { closed: true, spells };
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
 *   featPackIds?: string[], subclassUuid?: string, abilities?: Record<string, number>, log?: (m: string) => void}} o
 * @returns {Promise<{actorId: string, pump: any, spells: any}>}
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
  });
  log(`creating ${o.name} in Actor Studio`);
  await until(() => pressFooter(page, 'gas-create-character-btn'), {
    what: 'the Create Character button',
    timeoutMs: 20000,
  });
  const done = await finishWindow(page, { rotation: o.rotation, log });
  await sleep(1500);
  const actorId = await page.evaluate(
    ({ before, name }) => {
      const made = game.actors.filter(a => !before.includes(a.id) && a.name === name);
      return made.length ? made[made.length - 1].id : '';
    },
    { before, name: o.name }
  );
  if (!actorId) throw new KitAssertion(`Actor Studio: no actor named "${o.name}" after creation`);
  return { actorId, pump: await pumpStatus(page), spells: done.spells };
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
 *   log?: (m: string) => void}} o
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
