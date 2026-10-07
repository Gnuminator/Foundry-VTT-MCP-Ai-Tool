/**
 * The runs the origin scenarios share (slice 3c): reading the profile's classes and origins, making a
 * kit hero for a species, background or feat, using what the origin granted once, and sorting the
 * findings into the ones the expected-findings list accepts and the new ones.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyBuildError, countByKind } from './advancement.mjs';
import { selectContent } from './builder.mjs';
import { judgeUse, planUses } from './features.mjs';
import { knownAttachment, splitKnown } from './known.mjs';
import { loadExpected } from './studio-expected.mjs';
import { splitExpected } from './studio-compare.mjs';
import { descendants, itemsOfLabels, selectOrigins, withIds } from './origins.mjs';
import { loadProfile } from './profiles.mjs';

/** The scenario context's shape, as far as this file uses it. @typedef {import('./contract.mjs').ScenarioContext} T */

/** The standard array the hero builder gives every hero. */
export const STANDARD_ARRAY = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };

/** The file of expected findings of the origin scenarios. */
export const ORIGINS_EXPECTED_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'data',
  'origins-expected.json'
);

/** Folder every kit origin hero goes into. */
export const ORIGIN_FOLDER = 'Kit Origin Heroes';

/**
 * What the origin scenarios read from the profile: the classes (and their subclasses), the species,
 * backgrounds and feats after the profile's selection, and the folder for the heroes.
 * @param {T} t
 */
export async function loadOriginContext(t) {
  const profile = loadProfile(t.kit.profile);
  const list = async (/** @type {string[]} */ packIds, /** @type {string} */ type) =>
    (await t.gm('listCompendium', { packIds, type })).entries;
  const classEntries = await list(profile.packs.classes, 'class');
  const subclassEntries = await list(profile.packs.subclasses, 'subclass');
  const content = selectContent({
    classes: classEntries,
    subclasses: subclassEntries,
    select: profile.select,
  });
  const origins = async (
    /** @type {'species'|'background'|'feat'} */ kind,
    /** @type {string[]} */ packIds
  ) => {
    const reply = await t.gm('listOrigins', { packIds, kind });
    return { entries: selectOrigins(reply.entries, profile.select), missing: reply.missing ?? [] };
  };
  const { folderId } = await t.gm('ensureFolder', { type: 'Actor', name: ORIGIN_FOLDER });
  return {
    profile,
    classes: content.classes,
    subclasses: content.subclasses,
    species: await origins('species', profile.packs.species),
    backgrounds: await origins('background', profile.packs.backgrounds),
    feats: await origins('feat', profile.packs.feats),
    folderId,
    /** The class of an identifier (the 2024 one when both exist), or null. @param {string} identifier */
    classOf(identifier) {
      const found = content.classes.filter(c => c.identifier === identifier);
      return found.find(c => c.rules === '2024') ?? found[0] ?? null;
    },
    /** The first subclass (by name) of a class entry, or null. @param {{uuid: string}} classEntry */
    subclassOf(classEntry) {
      return content.subclasses.find(s => s.classEntry?.uuid === classEntry.uuid)?.entry ?? null;
    },
  };
}

/** @param {T} t @param {string} actorId */
export async function deleteHero(t, actorId) {
  if (!actorId) return;
  if (process.env.KIT_KEEP_ORIGINS) return;
  await t.gm('deleteKitActor', { actorId }).catch(() => {});
}

/**
 * The expected findings (the shared file or a given list).
 * @param {Array<{id: string, kind: 'KIT'|'CONTENT'|'SYSTEM'|'STUDIO', why: string}>} [list]
 */
export function expectedFindings(list) {
  return list ?? loadExpected(ORIGINS_EXPECTED_FILE);
}

/**
 * Uses what an origin granted, once each (the feature use pass), and judges each use.
 * @param {T} t
 * @param {{actorId: string, facts: any, build: any, rootLabel: string}} o
 * @returns {Promise<{problems: import('./advancement.mjs').Problem[], used: number, features: number, leftOut: Array<{item: string, activity: string, why: string}>}>}
 */
export async function useGranted(t, { actorId, facts, build, rootLabel }) {
  const labels = descendants(build, rootLabel);
  const own = { ...facts, items: itemsOfLabels(facts.items, labels) };
  const plan = planUses(own);
  /** @type {import('./advancement.mjs').Problem[]} */
  const problems = [];
  let used = 0;
  for (const planned of plan.use) {
    let result;
    try {
      result = await t.gm('exerciseActor', {
        actorId,
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
  return { problems, used, features: plan.features, leftOut: plan.skipped };
}

/**
 * The bookkeeping of a scenario: every problem found, split by the expected-findings list and then
 * by the profile's known list (lib/known.mjs), which holds content that stays on one PC.
 * @param {string} category
 * @param {Array<{id: string, kind: 'KIT'|'CONTENT'|'SYSTEM'|'STUDIO', why: string}>} expected
 * @param {{list: import('./known.mjs').KnownEntry[], scenario: string}} [known]
 */
export function newLedger(category, expected, known = { list: [], scenario: '' }) {
  /** @type {Array<import('./advancement.mjs').Problem & {id: string}>} */
  const all = [];
  /** @type {Record<string, number>} */
  const expectedCounts = {};
  /** @type {Array<{name: string, problems: string[]}>} */
  const failed = [];
  /** @type {Map<string, number>} */
  const knownHits = new Map();
  return {
    all,
    expectedCounts,
    failed,
    /**
     * Files a document's problems; returns the new ones (the ones that fail the step).
     * @param {string} name
     * @param {import('./advancement.mjs').Problem[]} problems
     */
    file(name, problems) {
      const ided = withIds(category, problems);
      all.push(...ided);
      const split = splitExpected(/** @type {any} */ (ided), expected);
      for (const [id, n] of Object.entries(split.counts))
        expectedCounts[id] = (expectedCounts[id] ?? 0) + n;
      const { fresh, known: hits } = splitKnown(
        /** @type {import('./advancement.mjs').Problem[]} */ (/** @type {unknown} */ (split.fresh)),
        known.list,
        known.scenario
      );
      for (const k of hits) knownHits.set(k.id, (knownHits.get(k.id) ?? 0) + 1);
      if (fresh.length)
        failed.push({
          name,
          problems: fresh.map(p => `[${p.kind}] ${p.what}: ${p.evidence}`),
        });
      return fresh;
    },
    /** The known-list attachment: matches per entry and the entries this run did not see. */
    known() {
      return knownAttachment(known.list, known.scenario, knownHits);
    },
    /** Problems by kind, over everything found. */
    byKind() {
      return countByKind(all);
    },
  };
}

/**
 * A build error of createHero as a problem.
 * @param {unknown} e
 */
export function buildFailure(e) {
  return classifyBuildError(e instanceof Error ? e.message : String(e));
}
