/**
 * The odd mechanics of monsters, one check each, over the monsters that have them: legendary
 * actions (the pool, the bridge's view of it, and whether a legendary action spends it: the
 * dashboard's Boss pips depend on that), legendary resistance, lair actions, regeneration,
 * damage threshold, shapechangers, movement modes (fly, swim, burrow, climb, hover), recharge
 * abilities (the system's own recharge roll against its target), multiattack and spellcasting.
 *
 * For each monster of a check the scenario makes a probe copy in the kit world, reads it
 * (inspectFeatures), uses what the mechanic needs (the GM action puts the monster back after each
 * use) and deletes the copy. A check that no monster of the profile applies to passes with
 * "skipped: <reason>" and is listed in the coverage attachment. `smoke` probes two monsters per
 * check (one per movement mode), `full` and `long` all of them.
 * Failures are classified KIT, CONTENT or SYSTEM (lib/monsters.mjs). CONTENT and SYSTEM problems
 * on the profile's known list (lib/known.mjs) are counted, not failed.
 */
import { FAILURE_KINDS, problemText } from '../lib/advancement.mjs';
import { knownAttachment, loadKnown, splitKnown } from '../lib/known.mjs';
import { ODD_CHECKS, monstersOf, pickOddRows, runOddCheck } from '../lib/monsters.mjs';
import { loadProfile } from '../lib/profiles.mjs';

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'monsters-odd',
  title:
    'The odd mechanics: legendary actions and resistance, lair, regeneration, shapechangers, movement, recharge, multiattack, spells',
  sizes: ['smoke', 'full', 'long'],
  tags: ['build', 'module', 'bridge'],
  needs: [],
  tools: ['get-character'],
  gmActions: [
    'ensureFolder',
    'listMonsters',
    'createMonster',
    'inspectFeatures',
    'exerciseActor',
    'deleteMonsters',
  ],
  // Last: the uses post chat cards, and a big play log can overflow the control channel.
  order: 100,
  timeoutMs: 3 * 60 * 60 * 1000,

  async run(t) {
    const profile = loadProfile(t.kit.profile);
    const { rows } = await monstersOf(t, profile.packs.monsters);
    const { folderId } = await t.gm('ensureFolder', { type: 'Actor', name: 'Kit Monster Probes' });
    const io = {
      call: (/** @type {string} */ action, /** @type {object} */ args) => t.gm(action, args),
      tool: (/** @type {string} */ name, /** @type {object} */ args) => t.tool(name, args),
      folderId,
    };
    const byKind = Object.fromEntries(FAILURE_KINDS.map(k => [k, 0]));
    const knownList = loadKnown(t.kit.profile);
    /** @type {Map<string, number>} known entry id -> problems it covered in this run */
    const hits = new Map();
    /** @type {Array<{check: string, applicable: number, probed: number, failed: string[], notes: string[], known?: number, skippedBecause?: string}>} */
    const coverage = [];

    for (const check of ODD_CHECKS) {
      await t.step(
        `${check.id}: ${check.title}`,
        async () => {
          const applicable = rows.filter(check.applies);
          if (!applicable.length) {
            coverage.push({
              check: check.id,
              applicable: 0,
              probed: 0,
              failed: [],
              notes: [],
              skippedBecause: check.none,
            });
            return `skipped: ${check.none}`;
          }
          const picked = pickOddRows(check, rows, t.size);
          const r = await runOddCheck(check, picked, io);
          // A monster whose problems are all on the known list is counted, not failed.
          let knownHere = 0;
          /** @type {string[]} */
          const knownIds = [];
          const fresh = r.failed.flatMap(f => {
            const split = splitKnown(f.problems, knownList, 'monsters-odd', hits);
            knownHere += split.known.length;
            knownIds.push(...split.known.map(k => k.id));
            return split.fresh.length ? [{ row: f.row, problems: split.fresh }] : [];
          });
          const failed = fresh.map(f => `${f.row.name}: ${problemText(f.problems, 3)}`);
          for (const f of fresh) for (const p of f.problems) byKind[p.kind] += 1;
          coverage.push({
            check: check.id,
            applicable: applicable.length,
            probed: r.checked.length,
            failed,
            notes: r.notes.slice(0, 500).map(n => `${n.name}: ${n.note}`),
            ...(knownHere ? { known: knownHere } : {}),
          });
          t.check(
            fresh.length === 0,
            `${fresh.length} of ${r.checked.length} monster(s) failed: ${failed.slice(0, 3).join(' || ')}${failed.length > 3 ? ` || and ${failed.length - 3} more` : ''}`,
            { failed }
          );
          const sample = r.notes
            .slice(0, 2)
            .map(n => n.note)
            .join('; ');
          const note = knownHere
            ? `; ${knownHere} known finding(s): ${[...new Set(knownIds)].join(', ')}`
            : '';
          return `${r.checked.length} of ${applicable.length} monster(s) probed${sample ? `: ${sample}` : ''}${note}`;
        },
        { continueOnFail: true }
      );
    }

    const skipped = coverage
      .filter(c => c.skippedBecause)
      .map(c => `${c.check}: ${c.skippedBecause}`);
    t.attach('coverage', {
      profile: t.kit.profile,
      size: t.size,
      monsters: rows.length,
      checks: ODD_CHECKS.length,
      checksRun: coverage.length - skipped.length,
      checksSkipped: skipped,
      problemsByKind: byKind,
      perCheck: coverage,
    });
    t.attach('known', knownAttachment(knownList, 'monsters-odd', hits));
    t.log(
      `${ODD_CHECKS.length} odd checks, ${coverage.length - skipped.length} ran, ${skipped.length} skipped; ` +
        `problems: ${FAILURE_KINDS.map(k => `${k} ${byKind[k]}`).join(', ')}`
    );
  },
};
