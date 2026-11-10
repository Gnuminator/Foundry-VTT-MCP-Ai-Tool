/**
 * The 22 cases of the tool eval (vault Design/Research 2026-11-03/AI answer quality.md, section 5).
 * Names are Curse of Strahd NPCs; "the cleric" and "the rogue" stand for test-world characters.
 *
 * Case fields:
 *   id, sets  the connectors that are switched on (core is always on)
 *   after     the id of the case this one continues (same chat, `--resume`); the canned results of
 *             the chain are shared, so the first case of a chain carries them all
 *   ask       the user's message
 *   paths     alternative good paths (see score.mjs); [] alone means "no tool call needed"
 *   gates     hard gates this turn carries: no-write, set-off, language
 *   fail      extra fail condition on the calls and text (optional)
 *   results   canned tool results by tool name (string or JSON)
 */

const has = (calls, name) => calls.some(c => c.name === name);
const inputOf = (calls, name) => JSON.stringify(calls.find(c => c.name === name)?.input ?? {});

const PARTY = {
  party: [
    { name: 'Aldric (cleric)', hp: '31/38', ac: 18, conditions: [] },
    { name: 'Vex (rogue)', hp: '22/27', ac: 15, conditions: ['poisoned'] },
    { name: 'Thorn (fighter)', hp: '40/44', ac: 19, conditions: [] },
  ],
};

