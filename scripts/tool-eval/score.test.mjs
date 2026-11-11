import assert from 'node:assert/strict';
import test from 'node:test';

import { CASES, chainOf } from './cases.mjs';
import { WRITE_TOOLS, danishWithGameTerms, matchPath, scoreTurn, summarize, verdict } from './score.mjs';

const call = (name, input = {}) => ({ name, input });

test('matchPath finds a subsequence in order', () => {
  assert.deepEqual(matchPath(['a', 'c'], ['a', 'b', 'c']), [0, 2]);
  assert.equal(matchPath(['c', 'a'], ['a', 'b', 'c']), undefined);
});

test('a good path passes, two extras are allowed and three are not', () => {
  const turn = { paths: [['get-party']] };
  assert.equal(scoreTurn(turn, [call('get-party')], '').path, true);
  const two = [call('get-party'), call('get-world-info'), call('list-scenes')];
  assert.equal(scoreTurn(turn, two, '').path, true);
  const three = [...two, call('list-characters')];
  assert.equal(scoreTurn(turn, three, '').path, false);
});

test('any alternative path passes', () => {
  const turn = { paths: [['check-action'], ['get-character-resources', 'get-combat-state']] };
  assert.equal(scoreTurn(turn, [call('get-character-resources'), call('get-combat-state')], '').path, true);
  assert.equal(scoreTurn(turn, [call('get-world-info')], '').path, false);
});

test('the no-write gate fails when a write tool is called', () => {
  const turn = { paths: [['plan-actor-change']], gates: ['no-write'] };
  const ok = scoreTurn(turn, [call('plan-actor-change')], '');
  assert.deepEqual(ok.gates, { 'no-write': true });
  const bad = scoreTurn(turn, [call('plan-actor-change'), call('apply-planned-change')], '');
  assert.deepEqual(bad.gates, { 'no-write': false });
});

test('the set-off gate wants no call and a reply that names Play', () => {
  const turn = { paths: [[]], gates: ['set-off'] };
  assert.equal(scoreTurn(turn, [], 'Switch on the Play connector first.').gates['set-off'], true);
  assert.equal(scoreTurn(turn, [], 'Done.').gates['set-off'], false);
  assert.equal(scoreTurn(turn, [call('get-combat-state')], 'Switch on Play.').gates['set-off'], false);
});

test('the language gate wants Danish with hit points kept', () => {
  assert.equal(danishWithGameTerms('Ismark har 27 hit points af 33.'), true);
  assert.equal(danishWithGameTerms('Ismark has 27 hit points.'), false);
  assert.equal(danishWithGameTerms('Ismark har 27 hit points av 33, nå.'), false);
  assert.equal(danishWithGameTerms('Ismark har 27 livspoeng.'), false);
});

test('a fail condition of the case fails the path', () => {
  const turn = { paths: [['search-journals']], fail: calls => calls.length > 1 };
  assert.equal(scoreTurn(turn, [call('search-journals'), call('list-scenes')], '').path, false);
});

test('summarize and verdict use the targets', () => {
  const rows = [
    { path: true, gates: { language: true } },
    { path: true, gates: {} },
    { path: false, gates: {} },
    { path: true, gates: {} },
  ];
  const s = summarize(rows);
  assert.equal(s.pathPass, 3);
  assert.equal(s.gatesAll, true);
  assert.equal(verdict('sonnet', s).ok, false); // 75% < 90%
  assert.equal(verdict('haiku', summarize(rows.slice(0, 2))).ok, true);
  const broken = summarize([{ path: true, gates: { 'no-write': false } }]);
  assert.equal(verdict('haiku', broken).ok, false);
});

test('the case set has 22 cases, unique ids and a valid chain', () => {
  assert.equal(CASES.length, 22);
  assert.equal(new Set(CASES.map(c => c.id)).size, 22);
  assert.deepEqual(chainOf(4).map(c => c.id), [2, 3, 4]);
  for (const c of CASES) {
    assert.ok(c.ask && c.paths.length > 0 && c.sets.includes('core'), `case ${c.id}`);
  }
});

test('the Norwegian check sees words with å, and the Danish check keeps passing', () => {
  assert.equal(danishWithGameTerms('Han har 12 hit points nå.'), false);
  assert.equal(danishWithGameTerms('Det gjelder hit points. Han har 12.'), false);
  assert.equal(danishWithGameTerms('Han har også 12 hit points lige nu.'), true);
  assert.equal(danishWithGameTerms('Han har 12 hit points lige nu.'), true);
});

test('the quest and dashboard write tools are write tools', () => {
  for (const n of ['create-quest-journal', 'update-quest-journal', 'link-quest-to-npc', 'create-campaign-dashboard']) {
    assert.equal(WRITE_TOOLS.has(n), true, n);
  }
});

test('the set-off gate needs Play near connector or switch, not any "play"', () => {
  const turn = { paths: [[]], gates: ['set-off'] };
  assert.equal(scoreTurn(turn, [], 'I cannot do that, but we could play a game.').gates['set-off'], false);
  assert.equal(scoreTurn(turn, [], 'Turn on the Play set in the search and tools menu.').gates['set-off'], true);
  assert.equal(scoreTurn(turn, [], 'The Play tools are switched off in this chat.').gates['set-off'], true);
  assert.equal(scoreTurn(turn, [], 'You need to enable the Play connector.').gates['set-off'], true);
});
