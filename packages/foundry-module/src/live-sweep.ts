import { MODULE_ID } from './constants.js';
import { featureSettingKey, isKnownFeature } from './guarded-features.js';
import { viewedScene } from './viewed-scene.js';

/**
 * Test-world helper for the live write sweep (I-016, `scripts/live-write-sweep.mjs`).
 *
 * The sweep runs the direct-write tools against the local test world and puts back what
 * it can through the tools themselves (moves tokens back, heals, removes notes and
 * templates). Three things the tool API cannot do, so this query does them:
 *
 * - `snapshot`: the active scene's darkness and global light (no read tool shows them),
 *   so the sweep can restore them after a `plan-scene-change` mood step.
 * - `combat`: start a combat on the active scene with the given tokens (no tool creates a
 *   combat), so the combat tools have something to act on.
 * - `concentration`: a concentration effect on one sweep actor with a dependent effect on
 *   another, linked as dnd5e links them, for the undo and redo check of an AI-ended
 *   concentration.
 * - `switches`: turn guarded feature switches on or off (the Obsidian mirror's is not one of
 *   the session switches) and give back what they were, so the sweep can put them back.
 * - `fixture`: the world documents the party, playlist and handout tools need and no tool makes
 *   (a party group, a playlist with one sound, a journal that players can open with a page
 *   they cannot), and `playlist-state` to read whether a sweep playlist is playing.
 * - `cleanup` (the default): close the dialogs that `use-item` leaves open on a sweep actor's item
 *   (Foundry keeps them after the actor is gone), then delete the world documents and tokens the sweep named with
 *   {@link SWEEP_PREFIX} (NPCs, journals, items, folders, its wolf token), plus the chat
 *   messages and combats created since the run started.
 *
 * Test worlds only: every mode refuses unless the world id is in {@link SWEEP_WORLD_IDS},
 * whatever the caller says, so it can never touch a real campaign. It is not an MCP tool:
 * the bridge reaches it through a control method the dashboard calls (`live_sweep`), so
 * Claude never sees it. GM client only; "Allow Write Operations" gates it like every
 * other write (write-gate.ts).
 */

/** Query name. */
export const LIVE_SWEEP_QUERY = 'liveSweep';

/**
 * The only worlds the helper runs in: the local test server's everyday test world and the module
 * walkthrough's copy of the old campaign world. Never a real campaign, never `ai-tool-kit`
 * (licensed content). `scripts/test-worlds.mjs` keeps the same list for the live scripts; a test
 * pins the two copies together.
 */
export const SWEEP_WORLD_IDS: readonly string[] = Object.freeze([
  'ai-tool-test',
  'ai-tool-walkthrough',
]);

/** The everyday test world (the first of {@link SWEEP_WORLD_IDS}). */
export const SWEEP_WORLD_ID = 'ai-tool-test';

/** Every world-level document the sweep creates starts with this name. */
export const SWEEP_PREFIX = 'AI Tool Sweep';

/** Deleted count per collection, and the names of the named documents deleted. */
export interface SweepCleanupResult {
  mode: 'cleanup';
  world: string;
  deleted: Record<string, number>;
  names: string[];
}

/** The active scene's lighting, as a `plan-scene-change` mood step takes it. */
export interface SweepSnapshotResult {
  mode: 'snapshot';
  sceneId: string | null;
  sceneName: string | null;
  darkness: number | null;
  globalLight: boolean | null;
}

/** The combat started for the sweep. */
export interface SweepCombatResult {
  mode: 'combat';
  combatId: string;
  combatants: string[];
}

/** The concentration effect and the dependent effect the helper made (see `concentration`). */
export interface SweepConcentrationResult {
  mode: 'concentration';
  effectUuid: string;
  dependentUuid: string;
}

/** The feature switches as they were before a `switches` call, by feature id. */
export interface SweepSwitchesResult {
  mode: 'switches';
  before: Record<string, boolean>;
}

