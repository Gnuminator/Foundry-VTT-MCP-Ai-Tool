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
 * Someone the GM takes out of the party by hand is added again at the next world load; switch the
 * setting off to manage the party yourself.
 */
import { MODULE_ID } from './constants.js';

/** World setting key. */
export const PARTY_AUTO_SETTING = 'partyAuto';

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

/** Make the group "Party" and set it as the primary party. */
async function createParty(): Promise<GroupLike | null> {
  const ActorCls = (globalThis as unknown as { Actor?: { create(data: object): Promise<unknown> } })
    .Actor;
  if (!ActorCls) return null;
  const group = (await ActorCls.create({
    name: 'Party',
    type: 'group',
    system: { type: { value: 'party' } },
  })) as GroupLike | undefined;
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
  const wanted = contentsOf(rec(gameRec()?.actors)).filter(isPlayerCharacter);
  if (wanted.length === 0) return [];
  let party = primaryParty();
  if (!party) {
    party = await createParty();
    if (!party) return [];
  }
  const added: string[] = [];
  for (const actor of wanted) {
    const id = rec(actor)?.id;
    if (typeof id !== 'string' || memberIds(party).has(id)) continue;
    if (!party.system?.addMember) return added;
    try {
      await party.system.addMember(actor);
      added.push(String(rec(actor)?.name ?? id));
    } catch (error) {
      console.warn(`[${MODULE_ID}] party: could not add ${String(rec(actor)?.name ?? id)}`, error);
    }
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
