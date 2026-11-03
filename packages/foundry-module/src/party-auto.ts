/**
 * Automatic party: Foundry keeps a dnd5e primary party and puts every player character in it, so
 * the GM never has to make one by hand (the dashboard's "Ask the party" needs it outside combat).
 *
 * - Runs on the active GM's client only (`game.users.activeGM`), so two GMs never add the same
 *   character twice. A player's browser never writes.
 * - When there is no primary party (dnd5e setting `primaryParty`, read as `game.actors.party`), it
 *   creates a group actor "Party" and sets it as the primary party.
 * - Eligible: a `character` actor that a player owns (`hasPlayerOwner`). NPCs, GM-only actors and
 *   actors no player owns stay out. A member is never added twice.
 * - When: at `ready` (the characters that exist), on `createActor` and when an actor's ownership
 *   changes (a new character, or one that gets a player owner later).
 * - Every addition is an ordinary update of the group actor from the GM's browser, so the change
 *   journal files it under Recent Changes, Everyone, with Undo. There is no bridge handler.
 * - The world setting "AI Tool: Add player characters to the party" (default on) turns it off.
 *
 * A character is added once (its id goes into a hidden world setting), so someone the GM takes out
 * of the party by hand, or an addition that was undone, stays out. One sync is one write and its
 * own change group, so Undo takes back that batch and not the edit made just before it. Undo only
 * works cleanly on the newest batch (a later change to the member list is kept), so to take one
 * older character out, remove it on the party sheet.
 */
import { changeJournal } from './change-journal.js';
import { MODULE_ID } from './constants.js';

/** World setting key. */
export const PARTY_AUTO_SETTING = 'partyAuto';

/** Hidden world setting: the actor ids already added once, so an Undo or a removal sticks. */
export const PARTY_AUTO_DONE_SETTING = 'partyAutoDone';

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | null {
  return value !== null && typeof value === 'object' ? (value as Rec) : null;
}

function contentsOf(collection: unknown): unknown[] {
  if (Array.isArray(collection)) return collection;
  const contents = rec(collection)?.contents;
  return Array.isArray(contents) ? contents : [];
}

function gameRec(): Rec | null {
  return rec((globalThis as { game?: unknown }).game);
}

