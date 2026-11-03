/**
 * Automatic party: player characters go into the primary party once, in one write per sync; NPCs
 * and actors no player owns stay out, only the active GM's client writes, a deleted party is made
 * again, and the setting turns it off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeJournal } from './change-journal.js';
import {
  PARTY_AUTO_DONE_SETTING,
  PARTY_AUTO_SETTING,
  isPlayerCharacter,
  syncParty,
} from './party-auto.js';

const g = globalThis as any;

interface Fake {
  id: string;
  name: string;
  type: string;
  hasPlayerOwner: boolean;
}

const hero: Fake = { id: 'a1', name: 'Hero', type: 'character', hasPlayerOwner: true };
const cleric: Fake = { id: 'a2', name: 'Cleric', type: 'character', hasPlayerOwner: true };
const gmChar: Fake = { id: 'a3', name: 'GM test', type: 'character', hasPlayerOwner: false };
const wolf: Fake = { id: 'a4', name: 'Wolf', type: 'npc', hasPlayerOwner: false };
const playerNpc: Fake = { id: 'a5', name: 'Pet', type: 'npc', hasPlayerOwner: true };
const byId: Record<string, Fake> = {};
for (const f of [hero, cleric, gmChar, wolf, playerNpc]) byId[f.id] = f;

let party: any;
let actors: any;
let enabled: boolean;
let activeGm: string;
let created: any[];
let primarySet: any[];
let done: unknown;
let updates: any[];

/** A dnd5e group: `system.members` holds `{ actor }` entries with the actor documents resolved. */
function makeGroup(id: string): any {
  const group: any = {
    id,
    type: 'group',
    name: 'Party',
    _source: { system: { members: [] } },
    system: { members: [] },
    update: vi.fn(async (data: Record<string, any[]>) => {
      updates.push(data);
      const next = data['system.members'];
      group._source.system.members = next;
      group.system.members = next.map(m => ({ actor: byId[m.actor] }));
    }),
  };
  return group;
}

function install(contents: Fake[], withParty: boolean): void {
  done = { parties: {} };
  created = [];
  primarySet = [];
  updates = [];
  party = makeGroup('g1');
  actors = { contents, party: withParty ? party : null };
  g.Actor = {
    create: vi.fn(async (data: object) => {
      created.push(data);
      return party;
    }),
  };
  g.game = {
    user: { id: 'gm1' },
    users: {
      get activeGM(): { id: string } {
        return { id: activeGm };
      },
    },
    actors,
    settings: {
      get: (_m: string, key: string): unknown =>
        key === PARTY_AUTO_SETTING ? enabled : key === PARTY_AUTO_DONE_SETTING ? done : undefined,
      set: vi.fn(async (m: string, key: string, value: unknown) => {
        if (key === PARTY_AUTO_DONE_SETTING) {
          done = value;
          return;
        }
        primarySet.push([key, value, m]);
        actors.party = party;
      }),
    },
  };
}

const doneFor = (id: string): string[] =>
  (done as { parties: Record<string, string[]> }).parties[id] ?? [];
const memberIdsOf = (): string[] => party.system.members.map((m: any) => m.actor.id);

beforeEach(() => {
  enabled = true;
  activeGm = 'gm1';
});

afterEach(() => {
  delete g.game;
  delete g.Actor;
});

