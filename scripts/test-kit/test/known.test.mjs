import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { knownAttachment, knownFile, loadKnown, splitKnown, validateKnown } from '../lib/known.mjs';
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
  const problems = validateKnown([ENTRY, { ...ENTRY }, { id: 'b', scenario: '', kind: 'SYSTEM', match: 'ab' }]);
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
  // Without `what` any what matches.
  const loose = { ...ENTRY, what: undefined };
  assert.equal(splitKnown([otherWhat], [loose], 'heroes-features-use').known.length, 1);
});

test('known: the attachment counts matches and lists unseen entries; the report renders it', () => {
  const second = { ...ENTRY, id: 'other', match: 'Other Feature' };
  const att = knownAttachment([ENTRY, second], 'heroes-features-use', new Map([['reckless-no-uses', 3]]));
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
        { advancement: 'Trait', title: 'Bard: Skills', chosen: ['skills:acr'], offered: ['skills:acr', 'skills:ath', 'skills:dec'] },
        { advancement: 'AbilityScoreImprovement', title: 'Bard: ASI', chosen: ['cha +2'] },
        { advancement: 'Trait', title: 'Human: Skillful', chosen: ['skills:his'] },
      ],
    },
    {
      classIdentifier: 'bard',
      picks: [{ advancement: 'Trait', title: 'Bard: Skills', chosen: ['skills:ath'], offered: ['skills:ath', 'skills:dec'] }],
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
    /** @type {any} */ ({ scenarios: [{ id: 'heroes-advancement', attachments: [{ name: 'picks', data: rows }] }] })
  ).join('\n');
  assert.match(md, /\| bard \| Bard: Skills \| 2 \| 3 \| 2 \| skills:dec \|/);
});
