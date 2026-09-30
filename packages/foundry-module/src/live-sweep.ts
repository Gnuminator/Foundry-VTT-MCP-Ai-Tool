/**
 * Test-world helper for the live write sweep (I-016, `scripts/live-write-sweep.mjs`).
 *
 * The sweep runs the direct-write tools against the local test world and puts back what
 * it can through the tools themselves (moves tokens back, heals, removes notes and
 * templates). Three things the tool API cannot do, so this query does them:
 *
 * - `snapshot`: the active scene's darkness and global light (no read tool shows them),
 *   so the sweep can restore them after `set-scene-mood`.
 * - `combat`: start a combat on the active scene with the given tokens (no tool creates a
 *   combat), so the combat tools have something to act on.
 * - `cleanup` (the default): delete the world documents and tokens the sweep named with
 *   {@link SWEEP_PREFIX} (NPCs, journals, items, folders, its wolf token), plus the chat
 *   messages and combats created since the run started.
 *
 * Test world only: every mode refuses unless the world id is {@link SWEEP_WORLD_ID},
 * whatever the caller says, so it can never touch a real campaign. It is not an MCP tool:
 * the bridge reaches it through a control method the dashboard calls (`live_sweep`), so
 * Claude never sees it. GM client only; "Allow Write Operations" gates it like every
 * other write (write-gate.ts).
 */

/** Query name. */
export const LIVE_SWEEP_QUERY = 'liveSweep';

/** The only world the helper runs in (the local test server's world). */
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

/** The active scene's lighting, as `set-scene-mood` takes it. */
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

export type LiveSweepResult = SweepCleanupResult | SweepSnapshotResult | SweepCombatResult;

interface LiveSweepRequest {
  mode?: unknown;
  /** cleanup: run start (ms since epoch); chat messages and combats created since then go too. */
  since?: unknown;
  /** combat: token ids on the active scene. */
  tokenIds?: unknown;
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
  startCombat(): Promise<unknown>;
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

/** Run one mode; refuses outside the test world. */
export async function liveSweep(data: unknown): Promise<LiveSweepResult> {
  const worldId = String(sweepGame().world?.id ?? '');
  if (worldId !== SWEEP_WORLD_ID) {
    throw new Error(
      `The live sweep helper runs only in the test world "${SWEEP_WORLD_ID}" (this is "${worldId}")`
    );
  }
  const request = (data ?? {}) as LiveSweepRequest;
  switch (request.mode ?? 'cleanup') {
    case 'snapshot':
      return snapshot();
    case 'combat':
      return startCombat(request.tokenIds);
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
  };
  const CombatClass = foundry.CONFIG?.Combat?.documentClass;
  if (!CombatClass) throw new Error('Combat document class not found');
  const combat = await CombatClass.create({ scene: scene.id, active: true });
  await combat.createEmbeddedDocuments(
    'Combatant',
    tokens.map(t => ({ tokenId: t.id, sceneId: scene.id, actorId: t.actorId }))
  );
  await combat.startCombat();
  return { mode: 'combat', combatId: combat.id, combatants: tokens.map(t => String(t.name)) };
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
