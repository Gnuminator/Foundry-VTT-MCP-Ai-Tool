import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NOT_BUILT, classifyBuildError } from '../lib/advancement.mjs';
import { knownAlsoOf, knownAttachment, knownFile, loadKnown, splitKnown, validateKnown } from '../lib/known.mjs';
import { pickCoverage, pickSummary } from '../lib/picks.mjs';
import { knownMarkdown, picksMarkdown } from '../lib/report.mjs';

const ENTRY = {
  id: 'reckless-no-uses',
  scenario: 'heroes-features-use',
  kind: 'CONTENT',
  what: 'the system refused the use',
  match: 'Reckless Attack / Use',
  why: 'the imported feature consumes uses it does not have',
};

test('known: the srd list sits next to the srd profile, a licensed one under the kit home', () => {
  assert.match(knownFile('srd'), /data[\\/]profiles[\\/]srd\.known\.json$/);
  assert.equal(
    knownFile('licensed', 'C:\\kit'),
    path.join('C:\\kit', 'licensed', 'profiles', 'licensed.known.json')
  );
});

test('known: a missing file is an empty list, a broken one throws', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kit-known-'));
  assert.deepEqual(loadKnown('x', { file: path.join(dir, 'none.json') }), []);
  const bad = path.join(dir, 'bad.json');
  writeFileSync(bad, JSON.stringify([{ ...ENTRY, kind: 'KIT' }]));
  assert.throws(() => loadKnown('x', { file: bad }), /CONTENT or SYSTEM/);
  const good = path.join(dir, 'good.json');
  writeFileSync(good, JSON.stringify([ENTRY]));
  assert.equal(loadKnown('x', { file: good }).length, 1);
});

test('known: validateKnown names every broken field', () => {
  assert.deepEqual(validateKnown([ENTRY]), []);
  const problems = validateKnown([
    ENTRY,
    { ...ENTRY },
    { id: 'b', scenario: '', kind: 'SYSTEM', match: 'ab' },
  ]);
  assert.ok(problems.some(p => /listed twice/.test(p)));
  assert.ok(problems.some(p => /no scenario/.test(p)));
  assert.ok(problems.some(p => /3 or more/.test(p)));
  assert.ok(problems.some(p => /no why/.test(p)));
  assert.deepEqual(validateKnown({}), ['the known list must be a JSON list']);
});

test('known: splitKnown matches scenario, kind, what and evidence; KIT is never known', () => {
  const hit = {
    kind: /** @type {const} */ ('CONTENT'),
    what: 'the system refused the use',
    evidence: 'Reckless Attack / Use (utility): No uses',
  };
  const otherWhat = { ...hit, what: 'uses consumed' };
  const otherKind = { ...hit, kind: /** @type {const} */ ('SYSTEM') };
  const kit = { ...hit, kind: /** @type {const} */ ('KIT') };
  const fresh = { ...hit, evidence: 'Rage / Use (utility): No uses' };
  const out = splitKnown([hit, otherWhat, otherKind, kit, fresh], [ENTRY], 'heroes-features-use');
  assert.deepEqual(out.known, [{ problem: hit, id: 'reckless-no-uses' }]);
  assert.deepEqual(out.fresh, [otherWhat, otherKind, kit, fresh]);
  // Another scenario does not use the entry.
  assert.equal(splitKnown([hit], [ENTRY], 'heroes-advancement').known.length, 0);
  // A list of whats covers each of them, and only them.
  const both = { ...ENTRY, what: ['the system refused the use', 'uses consumed'] };
  const third = { ...hit, what: 'no chat card' };
  const listed = splitKnown([hit, otherWhat, third], [both], 'heroes-features-use');
  assert.equal(listed.known.length, 2);
  assert.deepEqual(listed.fresh, [third]);
});

