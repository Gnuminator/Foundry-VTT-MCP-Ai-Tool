/**
 * Automatic party: player characters go into the primary party once, NPCs and actors no player
 * owns stay out, only the active GM's client writes, and the setting turns it off.
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

let members: Array<{ actor: Fake }>;
let party: any;
let actors: any;
let enabled: boolean;
let activeGm: string;
let created: any[];
let primarySet: any[];
let done: unknown;

function install(contents: Fake[], withParty: boolean): void {
  done = { ids: [] };
  members = [];
  created = [];
  primarySet = [];
  party = {
    id: 'g1',
    system: {
      members: { contents: members },
      addMember: vi.fn(async (actor: Fake) => {
        members.push({ actor });
      }),
    },
  };
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
      get activeGM() {
        return { id: activeGm };
      },
    },
    actors,
    settings: {
      get: (_m: string, key: string) =>
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

  it('adds player characters to an existing primary party, nobody else', async () => {
    install([hero, gmChar, wolf, cleric, playerNpc], true);
    expect(await syncParty()).toEqual(['Hero', 'Cleric']);
    expect(members.map(m => m.actor.id)).toEqual(['a1', 'a2']);
    expect(created).toHaveLength(0);
  });

  it('adds nothing twice, also from overlapping calls', async () => {
    install([hero, cleric], true);
    const runs = await Promise.all([syncParty(), syncParty(), syncParty()]);
    expect(runs.flat().sort()).toEqual(['Cleric', 'Hero']);
    expect(await syncParty()).toEqual([]);
    expect(members).toHaveLength(2);
  });

  it('makes the group Party and sets it as primary when there is none', async () => {
    install([hero], false);
    expect(await syncParty()).toEqual(['Hero']);
    expect(created).toEqual([
      { name: 'Party', type: 'group', system: { type: { value: 'party' } } },
    ]);
    expect(primarySet).toEqual([['primaryParty', { actor: party }, 'dnd5e']]);
  });

  it('sets the only group as primary instead of making another', async () => {
    const lone = { id: 'g9', name: 'Old group', type: 'group', hasPlayerOwner: false };
    install([hero, lone], false);
    party.id = 'g9';
    actors.contents = [hero, Object.assign(party, lone, { id: 'g9' })];
    expect(await syncParty()).toEqual(['Hero']);
    expect(created).toHaveLength(0);
    expect(primarySet).toHaveLength(1);
  });

  it('adds a character once: an undone addition stays out after a reload', async () => {
    install([hero, cleric], true);
    await syncParty();
    members.splice(0, members.length, { actor: cleric });
    expect(await syncParty()).toEqual([]);
    expect(members.map(m => m.actor.id)).toEqual(['a2']);
  });

  it('counts a character that is already a member as added', async () => {
    install([hero], true);
    members.push({ actor: hero });
    expect(await syncParty()).toEqual([]);
    expect((done as { ids: string[] }).ids).toEqual(['a1']);
  });

  it('breaks the change group around each addition', async () => {
    install([hero, cleric], true);
    const spy = vi.spyOn(changeJournal, 'breakGroup');
    await syncParty();
    expect(spy).toHaveBeenCalledTimes(4);
    spy.mockRestore();
  });

  it('makes no party when no player owns a character', async () => {
    install([gmChar, wolf], false);
    expect(await syncParty()).toEqual([]);
    expect(created).toHaveLength(0);
  });

  it('does nothing on a GM who is not the active one', async () => {
    install([hero], false);
    activeGm = 'gm2';
    expect(await syncParty()).toEqual([]);
    expect(created).toHaveLength(0);
    expect(members).toHaveLength(0);
  });

  it('does nothing with the setting off', async () => {
    install([hero], true);
    enabled = false;
    expect(await syncParty()).toEqual([]);
    expect(members).toHaveLength(0);
  });
});
