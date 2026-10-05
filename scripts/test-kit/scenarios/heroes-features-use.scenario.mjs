/**
 * Every feature of every kit hero is used once. For each built hero the scenario reads its
 * features (inspectFeatures), then uses every activity of every feature that can run with no dialog
 * (exerciseActor, op "use": no template, no roll, no action cost) and checks what the system did:
 * no error, a chat card, the uses the activity says it consumes. The GM action puts the hero back
 * after each use (uses, slots, hit points, effects, chat messages), and says when it could not.
 *
 * Activities that need a dialog (summon, transform, cast, order) are left out and listed in the
 * coverage attachment with the reason. Weapons, equipment and spells are not used in this pass.
 * Failures are classified like in heroes-advancement: KIT, CONTENT or SYSTEM (lib/features.mjs).
 */
import { FAILURE_KINDS, countByKind, problemText } from '../lib/advancement.mjs';
import { judgeUse, planUses } from '../lib/features.mjs';
import { builtHeroes } from '../lib/helpers.mjs';

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'heroes-features-use',
  title: 'Every feature of every hero can be used once: chat card, uses consumed, hero put back',
  sizes: ['smoke', 'full', 'long'],
  tags: ['build', 'module'],
  needs: ['heroes'],
  tools: [],
  gmActions: ['inspectFeatures', 'exerciseActor'],
  timeoutMs: 90 * 60 * 1000,

  async run(t) {
    const heroes = builtHeroes(t.kit);
    /** @type {import('../lib/advancement.mjs').Problem[]} */
    const allProblems = [];
    /** @type {Array<{hero: string, problems: import('../lib/advancement.mjs').Problem[]}>} */
    const failed = [];
    /** @type {Record<string, number>} */
    const skippedBy = {};
    let features = 0;
    let used = 0;

    for (const hero of heroes) {
      const sub = hero.subclassIdentifier ? ` (${hero.subclassIdentifier})` : '';
      const label = `${hero.name}: ${hero.classIdentifier} ${hero.level}${sub}`;
      await t.step(
        label,
        async () => {
          const facts = await t.gm('inspectFeatures', { actorId: hero.actorId });
          const plan = planUses(facts);
          features += plan.features;
          for (const s of plan.skipped)
            skippedBy[`${s.activity}: ${s.why}`] = (skippedBy[`${s.activity}: ${s.why}`] ?? 0) + 1;
          /** @type {import('../lib/advancement.mjs').Problem[]} */
          const problems = [];
          for (const planned of plan.use) {
            let result;
            try {
              result = await t.gm('exerciseActor', {
                actorId: hero.actorId,
                op: 'use',
                itemId: planned.item.id,
                activityId: planned.activity.id,
              });
            } catch (e) {
              problems.push({
                kind: 'KIT',
                what: 'the GM action failed',
                evidence: `${planned.item.name}: ${e instanceof Error ? e.message : String(e)}`,
              });
              continue;
            }
            used += 1;
            problems.push(...judgeUse(planned, result));
          }
          allProblems.push(...problems);
          if (problems.length) failed.push({ hero: hero.name, problems });
          t.check(problems.length === 0, problemText(problems, 6), { problems });
          return `${plan.features} features, ${plan.use.length} activities used, ${plan.skipped.length} left out`;
        },
        { continueOnFail: true }
      );
    }

    const byKind = countByKind(allProblems);
    t.attach('coverage', {
      profile: t.kit.profile,
      heroes: heroes.length,
      featuresWithActivities: features,
      activitiesUsed: used,
      leftOut: skippedBy,
      heroesFailed: failed.length,
      problemsByKind: byKind,
      failed: failed.map(f => ({
        hero: f.hero,
        problems: f.problems.map(p => `[${p.kind}] ${p.what}: ${p.evidence}`),
      })),
    });
    t.log(
      `${heroes.length} heroes, ${features} features with activities, ${used} activities used; ` +
        `${failed.length} heroes failed (${FAILURE_KINDS.map(k => `${k} ${byKind[k]}`).join(', ')})`
    );
  },
};