test('known: what is required, so an entry cannot cover a packed problem beside its own item', () => {
  const loose = { ...ENTRY, what: undefined };
  assert.ok(validateKnown([loose]).some(p => /needs a what/.test(p)));
  assert.ok(validateKnown([{ ...ENTRY, what: [] }]).some(p => /needs a what/.test(p)));
  assert.ok(validateKnown([{ ...ENTRY, what: ['ok', ''] }]).some(p => /needs a what/.test(p)));
  // The count is part of `what`: one more missing grant beside the known one fails.
  const entry = {
    ...ENTRY,
    scenario: 'heroes-advancement',
    kind: /** @type {const} */ ('SYSTEM'),
    what: '1 grant(s) missing',
    match: 'Some Feature',
  };
  const old = {
    kind: /** @type {const} */ ('SYSTEM'),
    what: '1 grant(s) missing',
    evidence: 'Some Feature (level 3)',
  };
  const grown = {
    ...old,
    what: '3 grant(s) missing',
    evidence: 'Some Feature (level 3), New A, New B',
  };
  assert.equal(splitKnown([old], [entry], 'heroes-advancement').known.length, 1);
  assert.deepEqual(splitKnown([grown], [entry], 'heroes-advancement').fresh, [grown]);
});

test('known: a hero that was not built is never known, and no entry may claim it', () => {
  assert.ok(
    validateKnown([{ ...ENTRY, scenario: 'heroes-advancement', what: NOT_BUILT }]).some(p =>
      /never known/.test(p)
    )
  );
  // Even an entry that slipped past validation does not hide it.
  const sneaky = {
    ...ENTRY,
    scenario: 'heroes-advancement',
    kind: /** @type {const} */ ('SYSTEM'),
    what: NOT_BUILT,
    match: 'aitool',
  };
  const notBuilt = classifyBuildError(
    'createHero failed: Compendium.aitool-content.classes.Item.x refused'
  );
  assert.equal(notBuilt.kind, 'SYSTEM');
  const out = splitKnown([notBuilt], [sneaky], 'heroes-advancement');
  assert.deepEqual(out.fresh, [notBuilt]);
  assert.equal(out.known.length, 0);
});

test('known: max caps the problems an entry covers per run, across calls that share the hits map', () => {
  assert.ok(validateKnown([{ ...ENTRY, max: 0 }]).some(p => /max must be/.test(p)));
  assert.ok(validateKnown([{ ...ENTRY, max: 1.5 }]).some(p => /max must be/.test(p)));
  assert.deepEqual(validateKnown([{ ...ENTRY, max: 2 }]), []);
  const capped = { ...ENTRY, max: 2 };
  const p = {
    kind: /** @type {const} */ ('CONTENT'),
    what: 'the system refused the use',
    evidence: 'Reckless Attack / Use (utility): No uses',
  };
  const hits = new Map();
  const first = splitKnown([p, p], [capped], 'heroes-features-use', hits);
  assert.equal(first.known.length, 2);
  assert.equal(hits.get('reckless-no-uses'), 2);
  const second = splitKnown([p], [capped], 'heroes-features-use', hits);
  assert.equal(second.known.length, 0);
  assert.equal(second.fresh.length, 1);
  assert.match(second.fresh[0].evidence, /over known entry reckless-no-uses \(max 2\)/);
  assert.equal(hits.get('reckless-no-uses'), 2);
  // Without a hits map, max counts the one call.
  assert.equal(splitKnown([p, p, p], [capped], 'heroes-features-use').fresh.length, 1);
  // The attachment shows the cap.
  assert.equal(
    knownAttachment([capped], 'heroes-features-use', hits).matched['reckless-no-uses'].max,
    2
  );
});

