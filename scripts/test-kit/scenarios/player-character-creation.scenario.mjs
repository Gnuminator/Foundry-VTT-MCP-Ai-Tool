/**
 * Session 0 (G0): the players make their own characters in Foundry. This scenario does that as the
 * kit's player user, the way a player will: it joins the world as "Kit Player" in its own browser,
 * opens Actor Studio from the Actors tab and builds a level-1 character of the 2024 rules (abilities,
 * species, background, class, the advancement questions, the starting equipment and the spells),
 * then checks the sheet on the GM side: the player owns it, one level of the class, species and
 * background, level-1 hit points, the planned starting equipment on the sheet, every spell the
 * class gave on its spell list (species and feat spells may be off it), and no console errors on
 * the player's page.
 *
 * What the table must set up for this (the scenario sets it for the run and puts it back):
 * - the Player role needs Foundry's "Create New Actors" permission (Actor Studio refuses without it);
 * - Actor Studio's starting equipment choices on, its sources on the packs the players pick from.
 *
 * Sizes: smoke builds a fighter and a wizard; full and long build every class of the 2024 rules, with
 * the species and backgrounds in turn. KIT_PLAYER_CLASSES (identifiers, comma separated) narrows it.
 * Needs the real Foundry page; against the fake it skips.
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
  applyStudioSettings,
  narrowSources,
  readStudioSettings,
  restorable,
  studioInfo,
  studioSettingsFor,
} from '../lib/studio.mjs';
import { createInStudio, discardActor, stopPump } from '../lib/studio-flow.mjs';

const SMOKE_CLASSES = ['fighter', 'wizard'];
/** Console errors Actor Studio logs itself (the same patterns as heroes-studio). */
const STUDIO_ERRORS = /actor-studio|gas\.[A-Za-z]+|\[GAS\]/i;

