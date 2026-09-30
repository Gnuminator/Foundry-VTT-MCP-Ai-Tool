/**
 * Party scan (idea I-079): a read-only look at the dnd5e 6 group actors for
 * the dashboard's Party drawer. Runs on the GM client.
 *
 * - Groups: actors of type `group`; the primary party (`game.actors.party`,
 *   dnd5e setting `primaryParty`) comes first.
 * - Members: `system.members[].actor`, with the numbers a GM glances at.
 * - Pace: `system.getTravelPace()` (dnd5e 6), which also says whether a
 *   slowed member forces slow pace; falls back to `attributes.travel.pace`.
 * - Tokens: member tokens on the encounter's scene, else the active scene,
 *   and whether each is a combatant already.
 * - Rest cards: the chat data of a party rest request, built like dnd5e's
 *   `GroupData#rest` (`type: "request"`, `handler: "rest"`, the members as
 *   targets), so the bridge can post it as a guarded create.
 *
 * The wire contract is `shared/src/party.ts`; only its types are imported
 * (the browser cannot resolve `@gnuminator/shared` at runtime). The query name
 * and feature id are mirrored here and pinned by `party-scan.test.ts`.
 */
import type {
  PartyEncounter,
  PartyGroup,
  PartyMember,
  PartyMemberToken,
  PartyPace,
  PartyRestCard,
  PartyRestType,
  PartyState,
} from '@gnuminator/shared';

import { statusEffectList } from './systems/dnd5e/status-effects.js';

/** Query name (mirror of the shared `PARTY_STATE_QUERY`). */
export const PARTY_STATE_QUERY = 'getPartyState';

/** Guarded feature id (mirror of the shared `PARTY_FEATURE_ID`). */
export const PARTY_FEATURE_ID = 'party';