test('known: the attachment counts matches and lists unseen entries; the report renders it', () => {
  const second = { ...ENTRY, id: 'other', match: 'Other Feature' };
  const att = knownAttachment(
    [ENTRY, second],
    'heroes-features-use',
    new Map([['reckless-no-uses', 3]])
  );
  assert.equal(att.entries, 2);
  assert.equal(att.matched['reckless-no-uses'].problems, 3);
  assert.deepEqual(att.unseen, ['other']);
  const md = knownMarkdown(
    /** @type {any} */ ({
      scenarios: [{ id: 'heroes-features-use', attachments: [{ name: 'known', data: att }] }],
    })
  ).join('\n');
  assert.match(md, /## Known findings/);
  assert.match(md, /1 of 2 entries matched/);
  assert.match(md, /Not seen in this run: other/);
});

test('picks: coverage per class and choice, with the options no hero picked', () => {
  const heroes = [
    {
      classIdentifier: 'bard',
      picks: [
        {
          advancement: 'Trait',
          title: 'Bard: Skills',
          chosen: ['skills:acr'],
          offered: ['skills:acr', 'skills:ath', 'skills:dec'],
        },
        { advancement: 'AbilityScoreImprovement', title: 'Bard: ASI', chosen: ['cha +2'] },
        { advancement: 'Trait', title: 'Human: Skillful', chosen: ['skills:his'] },
      ],
    },
    {
      classIdentifier: 'bard',
      picks: [
        {
          advancement: 'Trait',
          title: 'Bard: Skills',
          chosen: ['skills:ath'],
          offered: ['skills:ath', 'skills:dec'],
        },
      ],
    },
  ];
  const rows = pickCoverage(heroes);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    classIdentifier: 'bard',
    title: 'Bard: Skills',
    advancement: 'Trait',
    heroes: 2,
    offered: 3,
    picked: { 'skills:acr': 1, 'skills:ath': 1 },
    never: ['skills:dec'],
    mechanicalNever: [],
  });
  assert.equal(pickSummary(rows), '1 choices, 2 of 3 offered options picked at least once');
  const md = picksMarkdown(
    /** @type {any} */ ({
      scenarios: [{ id: 'heroes-advancement', attachments: [{ name: 'picks', data: rows }] }],
    })
  ).join('\n');
  assert.match(md, /\| bard \| Bard: Skills \| 2 \| 3 \| 2 \| skills:dec \|/);
});

test('known: a profile also uses the lists it names in knownAlso, its own entries first', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'kit-known-also-'));
  const dir = path.join(home, 'licensed', 'profiles');
  mkdirSync(dir, { recursive: true });
  /** @param {string} id @param {unknown} body */
  const put = (id, body) => writeFileSync(path.join(dir, id), JSON.stringify(body));
  // "mine" inherits "base"; "base" names "deeper", which is one level too far and is ignored.
  put('mine.json', { id: 'mine', knownAlso: ['base', 'absent'] });
  put('mine.known.json', [{ ...ENTRY, id: 'mine-own' }]);
  put('base.json', { id: 'base', knownAlso: ['deeper'] });
  put('base.known.json', [{ ...ENTRY, id: 'base-one' }]);
  put('deeper.json', { id: 'deeper' });
  put('deeper.known.json', [{ ...ENTRY, id: 'deeper-one' }]);
  assert.deepEqual(knownAlsoOf('mine', home), ['base', 'absent']);
  assert.deepEqual(knownAlsoOf('nope', home), []);
  assert.deepEqual(
    loadKnown('mine', { home }).map(e => e.id),
    ['mine-own', 'base-one']
  );
  // Loaded on its own, "base" inherits its one level ("deeper") like any profile.
  assert.deepEqual(
    loadKnown('base', { home }).map(e => e.id),
    ['base-one', 'deeper-one']
  );
  // The same id in two lists is an error, so an entry is never counted twice.
  put('base.known.json', [{ ...ENTRY, id: 'mine-own' }]);
  assert.throws(() => loadKnown('mine', { home }), /"mine-own" is in the lists of both "mine" and "base"/);
  // With a file given, only that file is read.
  assert.deepEqual(
    loadKnown('mine', { home, file: path.join(dir, 'base.known.json') }).map(e => e.id),
    ['mine-own']
  );
});