/** @param {Array<{rules?: string, name: string}>} entries */
const modern = entries =>
  entries.filter(e => e.rules === '2024').sort((a, b) => a.name.localeCompare(b.name, 'en'));

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'player-character-creation',
  title:
    'A player builds a level-1 character in Actor Studio (species, background, class, starting equipment, spells)',
  sizes: ['smoke', 'full', 'long'],
  tags: ['build', 'player', 'module'],
  needs: ['heroes'],
  tools: [],
  gmActions: ['listCompendium', 'adoptActor', 'deleteKitActor'],
  knownConsoleErrors: ['foundryvtt-actor-studio', 'gas\\.[A-Za-z]+', '\\[GAS\\]'],
  // Before heroes-studio (90): both drive Actor Studio, this one from the player's side.
  order: 85,
  timeoutMs: 45 * 60 * 1000,

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
    const only = (process.env.KIT_PLAYER_CLASSES ?? '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);

    // --- what the players pick from ---------------------------------------------------------------
    const [classes, species, backgrounds] = await Promise.all([
      t.gm('listCompendium', { packIds: profile.packs.classes, type: 'class' }),
      t.gm('listCompendium', { packIds: profile.packs.species, type: 'race' }),
      t.gm('listCompendium', { packIds: profile.packs.backgrounds, type: 'background' }),
    ]);
    // One pack per kind, the first with 2024 entries: a player sees each class once.
    const firstPack = (/** @type {any[]} */ entries) => modern(entries)[0]?.packId ?? '';
    const packs = {
      class: firstPack(classes.entries),
      species: firstPack(species.entries),
      background: firstPack(backgrounds.entries),
    };
    const inPack = (/** @type {any[]} */ entries, /** @type {string} */ pack) =>
      modern(entries).filter(e => e.packId === pack);
    const classList = inPack(classes.entries, packs.class);
    const speciesList = inPack(species.entries, packs.species);
    const backgroundList = inPack(backgrounds.entries, packs.background);
    const wanted = only.length ? only : t.size === 'smoke' ? SMOKE_CLASSES : null;
    const plan = classList.filter(c => !wanted || wanted.includes(c.identifier));
    const rawHeroes = chooseHeroes(t.kit, 1);

    /** @type {{player: import('playwright-core').Page | null, errors: () => any[], userId: string}} */
    const ctx = { player: null, errors: () => [], userId: '' };

    await t.step(
      'the table set-up: players may create actors, Actor Studio offers starting equipment',
      async () => {
        t.check(
          classList.length && speciesList.length && backgroundList.length,
          'the profile has no 2024 classes, species or backgrounds',
          packs
        );
        t.check(plan.length, `none of the classes ${wanted?.join(', ')} is in ${packs.class}`);
        const info = await studioInfo(gmPage);
        t.check(
          info.installed && info.active,
          'Actor Studio (foundryvtt-actor-studio) is not active in this world'
        );

        // The Player role and "Create New Actors": read, granted for the run, put back after.
        const before = await gmPage.evaluate(() =>
          foundry.utils.deepClone(game.settings.get('core', 'permissions'))
        );
        const granted = (before.ACTOR_CREATE ?? []).includes(PLAYER_ROLE);
        if (!granted) {
          t.cleanup(async () => {
            await gmPage.evaluate(async p => game.settings.set('core', 'permissions', p), before);
          });
          await gmPage.evaluate(async role => {
            const p = foundry.utils.deepClone(game.settings.get('core', 'permissions'));
            p.ACTOR_CREATE = [...new Set([...(p.ACTOR_CREATE ?? []), role])];
            await game.settings.set('core', 'permissions', p);
          }, PLAYER_ROLE);
        }

        // Actor Studio's usage tracking off for the player before it joins (never put back).
        const tracking = await turnOffTrackingFor(gmPage, STUDIO_MODULE, KIT_PLAYER_USER);

        // Actor Studio as the table sets it for session 0, put back after the run.
        const settings = playerStudioSettings(studioSettingsFor(profile), packs, narrowSources);
        const saved = await readStudioSettings(gmPage, Object.keys(settings));
        t.cleanup(async () => {
          await applyStudioSettings(gmPage, restorable(saved));
        });
        await applyStudioSettings(gmPage, settings);
        return (
          `${info.title} ${info.version}; Player role ${granted ? 'had' : 'lacked'} Create New Actors` +
          `${granted ? '' : ' (granted for the run)'}; packs ${packs.class}, ${packs.species}, ${packs.background}; ` +
          `${plan.length} classes to build; usage tracking for ${KIT_PLAYER_USER}: ${tracking ?? 'no setting'}`
        );
      }
    );

    await t.step(`${KIT_PLAYER_USER} joins the world in a browser of its own`, async () => {
      const j = await join(KIT_PLAYER_USER);
      ctx.player = j.page;
      ctx.errors = j.consoleErrors;
      const who = await j.page.evaluate(
        id => ({
          id: game.user.id,
          isGM: game.user.isGM,
          role: game.user.role,
          canCreate: game.user.can('ACTOR_CREATE'),
          tracking: game.settings.get(id, 'usage-tracking'),
          button: !!document.querySelector('#gas-sidebar-button'),
        }),
        STUDIO_MODULE
      );
      ctx.userId = who.id;
      t.check(!who.isGM, `${KIT_PLAYER_USER} is a GM; the scenario needs a player`);
      t.check(who.canCreate, `${KIT_PLAYER_USER} cannot create actors after the grant`);
      t.check(
        who.tracking === false,
        'Actor Studio usage tracking is on for the player (it must be off for every user)'
      );
      return `role ${who.role}; Actor Studio usage tracking off`;
    });

    // A build that fails after Create Character leaves its actor behind: every actor the player made
    // in this run goes at the end (the kit world only; the per-build clean-ups take the rest).
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

    /** @type {any[]} */
    const results = [];
    for (const [i, c] of plan.entries()) {
      const smoke = t.size === 'smoke' && !only.length;
      const sp =
        smoke && c.identifier === 'fighter'
          ? pickOrigin(speciesList, 'Human')
          : speciesList[i % speciesList.length].uuid;
      const bg =
        smoke && c.identifier === 'fighter'
          ? pickOrigin(backgroundList, 'Soldier')
          : backgroundList[(i * 5) % backgroundList.length].uuid;
      const spName = speciesList.find(e => e.uuid === sp)?.name ?? sp;
      const bgName = backgroundList.find(e => e.uuid === bg)?.name ?? bg;
      const raw = rawHeroes.find(h => h.classIdentifier === c.identifier && h.abilities);
      await t.step(
        `${KIT_PLAYER_USER} builds a level-1 ${c.name} (${spName}, ${bgName}) with starting equipment`,
        async () => {
          const page = /** @type {import('playwright-core').Page} */ (ctx.player);
          const name = `Player ${c.name} ${i + 1}`;
          const started = Date.now();
          /** @type {any} */
          let made = null;
          try {
            made = await createInStudio(page, {
              name,
              classUuid: c.uuid,
              speciesUuid: sp,
              backgroundUuid: bg,
              rotation: i,
              featPackIds: profile.packs.feats,
              abilities: raw?.abilities ?? KIT_ABILITIES,
              equipment: true,
              log: m => t.log(`${c.identifier}: ${m}`),
            });
          } finally {
            const pump = await stopPump(page).catch(() => null);
            if (made) made.pump = pump ?? made.pump;
          }
          const actorId = made.actorId;
          t.cleanup(async () => {
            try {
              await t.gm('deleteKitActor', { actorId });
            } catch {
              await discardActor(gmPage, actorId);
            }
          });
          // The kit flag, so a rebuild wipes it if the clean-up does not run.
          await t.gm('adoptActor', { actorId, name, folderId: t.kit.folders?.Actor });
          const sheet = await readSheet(gmPage, actorId);
          const spellList = sheet.spells.length ? await spellListOf(gmPage, c.identifier) : null;
          const verdict = judgeSheet({
            sheet,
            playerId: ctx.userId,
            classIdentifier: c.identifier,
            planned: made.equipment?.inventory ?? [],
            spellList,
            pumpErrors: made.pump?.errors ?? [],
            speciesUuid: sp,
          });
          const seconds = Math.round((Date.now() - started) / 1000);
          results.push({
            class: c.identifier,
            species: spName,
            background: bgName,
            seconds,
            equipment: made.equipment?.picks ?? [],
            planned: made.equipment?.inventory ?? [],
            spells: sheet.spells.map(s => s.name),
            problems: verdict.problems.map(p => `${p.what}: ${p.evidence}`),
            notes: verdict.notes,
          });
          for (const n of verdict.notes) t.log(`${c.identifier}: ${n}`);
          t.check(
            made.equipment && made.equipment.inventory.length > 0,
            made.equipment
              ? 'the Equipment tab planned no items'
              : 'the Equipment tab never showed (starting equipment untested)'
          );
          t.check(
            verdict.problems.length === 0,
            `${verdict.problems.length} problem(s): ${verdict.problems
              .slice(0, 4)
              .map(p => `${p.what}: ${p.evidence}`)
              .join(' | ')}`,
            { problems: verdict.problems }
          );
          return `${sheet.hp.max} HP, ${made.equipment?.inventory.length ?? 0} items planned, ${sheet.spells.length} spells, ${seconds} s`;
        },
        { continueOnFail: true }
      );
    }

    await t.step(
      'the player page logged no console errors',
      async () => {
        const errors = ctx.errors();
        const studio = errors.filter(e => STUDIO_ERRORS.test(`${e.message} ${e.source}`));
        const other = errors.filter(e => !STUDIO_ERRORS.test(`${e.message} ${e.source}`));
        t.attach('player console', { studio, other });
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

    t.attach('characters', { profile: t.kit.profile, packs, built: results });
  },
};
