/**
 * Bridge vault locations and name validation (plan step 0.3).
 *
 * Layout: `<dataDir>/<worldId>/{gm,sessions,backups}/<file>`. Every name that
 * reaches the filesystem is validated here, so no caller can escape the vault
 * with `..`, separators, drive letters or Windows device names.
 */
import * as os from 'os';
import * as path from 'path';

/** The three areas inside a world's vault directory. */
export const VAULT_AREAS = ['gm', 'sessions', 'backups'] as const;
export type VaultArea = (typeof VAULT_AREAS)[number];

/** Foundry world ids are slugs: letters, digits, `-` and `_`, no dots. */
const WORLD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

/** One path segment, ending in `.json` or `.jsonl`. */
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*\.jsonl?$/;

/** Windows device names are reserved with any extension (`con.json`, `nul.jsonl`). */
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i;

const MAX_FILE_NAME = 120;

export function isValidWorldId(worldId: unknown): worldId is string {
  return typeof worldId === 'string' && WORLD_ID.test(worldId) && !WINDOWS_DEVICE.test(worldId);
}

export function assertWorldId(worldId: unknown): string {
  if (!isValidWorldId(worldId)) {
    throw new Error(`Invalid world id for the vault: ${JSON.stringify(worldId)}`);
  }
  return worldId;
}

export function isValidFileName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length <= MAX_FILE_NAME &&
    FILE_NAME.test(name) &&
    !WINDOWS_DEVICE.test(name)
  );
}

export function assertFileName(name: unknown): string {
  if (!isValidFileName(name)) {
    throw new Error(`Invalid vault file name: ${JSON.stringify(name)}`);
  }
  return name;
}

export function assertArea(area: unknown): VaultArea {
  if (!(VAULT_AREAS as readonly unknown[]).includes(area)) {
    throw new Error(`Invalid vault area: ${JSON.stringify(area)}`);
  }
  return area as VaultArea;
}

/**
 * The vault root. `FOUNDRY_AI_DATA_DIR` wins; otherwise `%APPDATA%` on Windows,
 * `$XDG_DATA_HOME` or `~/.local/share` elsewhere, plus `foundry-ai-tool/vault`.
 */
export function resolveDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDir: string = os.homedir()
): string {
  const explicit = env.FOUNDRY_AI_DATA_DIR?.trim();
  if (explicit) return path.resolve(explicit);
  if (platform === 'win32') {
    const pathApi = path.win32;
    const configured = env.APPDATA?.trim();
    const appData = configured ? configured : pathApi.join(homeDir, 'AppData', 'Roaming');
    return pathApi.join(appData, 'foundry-ai-tool', 'vault');
  }
  const pathApi = path.posix;
  const xdg = env.XDG_DATA_HOME?.trim();
  const base = xdg && pathApi.isAbsolute(xdg) ? xdg : pathApi.join(homeDir, '.local', 'share');
  return pathApi.join(base, 'foundry-ai-tool', 'vault');
}

/** Absolute directory of one world. */
export function worldDir(dataDir: string, worldId: string): string {
  return path.join(dataDir, assertWorldId(worldId));
}

/** Absolute path of one vault file, checked to stay inside its area. */
export function vaultFilePath(
  dataDir: string,
  worldId: string,
  area: VaultArea,
  file: string
): string {
  const areaDir = path.resolve(worldDir(dataDir, worldId), assertArea(area));
  const full = path.resolve(areaDir, assertFileName(file));
  if (path.dirname(full) !== areaDir) {
    throw new Error(`Vault path escapes its directory: ${file}`);
  }
  return full;
}
