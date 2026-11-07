/**
 * Session 0 (G0): a player's Actor Studio window closes before the advancements are done (the
 * browser reloads, the connection drops, or the player presses the X) and the character is left
 * unfinished. Fork 2.10.5-aitool.7 saves the picks on the actor and offers a way back: a dialog
 * when the player joins again, and an orange bar on the sheet. This scenario does that as the kit's
 * player user, twice:
 * - A: Create Character, then a page reload in the middle; the "Resume your character" dialog
 *   shows on the next login, Resume reopens Actor Studio, the player answers what is left.
 * - B: Create Character, then the X button (and its "lose the advancements" confirmation); the
 *   sheet shows "This character was not finished" with a Resume button; the page reloads itself
 *   (the system keeps a stale advancement window) and Actor Studio opens again.
 * After each resume the character is judged like a normal level-1 build (one species, one
 * background, one level of the class, full hit points, the player owns it), the saved picks are
 * gone and no second actor was made. Needs the real Foundry page; against the fake it skips.
 */
import { KIT_PLAYER_USER } from '../lib/contract.mjs';
import {
  PLAYER_ROLE,
  judgeSheet,
  playerStudioSettings,
  readSheet,
  spellListOf,
  turnOffTrackingFor,
} from '../lib/player-creation.mjs';
import { loadProfile } from '../lib/profiles.mjs';
import { chooseHeroes, pickOrigin } from '../lib/studio-compare.mjs';
import {
  KIT_ABILITIES,
  STUDIO_MODULE,
  STUDIO_ROOT,
  applyStudioSettings,
  narrowSources,
  readStudioSettings,
  restorable,
  studioInfo,
  studioSettingsFor,
  until,
} from '../lib/studio.mjs';
import { beginCreation, discardActor, finishWindow, stopPump } from '../lib/studio-flow.mjs';
import { studioPump } from '../lib/studio-pump.mjs';

const STUDIO_ERRORS = /actor-studio|gas\.[A-Za-z]+|\[GAS\]/i;
const FLAG = 'pendingCreation';

/** @param {number} ms */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** @param {Array<{rules?: string, name: string}>} entries */
const modern = entries =>
  entries.filter(e => e.rules === '2024').sort((a, b) => a.name.localeCompare(b.name, 'en'));

/** Wait for a reloaded Foundry page to be ready again. @param {import('playwright-core').Page} page */
async function afterReload(page) {
  await page.waitForFunction(() => globalThis.game?.ready === true, undefined, {
    timeout: 120000,
  });
  await sleep(2500);
}

/**
 * Press the button named `label` in the topmost visible dialog window.
 * @param {import('playwright-core').Page} page
 * @param {RegExp} title  the dialog's title
 * @param {RegExp} label  the button's text
 */