export const CASES = [
  {
    id: 1,
    sets: ['core', 'play'],
    ask: 'How is the party doing?',
    paths: [['get-party']],
    gates: ['no-write'],
    fail: calls => calls.filter(c => c.name === 'get-character').length >= 2,
    results: { 'get-party': PARTY },
  },
  {
    id: 2,
    sets: ['core', 'play'],
    ask: 'Ireena takes 9 slashing damage.',
    paths: [['plan-actor-change']],
    gates: ['no-write'],
    fail: calls => !/9/.test(inputOf(calls, 'plan-actor-change')),
    results: {
      'plan-actor-change': {
        planId: 'plan-7f3a',
        summary: 'Ireena Kolyana: hit points 27 -> 18 (9 slashing damage).',
        expiresInMinutes: 15,
      },
      'apply-planned-change': {
        applied: true,
        changeId: 'chg-4b21',
        summary: 'Ireena Kolyana: hit points 27 -> 18.',
      },
      'undo-change': { undone: true, changeId: 'chg-4b21', summary: 'Ireena Kolyana back to 27 hit points.' },
      'list-recent-changes': {
        changes: [{ changeId: 'chg-4b21', summary: 'Ireena Kolyana took 9 slashing damage', undoable: true }],
      },
    },
  },
  {
    id: 3,
    after: 2,
    sets: ['core', 'play'],
    ask: 'Yes, do it.',
    paths: [['apply-planned-change']],
    fail: calls => has(calls, 'plan-actor-change'),
  },
  {
    id: 4,
    after: 3,
    sets: ['core', 'play'],
    ask: 'Oops, undo that.',
    paths: [['undo-change'], ['list-recent-changes', 'undo-change']],
    fail: calls => has(calls, 'plan-actor-change') && !has(calls, 'undo-change'),
  },
  {
    id: 5,
    sets: ['core', 'play'],
    ask: 'Ask the rogue for a private Dexterity save, DC 13.',
    paths: [['request-player-rolls']],
    fail: calls => has(calls, 'roll-saving-throws'),
    results: {
      'request-player-rolls': { requested: true, target: 'Vex (rogue)', visibility: 'private', dc: 13 },
      'get-party': PARTY,
    },
  },
  {
    id: 6,
    sets: ['core', 'play'],
    ask: 'The three wolves roll a Dex save against DC 14.',
    paths: [['roll-saving-throws']],
    fail: calls => has(calls, 'request-player-rolls'),
    results: {
      'roll-saving-throws': {
        results: [
          { name: 'Wolf 1', total: 15, success: true },
          { name: 'Wolf 2', total: 9, success: false },
          { name: 'Wolf 3', total: 12, success: false },
        ],
      },
    },
  },
  {
    id: 7,
    sets: ['core', 'play'],
    ask: "Run the dire wolf's turn, bite the closest PC.",
    paths: [['plan-npc-turn', 'use-npc-activity'], ['plan-npc-turn']],
    results: {
      'plan-npc-turn': {
        npc: 'Dire Wolf',
        position: 'near the north gate',
        closestTarget: { name: 'Vex (rogue)', distanceFeet: 10 },
        options: [{ itemName: 'Bite', activity: 'attack', reach: '5 ft' }],
        note: 'Closest PC is 10 ft away; moving 5 ft brings it into reach.',
      },
      'use-npc-activity': { rolled: true, attackTotal: 16, hit: true, damage: 11 },
    },
  },
  {
    id: 8,
    sets: ['core', 'play'],
    ask: 'Next turn.',
    paths: [['advance-combat-turn']],
    results: { 'advance-combat-turn': { round: 2, turn: 'Dire Wolf', next: 'Vex (rogue)' } },
  },
  {
    id: 9,
    sets: ['core', 'play'],
    ask: 'Can the cleric cast Shield of Faith right now?',
    paths: [['check-action'], ['get-character-resources', 'get-combat-state'], ['get-combat-state', 'get-character-resources']],
    results: {
      'check-action': { allowed: true, reason: 'Bonus action available, a 1st level slot is left, no concentration active.' },
      'get-character-resources': { spellSlots: { 1: '3/4' }, concentration: null },
      'get-combat-state': { active: true, round: 2, turn: 'Aldric (cleric)', bonusActionUsed: false },
    },
  },
  {
    id: 10,
    sets: ['core', 'play'],
    ask: 'Make it night and play something creepy.',
    paths: [['list-scene-moods', 'plan-scene-mood'], ['list-scene-moods', 'plan-scene-change']],
    fail: calls => has(calls, 'switch-scene'),
    results: {
      'list-scene-moods': { moods: ['day', 'dusk', 'night', 'storm', 'fog'] },
      'plan-scene-mood': { planId: 'plan-2c9e', summary: 'Scene lighting: night. Playlist suggestion needs play-playlist.' },
      'plan-scene-change': { planId: 'plan-2c9e', summary: 'Scene lighting: night.' },
    },
  },
  {
    id: 11,
    sets: ['core'],
    ask: 'What does grappling do in the 2024 rules?',
    paths: [['search-rules']],
    gates: ['no-write'],
    results: {
      'search-rules': {
        hits: [{ title: 'Grappled (condition)', source: 'PHB 2024', excerpt: 'Speed 0. Disadvantage on attacks against anyone but the grappler.' }],
      },
    },
  },
  {
    id: 12,
    sets: ['core'],
    ask: 'Who is Madam Eva?',
    paths: [['search-journals', 'list-journals']],
    fail: calls => calls.some(c => c.name === 'list-journals' && Object.keys(c.input ?? {}).length === 0),
    results: {
      'search-journals': { hits: [{ journalId: 'jrn-eva', pageId: 'pg-eva1', title: 'Madam Eva' }] },
      'list-journals': { journalId: 'jrn-eva', pageId: 'pg-eva1', text: 'Madam Eva is the Vistani seer of the Tser Pool camp.' },
    },
  },
  {
    id: 13,
    sets: ['core', 'prep'],
    ask: 'Help me prep next session.',
    paths: [['get-world-info', 'get-prep-digest'], ['get-prep-digest']],
    gates: ['no-write'],
    fail: calls => calls.length > 6,
    results: {
      'get-prep-digest': { lastSession: 'Arrived in Barovia village', openThreads: ['Ireena needs an escort', 'Burgomaster funeral'] },
    },
  },
  {
    id: 14,
    sets: ['core', 'prep'],
    ask: 'Show the players the letter from Kolyan.',
    paths: [['search-journals', 'plan-page-reveal']],
    gates: ['no-write'],
    results: {
      'search-journals': { hits: [{ pageUuid: 'JournalEntry.jrn1.JournalEntryPage.pg7', title: 'Letter from Kolyan' }] },
      'plan-page-reveal': { planId: 'plan-91d0', summary: 'Reveal "Letter from Kolyan" to all players.' },
    },
  },
  {
    id: 15,
    sets: ['core', 'prep'],
    ask: 'Is a pack of six wolves fair for the party?',
    paths: [['suggest-balanced-encounter'], ['search-compendium', 'suggest-balanced-encounter']],
    gates: ['no-write'],
    results: {
      'suggest-balanced-encounter': { difficulty: 'moderate', xp: 1200, budget: { easy: 600, moderate: 1100, hard: 1700 } },
      'search-compendium': { hits: [{ name: 'Wolf', cr: '1/4', uuid: 'Compendium.dnd5e.monsters.wolf' }] },
    },
  },
  {
    id: 16,
    sets: ['core', 'prep'],
    ask: 'Anything I should fix before Saturday?',
    paths: [['get-preflight']],
    gates: ['no-write'],
    results: { 'get-preflight': { problems: [{ area: 'Playlist', text: '2 tracks missing' }], ok: ['Players joined', 'Journals ready'] } },
  },
  {
    id: 17,
    sets: ['core', 'prep'],
    ask: 'What did the cards say about the Sunsword?',
    paths: [['get-tarokka-reading']],
    gates: ['no-write'],
    results: { 'get-tarokka-reading': { sunsword: { card: 'Seven of Swords', place: 'Yester Hill' } } },
  },
  {
    id: 18,
    sets: ['core', 'build'],
    ask: 'Add a Strahd zombie called Uncle Grigor to this scene.',
    paths: [['search-compendium', 'create-actor-from-compendium'], ['list-creatures-by-criteria', 'create-actor-from-compendium']],
    fail: calls => has(calls, 'dnd5e-create-npc'),
    results: {
      'search-compendium': { hits: [{ name: 'Strahd Zombie', cr: '1', uuid: 'Compendium.dnd5e.monsters.strahd-zombie' }] },
      'list-creatures-by-criteria': { creatures: [{ name: 'Strahd Zombie', cr: '1', uuid: 'Compendium.dnd5e.monsters.strahd-zombie' }] },
      'create-actor-from-compendium': { created: 'Uncle Grigor', addedToScene: true },
    },
  },
  {
    id: 19,
    sets: ['core', 'build'],
    ask: 'Give the vampire spawn Spider Climb.',
    paths: [['search-compendium', 'dnd5e-add-features-from-compendium'], ['search-compendium', 'dnd5e-add-feature']],
    results: {
      'search-compendium': { hits: [{ name: 'Spider Climb', type: 'feat', uuid: 'Compendium.dnd5e.monsterfeatures.spider-climb' }] },
      'dnd5e-add-features-from-compendium': { added: ['Spider Climb'], actor: 'Vampire Spawn' },
      'dnd5e-add-feature': { added: 'Spider Climb', actor: 'Vampire Spawn' },
    },
  },
  {
    id: 20,
    sets: ['core', 'admin'],
    ask: "Make the rogue's player the owner of Ezmerelda.",
    paths: [['plan-ownership-change']],
    gates: ['no-write'],
    results: { 'plan-ownership-change': { planId: 'plan-ae77', summary: 'Ezmerelda: owner Vex player (was none).' } },
  },
  {
    id: 21,
    sets: ['core'],
    ask: 'Roll initiative for the monsters.',
    paths: [[]],
    gates: ['set-off'],
  },
  {
    id: 22,
    sets: ['core', 'play'],
    ask: 'Hvor mange hit points har Ismark?',
    paths: [['get-character']],
    gates: ['language'],
    results: { 'get-character': { name: 'Ismark Kolyanovich', hitPoints: { value: 27, max: 33 }, ac: 16 } },
  },
];

/** The chat a case belongs to: the ids from its first case to itself, in order. */
export function chainOf(id) {
  const byId = new Map(CASES.map(c => [c.id, c]));
  const chain = [];
  for (let c = byId.get(id); c; c = c.after ? byId.get(c.after) : undefined) chain.unshift(c);
  return chain;
}
