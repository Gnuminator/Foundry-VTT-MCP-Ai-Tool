/**
 * Every monster of every compendium pack of the content profile is copied into the kit world,
 * uses one action and is deleted again. The one action is an attack when the monster has one,
 * else the first activity that runs with no dialog (no template, no summons, no roll after the
 * card, no action cost). For each monster the scenario checks:
 *
 * - the world copy equals the compendium entry (challenge rating, type, size, hit points, armor
 *   class, movement, legendary pools, lair, number of items),
 * - the action ran: no error, a chat card, the uses it says it consumes,
 * - the monster is exactly as before (uses, hit points, effects, new items and chat messages are
 *   put back; the GM action says when that failed),
 * - the bridge tool get-character agrees with Foundry (challenge rating, type, size, hit points,
 *   armor class, legendary pool, spells).
 *
 * Failures are classified KIT, CONTENT or SYSTEM (lib/monsters.mjs). CONTENT and SYSTEM problems
 * on the profile's known list (lib/known.mjs) are counted, not failed. The `smoke` size takes a
 * sample (the first monster of each challenge rating band, creature type, size and trait);
 * `full` and `long` take every monster. Monster names stay in the local report.
 */
import { FAILURE_KINDS, countByKind, problemText } from '../lib/advancement.mjs';
import { knownAttachment, loadKnown, splitKnown } from '../lib/known.mjs';
import {
  crBand,
  fmtCr,
  judgeBridge,
  judgeCopy,
  judgeNoAction,
  monstersOf,
  planMonsterUse,
  sampleMonsters,
} from '../lib/monsters.mjs';
import { judgeUse } from '../lib/features.mjs';
import { loadProfile } from '../lib/profiles.mjs';

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'monsters-every',
  title: 'Every monster of the profile can be added and use one action; the bridge agrees',
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
  // Last: thousands of chat cards fill the play log, and a big log can overflow the control channel.
  order: 100,
  timeoutMs: 6 * 60 * 60 * 1000,

  async run(t) {
    const profile = loadProfile(t.kit.profile);
    const packs = profile.packs.monsters;
    const { rows: all, missing } = await monstersOf(t, packs);
    await t.step('every monster pack of the profile is installed', async () => {
      t.check(missing.length === 0, `[CONTENT] pack not installed: ${missing.join(', ')}`, {
        missing,
      });
      return `${packs.length} packs, ${all.length} monsters`;
    });
    const rows = t.size === 'smoke' ? sampleMonsters(all) : all;
    t.log(`${rows.length} of ${all.length} monsters (${t.size})`);
    const { folderId } = await t.gm('ensureFolder', { type: 'Actor', name: 'Kit Monster Probes' });

    /** @type {string | null} */
    let current = null;
    t.cleanup(async () => {
      if (current) await t.gm('deleteMonsters', { actorIds: [current] }).catch(() => {});
    });

    const knownList = loadKnown(t.kit.profile);
    /** @type {Map<string, number>} known entry id -> problems it covered in this run */
    const hits = new Map();
    /** @type {import('../lib/advancement.mjs').Problem[]} */
    const allProblems = [];
    /** @type {Array<{monster: string, pack: string, cr: string, problems: string[]}>} */
    const failed = [];
    /** @type {Record<string, number>} */
    const whatBy = {};
    /** @type {Record<string, number>} */
    const leftOut = {};
    /** @type {Record<string, {monsters: number, failed: number}>} */
    const byBand = {};
    let used = 0;
    let withoutAction = 0;
    let bridgeChecked = 0;
    /** @type {string[]} */
    const bridgeNotes = [];

    for (const row of rows) {
      await t.step(
        `${row.name} (${row.packId}, CR ${fmtCr(row.cr)})`,
        async () => {
          /** @type {import('../lib/advancement.mjs').Problem[]} */
          const problems = [];
          let detail = '';
          try {
            const made = await t.gm('createMonster', {
              packId: row.packId,
              itemId: row.id,
              folderId,
            });
            current = made.actorId;
            const facts = await t.gm('inspectFeatures', { actorId: made.actorId });
            problems.push(...judgeCopy(row, facts));

            const plan = planMonsterUse(facts);
            for (const s of plan.skipped) {
              const key = `${s.activity}: ${s.why}`;
              leftOut[key] = (leftOut[key] ?? 0) + 1;
            }
            if (!plan.planned) {
              withoutAction += 1;
              problems.push(...judgeNoAction(row, facts, plan));
              detail = 'no usable action';
            } else {
              const result = await t.gm('exerciseActor', {
                actorId: made.actorId,
                op: 'use',
                itemId: plan.planned.item.id,
                activityId: plan.planned.activity.id,
              });
              used += 1;
              problems.push(...judgeUse(plan.planned, result));
              const spent =
                typeof result.uses?.before === 'number' && typeof result.uses?.after === 'number'
                  ? result.uses.after - result.uses.before
                  : 0;
              detail = `${plan.planned.item.name} (${plan.planned.activity.type}), ${spent} use(s) spent, ${plan.skipped.length} left out`;
            }

            try {
              const reply = await t.tool('get-character', { identifier: made.actorId });
              bridgeChecked += 1;
              problems.push(...judgeBridge(row, reply, bridgeNotes));
            } catch (e) {
              problems.push({
                kind: 'SYSTEM',
                what: 'the bridge could not read the monster',
                evidence: `${row.name}: ${e instanceof Error ? e.message : String(e)}`,
              });
            }
          } catch (e) {
            problems.push({
              kind: 'KIT',
              what: 'the probe failed',
              evidence: `${row.name}: ${e instanceof Error ? e.message : String(e)}`,
            });
          } finally {
            if (current) await t.gm('deleteMonsters', { actorIds: [current] }).catch(() => {});
            current = null;
          }

          const { fresh, known } = splitKnown(problems, knownList, 'monsters-every', hits);
          const band = crBand(row.cr);
          byBand[band] ??= { monsters: 0, failed: 0 };
          byBand[band].monsters += 1;
          if (fresh.length) {
            byBand[band].failed += 1;
            allProblems.push(...fresh);
            for (const p of fresh) {
              const key = `${p.kind} ${p.what}`;
              whatBy[key] = (whatBy[key] ?? 0) + 1;
            }
            failed.push({
              monster: row.name,
              pack: row.packId,
              cr: fmtCr(row.cr),
              problems: fresh.map(p => `[${p.kind}] ${p.what}: ${p.evidence}`),
            });
          }
          t.check(fresh.length === 0, problemText(fresh, 6), { problems: fresh });
          const note = known.length
            ? `; ${known.length} known finding(s): ${[...new Set(known.map(k => k.id))].join(', ')}`
            : '';
          return `${detail}${note}`;
        },
        { continueOnFail: true }
      );
    }

    const byKind = countByKind(allProblems);
    t.attach('coverage', {
      profile: t.kit.profile,
      size: t.size,
      monstersInProfile: all.length,
      monstersProbed: rows.length,
      actionsUsed: used,
      withoutAction,
      bridgeChecked,
      bridgeNotes: Object.fromEntries(
        [...new Set(bridgeNotes)].map(n => [n, bridgeNotes.filter(x => x === n).length])
      ),
      monstersFailed: failed.length,
      problemsByKind: byKind,
      problemsByWhat: Object.fromEntries(Object.entries(whatBy).sort((a, b) => b[1] - a[1])),
      leftOut: Object.fromEntries(Object.entries(leftOut).sort((a, b) => b[1] - a[1])),
      byBand,
      failed: failed.slice(0, 500),
    });
    t.attach('known', knownAttachment(knownList, 'monsters-every', hits));
    t.log(
      `${rows.length} monsters probed, ${used} actions used, ${failed.length} monsters failed ` +
        `(${FAILURE_KINDS.map(k => `${k} ${byKind[k]}`).join(', ')}), ` +
        `${[...hits.values()].reduce((a, b) => a + b, 0)} known findings`
    );
  },
};
