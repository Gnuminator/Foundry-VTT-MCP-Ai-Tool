/**
 * Thirty-one deep checks of how spells work, each on an SRD spell the profile has: spell attack
 * rolls, saves (half damage, negated with a condition), area templates (sphere, cone, line, cube,
 * wall), concentration (begin, replace, none), upcasting (more dice, more targets, more healing),
 * healing and temporary hit points, teleport, a reaction, armor and bonus effects, rituals, cantrip
 * scaling by character level, Pact Magic, which slot is taken, a refused cast, a summon (placed and
 * cleaned up) and a spell scroll. The oracle is the 2024 SRD rules written down in
 * lib/spells-deep.mjs. A check whose spell the profile lacks is skipped with the reason.
 * The caster is put back after every call by the GM action (exerciseSpell).
 */
import { FAILURE_KINDS, problemText } from '../lib/advancement.mjs';
import { builtHeroes } from '../lib/helpers.mjs';
import { loadProfile } from '../lib/profiles.mjs';
import { CASTER_CLASSES, casterCandidates, casterFor, selectSpells } from '../lib/spells.mjs';
import { DEEP_SPELL_CHECKS, runSpellCheck } from '../lib/spells-deep.mjs';

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'spells-deep',
  title:
    'Deep spell checks: attacks, saves, areas, concentration, upcasting, slots, rituals, scrolls',
  sizes: ['smoke', 'full', 'long'],
  tags: ['build', 'module'],
  needs: ['heroes', 'scene'],
  tools: [],
  gmActions: ['listSpells', 'inspectFeatures', 'exerciseSpell'],
  order: 90,
  timeoutMs: 60 * 60 * 1000,

  async run(t) {
    const profile = loadProfile(t.kit.profile);
    const heroes = builtHeroes(t.kit);
    /** @type {Map<string, import('../lib/spells.mjs').SpellEntry>} */
    const byName = new Map();
    /** @type {Map<string, Promise<any>>} */
    const factsCache = new Map();
    const factsOf = (/** @type {any} */ hero) => {
      if (!factsCache.has(hero.actorId))
        factsCache.set(hero.actorId, t.gm('inspectFeatures', { actorId: hero.actorId }));
      return /** @type {Promise<any>} */ (factsCache.get(hero.actorId));
    };
    const who = async (/** @type {any} */ hero) =>
      hero ? { hero, facts: await factsOf(hero) } : null;

    await t.step('list the spells', async () => {
      const listed = await t.gm('listSpells', { packIds: profile.packs.spells });
      const all = selectSpells(listed.entries, profile.select);
      // The 2024 spell of a name wins over a legacy one; within a version the first pack wins.
      for (const e of [...all].sort(
        (a, b) => Number(b.rules === '2024') - Number(a.rules === '2024')
      )) {
        if (!byName.has(e.name.toLowerCase())) byName.set(e.name.toLowerCase(), e);
      }
      t.check(byName.size > 0, 'the profile has no spells (are its spell packs installed?)');
      return `${byName.size} distinct spells`;
    });

    // Caster candidates with their slots, once.
    const casters = [];
    for (const hero of casterCandidates(heroes)) casters.push({ hero, facts: await factsOf(hero) });
    if (!casters.length && heroes.length)
      casters.push({ hero: heroes[0], facts: await factsOf(heroes[0]) });

    /** @type {import('../lib/spells-deep.mjs').SpellCtx} */
    const ctx = {
      find: name => byName.get(name.toLowerCase()),
      caster: async level => casterFor(level, casters) ?? null,
      heroAtLevel: async level => {
        const ofLevel = heroes.filter(h => h.level === level);
        const hero =
          ofLevel.find(h => CASTER_CLASSES.includes(h.classIdentifier)) ?? ofLevel[0] ?? null;
        return who(hero);
      },
      byClass: async classId => {
        const own = heroes.filter(h => h.classIdentifier === classId);
        const hero = own.reduce((best, h) => (!best || h.level > best.level ? h : best), null);
        return who(hero);
      },
      unarmored: async () => {
        // Casters first, then the other heroes; a hero with no armor and no shield.
        const order = [
          ...casters.map(c => c.hero),
          ...heroes.filter(h => !casters.some(c => c.hero === h)),
        ];
        for (const hero of order.slice(0, 16)) {
          const facts = await factsOf(hero);
          if (!facts.ac?.armor) return { hero, facts };
        }
        return null;
      },
      exercise: (w, args) =>
        t.gm('exerciseSpell', { actorId: w.hero.actorId, sceneId: t.kit.scene.sceneId, ...args }),
    };

    const byKind = Object.fromEntries(FAILURE_KINDS.map(k => [k, 0]));
    /** @type {Array<{check: string, ran: boolean, skipped?: string, notes: string[], failed: string[]}>} */
    const coverage = [];

    for (const check of DEEP_SPELL_CHECKS) {
      await t.step(
        `${check.id}: ${check.title}`,
        async () => {
          const outcome = await runSpellCheck(check, ctx);
          coverage.push({
            check: check.id,
            ran: !outcome.skip,
            ...(outcome.skip ? { skipped: outcome.skip } : {}),
            notes: outcome.notes,
            failed: outcome.problems.map(p => `[${p.kind}] ${p.what}: ${p.evidence}`),
          });
          for (const p of outcome.problems) byKind[p.kind] += 1;
          t.check(outcome.problems.length === 0, problemText(outcome.problems, 5), {
            problems: outcome.problems,
          });
          if (outcome.skip) return `skipped: ${outcome.skip}`;
          return outcome.notes.slice(0, 3).join('; ') || 'passed';
        },
        { continueOnFail: true }
      );
    }

    const skipped = coverage.filter(c => !c.ran).map(c => `${c.check}: ${c.skipped}`);
    t.attach('coverage', {
      profile: t.kit.profile,
      heroes: heroes.length,
      casters: casters.map(c => `${c.hero.name} (${c.hero.classIdentifier} ${c.hero.level})`),
      checks: DEEP_SPELL_CHECKS.length,
      checksRun: coverage.length - skipped.length,
      checksSkipped: skipped,
      problemsByKind: byKind,
      perCheck: coverage,
    });
    t.log(
      `${DEEP_SPELL_CHECKS.length} deep spell checks, ${coverage.length - skipped.length} ran, ${skipped.length} skipped; ` +
        `problems: ${FAILURE_KINDS.map(k => `${k} ${byKind[k]}`).join(', ')}`
    );
  },
};