async function pressDialog(page, title, label) {
  return until(
    () =>
      page.evaluate(
        ({ title: ts, label: ls }) => {
          const title = new RegExp(ts, 'i');
          const label = new RegExp(ls, 'i');
          const dialogs = [...document.querySelectorAll('.application, .window-app')].filter(
            d => d.getClientRects().length > 0 && title.test(d.textContent ?? '')
          );
          for (const d of dialogs) {
            const b = [...d.querySelectorAll('button')].find(x => label.test(x.textContent.trim()));
            if (b) {
              b.click();
              return true;
            }
          }
          return false;
        },
        { title: title.source, label: label.source }
      ),
    { what: `the ${label} button of the ${title} dialog`, timeoutMs: 30000 }
  );
}

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'studio-resume',
  title:
    'A player whose Actor Studio window closed mid-build resumes the unfinished character (page reload, X button)',
  sizes: ['smoke', 'full', 'long'],
  tags: ['build', 'player', 'module'],
  needs: ['heroes'],
  tools: [],
  gmActions: ['listCompendium', 'adoptActor', 'deleteKitActor'],
  knownConsoleErrors: ['foundryvtt-actor-studio', 'gas\\.[A-Za-z]+', '\\[GAS\\]'],
  // Right after player-character-creation (85), before heroes-studio (90).
  order: 87,
  timeoutMs: 30 * 60 * 1000,

  async run(t) {
    const gmPage = t.page;
    if (!gmPage || !t.joinFoundry) {
      await t.step('needs the real Foundry page', async () =>
        t.skip('needs a real browser: the Foundry page and a second Edge (none against the fake)')
      );
      return;
    }
    const join = t.joinFoundry;
    const profile = loadProfile(t.kit.profile);

    const [classes, species, backgrounds] = await Promise.all([
      t.gm('listCompendium', { packIds: profile.packs.classes, type: 'class' }),
      t.gm('listCompendium', { packIds: profile.packs.species, type: 'race' }),
      t.gm('listCompendium', { packIds: profile.packs.backgrounds, type: 'background' }),
    ]);
    const firstPack = (/** @type {any[]} */ entries) => modern(entries)[0]?.packId ?? '';
    const packs = {
      class: firstPack(classes.entries),
      species: firstPack(species.entries),
      background: firstPack(backgrounds.entries),
    };
    const inPack = (/** @type {any[]} */ entries, /** @type {string} */ pack) =>
      modern(entries).filter(e => e.packId === pack);
    const fighter = inPack(classes.entries, packs.class).find(c => c.identifier === 'fighter');
    const speciesList = inPack(species.entries, packs.species);
    const backgroundList = inPack(backgrounds.entries, packs.background);
    const rawHeroes = chooseHeroes(t.kit, 1);
    const raw = rawHeroes.find(h => h.classIdentifier === 'fighter' && h.abilities);

    /** @type {{player: import('playwright-core').Page | null, errors: () => any[], userId: string}} */
    const ctx = { player: null, errors: () => [], userId: '' };

    await t.step('the table set-up: players may create actors, one Fighter to build', async () => {
      t.check(
        fighter && speciesList.length && backgroundList.length,
        'the profile has no 2024 fighter, species or backgrounds',
        packs
      );
      const info = await studioInfo(gmPage);
      t.check(info.installed && info.active, 'Actor Studio is not active in this world');
      t.check(
        /aitool\.(7|[89]|\d\d)/.test(info.version ?? ''),
        `Actor Studio ${info.version} has no resume (needs 2.10.5-aitool.7 or later)`
      );
      const before = await gmPage.evaluate(() =>
        foundry.utils.deepClone(game.settings.get('core', 'permissions'))
      );
      if (!(before.ACTOR_CREATE ?? []).includes(PLAYER_ROLE)) {
        t.cleanup(async () => {
          await gmPage.evaluate(async p => game.settings.set('core', 'permissions', p), before);
        });
        await gmPage.evaluate(async role => {
          const p = foundry.utils.deepClone(game.settings.get('core', 'permissions'));
          p.ACTOR_CREATE = [...new Set([...(p.ACTOR_CREATE ?? []), role])];
          await game.settings.set('core', 'permissions', p);
        }, PLAYER_ROLE);
      }
      await turnOffTrackingFor(gmPage, STUDIO_MODULE, KIT_PLAYER_USER);
      const settings = playerStudioSettings(studioSettingsFor(profile), packs, narrowSources);
      const saved = await readStudioSettings(gmPage, Object.keys(settings));
      t.cleanup(async () => {
        await applyStudioSettings(gmPage, restorable(saved));
      });
      await applyStudioSettings(gmPage, settings);
      return `${info.title} ${info.version}`;
    });

    await t.step(`${KIT_PLAYER_USER} joins the world in a browser of its own`, async () => {
      const j = await join(KIT_PLAYER_USER);
      ctx.player = j.page;
      ctx.errors = j.consoleErrors;
      ctx.userId = await j.page.evaluate(() => game.user.id);
    });

    const actorsBefore = await gmPage.evaluate(() => game.actors.map(a => a.id));
    t.cleanup(async () => {
      const left = await gmPage.evaluate(
        ({ before, userId }) =>
          game.actors
            .filter(a => !before.includes(a.id) && a.ownership[userId] === 3)
            .map(a => a.id),
        { before: actorsBefore, userId: ctx.userId }
      );
      for (const id of left) await discardActor(gmPage, id);
    });

    const sp = pickOrigin(speciesList, 'Human');
    const bg = pickOrigin(backgroundList, 'Soldier');

    /** The player's browser, as a typed shortcut. */
    const player = () => /** @type {import('playwright-core').Page} */ (ctx.player);

    /**
     * Build up to the interruption: Create Character without the answer pump, wait until the actor
     * exists with its saved picks and the first advancement window has opened. Returns the actor id.
     * @param {string} name
     * @param {number} rotation
     */
    async function startAndInterrupt(name, rotation) {
      await beginCreation(player(), {
        name,
        classUuid: fighter.uuid,
        speciesUuid: sp,
        backgroundUuid: bg,
        rotation,
        featPackIds: profile.packs.feats,
        abilities: raw?.abilities ?? KIT_ABILITIES,
        log: m => t.log(m),
      });
      const actorId = await until(
        async () =>
          (await player().evaluate(
            ({ name, flag, studio }) => {
              const a = game.actors.find(x => x.name === name);
              return a?.getFlag(studio, flag) ? a.id : null;
            },
            { name, flag: FLAG, studio: STUDIO_MODULE }
          )) || null,
        { what: `an actor "${name}" with saved picks`, timeoutMs: 40000 }
      );
      await until(
        () =>
          player().evaluate(
            root => !!document.querySelector(`${root} .gas-advancements`),
            STUDIO_ROOT
          ),
        { what: 'the first advancement window', timeoutMs: 40000 }
      );
      await sleep(1000);
      return actorId;
    }

    /** What the GM page sees of the actor right after the interruption. @param {string} actorId */
    const interrupted = actorId =>
      gmPage.evaluate(
        ({ id, flag, studio }) => {
          const a = game.actors.get(id);
          return {
            picks: Object.keys(a.getFlag(studio, flag)?.picks ?? {}),
            items: a.items.map(i => i.type),
          };
        },
        { id: actorId, flag: FLAG, studio: STUDIO_MODULE }
      );

    /**
     * After the resume: answer what is left, then judge the sheet and the leftovers.
     * @param {string} actorId
     * @param {string} name
     * @param {number} rotation
     */
    async function finishAndJudge(actorId, name, rotation) {
      const page = player();
      await until(
        () =>
          page
            .locator(STUDIO_ROOT)
            .count()
            .then(n => n > 0),
        {
          what: 'Actor Studio to open again',
          timeoutMs: 60000,
        }
      );
      await page.evaluate(studioPump, {
        op: 'start',
        rotation,
        subclassUuid: '',
        featPackIds: profile.packs.feats,
        prefer: {},
      });
      let pump = null;
      let gear = null;
      try {
        const done = await finishWindow(page, { rotation, equipment: true, log: m => t.log(m) });
        gear = done.equipment;
      } finally {
        pump = await stopPump(page).catch(() => null);
      }
      await sleep(1500);
      t.cleanup(async () => {
        try {
          await t.gm('deleteKitActor', { actorId });
        } catch {
          await discardActor(gmPage, actorId);
        }
      });
      await t.gm('adoptActor', { actorId, name, folderId: t.kit.folders?.Actor });
      const sheet = await readSheet(gmPage, actorId);
      const spellList = sheet.spells.length ? await spellListOf(gmPage, 'fighter') : null;
      const verdict = judgeSheet({
        sheet,
        playerId: ctx.userId,
        classIdentifier: 'fighter',
        planned: gear?.inventory ?? [],
        spellList,
        pumpErrors: pump?.errors ?? [],
        speciesUuid: sp,
        classUuid: fighter.uuid,
        backgroundUuid: bg,
        baseAbilities: raw?.abilities ?? KIT_ABILITIES,
      });
      const left = await gmPage.evaluate(
        ({ id, flag, studio }) => ({
          flag: game.actors.get(id)?.getFlag(studio, flag) ?? null,
          copies: game.actors.filter(a => a.name === game.actors.get(id)?.name).length,
        }),
        { id: actorId, flag: FLAG, studio: STUDIO_MODULE }
      );
      t.log(`${name} is actor ${actorId}`);
      for (const n of verdict.notes) t.log(n);
      t.check(
        verdict.problems.length === 0,
        `${verdict.problems.length} problem(s): ${verdict.problems
          .slice(0, 4)
          .map(p => `${p.what}: ${p.evidence}`)
          .join(' | ')}`,
        { problems: verdict.problems }
      );
      t.check(left.flag === null, 'the saved picks are still on the actor after the resume');
      t.check(
        left.copies === 1,
        `${left.copies} actors named "${name}" (a resume must not make a second)`
      );
      return `${sheet.hp.max} HP, ${sheet.items.length} items, saved picks gone`;
    }

    // --- A: a reload in the middle, the dialog on the next login ------------------------------------
    await t.step(
      `A: the page reloads mid-build, the login dialog offers Resume, the Fighter is finished`,
      async () => {
        const name = 'Resume Reload Fighter';
        const actorId = await startAndInterrupt(name, 0);
        const state = await interrupted(actorId);
        t.check(state.picks.length >= 3, `only ${state.picks.join(', ')} were saved`, state);
        t.check(
          !state.items.includes('class'),
          'the class was on the actor before the interruption'
        );
        await player().reload({ waitUntil: 'domcontentloaded' });
        await afterReload(player());
        await pressDialog(player(), /Resume your character/i, /^Resume$/i);
        return finishAndJudge(actorId, name, 0);
      },
      { continueOnFail: true }
    );

    // --- B: the X button, the bar on the sheet ------------------------------------------------------
    await t.step(
      `B: the X button closes the window mid-build, the sheet bar offers Resume, the Fighter is finished`,
      async () => {
        const name = 'Resume Close Fighter';
        const actorId = await startAndInterrupt(name, 1);
        const pressed = await player().evaluate(root => {
          const b = document.querySelector(`${root} .header-button.close`);
          b?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return !!b;
        }, STUDIO_ROOT);
        t.check(pressed, 'the window has no X button');
        // The legacy confirm dialog: "Are you sure you want to close? ... will be lost".
        await pressDialog(player(), /want to close/i, /^\s*yes\s*$/i);
        await until(() => player().evaluate(root => !document.querySelector(root), STUDIO_ROOT), {
          what: 'Actor Studio to close',
          timeoutMs: 20000,
        });
        const state = await interrupted(actorId);
        t.check(state.picks.length >= 3, `only ${state.picks.join(', ')} were saved`, state);
        // Closing the window opens the character's sheet by itself; the bar must show on it.
        await until(
          () =>
            player()
              .locator('.gas-resume-banner button')
              .count()
              .then(n => n > 0),
          { what: 'the "not finished" bar on the sheet', timeoutMs: 20000 }
        );
        // The bar's button reloads the page (a stale advancement window) and Studio opens after it.
        await Promise.all([
          player()
            .waitForEvent('load', { timeout: 30000 })
            .catch(() => null),
          player().locator('.gas-resume-banner button').first().click(),
        ]);
        await afterReload(player());
        return finishAndJudge(actorId, name, 1);
      },
      { continueOnFail: true }
    );

    await t.step(
      'the player page logged no console errors',
      async () => {
        const errors = ctx.errors();
        const studio = errors.filter(e => STUDIO_ERRORS.test(`${e.message} ${e.source}`));
        const other = errors.filter(e => !STUDIO_ERRORS.test(`${e.message} ${e.source}`));
        t.attach('player console', { studio, other });
        for (const id of new Set(
          errors.map(e => /Actor \[(\w+)\]/.exec(String(e.message))?.[1]).filter(Boolean)
        )) {
          const who = await gmPage.evaluate(
            ({ id, studio }) => {
              const a = game.actors.get(id);
              return a
                ? {
                    name: a.name,
                    ownership: a.ownership,
                    flags: a.flags[studio] ?? null,
                    items: a.items.size,
                  }
                : null;
            },
            { id, studio: STUDIO_MODULE }
          );
          t.log(`console error actor ${id}: ${JSON.stringify(who)}`);
        }
        t.check(
          other.length === 0 && studio.length === 0,
          `${other.length} console error(s) and ${studio.length} from Actor Studio on the player page: ${[
            ...other,
            ...studio,
          ]
            .slice(0, 3)
            .map(e => String(e.message).slice(0, 160))
            .join(' | ')}`
        );
      },
      { continueOnFail: true }
    );
  },
};