/** Mirror of the shared `PARTY_REST_TYPES`. */
export const PARTY_REST_TYPES: readonly PartyRestType[] = ['short', 'long'];

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | null {
  return value !== null && typeof value === 'object' ? (value as Rec) : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** `collection.contents` read defensively (Foundry `Collection#contents`), else an array as is. */
function contentsOf(collection: unknown): unknown[] {
  if (Array.isArray(collection)) return collection;
  const contents = rec(collection)?.contents;
  return Array.isArray(contents) ? contents : [];
}

function localize(key: string): string {
  const i18n = rec(rec(game as unknown)?.i18n);
  const fn = i18n?.localize;
  return typeof fn === 'function' ? String(fn.call(i18n, key)) : key;
}

function dnd5eConfig(): Rec | null {
  return rec(rec(CONFIG as unknown)?.DND5E);
}

// ---------------------------------------------------------------------------
// Scene and encounter
// ---------------------------------------------------------------------------

function activeScene(): Rec | null {
  const scenes = rec(rec(game as unknown)?.scenes);
  const active = rec(scenes?.active);
  if (active) return active;
  return (
    (contentsOf(scenes)
      .map(rec)
      .find(s => s?.active === true) as Rec | undefined) ?? null
  );
}

function sceneById(id: string | null): Rec | null {
  if (!id) return null;
  return (
    (contentsOf(rec(game as unknown)?.scenes)
      .map(rec)
      .find(s => s?.id === id) as Rec | undefined) ?? null
  );
}

function currentCombat(): Rec | null {
  return rec(rec(game as unknown)?.combat);
}

function combatantsOf(combat: Rec | null): Rec[] {
  if (!combat) return [];
  const list = contentsOf(combat.combatants);
  const all = list.length > 0 ? list : contentsOf(combat.turns);
  return all.map(rec).filter((c): c is Rec => c !== null);
}

function encounterOf(combat: Rec | null): PartyEncounter | null {
  const combatId = str(combat?.id);
  if (!combat || !combatId) return null;
  return {
    combatId,
    uuid: str(combat.uuid) ?? `Combat.${combatId}`,
    round: num(combat.round) ?? 0,
    started: combat.started === true,
  };
}

/** The encounter's scene (by object or id), else the active scene. */
function tokenScene(combat: Rec | null): Rec | null {
  const own = rec(combat?.scene) ?? sceneById(str(combat?.scene) ?? str(combat?.sceneId));
  return own ?? activeScene();
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

function conditionLabels(actor: Rec): string[] {
  const statuses = actor.statuses;
  const ids =
    statuses && typeof (statuses as Iterable<unknown>)[Symbol.iterator] === 'function'
      ? Array.from(statuses as Iterable<unknown>).filter((s): s is string => typeof s === 'string')
      : [];
  const effects = statusEffectList();
  return ids
    .filter(id => id !== 'exhaustion')
    .map(id => {
      const effect = effects.find(e => e.id === id);
      const name = str(effect?.name) ?? str((effect as Rec | undefined)?.label);
      return name ? localize(name) : id;
    })
    .sort((a, b) => a.localeCompare(b));
}

function hitPoints(attributes: Rec | null): PartyMember['hp'] {
  const hp = rec(attributes?.hp);
  const value = num(hp?.value);
  const max = num(hp?.effectiveMax) ?? num(hp?.max);
  if (value === null || max === null) return null;
  return { value, max, temp: num(hp?.temp) ?? 0 };
}

function hitDice(attributes: Rec | null): PartyMember['hitDice'] {
  const hd = rec(attributes?.hd);
  const value = num(hd?.value);
  const max = num(hd?.max);
  return value === null || max === null || max === 0 ? null : { value, max };
}

function memberTokens(actorId: string, scene: Rec | null, combat: Rec | null): PartyMemberToken[] {
  if (!scene) return [];
  const sceneId = str(scene.id);
  const inCombat = new Set(
    combatantsOf(combat)
      .filter(c => (str(c.sceneId) ?? sceneId) === sceneId)
      .map(c => str(c.tokenId))
      .filter((id): id is string => id !== null)
  );
  const out: PartyMemberToken[] = [];
  for (const token of contentsOf(scene.tokens)) {
    const t = rec(token);
    const tokenId = str(t?.id);
    if (!t || !tokenId || str(t.actorId) !== actorId) continue;
    out.push({
      tokenId,
      name: str(t.name) ?? '',
      hidden: t.hidden === true,
      inCombat: inCombat.has(tokenId),
    });
  }
  return out;
}

function memberOf(actor: Rec, scene: Rec | null, combat: Rec | null): PartyMember | null {
  const actorId = str(actor.id);
  if (!actorId) return null;
  const system = rec(actor.system);
  const attributes = rec(system?.attributes);
  const hp = hitPoints(attributes);
  const death = rec(attributes?.death);
  return {
    actorId,
    uuid: str(actor.uuid) ?? `Actor.${actorId}`,
    name: str(actor.name) ?? '',
    type: str(actor.type) ?? '',
    level: num(rec(system?.details)?.level),
    hp,
    ac: num(rec(attributes?.ac)?.value),
    passivePerception: num(rec(rec(system?.skills)?.prc)?.passive),
    exhaustion: num(attributes?.exhaustion) ?? 0,
    hitDice: hitDice(attributes),
    deathSaves:
      hp && hp.value <= 0 && death
        ? { success: num(death.success) ?? 0, failure: num(death.failure) ?? 0 }
        : null,
    conditions: conditionLabels(actor),
    inspiration: attributes?.inspiration === true,
    tokens: memberTokens(actorId, scene, combat),
  };
}

// ---------------------------------------------------------------------------
// Pace and rest cards
// ---------------------------------------------------------------------------

function paceOptions(): PartyState['paceOptions'] {
  const paces = rec(dnd5eConfig()?.travelPace);
  if (!paces) return [];
  return Object.entries(paces).map(([value, config]) => ({
    value,
    label: localize(str(rec(config)?.label) ?? value),
  }));
}

function paceOf(group: Rec): PartyPace | null {
  const system = rec(group.system);
  const getTravelPace = system?.getTravelPace;
  if (typeof getTravelPace === 'function') {
    try {
      const pace = rec(rec(getTravelPace.call(system))?.pace);
      const value = str(pace?.value);
      if (value) {
        return {
          value,
          label: localize(str(pace?.label) ?? value),
          slowed: pace?.slowed === true,
        };
      }
    } catch {
      // Fall through to the stored value.
    }
  }
  const value = str(rec(rec(system?.attributes)?.travel)?.pace);
  if (!value) return null;
  const label = str(rec(rec(dnd5eConfig()?.travelPace)?.[value])?.label) ?? value;
  return { value, label: localize(label), slowed: false };
}

function restVariant(): string {
  try {
    const settings = rec(rec(game as unknown)?.settings);
    const get = settings?.get;
    const value: unknown =
      typeof get === 'function' ? get.call(settings, 'dnd5e', 'restVariant') : null;
    return str(value) ?? 'normal';
  } catch {
    return 'normal';
  }
}

function speakerFor(group: Rec, name: string): Rec {
  const chat = rec((globalThis as Rec).ChatMessage);
  const getSpeaker = chat?.getSpeaker;
  if (typeof getSpeaker === 'function') {
    try {
      const speaker = rec(getSpeaker.call(chat, { actor: group, alias: name }));
      if (speaker) return { ...speaker };
    } catch {
      // Fall through to a plain speaker.
    }
  }
  return { actor: str(group.id), alias: name };
}

/**
 * The chat data of a party rest request, as dnd5e's `GroupData#rest` posts it
 * when auto-rest is off: each targeted player clicks the card to rest.
 */
function restCard(
  group: Rec,
  name: string,
  members: PartyMember[],
  type: PartyRestType
): PartyRestCard | null {
  const restConfig = rec(rec(dnd5eConfig()?.restTypes)?.[type]);
  if (!restConfig) return null;
  const newDay = restConfig.newDay === true;
  const duration = num(rec(restConfig.duration)?.[restVariant()]) ?? 0;
  const config = { type, duration, newDay };
  const createRestFlavor = group.createRestFlavor;
  let flavor = localize(str(restConfig.label) ?? type);
  if (typeof createRestFlavor === 'function') {
    try {
      flavor = String(createRestFlavor.call(group, config));
    } catch {
      // Keep the plain label.
    }
  }
  return {
    type: 'request',
    flavor,
    speaker: speakerFor(group, name),
    system: {
      button: {
        icon: str(restConfig.icon) ?? 'fa-solid fa-bed',
        label: localize(str(restConfig.label) ?? type),
      },
      data: { newDay, recoverTemp: false, recoverTempMax: false, type },
      handler: 'rest',
      targets: members.filter(m => m.hp !== null).map(m => ({ actor: m.uuid })),
    },
  };
}

// ---------------------------------------------------------------------------
// The query
// ---------------------------------------------------------------------------

function groupOf(
  group: Rec,
  primaryId: string | null,
  scene: Rec | null,
  combat: Rec | null
): PartyGroup | null {
  const actorId = str(group.id);
  if (!actorId) return null;
  const name = str(group.name) ?? '';
  const system = rec(group.system);
  const members: PartyMember[] = [];
  for (const entry of contentsOf(system?.members)) {
    const actor = rec(rec(entry)?.actor);
    if (!actor) continue;
    const member = memberOf(actor, scene, combat);
    if (member) members.push(member);
  }
  const restCards: PartyGroup['restCards'] = {};
  for (const type of PARTY_REST_TYPES) {
    const card = restCard(group, name, members, type);
    if (card) restCards[type] = card;
  }
  return {
    actorId,
    uuid: str(group.uuid) ?? `Actor.${actorId}`,
    name,
    primary: actorId === primaryId,
    level: num(system?.level) ?? 0,
    pace: paceOf(group),
    members,
    restCards,
  };
}

export function getPartyState(): PartyState {
  const warnings: string[] = [];
  if (!dnd5eConfig()) warnings.push('The dnd5e system is not loaded, so there are no parties.');
  const actors = rec(rec(game as unknown)?.actors);
  const primaryId = str(rec(actors?.party)?.id);
  const combat = currentCombat();
  const scene = tokenScene(combat);
  const groups: PartyGroup[] = [];
  for (const actor of contentsOf(actors)) {
    const a = rec(actor);
    if (!a || a.type !== 'group') continue;
    try {
      const group = groupOf(a, primaryId, scene, combat);
      if (group) groups.push(group);
    } catch (error) {
      warnings.push(
        `Could not read the group "${str(a.name) ?? '?'}": ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  groups.sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name));
  const sceneId = str(scene?.id);
  return {
    groups,
    paceOptions: paceOptions(),
    scene: sceneId ? { sceneId, name: str(scene?.name) ?? '' } : null,
    encounter: encounterOf(combat),
    warnings,
  };
}
