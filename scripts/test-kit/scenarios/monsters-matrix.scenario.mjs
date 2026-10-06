/**
 * The matrix of the monsters in the content profile: how many there are by pack and book, by
 * challenge rating band, by creature type and size and by trait (resistances, immunities,
 * vulnerabilities, senses, languages, spells, legendary actions, lair, movement modes and the odd
 * mechanics), and which bands, types, sizes and traits nobody has (the gaps). It reads the
 * compendium packs and changes nothing.
 *
 * Every monster is also checked for the data every creature needs (a challenge rating, a known
 * type and size, hit points, armor class, items, a legendary pool that matches its legendary
 * actions, sane movement); a failure is CONTENT. The counts and the gaps are attached to the
 * report, they do not fail the scenario.
 */
import { FAILURE_KINDS, countByKind, problemText } from '../lib/advancement.mjs';
import {
  CR_BANDS,
  CREATURE_TYPES,
  TRAITS,
  countsLine,
  judgeRow,
  matrixOf,
  monstersOf,
} from '../lib/monsters.mjs';
import { loadProfile } from '../lib/profiles.mjs';

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'monsters-matrix',
  title:
    'The monsters by challenge rating, type, size and trait; the gaps; the data every creature needs',
  sizes: ['smoke', 'full', 'long'],
  tags: ['build'],
  needs: [],
  tools: [],
  gmActions: ['listMonsters'],
  timeoutMs: 30 * 60 * 1000,

  async run(t) {
    const profile = loadProfile(t.kit.profile);
    const packs = profile.packs.monsters;
    const { rows, missing, perPack } = await monstersOf(t, packs);

    await t.step('every monster pack is installed and has monsters', async () => {
      t.check(missing.length === 0, `[CONTENT] pack not installed: ${missing.join(', ')}`, {
        missing,
      });
      for (const id of packs) t.check(perPack[id]?.total > 0, `[CONTENT] ${id} has no monsters`);
      return packs
        .map(id => `${id} ${perPack[id]?.total ?? 0}${skippedText(perPack[id]?.skipped)}`)
        .join(', ');
    });

    const m = matrixOf(rows);
    t.attach('matrix', m);

    await t.step('the counts add up', async () => {
      for (const [what, counts] of /** @type {Array<[string, Record<string, number>]>} */ ([
        ['packs', m.byPack],
        ['bands', m.byBand],
        ['types', m.byType],
        ['sizes', m.bySize],
      ])) {
        const sum = Object.values(counts).reduce((a, b) => a + b, 0);
        t.check(sum === m.total, `[KIT] the ${what} add up to ${sum}, not ${m.total}`);
      }
      return `${m.total} monsters, ${m.distinctNames} different names, ${m.statBlocks} stat blocks without a challenge rating`;
    });

    await t.step('by challenge rating band', async () => {
      return `${CR_BANDS.map(b => `${b.label} ${m.byBand[b.id] ?? 0}`).join(', ')}, no rating ${m.byBand.none ?? 0}`;
    });
    await t.step('by creature type', async () => {
      return CREATURE_TYPES.map(c => `${c} ${m.byType[c] ?? 0}`).join(', ');
    });
    await t.step('by size', async () => countsLine(m.bySize));
    await t.step('by book', async () => countsLine(m.byBook));
    await t.step('by trait', async () => {
      return TRAITS.map(x => `${x.label} ${m.traits[x.id] ?? 0}`).join(', ');
    });
    await t.step('the damage types, conditions and languages', async () => {
      return (
        `resistances: ${countsLine(m.resistances, 6)}; immunities: ${countsLine(m.immunities, 6)}; ` +
        `vulnerabilities: ${countsLine(m.vulnerabilities, 6)}; conditions: ${countsLine(m.conditions, 6)}; ` +
        `languages: ${countsLine(m.languages, 6)}`
      );
    });
    await t.step('the gaps (nothing in the profile has them)', async () => {
      return m.gaps.length
        ? m.gaps.map(g => `${g.what}: ${g.id}`).join('; ')
        : 'no gaps: every band, type, size and trait has an example';
    });

    await t.step('every monster has the data every creature needs', async () => {
      /** @type {import('../lib/advancement.mjs').Problem[]} */
      const problems = [];
      /** @type {Array<{monster: string, pack: string, problems: string[]}>} */
      const bad = [];
      for (const row of rows) {
        const own = judgeRow(row);
        if (!own.length) continue;
        problems.push(...own);
        bad.push({
          monster: row.name,
          pack: row.packId,
          problems: own.map(p => `[${p.kind}] ${p.what}: ${p.evidence}`),
        });
      }
      const byKind = countByKind(problems);
      /** @type {Record<string, number>} */
      const byWhat = {};
      for (const p of problems) byWhat[p.what] = (byWhat[p.what] ?? 0) + 1;
      t.attach('data', {
        monstersChecked: rows.length,
        monstersFailed: bad.length,
        problemsByKind: byKind,
        problemsByWhat: byWhat,
        failed: bad.slice(0, 500),
      });
      t.log(
        `${rows.length} monsters, ${bad.length} with a data problem (${FAILURE_KINDS.map(k => `${k} ${byKind[k]}`).join(', ')})`
      );
      t.check(
        problems.length === 0,
        `${bad.length} of ${rows.length} monsters: ${problemText(problems, 4)}`,
        { byWhat }
      );
      return `${rows.length} monsters`;
    });
  },
};

/** @param {Record<string, number> | undefined} skipped */
function skippedText(skipped) {
  const parts = Object.entries(skipped ?? {}).map(([k, v]) => `${v} ${k}`);
  return parts.length ? ` (left out: ${parts.join(', ')})` : '';
}
