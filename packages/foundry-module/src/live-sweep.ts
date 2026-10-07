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
 * - `cleanup` (the default): delete the world documents and tokens the sweep named with
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

export type LiveSweepResult =
  | SweepCleanupResult
  | SweepSnapshotResult
  | SweepCombatResult
  | SweepConcentrationResult;

interface LiveSweepRequest {
  mode?: unknown;
  /** cleanup: run start (ms since epoch); chat messages and combats created since then go too. */
  since?: unknown;
  /** combat: token ids on the active scene. */
  tokenIds?: unknown;
  /** concentration: the caster's and the target's actor ids. */
  actorIds?: unknown;
}

interface SweepActor {
  uuid: string;
  createEmbeddedDocuments(type: string, data: Record<string, unknown>[]): Promise<SweepEffect[]>;
}

interface SweepEffect {
  uuid: string;
}

/** World collections whose sweep-made documents are found by name, with their type. */
const NAMED_COLLECTIONS: ReadonlyArray<readonly [string, string]> = [
  ['actors', 'Actor'],
  ['items', 'Item'],
  ['journal', 'JournalEntry'],
  ['scenes', 'Scene'],
  ['tables', 'RollTable'],
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
    case 'cleanup':
      return cleanup(worldId, request.since);
    default:
      throw new Error(`Unknown live sweep mode: ${String(request.mode)}`);
  }
}

function snapshot(): SweepSnapshotResult {
  const scene = sweepGame().scenes?.current ?? null;
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
  const scene = sweepGame().scenes?.current;
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
  const [dependent] = await target.createEmbeddedDocuments('ActiveEffect', [
    { name: `${SWEEP_PREFIX} Held`, img: 'icons/svg/paralysis.svg' },
  ]);
  const [effect] = await caster.createEmbeddedDocuments('ActiveEffect', [
    {
      name: `${SWEEP_PREFIX} Concentrating`,
      img: 'icons/svg/aura.svg',
      flags: { dnd5e: { dependents: [{ uuid: dependent.uuid }] } },
    },
  ]);
  return { mode: 'concentration', effectUuid: effect.uuid, dependentUuid: dependent.uuid };
}

/**
 * Delete what the sweep made. Folders go last, with their contents (a folder delete in
 * Foundry keeps its contents unless asked otherwise).
 */
async function cleanup(worldId: string, sinceValue: unknown): Promise<SweepCleanupResult> {
  const since = typeof sinceValue === 'number' && sinceValue > 0 ? sinceValue : null;
  const deleted: Record<string, number> = {};
  const names: string[] = [];

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
