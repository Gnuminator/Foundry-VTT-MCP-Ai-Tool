/**
 * The run behind the species and background scenarios (slice 3c): one hero per species or per
 * background, a level 1 hero of the profile's fighter (else its first class), made through the
 * system's advancement with that origin, then checked against the origin's own data and its granted
 * features used once.
 */
import { problemText } from './advancement.mjs';
import { loadKnown } from './known.mjs';
import { checkOrigin, sampleEvenly } from './origins.mjs';
import {
  STANDARD_ARRAY,
  buildFailure,
  deleteHero,
  expectedFindings,
  loadOriginContext,
  newLedger,
  useGranted,
} from './origins-flow.mjs';

/** How many of each kind a smoke run takes. */
export const SMOKE_COUNT = { species: 3, background: 2 };

/**
 * @param {import('./contract.mjs').ScenarioContext} t
 * @param {'species'|'background'} kind
 */
export async function runOriginList(t, kind) {
  const ctx = await loadOriginContext(t);
  const rows = kind === 'species' ? ctx.species : ctx.backgrounds;
  const packs = kind === 'species' ? ctx.profile.packs.species : ctx.profile.packs.backgrounds;
  await t.step(`the ${kind} packs of the profile are installed and have entries`, async () => {
    t.check(rows.missing.length === 0, `[CONTENT] pack not installed: ${rows.missing.join(', ')}`, {
      missing: rows.missing,
    });
    t.check(rows.entries.length > 0, `[CONTENT] no ${kind} in ${packs.join(', ')}`);
    return `${packs.length} packs, ${rows.entries.length} entries`;
  });
  const hostClass = ctx.classOf('fighter') ?? ctx.classes[0];
  if (!hostClass) t.skip('the profile has no class to build a hero with');
  const list = t.size === 'smoke' ? sampleEvenly(rows.entries, SMOKE_COUNT[kind]) : rows.entries;
  t.log(`${list.length} of ${rows.entries.length} ${kind} entries (${t.size})`);
  const ledger = newLedger(kind, expectedFindings(), {
    list: loadKnown(t.kit.profile),
    scenario: `origins-${kind}`,
  });
  /** @type {Record<string, number>} */
  const leftOut = {};
  /** @type {Set<string>} */
  const notes = new Set();
  let used = 0;
  let features = 0;

  for (const [i, entry] of list.entries()) {
    await t.step(
      `${entry.name} (${entry.packId})`,
      async () => {
        /** @type {import('./advancement.mjs').Problem[]} */
        let problems = [];
        let detail = '';
        let actorId = '';
        try {
          const desc = await t.gm('describeOrigin', { uuid: entry.uuid });
          const hero = await t.gm('createHero', {
            name: `Kit ${kind} ${i + 1}: ${entry.name}`,
            classUuid: hostClass.uuid,
            level: 1,
            rotation: i,
            folderId: ctx.folderId,
            featPackIds: ctx.profile.packs.feats,
            abilities: STANDARD_ARRAY,
            chooseSize: kind === 'species',
            ...(kind === 'species' ? { speciesUuid: entry.uuid } : { backgroundUuid: entry.uuid }),
          });
          actorId = hero.actorId;
          const build = await t.gm('inspectBuild', { actorId });
          const actor = await t.gm('inspectActor', { actorId });
          const facts = await t.gm('inspectFeatures', { actorId });
          const size = (hero.picks ?? []).find((/** @type {any} */ p) => p.advancement === 'Size')
            ?.chosen?.[0];
          const checked = checkOrigin({
            kind,
            uuid: entry.uuid,
            desc,
            hero,
            build,
            actor,
            base: STANDARD_ARRAY,
            chosenSize: size ?? null,
          });
          problems = checked.problems;
          for (const n of checked.notes) notes.add(`${entry.name}: ${n}`);
          // A feat the origin grants (an origin feat) is checked against its own data too.
          for (const adv of desc.advancements ?? []) {
            for (const g of adv.type === 'ItemGrant' ? (adv.items ?? []) : []) {
              if (!g.playerFeat || !g.resolved || g.optional || adv.optional) continue;
              const featDesc = await t.gm('describeOrigin', { uuid: g.uuid });
              const featChecked = checkOrigin({
                kind: 'feat',
                uuid: g.uuid,
                desc: featDesc,
                hero,
                build,
                actor,
                base: STANDARD_ARRAY,
                skipScores: true,
              });
              problems.push(...featChecked.problems);
              for (const n of featChecked.notes) notes.add(`${entry.name} / ${g.name}: ${n}`);
            }
          }
          const use = await useGranted(t, {
            actorId,
            facts,
            build,
            rootLabel: `${kind === 'species' ? 'race' : 'background'}:${entry.name}`,
          });
          problems.push(...use.problems);
          used += use.used;
          features += use.features;
          for (const s of use.leftOut) {
            const key = `${s.activity}: ${s.why}`;
            leftOut[key] = (leftOut[key] ?? 0) + 1;
          }
          detail = `${checked.summary}; ${use.used} activities used`;
        } catch (e) {
          problems.push(buildFailure(e));
        } finally {
          await deleteHero(t, actorId);
        }
        const fresh = ledger.file(entry.name, problems);
        t.check(fresh.length === 0, problemText(fresh, 6), { problems: fresh });
        return detail;
      },
      { continueOnFail: true }
    );
  }
  const byKind = ledger.byKind();
  t.attach('coverage', {
    profile: t.kit.profile,
    kind,
    found: rows.entries.length,
    checked: list.length,
    featuresWithActivities: features,
    activitiesUsed: used,
    leftOut,
    problemsByKind: byKind,
    expectedFindings: ledger.expectedCounts,
    knownFindings: ledger.known(),
    failed: ledger.failed,
    notes: [...notes].slice(0, 80),
  });
  t.log(
    `${list.length} ${kind} heroes, ${used} activities used; KIT ${byKind.KIT}, CONTENT ${byKind.CONTENT}, SYSTEM ${byKind.SYSTEM}`
  );
}