describe('party auto', () => {
  it('counts only player-owned characters', () => {
    expect([hero, gmChar, wolf, playerNpc].map(isPlayerCharacter)).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  it('adds player characters to an existing primary party in one write, nobody else', async () => {
    install([hero, gmChar, wolf, cleric, playerNpc], true);
    expect(await syncParty()).toEqual(['Hero', 'Cleric']);
    expect(memberIdsOf()).toEqual(['a1', 'a2']);
    expect(updates).toHaveLength(1);
    expect(created).toHaveLength(0);
  });

  it('keeps the members that are already there', async () => {
    install([hero, cleric], true);
    party._source.system.members = [{ actor: 'a2', quantity: { value: 2 } }];
    party.system.members = [{ actor: cleric }];
    expect(await syncParty()).toEqual(['Hero']);
    expect(updates[0]['system.members']).toEqual([
      { actor: 'a2', quantity: { value: 2 } },
      { actor: 'a1' },
    ]);
  });

  it('adds nothing twice, also from overlapping calls', async () => {
    install([hero, cleric], true);
    const runs = await Promise.all([syncParty(), syncParty(), syncParty()]);
    expect(runs.flat().sort()).toEqual(['Cleric', 'Hero']);
    expect(await syncParty()).toEqual([]);
    expect(memberIdsOf()).toEqual(['a1', 'a2']);
    expect(updates).toHaveLength(1);
  });

  it('makes the group Party and sets it as primary when there is none', async () => {
    install([hero], false);
    expect(await syncParty()).toEqual(['Hero']);
    expect(created).toEqual([{ name: 'Party', type: 'group' }]);
    expect(primarySet).toEqual([['primaryParty', { actor: party }, 'dnd5e']]);
  });

  it('makes no party when no player owns a character', async () => {
    install([gmChar, wolf], false);
    expect(await syncParty()).toEqual([]);
    expect(created).toHaveLength(0);
  });

  it('sets the only group as primary instead of making another', async () => {
    install([hero], false);
    actors.contents = [hero, party];
    expect(await syncParty()).toEqual(['Hero']);
    expect(created).toHaveLength(0);
    expect(primarySet).toHaveLength(1);
  });

  it('does not adopt a lone group that holds an NPC or is a sweep fixture', async () => {
    install([hero], false);
    party.system.members = [{ actor: wolf }];
    actors.contents = [hero, party];
    await syncParty();
    expect(created).toHaveLength(1);

    install([hero], false);
    party.name = 'AI Tool Sweep Party';
    actors.contents = [hero, party];
    await syncParty();
    expect(created).toHaveLength(1);
  });

  it('adds a character once: an undone addition stays out after a reload', async () => {
    install([hero, cleric], true);
    await syncParty();
    party._source.system.members = [{ actor: 'a2' }];
    party.system.members = [{ actor: cleric }];
    expect(await syncParty()).toEqual([]);
    expect(memberIdsOf()).toEqual(['a2']);
  });

  it('counts a character that is already a member as added', async () => {
    install([hero], true);
    party._source.system.members = [{ actor: 'a1' }];
    party.system.members = [{ actor: hero }];
    expect(await syncParty()).toEqual([]);
    expect(updates).toHaveLength(0);
    expect(doneFor('g1')).toEqual(['a1']);
  });

  it('makes a deleted party again and fills it', async () => {
    install([hero, cleric], true);
    await syncParty();
    actors.party = null;
    party = makeGroup('g2');
    expect(await syncParty()).toEqual(['Hero', 'Cleric']);
    expect(created).toHaveLength(1);
    expect(memberIdsOf()).toEqual(['a1', 'a2']);
  });

  it('remembers removals per party, so switching the primary and back keeps them out', async () => {
    install([hero, cleric], true);
    await syncParty();
    party._source.system.members = [{ actor: 'a2' }];
    party.system.members = [{ actor: cleric }];
    const first = party;
    actors.party = makeGroup('g2');
    expect(await syncParty()).toEqual(['Hero', 'Cleric']);
    actors.party = first;
    expect(await syncParty()).toEqual([]);
    expect(memberIdsOf()).toEqual(['a2']);
  });

  it('reads the older single-party list', async () => {
    install([hero, cleric], true);
    done = { partyId: 'g1', ids: ['a1'] };
    expect(await syncParty()).toEqual(['Cleric']);
    expect(doneFor('g1')).toEqual(['a1', 'a2']);
  });

  it('writes the list only when it changed', async () => {
    install([hero], true);
    await syncParty();
    const set = g.game.settings.set as ReturnType<typeof vi.fn>;
    set.mockClear();
    await syncParty();
    expect(set).not.toHaveBeenCalled();
  });

  it('takes a group it filled before as primary again instead of making a second one', async () => {
    install([hero], true);
    await syncParty();
    actors.party = null;
    actors.contents = [
      hero,
      party,
      { id: 'g9', type: 'group', name: 'Split', system: { members: [] } },
    ];
    await syncParty();
    expect(created).toHaveLength(0);
    expect(primarySet).toHaveLength(1);
  });

  it('breaks the change group around the write', async () => {
    install([hero, cleric], true);
    const spy = vi.spyOn(changeJournal, 'breakGroup');
    await syncParty();
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('keeps nobody marked as added when the write fails', async () => {
    install([hero], true);
    party.update.mockRejectedValueOnce(new Error('no'));
    await expect(syncParty()).rejects.toThrow('no');
    expect(doneFor('g1')).toEqual([]);
    expect(await syncParty()).toEqual(['Hero']);
  });

  it('does nothing on a GM who is not the active one', async () => {
    install([hero], false);
    activeGm = 'gm2';
    expect(await syncParty()).toEqual([]);
    expect(created).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('does nothing with the setting off', async () => {
    install([hero], true);
    enabled = false;
    expect(await syncParty()).toEqual([]);
    expect(updates).toHaveLength(0);
  });
});