/** A fixture the helper made (`fixture`): its kind, id and the names the sweep looks up. */
export interface SweepFixtureResult {
  mode: 'fixture';
  kind: string;
  id: string;
  name: string;
  /** handout: the page's uuid. */
  pageUuid?: string;
  /** playlist: the playlist's sound id. */
  soundId?: string;
}

/** Whether a sweep playlist is playing (`playlist-state`). */
export interface SweepPlaylistStateResult {
  mode: 'playlist-state';
  id: string;
  name: string;
  playing: boolean;
}

export type LiveSweepResult =
  | SweepCleanupResult
  | SweepSnapshotResult
  | SweepCombatResult
  | SweepConcentrationResult
  | SweepSwitchesResult
  | SweepFixtureResult
  | SweepPlaylistStateResult;

interface LiveSweepRequest {
  mode?: unknown;
  /** cleanup: run start (ms since epoch); chat messages and combats created since then go too. */
  since?: unknown;
  /** combat: token ids on the active scene. */
  tokenIds?: unknown;
  /** concentration: the caster's and the target's actor ids; fixture party: the members. */
  actorIds?: unknown;
  /** switches: feature id -> on or off. */
  switches?: unknown;
  /** fixture: playlist, party or handout. */
  kind?: unknown;
  /** playlist-state: the playlist id. */
  id?: unknown;
}

interface SweepActor {
  uuid: string;
  createEmbeddedDocuments(type: string, data: Record<string, unknown>[]): Promise<SweepEffect[]>;
}

interface SweepEffect {
  uuid: string;
  update(data: Record<string, unknown>): Promise<unknown>;
}

/** World collections whose sweep-made documents are found by name, with their type. */
const NAMED_COLLECTIONS: ReadonlyArray<readonly [string, string]> = [
  ['actors', 'Actor'],
  ['items', 'Item'],
  ['journal', 'JournalEntry'],
  ['scenes', 'Scene'],
  ['tables', 'RollTable'],
  ['playlists', 'Playlist'],
];

/** World collections whose sweep-made documents are found by creation time. */
const TIMED_COLLECTIONS = ['messages', 'combats'] as const;

/** The parts of a Foundry document the helper uses. */
interface SweepDoc {
  id?: string;
  name?: string;
  actorId?: string;
  _stats?: { createdTime?: unknown };
  delete(options?: Record<string, unknown>): Promise<unknown>;
}

interface SweepCollection {
  filter(predicate: (doc: SweepDoc) => boolean): SweepDoc[];
}

interface SweepScene {
  id: string;
  name?: string;
  darkness?: unknown;
  environment?: { darknessLevel?: unknown; globalLight?: { enabled?: unknown } };
  tokens?: { get(id: string): SweepDoc | undefined; filter?: SweepCollection['filter'] };
}

interface SweepCombat {
  id: string;
  createEmbeddedDocuments(type: string, data: Record<string, unknown>[]): Promise<unknown>;
  update(data: Record<string, unknown>): Promise<unknown>;
}

interface SweepGame {
  world?: { id?: string };
  scenes?: { current?: SweepScene | null };
  [collection: string]: unknown;
}

const sweepGame = (): SweepGame => game as unknown as SweepGame;

function collection(key: string): SweepCollection | null {
  return collectionOf(sweepGame()[key]);
}

function collectionOf(value: unknown): SweepCollection | null {
  const c = value as SweepCollection | undefined;
  return c && typeof c.filter === 'function' ? c : null;
}

function createdTime(doc: SweepDoc): number {
  const t = doc._stats?.createdTime;
  return typeof t === 'number' ? t : 0;
}

function hasSweepName(doc: SweepDoc): boolean {
  return String(doc.name ?? '').startsWith(SWEEP_PREFIX);
}

