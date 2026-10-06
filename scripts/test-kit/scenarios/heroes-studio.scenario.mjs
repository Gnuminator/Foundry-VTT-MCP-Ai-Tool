/**
 * The table builds its characters with the Actor Studio module. For each class of the profile this
 * scenario builds one hero through Actor Studio's own windows (driven by Playwright on the GM page:
 * the abilities, species, background and class pickers, "Create Character", the level-up window once
 * per level, the Spells tab), then compares it with the raw kit hero of the same class, level and
 * choices: class levels, subclass, hit points, armor class, ability scores, proficiencies, items and
 * features granted, spell slots, advancement values and where each item came from.
 *
 * A difference is a finding (KIT, CONTENT, SYSTEM, or STUDIO when Actor Studio itself made it, see
 * lib/studio-compare.mjs). The feature use pass of heroes-features-use then runs on each Studio hero
 * and on its raw twin; a problem only the Studio hero has is a STUDIO finding.
 *
 * Choices: the answer pump (lib/studio-pump.mjs) answers the system's advancement questions that
 * Actor Studio shows, with the same rotation rule as the raw hero's builder.
 *
 * The scenario needs the real Foundry page (it clicks in Actor Studio's windows); against the fake
 * it builds the "Studio" hero with the builder instead, which tests the comparison and the report.
 * Development filters: KIT_STUDIO_CLASSES (identifiers, comma separated), KIT_STUDIO_LEVEL (default 5),
 * KIT_KEEP_STUDIO=1 keeps the Studio heroes in the world (they carry the kit flag), KIT_SKIP_STUDIO=1 skips
 * the scenario (a run takes about a minute and a half per class).
 */
import { problemText } from '../lib/advancement.mjs';
import { judgePlan, judgeUse, planUses } from '../lib/features.mjs';
import { loadProfile } from '../lib/profiles.mjs';
import {
  STUDIO_KINDS,
  chooseHeroes,
  classify,
  compareHeroes,
  consoleFindingId,
  countStudioKinds,
  featureProblemId,
  pickOrigin,
  splitExpected,
} from '../lib/studio-compare.mjs';
import {
  applyStudioSettings,
  readStudioSettings,
  restorable,
  studioInfo,
  studioSettingsFor,
} from '../lib/studio.mjs';
import { buildHeroInStudio, discardActor } from '../lib/studio-flow.mjs';
import { loadExpected } from '../lib/studio-expected.mjs';

const DEFAULT_LEVEL = 5;

/** @param {import('../lib/contract.mjs').ScenarioContext} t @param {string} actorId */
async function snapshot(t, actorId) {
  return {
    actor: await t.gm('inspectActor', { actorId }),
    features: await t.gm('inspectFeatures', { actorId }),
    build: await t.gm('inspectBuild', { actorId }),
  };
}

/**
 * The feature use pass on one hero (see heroes-features-use): the problems as comparable lines.
 * @param {import('../lib/contract.mjs').ScenarioContext} t
 * @param {string} actorId
 * @param {number} level
 */
