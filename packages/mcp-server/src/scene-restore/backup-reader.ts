/**
 * Reads one scene's walls, lights, tiles and tokens out of a copy of a Foundry world (I-128): the
 * Pi's nightly backup restored by `scripts/plan-b/restore.ps1`, or any copy of the world folder.
 *
 * Foundry keeps a world's scenes in a LevelDB folder (`<world>/data/scenes`); the embedded
 * documents are separate keys (`!scenes.walls!<sceneId>.<wallId>`). The browser module cannot
 * open it, so the backend does, with the `classic-level` package that ships inside Foundry's own
 * app folder (the AI Tool adds no native dependency). The copy is never opened in place: it is
 * copied to a temp folder first (LevelDB takes a lock and may replay its log), so a backup stays
 * byte for byte as it was. Read only; nothing in the copy is changed.
 */
import { createRequire } from 'node:module';
import { cp, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

import { SCENE_RESTORE_PARTS, type SceneRestorePart } from '@gnuminator/shared';

/** The documents of one scene found in a backup. */
export interface BackupScene {
  sceneId: string;
  name: string;
  walls: Record<string, unknown>[];
  lights: Record<string, unknown>[];
  tiles: Record<string, unknown>[];
  tokens: Record<string, unknown>[];
  /** The `scenes` folder that was read. */
  scenesDir: string;
  /** Newest file time in that folder: when the backup was taken (best estimate). */
  modifiedMs: number;
}

/** The slice of a LevelDB handle the reader needs; tests supply a fake. */
export interface LevelHandle {
  entries(prefix: string): AsyncIterable<[string, string]>;
  close(): Promise<void>;
}
export type LevelOpener = (dir: string) => Promise<LevelHandle>;

/** The key prefix of each embedded collection in the `scenes` database. */
const COLLECTION_KEY: Record<SceneRestorePart, string> = {
  walls: '!scenes.walls!',
  lights: '!scenes.lights!',
  tiles: '!scenes.tiles!',
  tokens: '!scenes.tokens!',
};

/**
 * The package is Foundry's own, found in its app folder at run time. It is deliberately not a
 * dependency of the AI Tool (a native module the Pi's build and the installer would have to carry),
 * so the name is a constant and the Pi runtime-imports check does not expect it in package.json.
 */
const FOUNDRY_LEVEL_PACKAGE = 'classic-level';

/** The slice of `classic-level` used here (the package is Foundry's, loaded at run time). */
interface ClassicLevelDb {
  open(): Promise<void>;
  close(): Promise<void>;
  iterator(range: { gte: string; lt: string }): AsyncIterable<[string, string]>;
}
type ClassicLevelConstructor = new (
  dir: string,
  options: { valueEncoding: 'utf8'; createIfMissing: boolean }
) => ClassicLevelDb;

/** Foundry's app folders to try when none is given (Plan B first, then the test server). */
export function defaultFoundryAppDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  return [env.FOUNDRY_AI_FOUNDRY_APP_DIR, 'C:\\FoundryPlanB\\app', 'C:\\FoundryTest\\app'].filter(
    (d): d is string => typeof d === 'string' && d.length > 0
  );
}

/** Open a LevelDB folder with the `classic-level` found in one of Foundry's app folders. */
export function levelOpenerFromFoundry(appDirs: string[]): LevelOpener {
  return async dir => {
    let ClassicLevel: ClassicLevelConstructor | undefined;
    for (const appDir of appDirs) {
      try {
        const req = createRequire(join(appDir, 'package.json'));
        ClassicLevel = (req(FOUNDRY_LEVEL_PACKAGE) as { ClassicLevel?: ClassicLevelConstructor })
          .ClassicLevel;
        if (ClassicLevel) break;
      } catch {
        // try the next app folder
      }
    }
    if (!ClassicLevel) {
      throw new Error(
        `Cannot read the backup: Foundry's classic-level package was not found in ${appDirs.join(', ')}. Set FOUNDRY_AI_FOUNDRY_APP_DIR to a Foundry app folder.`
      );
    }
    const db = new ClassicLevel(dir, { valueEncoding: 'utf8', createIfMissing: false });
    await db.open();
    return {
      async *entries(prefix: string): AsyncGenerator<[string, string]> {
        for await (const pair of db.iterator({ gte: prefix, lt: `${prefix}\uffff` })) {
          yield pair;
        }
      },
      close: () => db.close(),
    };
  };
}

