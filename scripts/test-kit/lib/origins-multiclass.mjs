/**
 * The run behind the multiclass scenario (slice 3c): heroes built by taking a first class and then
 * leveling into one or two more through the system's advancement (createHero on the existing hero),
 * checked for the multiclass prerequisites the kit set, the proficiencies a further class gives (the
 * reduced set), the combined spell slot table with Pact Magic kept apart, hit points, hit dice and
 * the features of every class.
 */
import { problemText } from './advancement.mjs';
import {
  MULTICLASS_PLAN,
  checkMulticlass,
  checkMulticlassProficiencies,
  multiclassAbilities,
} from './origins.mjs';
import {
  buildFailure,
  deleteHero,
  expectedFindings,
  loadOriginContext,
  newLedger,
} from './origins-flow.mjs';
import { judgeUse, planUses } from './features.mjs';

/**
 * @param {import('./contract.mjs').ScenarioContext} t
 */
export async function runMulticlass(t) {
  const ctx = await loadOriginContext(t);
  const plan = t.size === 'smoke' ? MULTICLASS_PLAN.filter(c => c.smoke) : MULTICLASS_PLAN;
  t.log(`${plan.length} of ${MULTICLASS_PLAN.length} combinations (${t.size})`);
  const ledger = newLedger('multiclass', expectedFindings());
  /** @type {Record<string, number>} */
  const leftOut = {};
  /** @type {Set<string>} */
  const notes = new Set();
  /** @type {Array<{id: string, why: string}>} */
  const skippedCombos = [];
  /** @type {Array<{id: string, classes: string, casterLevel?: number}>} */
  const built = [];
  let used = 0;

  /** The level a class asks for its subclass, from the data (cached). @type {Map<string, number | null>} */
  const subclassAtOf = new Map();
  const subclassAt = async (/** @type {{uuid: string}} */ c) => {
    if (!subclassAtOf.has(c.uuid)) {
      const d = await t.gm('describeClass', { classUuid: c.uuid, level: 20 });
      subclassAtOf.set(c.uuid, d.expected.subclassAt ?? null);
    }
    return subclassAtOf.get(c.uuid) ?? null;
  };

  /** The first subclass of fighter or rogue that casts as a third caster, or null. */
  const thirdCasterSubclass = async () => {
    for (const id of ['fighter', 'rogue']) {
      const klass = ctx.classOf(id);
      if (!klass) continue;
      for (const s of ctx.subclasses.filter(x => x.classEntry?.uuid === klass.uuid)) {
        const d = await t.gm('describeClass', {
          classUuid: klass.uuid,
          subclassUuid: s.entry.uuid,
          level: 20,
        });
        if (d.expected.spellcasting?.progression === 'third') return { klass, subclass: s.entry };
      }
    }
    return null;
  };

  for (const [index, combo] of plan.entries()) {
    const label = `${combo.id}: ${combo.classes.map(([c, l]) => `${c} ${l}`).join(' / ')}`;
    await t.step(
      label,
      async () => {
        let actorId = '';
        /** @type {import('./advancement.mjs').Problem[]} */
        let problems = [];
        let detail = '';
        try {
          // The classes of the combination, from the profile.
          /** @type {Array<{entry: any, level: number, subclass: any}>} */
          const parts = [];
          const third = combo.third ? await thirdCasterSubclass() : null;
          if (combo.third && !third) return 'skipped: the profile has no third caster subclass';
          for (const [identifier, level] of combo.classes) {
            const entry = ctx.classOf(identifier);
            if (!entry) {
              skippedCombos.push({ id: combo.id, why: `no ${identifier} in the profile` });
              return `skipped: the profile has no ${identifier}`;
            }
            const at = await subclassAt(entry);
            const wants = at !== null && level >= at;
            const subclass =
              third && third.klass.uuid === entry.uuid
                ? third.subclass
                : wants
                  ? ctx.subclassOf(entry)
                  : null;
            parts.push({ entry, level, subclass: wants || subclass ? subclass : null });
          }
          const descs = [];
          for (const p of parts) descs.push(await t.gm('describeOrigin', { uuid: p.entry.uuid }));
          const base = multiclassAbilities(descs);

          // The first class, then every other class on top of it.
          const first = await t.gm('createHero', {
            name: `Kit Multiclass ${combo.id}`,
            classUuid: parts[0].entry.uuid,
            ...(parts[0].subclass ? { subclassUuid: parts[0].subclass.uuid } : {}),
            level: parts[0].level,
            rotation: index,
            folderId: ctx.folderId,
            featPackIds: ctx.profile.packs.feats,
            abilities: base,
          });
          actorId = first.actorId;
          /** @type {any[]} */
          const picksOf = [first.picks ?? []];
          const warnings = [...(first.warnings ?? [])];
          for (let i = 1; i < parts.length; i += 1) {
            const before = await t.gm('inspectBuild', { actorId });
            const added = await t.gm('createHero', {
              actorId,
              items: [
                {
                  uuid: parts[i].entry.uuid,
                  level: parts[i].level,
                  ...(parts[i].subclass ? { subclassUuid: parts[i].subclass.uuid } : {}),
                },
              ],
              rotation: index + i,
              featPackIds: ctx.profile.packs.feats,
            });
            picksOf.push(added.picks ?? []);
            warnings.push(...(added.warnings ?? []));
            const after = await t.gm('inspectBuild', { actorId });
            // A feature the hero chose (a Divine Order, say) may carry proficiencies of its own: they are
            // the feature's, not the multiclass set's.
            const chosenNames = new Set(
              (added.picks ?? [])
                .filter((/** @type {any} */ p) => p.advancement === 'ItemChoice')
                .flatMap((/** @type {any} */ p) => p.chosen ?? [])
                .map((/** @type {string} */ n) => String(n).toLowerCase())
            );
            const featureGrants = [];
            // The class's own subclass (a Way that grants a tool, say) carries proficiencies too.
            if (parts[i].subclass) {
              const sub = await t
                .gm('describeOrigin', { uuid: parts[i].subclass.uuid })
                .catch(() => ({ advancements: [] }));
              for (const a of sub.advancements ?? [])
                if (a.type === 'Trait' && (!a.mode || a.mode === 'default'))
                  featureGrants.push(...(a.grants ?? []));
              for (const e of sub.effects ?? []) featureGrants.push(...(e.profs ?? []));
            }
            for (const item of after.items ?? []) {
              if (!item.sourceUuid || !chosenNames.has(String(item.name).toLowerCase())) continue;
              // A feature the data cannot describe adds no grants; any proficiency it gave then shows as extra.
              const feature = await t
                .gm('describeOrigin', { uuid: item.sourceUuid })
                .catch(() => ({ advancements: [] }));
              for (const a of feature.advancements ?? [])
                if (a.type === 'Trait' && (!a.mode || a.mode === 'default'))
                  featureGrants.push(...(a.grants ?? []));
              for (const e of feature.effects ?? []) featureGrants.push(...(e.profs ?? []));
            }
            const prof = checkMulticlassProficiencies({
              desc: descs[i],
              before,
              after,
              picks: added.picks ?? [],
              className: parts[i].entry.name,
              featureGrants,
            });
            problems.push(...prof.problems);
            for (const n of prof.notes) notes.add(`${combo.id}: ${n}`);
          }

          const actor = await t.gm('inspectActor', { actorId });
          const facts = await t.gm('inspectFeatures', { actorId });
          const build = await t.gm('inspectBuild', { actorId });
          const classes = [];
          for (const [i, p] of parts.entries()) {
            const d = await t.gm('describeClass', {
              classUuid: p.entry.uuid,
              ...(p.subclass ? { subclassUuid: p.subclass.uuid } : {}),
              level: p.level,
              ...(i > 0 ? { multiclass: true } : {}),
            });
            classes.push({
              identifier: p.entry.identifier,
              name: p.entry.name,
              levels: p.level,
              rules: p.entry.rules === '2024' ? '2024' : '2014',
              expected: d.expected,
              desc: descs[i],
              picks: picksOf[i],
            });
          }
          const checked = checkMulticlass({ classes, actor, facts, build, base, warnings });
          problems.push(...checked.problems);
          for (const n of checked.notes) notes.add(`${combo.id}: ${n}`);
          detail = checked.summary;
          built.push({
            id: combo.id,
            classes: combo.classes.map(([c, l]) => `${c} ${l}`).join(' / '),
          });

          // The features each added class gave, used once.
          const names = new Set(
            classes
              .slice(1)
              .flatMap(c =>
                (c.expected.grants ?? []).map((/** @type {any} */ g) =>
                  String(g.name).toLowerCase()
                )
              )
          );
          const own = {
            ...facts,
            items: facts.items.filter((/** @type {any} */ i) => names.has(i.name.toLowerCase())),
          };
          const usable = planUses(own);
          for (const s of usable.skipped) {
            const key = `${s.activity}: ${s.why}`;
            leftOut[key] = (leftOut[key] ?? 0) + 1;
          }
          for (const planned of usable.use.slice(0, 12)) {
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
        } catch (e) {
          problems.push(buildFailure(e));
        } finally {
          await deleteHero(t, actorId);
        }
        const fresh = ledger.file(label, problems);
        t.check(fresh.length === 0, problemText(fresh, 6), { problems: fresh });
        return detail;
      },
      { continueOnFail: true }
    );
  }
  const byKind = ledger.byKind();
  t.attach('coverage', {
    profile: t.kit.profile,
    combinations: plan.length,
    built: built.length,
    skippedCombinations: skippedCombos,
    activitiesUsed: used,
    leftOut,
    problemsByKind: byKind,
    expectedFindings: ledger.expectedCounts,
    failed: ledger.failed,
    notes: [...notes].slice(0, 80),
  });
  t.log(
    `${built.length} of ${plan.length} multiclass heroes built, ${used} activities used; KIT ${byKind.KIT}, CONTENT ${byKind.CONTENT}, SYSTEM ${byKind.SYSTEM}`
  );
}