/** Register the setting. Call from the module `init` hook. */
export function registerPartyAutoSettings(): void {
  game.settings.register(MODULE_ID, PARTY_AUTO_SETTING, {
    name: 'AI Tool: Add player characters to the party',
    hint: 'Keeps a dnd5e party and adds every character a player owns to it by itself, so "Ask the party" and the party tools work without setting a party up. Makes a group "Party" when there is none. NPCs and actors no player owns stay out. Each addition shows in Recent Changes with Undo. Switch off to manage the party yourself.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });
  game.settings.register(MODULE_ID, PARTY_AUTO_DONE_SETTING, {
    name: 'Party: characters already added',
    hint: 'The actors the automatic party added once. Not shown.',
    scope: 'world',
    config: false,
    type: Object,
    default: { parties: {} },
  });
}

/** The stored lists, one per party id (an older single `{ partyId, ids }` list reads as one entry). */
function storedParties(): Record<string, string[]> {
  try {
    const stored = rec(game.settings.get(MODULE_ID, PARTY_AUTO_DONE_SETTING));
    const out: Record<string, string[]> = {};
    const strings = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((i): i is string => typeof i === 'string') : [];
    const parties = rec(stored?.parties);
    if (parties) for (const [id, ids] of Object.entries(parties)) out[id] = strings(ids);
    else if (typeof stored?.partyId === 'string') out[stored.partyId] = strings(stored.ids);
    return out;
  } catch {
    return {};
  }
}

/** The ids already added to the party `partyId`; a party never seen before starts empty. */
function doneIds(partyId: string | undefined): Set<string> {
  return new Set((partyId && storedParties()[partyId]) || []);
}

/** Whether the GM left it on. A setting that is not registered counts as off. */
export function partyAutoEnabled(): boolean {
  try {
    return game.settings.get(MODULE_ID, PARTY_AUTO_SETTING) === true;
  } catch {
    return false;
  }
}

/** True when this browser is the active GM's. */
export function isActiveGm(): boolean {
  const g = gameRec();
  const active = rec(rec(g?.users)?.activeGM);
  const own = rec(g?.user);
  return typeof active?.id === 'string' && active.id === own?.id;
}

interface GroupLike {
  id?: string;
  /** The stored data: `system.members` entries are `{ actor: id, ... }`. */
  _source?: unknown;
  system?: { members?: unknown };
  update?: (data: object) => Promise<unknown>;
}

/** A player-owned character. */
export function isPlayerCharacter(actor: unknown): boolean {
  const a = rec(actor);
  return a?.type === 'character' && a.hasPlayerOwner === true;
}

function memberIds(group: GroupLike): Set<string> {
  const ids = new Set<string>();
  for (const entry of contentsOf(group.system?.members)) {
    const id = rec(rec(entry)?.actor)?.id;
    if (typeof id === 'string') ids.add(id);
  }
  return ids;
}

/** The primary party, or null. */
function primaryParty(): GroupLike | null {
  return rec(rec(gameRec()?.actors)?.party);
}

/**
 * A group that is safe to adopt as the primary party: one this module filled before (the GM took
 * its primary mark away), else the only group there is, holding only player characters (or
 * nobody), and not a sweep fixture.
 */
function adoptableGroup(): GroupLike | null {
  const groups = contentsOf(rec(gameRec()?.actors)).filter(a => rec(a)?.type === 'group');
  const known = storedParties();
  const earlier = groups.find(a => {
    const id = rec(a)?.id;
    return typeof id === 'string' && id in known;
  });
  if (earlier) return rec(earlier);
  if (groups.length !== 1) return null;
  const group = groups[0] as GroupLike & { name?: string };
  if (String(group.name ?? '').startsWith('AI Tool Sweep')) return null;
  for (const entry of contentsOf(group.system?.members)) {
    if (!isPlayerCharacter(rec(entry)?.actor)) return null;
  }
  return group;
}

/**
 * Make the primary party: the group the GM left without a primary mark, else a new group
 * "Party". Either way it becomes the dnd5e primary party.
 */
async function makeParty(): Promise<GroupLike | null> {
  let group: GroupLike | null = adoptableGroup();
  if (!group) {
    const ActorCls = (
      globalThis as unknown as { Actor?: { create(data: object): Promise<unknown> } }
    ).Actor;
    if (!ActorCls) return null;
    // Its own row in Recent Changes, never a follow-up of the GM's edit that triggered this.
    changeJournal.breakGroup();
    group =
      ((await ActorCls.create({ name: 'Party', type: 'group' })) as GroupLike | undefined) ?? null;
    changeJournal.breakGroup();
  }
  if (!group?.id) return null;
  await game.settings.set('dnd5e', 'primaryParty', { actor: group });
  return primaryParty() ?? group;
}

/** Runs one at a time, so a burst of hooks never adds a character twice. */
let chain: Promise<void> = Promise.resolve();

/**
 * Add every player-owned character that is not yet a member, creating the party first when there
 * is none. A no-op on a player's browser, on a GM who is not the active one, and with the setting
 * off. Returns the names added.
 */
export function syncParty(): Promise<string[]> {
  const run = chain.then(doSync, doSync);
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function doSync(): Promise<string[]> {
  if (!partyAutoEnabled() || !isActiveGm()) return [];
  const eligible = contentsOf(rec(gameRec()?.actors)).filter(isPlayerCharacter);
  if (eligible.length === 0) return [];
  // A missing party is always made again (the GM deleted it, or an Undo took it away).
  let party = primaryParty();
  if (!party) {
    party = await makeParty();
    if (!party) return [];
  }
  // Added once is enough: a character the GM took out of the party, or an addition that was
  // undone, stays out. A character that is already a member counts as added. The list belongs
  // to one party, so a new party is filled again.
  const done = doneIds(party.id);
  const members = memberIds(party);
  const fresh: unknown[] = [];
  for (const actor of eligible) {
    const id = rec(actor)?.id;
    if (typeof id !== 'string' || done.has(id)) continue;
    done.add(id);
    if (!members.has(id)) fresh.push(actor);
  }
  if (fresh.length > 0 && typeof party.update === 'function') {
    // One write for everyone: dnd5e's addMember rewrites the whole member list each time, so one
    // update per sync is what Undo can take back cleanly. Its own row in Recent Changes, never a
    // follow-up of the ownership edit that made a character eligible.
    const current = rec(rec(party._source)?.system)?.members;
    const kept: unknown[] = Array.isArray(current)
      ? (current as unknown[])
      : contentsOf(party.system?.members).map(m => ({ actor: rec(rec(m)?.actor)?.id }));
    const next = [...kept, ...fresh.map(a => ({ actor: rec(a)?.id }))];
    changeJournal.breakGroup();
    await party.update({ 'system.members': next });
    changeJournal.breakGroup();
  }
  // No write (and no broadcast to every client) when nothing changed.
  const parties = storedParties();
  const before = party.id ? parties[party.id] : undefined;
  if (party.id && before?.length !== done.size) {
    await game.settings.set(MODULE_ID, PARTY_AUTO_DONE_SETTING, {
      parties: { ...parties, [party.id]: [...done] },
    });
  }
  return fresh.map(a => String(rec(a)?.name ?? rec(a)?.id));
}

function quiet(task: () => Promise<unknown>): void {
  void task().catch(error => console.warn(`[${MODULE_ID}] party auto failed:`, error));
}

/** Register the hooks. Call once from the module `init` hook (the work waits for `ready`). */
export function registerPartyAuto(): void {
  let ready = false;
  Hooks.once('ready', () => {
    ready = true;
    quiet(syncParty);
  });
  Hooks.on('createActor', () => {
    if (ready) quiet(syncParty);
  });
  Hooks.on('updateActor', (_actor: unknown, changes: unknown) => {
    if (ready && rec(changes) && 'ownership' in (changes as Rec)) quiet(syncParty);
  });
}
