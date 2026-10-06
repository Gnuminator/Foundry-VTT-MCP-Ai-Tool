/**
 * Every spell of the profile's spell packs is cast once. Each spell goes to a suitable caster hero
 * (the best hero of a spellcasting class, one with slots of the spell's level when there is one; a
 * slot is forced when no hero has one), is cast at its base level through its first activity with no
 * dialog, no measured template and no summons (exerciseSpell), and the cast is judged: no error, a
 * chat card, the slot taken (none for a cantrip), concentration begun when the spell needs it. The
 * hero is put back after every cast and the GM action says when that failed.
 *
 * `smoke` casts a sample of about thirty spells (the first and last of every level, one of every
 * kind of activity and area shape, a concentration spell, a ritual); `full` and `long` cast them all.
 * One step per spell level, so the report stays readable; the attachment lists every failure.
 * Failures are classified like in heroes-advancement: KIT, CONTENT or SYSTEM (lib/spells.mjs).
 */
import { FAILURE_KINDS, countByKind, problemText } from '../lib/advancement.mjs';
import { builtHeroes } from '../lib/helpers.mjs';
import { loadProfile } from '../lib/profiles.mjs';
import {
  casterCandidates,
  casterFor,
  judgeCast,
  sampleSpells,
  selectSpells,
} from '../lib/spells.mjs';

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'spells-cast-all',
  title: 'Every spell can be cast once: chat card, slot taken, caster put back',
  sizes: ['smoke', 'full', 'long'],
  tags: ['build', 'module'],
  needs: ['heroes', 'scene'],
  tools: [],
  gmActions: ['listSpells', 'inspectFeatures', 'exerciseSpell'],
  // Late: the casts post chat cards (deleted again) and the log should not starve other scenarios.
  order: 90,
  timeoutMs: 150 * 60 * 1000,

  async run(t) {
    const profile = loadProfile(t.kit.profile);
    const heroes = builtHeroes(t.kit);
    /** @type {import('../lib/spells.mjs').SpellEntry[]} */
    let selected = [];
    /** @type {any[]} */
    let candidates = [];
    const listing = { listed: 0, packsMissing: /** @type {string[]} */ ([]) };

    await t.step('list the spells and find the casters', async () => {
      const listed = await t.gm('listSpells', { packIds: profile.packs.spells });
      listing.listed = listed.entries.length;
      listing.packsMissing = listed.missing ?? [];
      const all = selectSpells(listed.entries, profile.select);
      selected = t.size === 'smoke' ? sampleSpells(all, 30) : all;
      t.check(all.length > 0, 'the profile has no spells (are its spell packs installed?)', {
        packsMissing: listing.packsMissing,
      });
      const casters = casterCandidates(heroes);
      // No spellcasting hero at all: any hero will do, the cast forces a slot.
      const pool = casters.length ? casters : heroes.slice(0, 1);
      t.check(pool.length > 0, 'the kit has no hero to cast with');
      candidates = [];
      for (const hero of pool)
        candidates.push({ hero, facts: await t.gm('inspectFeatures', { actorId: hero.actorId }) });
      return `${all.length} spells in ${profile.packs.spells.length} pack(s), ${selected.length} to cast, ${candidates.length} caster hero(es)`;
    });

    /** @type {import('../lib/advancement.mjs').Problem[]} */
    const allProblems = [];
    /** @type {Array<{spell: string, level: number, problems: import('../lib/advancement.mjs').Problem[]}>} */
    const failed = [];
    /** @type {Record<number, {spells: number, failed: number}>} */
    const byLevel = {};
    let cast = 0;
    let forced = 0;
    /** @type {Record<string, number>} */
    const skippedBy = {};

    for (let level = 0; level <= 9; level += 1) {
      const ofLevel = selected.filter(s => s.level === level);
      if (!ofLevel.length) continue;
      await t.step(
        `level ${level}: ${ofLevel.length} spell(s)`,
        async () => {
          const row = (byLevel[level] = { spells: ofLevel.length, failed: 0 });
          /** @type {import('../lib/advancement.mjs').Problem[]} */
          const problems = [];
          for (const entry of ofLevel) {
            const who = casterFor(level, candidates);
            /** @type {import('../lib/advancement.mjs').Problem[]} */
            let found;
            try {
              const res = await t.gm('exerciseSpell', {
                actorId: who.hero.actorId,
                sceneId: t.kit.scene.sceneId,
                casts: [{ uuid: entry.uuid }],
              });
              cast += 1;
              if (res.casts?.[0]?.slotForced) forced += 1;
              if (res.casts?.[0]?.skipped) {
                const why = res.casts[0].skipped;
                skippedBy[why] = (skippedBy[why] ?? 0) + 1;
              }
              found = judgeCast(entry, res);
            } catch (e) {
              found = [
                {
                  kind: 'KIT',
                  what: 'the GM action failed',
                  evidence: `${entry.name}: ${e instanceof Error ? e.message : String(e)}`,
                },
              ];
            }
            if (found.length) {
              row.failed += 1;
              failed.push({ spell: entry.name, level, problems: found });
              problems.push(...found);
            }
            if (cast % 50 === 0) t.log(`${cast} of ${selected.length} spells cast`);
          }
          allProblems.push(...problems);
          t.check(problems.length === 0, problemText(problems, 6), { problems });
          return `${ofLevel.length} cast, ${row.failed} with problems`;
        },
        { continueOnFail: true }
      );
    }

    const byKind = countByKind(allProblems);
    t.attach('coverage', {
      profile: t.kit.profile,
      size: t.size,
      spellPacks: profile.packs.spells,
      packsMissing: listing.packsMissing,
      spellsListed: listing.listed,
      spellsCounted: selected.length,
      spellsCast: cast,
      slotsForced: forced,
      leftOut: skippedBy,
      casters: candidates.map(c => `${c.hero.name} (${c.hero.classIdentifier} ${c.hero.level})`),
      byLevel,
      spellsFailed: failed.length,
      problemsByKind: byKind,
      failed: failed.map(f => ({
        spell: f.spell,
        level: f.level,
        problems: f.problems.map(p => `[${p.kind}] ${p.what}: ${p.evidence}`),
      })),
    });
    t.log(
      `${selected.length} spells (${t.size}), ${cast} cast, ${forced} with a forced slot; ${failed.length} failed ` +
        `(${FAILURE_KINDS.map(k => `${k} ${byKind[k]}`).join(', ')})`
    );
  },
};