/** Run one mode; refuses outside the test worlds. */
export async function liveSweep(data: unknown): Promise<LiveSweepResult> {
  const worldId = String(sweepGame().world?.id ?? '');
  if (!SWEEP_WORLD_IDS.includes(worldId)) {
    throw new Error(
      `The live sweep helper runs only in the test world ${SWEEP_WORLD_IDS.map(w => `"${w}"`).join(' or ')} (this is "${worldId}")`
    );
  }
  const request = (data ?? {}) as LiveSweepRequest;
  switch (request.mode ?? 'cleanup') {
    case 'snapshot':
      return snapshot();
    case 'combat':
      return startCombat(request.tokenIds);
    case 'concentration':
      return concentration(request.actorIds);
    case 'switches':
      return setSwitches(request.switches);
    case 'fixture':
      return makeFixture(request.kind, request.actorIds);
    case 'playlist-state':
      return playlistState(request.id);
    case 'cleanup':
      return cleanup(worldId, request.since);
    default:
      throw new Error(`Unknown live sweep mode: ${String(request.mode)}`);
  }
}

function snapshot(): SweepSnapshotResult {
  const scene = viewedScene(sweepGame().scenes) ?? null;
  const env = scene?.environment;
  const darkness = env?.darknessLevel ?? scene?.darkness;
  const globalLight = env?.globalLight?.enabled;
  return {
    mode: 'snapshot',
    sceneId: scene?.id ?? null,
    sceneName: scene?.name ?? null,
    darkness: typeof darkness === 'number' ? darkness : null,
    globalLight: typeof globalLight === 'boolean' ? globalLight : null,
  };
}

async function startCombat(tokenIds: unknown): Promise<SweepCombatResult> {
  const scene = viewedScene(sweepGame().scenes);
  if (!scene) throw new Error('No active scene');
  const ids = Array.isArray(tokenIds) ? tokenIds.map(String) : [];
  const tokens = ids.map(id => scene.tokens?.get(id)).filter((t): t is SweepDoc => t !== undefined);
  if (tokens.length === 0) throw new Error('None of the given tokens is on the active scene');

  const foundry = globalThis as unknown as {
    CONFIG?: { Combat?: { documentClass?: { create(data: object): Promise<SweepCombat> } } };
    Hooks?: { callAll(name: string, ...args: unknown[]): unknown };
  };
  const CombatClass = foundry.CONFIG?.Combat?.documentClass;
  if (!CombatClass) throw new Error('Combat document class not found');
  const combat = await CombatClass.create({ scene: scene.id, active: true });
  await combat.createEmbeddedDocuments(
    'Combatant',
    tokens.map(t => ({ tokenId: t.id, sceneId: scene.id, actorId: t.actorId }))
  );
  // Mirrors Foundry 14's Combat#startCombat (the combatStart hook, then round 1, turn 0) without
  // calling it: modules wrap startCombat with a confirm dialog (Monk's Combat Details: "Not all
  // Initiative have been rolled"), which no one clicks in a scripted run, so the query timed out.
  const start = { round: 1, turn: 0 };
  foundry.Hooks?.callAll('combatStart', combat, start);
  await combat.update(start);
  return { mode: 'combat', combatId: combat.id, combatants: tokens.map(t => String(t.name)) };
}

/**
 * A concentration as dnd5e links it: an effect on the caster whose `flags.dnd5e.dependents`
 * names an effect on the target, so dnd5e deletes the target's effect when the caster's goes
 * (the sweep checks that an AI delete of the caster's effect, its undo and its redo take the
 * dependent along). Both carry the sweep prefix; the actors are the sweep's own, so the
 * clean-up removes what is left.
 */
async function concentration(actorIds: unknown): Promise<SweepConcentrationResult> {
  const ids = Array.isArray(actorIds) ? actorIds.map(String) : [];
  const actors = sweepGame().actors as { get(id: string): SweepActor | undefined } | undefined;
  const caster = ids[0] ? actors?.get(ids[0]) : undefined;
  const target = ids[1] ? actors?.get(ids[1]) : undefined;
  if (!caster || !target) throw new Error('concentration needs two actor ids: caster, target');
  // dnd5e 6 follows the link only to an effect whose `origin` is the concentration effect
  // (ActiveEffect5e#getDependents), so the caster's effect comes first.
  const [effect] = await caster.createEmbeddedDocuments('ActiveEffect', [
    { name: `${SWEEP_PREFIX} Concentrating`, img: 'icons/svg/aura.svg' },
  ]);
  const [dependent] = await target.createEmbeddedDocuments('ActiveEffect', [
    { name: `${SWEEP_PREFIX} Held`, img: 'icons/svg/paralysis.svg', origin: effect.uuid },
  ]);
  await effect.update({ 'flags.dnd5e.dependents': [{ uuid: dependent.uuid }] });
  return { mode: 'concentration', effectUuid: effect.uuid, dependentUuid: dependent.uuid };
}