async function usePass(t, actorId, level) {
  const facts = await t.gm('inspectFeatures', { actorId });
  const plan = planUses(facts);
  /** @type {import('../lib/advancement.mjs').Problem[]} */
  const problems = [...judgePlan({ level }, plan)];
  let used = 0;
  for (const planned of plan.use) {
    try {
      const result = await t.gm('exerciseActor', {
        actorId,
        op: 'use',
        itemId: planned.item.id,
        activityId: planned.activity.id,
      });
      used += 1;
      problems.push(...judgeUse(planned, result));
    } catch (e) {
      problems.push({
        kind: 'KIT',
        what: 'the GM action failed',
        evidence: `${planned.item.name}: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
  return { problems, used, features: plan.features };
}

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'heroes-studio',
  title:
    'Heroes built in Actor Studio match the raw kit heroes (known findings counted, new ones fail)',
  sizes: ['smoke', 'full', 'long'],
  tags: ['build', 'module'],
  needs: ['heroes'],
  tools: [],
  gmActions: [
    'listCompendium',
    'createHero',
    'inspectActor',
    'inspectFeatures',
    'inspectBuild',
    'exerciseActor',
    'adoptActor',
    'deleteKitActor',
    'consoleErrors',
  ],
  // Actor Studio's own console errors are reported by this scenario (the last step), as STUDIO findings.
  knownConsoleErrors: ['foundryvtt-actor-studio', 'gas\\.[A-Za-z]+', '\\[GAS\\]'],
  // Before the feature scenarios: they fill the play log with thousands of chat cards.
  order: 90,
  timeoutMs: 3 * 60 * 60 * 1000,

  async run(t) {
    if (process.env.KIT_SKIP_STUDIO === '1') t.skip('KIT_SKIP_STUDIO=1');
    const startedAt = Date.now();
    const level = Number(process.env.KIT_STUDIO_LEVEL) || DEFAULT_LEVEL;
    const only = (process.env.KIT_STUDIO_CLASSES ?? '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);
    const keep = process.env.KIT_KEEP_STUDIO === '1';
    const profile = loadProfile(t.kit.profile);
    const page = t.fake ? null : t.page;
    if (!t.fake && !page) t.skip('Actor Studio needs the real Foundry page; none is open');

    /** @type {{installed: boolean, active: boolean, version: string, title: string}} */
    let info = { installed: true, active: true, version: 'fake', title: 'Actor Studio (fake)' };
    if (page) {
      await t.step('Actor Studio is installed and active in the kit world', async () => {
        info = await studioInfo(page);
        t.check(
          info.installed,
          'the module foundryvtt-actor-studio is not installed on this Foundry'
        );
        t.check(
          info.active,
          'the module foundryvtt-actor-studio is installed but not enabled in this world (kit init enables it; the profile lists it under modules)'
        );
        return `${info.title} ${info.version}`;
      });
      // The table's settings for the module, put back after the run. They are read and the restore is
      // registered first, so a write that fails halfway is still undone. Usage tracking is never put back.
      const wanted = studioSettingsFor(profile);
      const before = await readStudioSettings(page, Object.keys(wanted));
      t.cleanup(async () => {
        await applyStudioSettings(page, restorable(before));
      });
      await applyStudioSettings(page, wanted);
    }

    // The species and background the builder used for the raw heroes.
    const species = await t.gm('listCompendium', { packIds: profile.packs.species, type: 'race' });
    const backgrounds = await t.gm('listCompendium', {
      packIds: profile.packs.backgrounds,
      type: 'background',
    });
    const speciesUuid = pickOrigin(species.entries, 'Human');
    const backgroundUuid = pickOrigin(backgrounds.entries, 'Soldier');
    t.check(
      speciesUuid && backgroundUuid,
      'the profile has no species or no background to build with'
    );

    const heroes = chooseHeroes(t.kit, level, only);
    t.check(
      heroes.length > 0,
      `the kit has no tier hero at or below level ${level} to compare with`
    );
    const settings = page ? studioSettingsFor(profile) : null;
    // The findings that are known and accepted: counted, not failed. Anything else fails.
    const expectedList = loadExpected();

    /** @type {Array<{hero: string, class: string, level: number, seconds: number, problems: import('../lib/studio-compare.mjs').StudioProblem[], notes: string[], summary: string, picks: number, spells: unknown, useProblems: string[], studioOnly: string[]}>} */
    const results = [];
    /** @type {import('../lib/studio-compare.mjs').StudioProblem[]} */
    const all = [];
    const made = [];

    for (const raw of heroes) {
      const sub = raw.subclassIdentifier ? ` (${raw.subclassIdentifier})` : '';
      const where = page
        ? 'built in Actor Studio'
        : 'built by the fixture (the fake has no Actor Studio)';
      const label = `${raw.name}: ${raw.classIdentifier} ${raw.level}${sub} ${where}`;
      await t.step(
        label,
        async () => {
          const name = raw.name.replace(/^Kit /, 'Studio ');
          const started = Date.now();
          /** @type {{actorId: string, picks: any[], warnings: string[], errors: string[], spells: any, seconds: number}} */
          let built;
          if (page && settings) {
            built = await buildHeroInStudio(page, {
              name,
              level: raw.level,
              classUuid: raw.classUuid,
              subclassUuid: raw.subclassUuid,
              speciesUuid,
              backgroundUuid,
              rotation: raw.rotation,
              featPackIds: profile.packs.feats,
              settings,
              log: m => t.log(`${raw.name}: ${m}`),
            });
            // The restore comes first: whatever fails after the build, the hero does not stay behind.
            if (!keep)
              t.cleanup(async () => {
                try {
                  await t.gm('deleteKitActor', { actorId: built.actorId });
                } catch {
                  await discardActor(page, built.actorId);
                }
              });
            try {
              await t.gm('adoptActor', { actorId: built.actorId, folderId: t.kit.folders?.Actor });
            } catch (e) {
              await discardActor(page, built.actorId);
              throw e;
            }
          } else {
            // The fake has no Actor Studio: the builder makes the "Studio" hero.
            const hero = await t.gm('createHero', {
              name,
              classUuid: raw.classUuid,
              subclassUuid: raw.subclassUuid,
              level: raw.level,
              rotation: raw.rotation,
              speciesUuid,
              backgroundUuid,
              folderId: t.kit.folders?.Actor,
              featPackIds: profile.packs.feats,
            });
            built = {
              actorId: hero.actorId,
              picks: hero.picks,
              warnings: hero.warnings,
              errors: [],
              spells: null,
              seconds: Math.round((Date.now() - started) / 1000),
            };
          }
          made.push(built.actorId);
          if (!keep && !page)
            t.cleanup(async () => {
              await t.gm('deleteKitActor', { actorId: built.actorId });
            });

          const rawShot = await snapshot(t, raw.actorId);
          const studioShot = await snapshot(t, built.actorId);
          const verdict = compareHeroes({
            raw: { ...rawShot, picks: raw.picks },
            studio: { ...studioShot, picks: built.picks },
            pumpErrors: built.errors,
          });
          /** @type {import('../lib/studio-compare.mjs').StudioProblem[]} */
          const problems = [...verdict.problems];

          // The feature use pass on both heroes: a problem only the Studio hero has is a finding.
          const rawUse = await usePass(t, raw.actorId, raw.level);
          const studioUse = await usePass(t, built.actorId, raw.level);
          const line = p => `[${p.kind}] ${p.what}: ${p.evidence}`;
          const rawLines = new Set(rawUse.problems.map(line));
          const studioOnly = studioUse.problems.map(line).filter(l => !rawLines.has(l));
          for (const l of studioOnly) {
            const c = classify('feature problems', 'STUDIO', l);
            problems.push({
              kind: c.kind,
              what: 'a feature problem only the Studio hero has',
              evidence: c.why ? `${l} (${c.why})` : l,
              category: 'feature problems',
              id: featureProblemId(l),
            });
          }

          results.push({
            hero: raw.name,
            class: raw.classIdentifier,
            level: raw.level,
            seconds: built.seconds,
            problems,
            notes: verdict.notes,
            summary: verdict.summary,
            picks: built.picks.length,
            spells: built.spells,
            useProblems: studioUse.problems.map(line),
            studioOnly,
          });
          all.push(...problems);
          const split = splitExpected(problems, expectedList);
          t.check(
            split.fresh.length === 0,
            `${split.fresh.length} new finding(s): ${problemText(split.fresh, 6)}`,
            { fresh: split.fresh }
          );
          return (
            `${verdict.summary}; ${split.expected.length} expected findings; ` +
            `${studioUse.used} activities used, ${built.seconds} s` +
            `${verdict.notes.length ? `; ${verdict.notes.length} notes` : ''}`
          );
        },
        { continueOnFail: true }
      );
    }

    // What Actor Studio logged to the browser console while it built the heroes.
    /** @type {Array<{message: string, source: string, count: number}>} */
    const consoleStudio = [];
    await t.step(
      'Actor Studio logged no console errors',
      async () => {
        const reply = await t.gm('consoleErrors', { since: startedAt });
        /** @type {Map<string, {message: string, source: string, count: number}>} */
        const distinct = new Map();
        for (const e of reply.errors ?? []) {
          const text = `${e.message} ${e.source}`;
          if (!/actor-studio|gas\.[A-Za-z]+|\[GAS\]/i.test(text)) continue;
          const first = String(e.message).split(/\r?\n/)[0].slice(0, 220);
          const found = distinct.get(first);
          if (found) found.count += 1;
          else distinct.set(first, { message: first, source: String(e.source), count: 1 });
        }
        consoleStudio.push(...distinct.values());
        const problems = consoleStudio.map(c => ({
          kind: /** @type {const} */ ('STUDIO'),
          what: `console error x${c.count}`,
          evidence: `${c.message} (${c.source.replace(/^https?:\/\/[^/]+\//, '')})`,
          category: 'console',
          id: consoleFindingId(c.message, c.source),
        }));
        all.push(...problems);
        const split = splitExpected(problems, expectedList);
        t.check(
          split.fresh.length === 0,
          `${split.fresh.length} new console error(s): ${problemText(split.fresh, 4)}`,
          { fresh: split.fresh }
        );
        return `${split.expected.length} expected console errors`;
      },
      { continueOnFail: true }
    );

    const byKind = countStudioKinds(all);
    const overall = splitExpected(all, expectedList);
    t.attach('coverage', {
      expectedFindings: overall.counts,
      newFindings: overall.fresh.map(p => `[${p.kind}] ${p.id ?? p.what}: ${p.evidence}`),
      profile: t.kit.profile,
      actorStudio: { version: info.version, title: info.title },
      level,
      heroes: heroes.length,
      built: results.length,
      differencesByKind: byKind,
      kept: keep ? made : [],
      consoleErrors: consoleStudio,
      byClass: results.map(r => ({
        hero: r.hero,
        class: r.class,
        level: r.level,
        seconds: r.seconds,
        picks: r.picks,
        spells: r.spells,
        differences: r.problems.map(p => `[${p.kind}] ${p.what}: ${p.evidence}`),
        notes: r.notes,
        studioOnlyFeatureProblems: r.studioOnly,
        featureProblemsOnStudioHero: r.useProblems.length,
      })),
    });
    t.log(
      `${results.length}/${heroes.length} heroes built in Actor Studio ${info.version}; ` +
        `differences: ${STUDIO_KINDS.map(k => `${k} ${byKind[k]}`).join(', ')}; ` +
        `${overall.expected.length} expected, ${overall.fresh.length} new`
    );
  },
};
