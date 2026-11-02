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
 * of the party by hand, or an addition that was undone, stays out. Each addition is its own change
 * group, so Undo takes back only the party and not the edit made just before it.
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
    default: { ids: [] },
  });
}

function doneIds(): Set<string> {
  try {
    const ids = rec(game.settings.get(MODULE_ID, PARTY_AUTO_DONE_SETTING))?.ids;
    return new Set(Array.isArray(ids) ? ids.filter((i): i is string => typeof i === 'string') : []);
  } catch {
    return new Set();
  }
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
  system?: { members?: unknown; addMember?(actor: unknown): Promise<unknown> };
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
  const party = rec(rec(gameRec()?.actors)?.party);
  return party ? (party as GroupLike) : null;
}

/**
 * Make the primary party: the only group there is (the GM made it and never set it as primary),
 * else a new group "Party". Either way it becomes the dnd5e primary party.
 */
async function makeParty(): Promise<GroupLike | null> {
  const groups = contentsOf(rec(gameRec()?.actors)).filter(a => rec(a)?.type === 'group');
  let group: GroupLike | null = groups.length === 1 ? (groups[0] as GroupLike) : null;
  if (!group) {
    const ActorCls = (
      globalThis as unknown as { Actor?: { create(data: object): Promise<unknown> } }
    ).Actor;
    if (!ActorCls) return null;
    group =
      ((await ActorCls.create({
        name: 'Party',
        type: 'group',
        system: { type: { value: 'party' } },
      })) as GroupLike | undefined) ?? null;
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
  // Added once is enough: a character the GM took out of the party, or an addition that was
  // undone, stays out. A character that is already a member counts as added.
  const done = doneIds();
  const wanted = contentsOf(rec(gameRec()?.actors))
    .filter(isPlayerCharacter)
    .filter(a => !done.has(String(rec(a)?.id)));
  if (wanted.length === 0) return [];
  let party = primaryParty();
  if (!party) {
    party = await makeParty();
    if (!party) return [];
  }
  const members = memberIds(party);
  const added: string[] = [];
  const before = done.size;
  for (const actor of wanted) {
    const id = rec(actor)?.id;
    if (typeof id !== 'string') continue;
    if (members.has(id)) {
      done.add(id);
      continue;
    }
    if (!party.system?.addMember) break;
    try {
      // Each addition is its own row in Recent Changes, never a follow-up of the edit before it
      // (the ownership change that made the character eligible), so Undo takes back only the party.
      changeJournal.breakGroup();
      await party.system.addMember(actor);
      changeJournal.breakGroup();
      done.add(id);
      members.add(id);
      added.push(String(rec(actor)?.name ?? id));
    } catch (error) {
      console.warn(`[${MODULE_ID}] party: could not add ${String(rec(actor)?.name ?? id)}`, error);
    }
  }
  if (done.size !== before) {
    await game.settings.set(MODULE_ID, PARTY_AUTO_DONE_SETTING, { ids: [...done] });
  }
  return added;
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
