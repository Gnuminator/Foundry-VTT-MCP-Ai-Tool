/**
 * Vault command line (backups; the vault is not in Foundry's world backup).
 *
 *   npm run vault -- path                              print the vault directory
 *   npm run vault -- worlds                            list worlds with a vault
 *   npm run vault -- list <worldId>                    list a world's files
 *   npm run vault -- export <worldId> [bundle.json]    write a bundle (stdout without a file)
 *   npm run vault -- import <bundle.json> [--world <worldId>] [--overwrite]
 *   npm run vault -- forget-user <worldId> <user> [--chat-only] [--dry-run]
 *
 * The vault directory is `FOUNDRY_AI_DATA_DIR`, else the platform default.
 */
import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { evaluateLockFile } from '../lock.js';

import { forgetUser } from './forget-user.js';
import { resolveDataDir } from './paths.js';
import { VaultStore } from './store.js';
import { exportWorld, importWorld } from './transfer.js';

export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
  env?: NodeJS.ProcessEnv;
  /** Whether a bridge backend is running (tests replace it). */
  bridgeRunning?: () => boolean;
}

/**
 * A live bridge backend holds a lock file in the temp directory
 * (`foundry-mcp-backend.lock`, or `-<port>.lock` for another control port).
 */
export function bridgeBackendRunning(): boolean {
  let names: string[];
  try {
    names = fs.readdirSync(os.tmpdir()).filter(n => /^foundry-mcp-backend(-\d+)?\.lock$/.test(n));
  } catch {
    return false;
  }
  for (const name of names) {
    const file = path.join(os.tmpdir(), name);
    try {
      const pid = Number.parseInt(fs.readFileSync(file, 'utf8').trim(), 10);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      process.kill(pid, 0);
      if (evaluateLockFile(pid, file) === 'valid') return true;
    } catch {
      // not running, or unreadable: not a live bridge
    }
  }
  return false;
}

const USAGE = [
  'Usage:',
  '  vault path',
  '  vault worlds',
  '  vault list <worldId>',
  '  vault export <worldId> [bundle.json]',
  '  vault import <bundle.json> [--world <worldId>] [--overwrite]',
  '  vault forget-user <worldId> <user> [--chat-only] [--dry-run]',
].join('\n');

/** Run one CLI command; resolves to the process exit code. */
export async function runVaultCli(argv: string[], io: CliIo): Promise<number> {
  const store = new VaultStore({ dataDir: resolveDataDir(io.env ?? process.env) });
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case 'path':
        io.out(store.dataDir);
        return 0;
      case 'worlds':
        for (const w of await store.listWorlds()) io.out(w);
        return 0;
      case 'list': {
        const [worldId] = rest;
        if (!worldId) break;
        for (const f of await store.listAll(worldId)) io.out(`${f.area}/${f.file}`);
        return 0;
      }
      case 'export': {
        const [worldId, outFile] = rest;
        if (!worldId) break;
        const bundle = await exportWorld(store, worldId);
        const text = `${JSON.stringify(bundle, null, 2)}\n`;
        if (outFile) {
          await fsp.writeFile(outFile, text, { encoding: 'utf8', flag: 'wx' });
          io.err(`Exported ${bundle.files.length} file(s) of "${worldId}" to ${outFile}`);
        } else {
          io.out(text.trimEnd());
        }
        return 0;
      }
      case 'import': {
        const file = rest.find(a => !a.startsWith('--'));
        if (!file) break;
        const worldIndex = rest.indexOf('--world');
        const worldId = worldIndex >= 0 ? rest[worldIndex + 1] : undefined;
        if (worldIndex >= 0 && !worldId) break;
        const bundle: unknown = JSON.parse(await fsp.readFile(file, 'utf8'));
        const result = await importWorld(store, bundle, {
          ...(worldId ? { worldId } : {}),
          overwrite: rest.includes('--overwrite'),
        });
        io.err(`Imported ${result.written} file(s) into "${result.worldId}"`);
        return 0;
      }
      case 'forget-user': {
        const [worldId, ...words] = rest.filter(a => !a.startsWith('--'));
        const user = words.join(' ');
        if (!worldId || !user) break;
        const dryRun = rest.includes('--dry-run');
        if (!dryRun && (io.bridgeRunning ?? bridgeBackendRunning)()) {
          io.err(
            'vault: the bridge is running and keeps writing these logs. Quit Claude Desktop (and any test bridge), then run this again. --dry-run works any time.'
          );
          return 1;
        }
        const result = await forgetUser(store, worldId, {
          user,
          chatOnly: rest.includes('--chat-only'),
          dryRun,
        });
        for (const f of result.files) {
          io.out(`sessions/${f.file}: ${f.removed} removed, ${f.kept} kept`);
        }
        if (result.removed === 0) {
          io.err(`No records of "${user}" in "${worldId}".`);
        } else if (dryRun) {
          io.err(`Would remove ${result.removed} record(s) of "${user}" from "${worldId}".`);
        } else {
          io.err(
            `Removed ${result.removed} record(s) of "${user}" from "${worldId}". Run "npm run obsidian -- export" to rebuild the Obsidian notes without them.`
          );
        }
        return 0;
      }
      default:
        break;
    }
  } catch (error) {
    io.err(`vault: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  io.err(USAGE);
  return 2;
}