/**
 * The `scenes` folder of a backup, from a path to the world folder (`.../worlds/<id>`), to its
 * `data` folder, to the `scenes` folder itself, or to a Foundry data root (`Data` or its parent)
 * together with the world id.
 */
export async function findScenesDir(backupPath: string, worldId?: string): Promise<string> {
  const base = resolve(backupPath);
  const candidates = [
    base,
    join(base, 'data', 'scenes'),
    join(base, 'scenes'),
    ...(worldId
      ? [
          join(base, 'worlds', worldId, 'data', 'scenes'),
          join(base, 'Data', 'worlds', worldId, 'data', 'scenes'),
          join(base, 'data', 'Data', 'worlds', worldId, 'data', 'scenes'),
        ]
      : []),
  ];
  for (const dir of candidates) {
    if (!dir.endsWith(`${sep}scenes`)) continue;
    try {
      const names = await readdir(dir);
      if (names.includes('CURRENT')) return dir;
    } catch {
      // not there
    }
  }
  throw new Error(
    `No scenes database found at ${backupPath}. Point it at the restored world folder (for example C:\\FoundryPlanB\\data\\Data\\worlds\\<world>) or a copy of it.`
  );
}

async function newestFileMs(dir: string): Promise<number> {
  let newest = 0;
  for (const name of await readdir(dir)) {
    const info = await stat(join(dir, name));
    if (info.isFile()) newest = Math.max(newest, info.mtimeMs);
  }
  return newest;
}

/** Parse a stored document; the id comes from the key when the value has none. */
function parseDoc(raw: string, id: string): Record<string, unknown> {
  const doc = JSON.parse(raw) as Record<string, unknown>;
  doc._id = typeof doc._id === 'string' ? doc._id : id;
  delete doc._stats;
  return doc;
}

/**
 * Read one scene (by id) from a backup. Throws when the scene is not in the backup, with the
 * scene names the backup does hold. The copy is read through a temp copy that is removed after.
 */
export async function readBackupScene(options: {
  backupPath: string;
  sceneId: string;
  worldId?: string;
  open: LevelOpener;
}): Promise<BackupScene> {
  const scenesDir = await findScenesDir(options.backupPath, options.worldId);
  const modifiedMs = await newestFileMs(scenesDir);
  const work = await mkdtemp(join(tmpdir(), 'scene-restore-'));
  try {
    const copy = join(work, 'scenes');
    await cp(scenesDir, copy, { recursive: true, filter: src => !src.endsWith(`${sep}LOCK`) });
    const handle = await options.open(copy);
    try {
      const sceneKey = `!scenes!${options.sceneId}`;
      let name: string | undefined;
      const others: string[] = [];
      for await (const [key, value] of handle.entries('!scenes!')) {
        const doc = JSON.parse(value) as { name?: string };
        if (key === sceneKey) name = doc.name ?? options.sceneId;
        else others.push(String(doc.name ?? key.slice('!scenes!'.length)));
      }
      if (name === undefined) {
        throw new Error(
          `Scene ${options.sceneId} is not in that backup. It holds: ${others.join(', ') || 'no scenes'}.`
        );
      }
      const scene: BackupScene = {
        sceneId: options.sceneId,
        name,
        walls: [],
        lights: [],
        tiles: [],
        tokens: [],
        scenesDir,
        modifiedMs,
      };
      for (const part of SCENE_RESTORE_PARTS) {
        const prefix = `${COLLECTION_KEY[part]}${options.sceneId}.`;
        for await (const [key, value] of handle.entries(prefix)) {
          scene[part].push(parseDoc(value, key.slice(prefix.length)));
        }
      }
      return scene;
    } finally {
      await handle.close();
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