interface SweepSettings {
  get(module: string, key: string): unknown;
  set(module: string, key: string, value: unknown): Promise<unknown>;
}

/** Turn feature switches on or off; `before` has what each was, for the sweep to put back. */
async function setSwitches(wanted: unknown): Promise<SweepSwitchesResult> {
  const entries =
    wanted && typeof wanted === 'object' && !Array.isArray(wanted) ? Object.entries(wanted) : [];
  if (entries.length === 0) throw new Error('switches needs { featureId: true | false }');
  const settings = (game as unknown as { settings: SweepSettings }).settings;
  // Check every entry before setting any, so a bad id leaves no switch changed.
  for (const [id, on] of entries) {
    if (typeof on !== 'boolean' || !/^[a-z][a-z0-9-]*$/.test(id)) {
      throw new Error(`switches: "${id}" must be a feature id with true or false`);
    }
    if (!isKnownFeature(id)) throw new Error(`switches: "${id}" is not a guarded feature`);
  }
  const before: Record<string, boolean> = {};
  for (const [id, on] of entries) {
    const key = featureSettingKey(id);
    before[id] = settings.get(MODULE_ID, key) === true;
    await settings.set(MODULE_ID, key, on);
  }
  return { mode: 'switches', before };
}

interface SweepCreated {
  id: string;
  name?: string;
  uuid?: string;
  playing?: boolean;
  pages?: { contents: Array<{ uuid: string }> };
  sounds?: { contents: Array<{ id: string }> };
  system?: { addMember?(actor: unknown): Promise<unknown> };
}

function creator(documentName: string): (data: object) => Promise<SweepCreated> {
  const cls = (globalThis as unknown as Record<string, unknown>)[documentName] as
    | { create(data: object): Promise<SweepCreated> }
    | undefined;
  if (!cls || typeof cls.create !== 'function') throw new Error(`${documentName} is not available`);
  return data => cls.create(data);
}

/**
 * The documents the party, playlist and handout tools need and no tool makes. Every one carries
 * the sweep prefix, so `cleanup` removes it.
 */
async function makeFixture(kind: unknown, actorIds: unknown): Promise<SweepFixtureResult> {
  if (kind === 'playlist') {
    const name = `${SWEEP_PREFIX} Playlist`;
    const playlist = await creator('Playlist')({
      name,
      sounds: [{ name: `${SWEEP_PREFIX} Sound`, path: 'sounds/drums.wav', volume: 0.1 }],
    });
    const sound = playlist.sounds?.contents[0];
    return {
      mode: 'fixture',
      kind,
      id: playlist.id,
      name,
      ...(sound ? { soundId: sound.id } : {}),
    };
  }
  if (kind === 'party') {
    const name = `${SWEEP_PREFIX} Party`;
    const group = await creator('Actor')({
      name,
      type: 'group',
      system: { type: { value: 'party' } },
    });
    const actors = sweepGame().actors as { get(id: string): unknown } | undefined;
    const ids = Array.isArray(actorIds) ? actorIds.map(String) : [];
    for (const actorId of ids) {
      const actor = actors?.get(actorId);
      if (!actor) throw new Error(`party: no actor ${actorId}`);
      if (!group.system?.addMember) throw new Error('party: this system has no group members');
      await group.system.addMember(actor);
    }
    return { mode: 'fixture', kind, id: group.id, name };
  }
  if (kind === 'handout') {
    // Players can open the journal; its one page they cannot, so a reveal without a copy has
    // something to open up.
    const name = `${SWEEP_PREFIX} Handout`;
    const journal = await creator('JournalEntry')({
      name,
      ownership: { default: 2 },
      pages: [
        {
          name: `${SWEEP_PREFIX} Handout page`,
          type: 'text',
          text: { content: '<p>The sweep handout.</p>', format: 1 },
          ownership: { default: 0 },
        },
      ],
    });
    const pageUuid = journal.pages?.contents[0]?.uuid;
    if (!pageUuid) throw new Error('handout: the page was not created');
    return { mode: 'fixture', kind, id: journal.id, name, pageUuid };
  }
  throw new Error(`Unknown fixture kind: ${String(kind)}`);
}

