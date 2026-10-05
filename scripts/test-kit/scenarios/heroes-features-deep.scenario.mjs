/**
 * About twenty deep checks of what a class gives its heroes, each against a rules table written
 * down in lib/features.mjs (the 2024 SRD class tables): Rage (damage bonus, resistances, uses),
 * Wild Shape, Channel Divinity, Sneak Attack dice, Bardic Inspiration die, Focus points, Sorcery
 * points, Pact Magic slots, Action Surge, Lay on Hands, Second Wind, Arcane Recovery, Divine Smite,
 * Cunning Action, Extra Attack, superiority dice, Unarmored Defense, spell slots, Hit Dice, short
 * and long rest recovery and the proficiency bonus.
 *
 * One step per check, over every hero it applies to. A check with no hero it applies to (the kit
 * has no barbarian, say) passes with "skipped: <reason>" as its detail and is listed in the coverage
 * attachment. A check that compares with a number table only looks at heroes of a 2024 class.
 * The hero is put back after every probe by the GM action (exerciseActor).
 */
import { FAILURE_KINDS, problemText } from '../lib/advancement.mjs';
import { DEEP_CHECKS, runDeepCheck } from '../lib/features.mjs';
import { builtHeroes } from '../lib/helpers.mjs';

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'heroes-features-deep',
  title:
    'Deep checks of what each class gives: uses, dice, slots, AC, rests, against the rules tables',
  sizes: ['smoke', 'full', 'long'],
  tags: ['build', 'module'],
  needs: ['heroes'],
  tools: [],
  gmActions: ['inspectFeatures', 'exerciseActor'],
  timeoutMs: 60 * 60 * 1000,

  async run(t) {
    const heroes = builtHeroes(t.kit);
    /** @type {Map<string, Promise<any>>} */
    const cache = new Map();
    const factsOf = (/** @type {any} */ hero) => {
      if (!cache.has(hero.actorId))
        cache.set(hero.actorId, t.gm('inspectFeatures', { actorId: hero.actorId }));
      return /** @type {Promise<any>} */ (cache.get(hero.actorId));
    };
    const call = (/** @type {string} */ action, /** @type {object} */ args) => t.gm(action, args);
    const byKind = Object.fromEntries(FAILURE_KINDS.map(k => [k, 0]));
    /** @type {Array<{check: string, heroes: number, skipped: string[], failed: string[], skippedBecause?: string}>} */
    const coverage = [];

    for (const check of DEEP_CHECKS) {
      await t.step(
        `${check.id}: ${check.title}`,
        async () => {
          const r = await runDeepCheck(check, heroes, factsOf, call);
          const row = {
            check: check.id,
            heroes: r.checked.length,
            skipped: r.skipped.map(s => `${s.hero}: ${s.why}`),
            failed: r.failed.map(f => `${f.hero.name}: ${problemText(f.problems, 3)}`),
            ...(r.checked.length === 0 && !r.failed.length
              ? { skippedBecause: check.none ?? 'no hero applies' }
              : {}),
          };
          coverage.push(row);
          for (const f of r.failed) for (const p of f.problems) byKind[p.kind] += 1;
          t.check(
            r.failed.length === 0,
            `${r.failed.length} of ${r.checked.length} hero(es) failed: ${row.failed.slice(0, 4).join(' || ')}${r.failed.length > 4 ? ` || and ${r.failed.length - 4} more` : ''}`,
            { failed: row.failed }
          );
          if (row.skippedBecause) return `skipped: ${row.skippedBecause}`;
          const sample = r.notes
            .slice(0, 2)
            .map(n => `${n.hero} ${n.note}`)
            .join('; ');
          return `${r.checked.length} hero(es) checked${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}${sample ? `: ${sample}` : ''}`;
        },
        { continueOnFail: true }
      );
    }

    const skipped = coverage
      .filter(c => c.skippedBecause)
      .map(c => `${c.check}: ${c.skippedBecause}`);
    t.attach('coverage', {
      profile: t.kit.profile,
      heroes: heroes.length,
      checks: DEEP_CHECKS.length,
      checksRun: coverage.length - skipped.length,
      checksSkipped: skipped,
      problemsByKind: byKind,
      perCheck: coverage,
    });
    t.log(
      `${DEEP_CHECKS.length} deep checks, ${coverage.length - skipped.length} ran, ${skipped.length} skipped; ` +
        `problems: ${FAILURE_KINDS.map(k => `${k} ${byKind[k]}`).join(', ')}`
    );
  },
};
