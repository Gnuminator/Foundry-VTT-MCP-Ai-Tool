/**
 * Every kit hero has what its class and subclass give at its level: the grants, the choices, the
 * scale values, the hit points, the spell slots, the skills and the saving throws. One step per
 * hero, so the report lists every failure. The advancement data (describeClass) is the oracle,
 * the actor (inspectActor) is what is checked. See lib/advancement.mjs for the checks and for how
 * a failure is classified: KIT (our builder or check), CONTENT (the imported data) or SYSTEM
 * (dnd5e behaviour).
 */
import { FAILURE_KINDS, checkHero, classifyBuildError, problemText } from '../lib/advancement.mjs';

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'heroes-advancement',
  title: 'Every kit hero has the grants, choices, scale values, HP and spell slots of its level',
  sizes: ['smoke', 'full', 'long'],
  tags: ['build', 'module'],
  needs: ['heroes'],
  tools: [],
  gmActions: ['describeClass', 'inspectActor'],
  timeoutMs: 20 * 60 * 1000,

  async run(t) {
    /** @type {Array<{hero: any, problems: import('../lib/advancement.mjs').Problem[]}>} */
    const results = [];

    for (const hero of t.kit.heroes) {
      const sub = hero.subclassIdentifier ? ` (${hero.subclassIdentifier})` : '';
      const label = `${hero.name}: ${hero.classIdentifier} ${hero.level}${sub}`;
      await t.step(
        label,
        async () => {
          if (hero.buildError || !hero.actorId) {
            const problem = classifyBuildError(hero.buildError ?? 'no actor');
            results.push({ hero, problems: [problem] });
            t.check(false, problemText([problem]));
          }
          const { expected } = await t.gm('describeClass', {
            classUuid: hero.classUuid,
            subclassUuid: hero.subclassUuid,
            level: hero.level,
          });
          const actor = await t.gm('inspectActor', { actorId: hero.actorId });
          const { problems, summary } = checkHero({ hero, expected, actor });
          results.push({ hero, problems });
          t.check(problems.length === 0, problemText(problems), { problems, expected });
          return summary;
        },
        { continueOnFail: true }
      );
    }

    // The coverage of the scenario: what was checked and how the failures split.
    const failedHeroes = results.filter(r => r.problems.length);
    const byKind = Object.fromEntries(FAILURE_KINDS.map(k => [k, 0]));
    for (const r of results) for (const p of r.problems) byKind[p.kind] += 1;
    const classes = new Set(t.kit.heroes.map(h => h.classIdentifier));
    const subclasses = new Set(t.kit.heroes.map(h => h.subclassIdentifier).filter(Boolean));
    t.attach('coverage', {
      profile: t.kit.profile,
      classes: classes.size,
      subclasses: subclasses.size,
      heroes: t.kit.heroes.length,
      heroesFailed: failedHeroes.length,
      problemsByKind: byKind,
      failed: failedHeroes.map(r => ({
        hero: r.hero.name,
        problems: r.problems.map(p => `[${p.kind}] ${p.what}`),
      })),
    });
    t.log(
      `${t.kit.heroes.length} heroes, ${classes.size} classes, ${subclasses.size} subclasses; ` +
        `${failedHeroes.length} heroes failed (KIT ${byKind.KIT}, CONTENT ${byKind.CONTENT}, SYSTEM ${byKind.SYSTEM})`
    );
  },
};