function playlistState(id: unknown): SweepPlaylistStateResult {
  const playlists = sweepGame().playlists as
    | { get(id: string): SweepCreated | undefined }
    | undefined;
  const playlist = typeof id === 'string' ? playlists?.get(id) : undefined;
  if (!playlist) throw new Error(`playlist-state: no playlist ${String(id)}`);
  return {
    mode: 'playlist-state',
    id: playlist.id,
    name: String(playlist.name ?? ''),
    playing: playlist.playing === true,
  };
}

interface SweepApp {
  item?: { actor?: { name?: unknown } };
  close(): Promise<unknown>;
}

/**
 * `use-item` opens the item's activity dialog on the GM's screen and answers at once; the dialog
 * outlives the actor it belongs to. Close the ones that belong to a sweep actor.
 */
async function closeSweepDialogs(): Promise<number> {
  const instances = (
    globalThis as unknown as {
      foundry?: { applications?: { instances?: Map<string, SweepApp> } };
    }
  ).foundry?.applications?.instances;
  if (!instances) return 0;
  const open = [...instances.values()].filter(app => {
    // An application whose `item` getter throws is not ours; it must not stop the clean-up.
    try {
      const name = app.item?.actor?.name;
      return (typeof name === 'string' ? name : '').startsWith(SWEEP_PREFIX);
    } catch {
      return false;
    }
  });
  for (const app of open) await app.close();
  return open.length;
}

/**
 * Delete what the sweep made. Folders go last, with their contents (a folder delete in
 * Foundry keeps its contents unless asked otherwise).
 */
async function cleanup(worldId: string, sinceValue: unknown): Promise<SweepCleanupResult> {
  const since = typeof sinceValue === 'number' && sinceValue > 0 ? sinceValue : null;
  const deleted: Record<string, number> = {};
  const names: string[] = [];

  const dialogs = await closeSweepDialogs();
  if (dialogs > 0) deleted.dialogs = dialogs;

  for (const [key, type] of NAMED_COLLECTIONS) {
    const docs = collection(key)?.filter(hasSweepName);
    if (!docs) continue;
    for (const doc of docs) {
      names.push(`${type}: ${doc.name}`);
      await doc.delete();
    }
    deleted[key] = docs.length;
  }

  // Sweep tokens on any scene: the tools delete the sweep's token from the scene the GM
  // views, which may not be the one it was placed on.
  let tokens = 0;
  for (const scene of collection('scenes')?.filter(() => true) ?? []) {
    const onScene = (scene as SweepScene).tokens;
    const sweepTokens = onScene ? (collectionOf(onScene)?.filter(hasSweepName) ?? []) : [];
    for (const token of sweepTokens) {
      names.push(`Token: ${token.name}`);
      await token.delete();
    }
    tokens += sweepTokens.length;
  }
  deleted.tokens = tokens;

  if (since !== null) {
    for (const key of TIMED_COLLECTIONS) {
      const docs = collection(key)?.filter(doc => createdTime(doc) >= since);
      if (!docs) continue;
      for (const doc of docs) await doc.delete();
      deleted[key] = docs.length;
    }
  }

  const folders = collection('folders')?.filter(hasSweepName) ?? [];
  for (const folder of folders) {
    names.push(`Folder: ${folder.name}`);
    await folder.delete({ deleteSubfolders: true, deleteContents: true });
  }
  deleted.folders = folders.length;

  return { mode: 'cleanup', world: worldId, deleted, names };
}
