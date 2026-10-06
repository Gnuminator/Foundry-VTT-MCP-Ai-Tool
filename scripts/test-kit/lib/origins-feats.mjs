/**
 * The run behind the feat scenario (slice 3c): every feat of the profile is added, one at a time, to
 * a copy of a host hero that meets its prerequisites; the result is checked against the feat's own
 * data and what it granted is used once. A feat no host can take is recorded, never forced.
 */
import { problemText } from './advancement.mjs';
import { FEAT_HOSTS, HOST_FLOOR, checkOrigin, sampleFeats } from './origins.mjs';
import {
  buildFailure,
  deleteHero,
  expectedFindings,
  loadOriginContext,
  newLedger,
  useGranted,
} from './origins-flow.mjs';

/**
 * @param {import('./contract.mjs').ScenarioContext} t
 */
export async function runFeats(t) {
  const ctx = await loadOriginContext(t);
  const packs = ctx.profile.packs.feats;
  await t.step('the feat packs of the profile are installed and have feats', async () => {
    t.check(
      ctx.feats.missing.length === 0,
      `[CONTENT] pack not installed: ${ctx.feats.missing.join(', ')}`,
      {
        missing: ctx.feats.missing,
      }
    );
    t.check(ctx.feats.entries.length > 0, `[CONTENT] no feat in ${packs.join(', ')}`);
    /** @type {Record<string, number>} */
    const byType = {};
    for (const f of ctx.feats.entries)
      byType[f.featType ?? 'general'] = (byType[f.featType ?? 'general'] ?? 0) + 1;
    t.attach('feats-by-type', byType);
    return `${packs.length} packs, ${ctx.feats.entries.length} feats (${Object.entries(byType)
      .map(([k, n]) => `${k} ${n}`)
      .join(', ')})`;
  });
  const list = t.size === 'smoke' ? sampleFeats(ctx.feats.entries) : ctx.feats.entries;
  t.log(`${list.length} of ${ctx.feats.entries.length} feats (${t.size})`);

  /** @type {Map<string, {actorId: string, build: any} | null>} */
  const hosts = new Map();
  /** @type {string[]} */
  const made = [];
  t.cleanup(async () => {
    for (const id of made) await deleteHero(t, id);
  });

  /** The host hero of a spec, built once; null when the profile has no such class. @param {{id: string, classId: string, level: number}} spec */
  const hostOf = async spec => {
    if (hosts.has(spec.id)) return hosts.get(spec.id) ?? null;
    const klass = ctx.classOf(spec.classId);
    if (!klass) {
      hosts.set(spec.id, null);
      return null;
    }
    const sub = ctx.subclassOf(klass);
    const hero = await t.gm('createHero', {
      name: `Kit Feat Host ${spec.id}`,
      classUuid: klass.uuid,
      ...(sub && spec.level >= 3 ? { subclassUuid: sub.uuid } : {}),
      level: spec.level,
      rotation: 0,
      folderId: ctx.folderId,
      featPackIds: packs,
    });
    made.push(hero.actorId);
    const host = {
      actorId: hero.actorId,
      build: await t.gm('inspectBuild', { actorId: hero.actorId }),
    };
    hosts.set(spec.id, host);
    return host;
  };

  /**
   * A copy of a host that meets the feat's prerequisites, or why none does.
   * @param {{uuid: string, name: string}} entry
   * @returns {Promise<{clone: string, host: string, boosted: boolean, dropped: boolean} | {unmet: string}>}
   */
  const findHost = async entry => {
    const reasons = [];
    for (const spec of FEAT_HOSTS) {
      const host = await hostOf(spec);
      if (!host) {
        reasons.push(`${spec.id}: no ${spec.classId} in the profile`);
        continue;
      }
      const has = (host.build.items ?? []).some(
        (/** @type {any} */ i) =>
          i.type === 'feat' && i.name.toLowerCase() === entry.name.toLowerCase()
      );
      for (const boosted of [false, true]) {
        // The host already has this feat (its background gave it): a copy without it.
        const needCopy = boosted || has;
        const target = needCopy
          ? (
              await t.gm('cloneHero', {
                actorId: host.actorId,
                name: `Kit Feat Probe ${spec.id}`,
                folderId: ctx.folderId,
                ...(boosted ? { abilityFloor: HOST_FLOOR } : {}),
                ...(has ? { drop: [entry.name] } : {}),
              })
            ).actorId
          : host.actorId;
        if (needCopy) made.push(target);
        const probe = await t.gm('describeOrigin', { uuid: entry.uuid, actorId: target });
        if (probe.actor?.prerequisitesMet) {
          if (needCopy) return { clone: target, host: spec.id, boosted, dropped: has };
          const copy = await t.gm('cloneHero', {
            actorId: host.actorId,
            name: `Kit Feat ${entry.name}`,
            folderId: ctx.folderId,
          });
          made.push(copy.actorId);
          return { clone: copy.actorId, host: spec.id, boosted, dropped: false };
        }
        reasons.push(
          `${spec.id}${boosted ? ' (scores 15)' : ''}: ${probe.actor?.detail || 'not met'}`
        );
        if (needCopy) {
          await deleteHero(t, target);
          made.splice(made.indexOf(target), 1);
        }
      }
    }
    return { unmet: reasons.slice(-4).join(' | ') };
  };

  const ledger = newLedger('feats', expectedFindings());
  /** @type {Array<{name: string, featType: string, why: string}>} */
  const unmet = [];
  /** @type {Record<string, number>} */
  const byHost = {};
  /** @type {Record<string, number>} */
  const leftOut = {};
  /** @type {Set<string>} */
  const notes = new Set();
  let used = 0;
  let features = 0;
  let taken = 0;

  for (const [i, entry] of list.entries()) {
    await t.step(
      `${entry.name} (${entry.featType ?? 'general'}, ${entry.packId})`,
      async () => {
        /** @type {import('./advancement.mjs').Problem[]} */
        let problems = [];
        let detail = '';
        let clone = '';
        try {
          const found = await findHost(entry);
          if ('unmet' in found) {
            unmet.push({
              name: entry.name,
              featType: entry.featType ?? 'general',
              why: found.unmet,
            });
            return `skipped: no host meets the prerequisites (${found.unmet})`;
          }
          clone = found.clone;
          byHost[found.host + (found.boosted ? '+' : '')] =
            (byHost[found.host + (found.boosted ? '+' : '')] ?? 0) + 1;
          const desc = await t.gm('describeOrigin', { uuid: entry.uuid });
          const beforeBuild = await t.gm('inspectBuild', { actorId: clone });
          const beforeActor = await t.gm('inspectActor', { actorId: clone });
          const hero = await t.gm('createHero', {
            actorId: clone,
            items: [{ uuid: entry.uuid }],
            rotation: i,
            featPackIds: packs,
          });
          taken += 1;
          const build = await t.gm('inspectBuild', { actorId: clone });
          const actor = await t.gm('inspectActor', { actorId: clone });
          const facts = await t.gm('inspectFeatures', { actorId: clone });
          const base = Object.fromEntries(
            Object.entries(beforeActor.abilities).map(([id, a]) => [
              id,
              /** @type {any} */ (a).value,
            ])
          );
          const checked = checkOrigin({
            kind: 'feat',
            uuid: entry.uuid,
            desc,
            hero,
            build,
            actor,
            base,
            hostBuild: beforeBuild,
          });
          problems = checked.problems;
          for (const n of checked.notes) notes.add(`${entry.name}: ${n}`);
          const use = await useGranted(t, {
            actorId: clone,
            facts,
            build,
            rootLabel: `feat:${entry.name}`,
          });
          problems.push(...use.problems);
          used += use.used;
          features += use.features;
          for (const s of use.leftOut) {
            const key = `${s.activity}: ${s.why}`;
            leftOut[key] = (leftOut[key] ?? 0) + 1;
          }
          detail = `${found.host}${found.boosted ? ' with scores 15' : ''}: ${checked.summary}; ${use.used} activities used`;
        } catch (e) {
          problems.push(buildFailure(e));
        } finally {
          if (clone) {
            await deleteHero(t, clone);
            const at = made.indexOf(clone);
            if (at >= 0) made.splice(at, 1);
          }
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
    found: ctx.feats.entries.length,
    checked: list.length,
    taken,
    unmetPrerequisites: unmet,
    takenOnHost: byHost,
    featuresWithActivities: features,
    activitiesUsed: used,
    leftOut,
    problemsByKind: byKind,
    expectedFindings: ledger.expectedCounts,
    failed: ledger.failed,
    notes: [...notes].slice(0, 80),
  });
  t.log(
    `${taken} of ${list.length} feats taken (${unmet.length} no host could take), ${used} activities used; KIT ${byKind.KIT}, CONTENT ${byKind.CONTENT}, SYSTEM ${byKind.SYSTEM}`
  );
}
