/**
 * Obsidian command line (docs/design/OBSIDIAN-PLAN.md, O1).
 *
 *   npm run obsidian -- export [<worldId> ...] [--vault <dir>]
 *
 * Renders the bridge vault of each world (all worlds when none is named) into
 * the GM's Obsidian vault: `--vault`, else `FOUNDRY_AI_OBSIDIAN_DIR`. The
 * bridge vault is `FOUNDRY_AI_DATA_DIR`, else the platform default.
 */
import { AuditLog } from '../vault/audit.js';
import { resolveDataDir } from '../vault/paths.js';
import { VaultStore } from '../vault/store.js';

import { exportWorldToObsidian } from './export.js';

export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
  env?: NodeJS.ProcessEnv;
}

const USAGE = 'Usage: obsidian export [<worldId> ...] [--vault <dir>]';

export async function runObsidianCli(argv: string[], io: CliIo): Promise<number> {
  const env = io.env ?? process.env;
  const [command, ...rest] = argv;
  if (command !== 'export') {
    io.err(USAGE);
    return 2;
  }
  const worlds: string[] = [];
  let vaultDir = env.FOUNDRY_AI_OBSIDIAN_DIR?.trim() ?? '';
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--vault') {
      vaultDir = rest[++i] ?? '';
    } else {
      worlds.push(rest[i]);
    }
  }
  if (!vaultDir) {
    io.err('No Obsidian vault: pass --vault <dir> or set FOUNDRY_AI_OBSIDIAN_DIR.');
    return 2;
  }
  const store = new VaultStore({ dataDir: resolveDataDir(env) });
  const audit = new AuditLog(store);
  const targets = worlds.length ? worlds : await store.listWorlds();
  if (targets.length === 0) {
    io.err(`No worlds in the bridge vault at ${store.dataDir}.`);
    return 1;
  }
  let hadErrors = false;
  try {
    for (const worldId of targets) {
      const r = await exportWorldToObsidian({ store, audit, worldId, vaultDir });
      io.out(
        `${worldId}: ${r.written.length} written, ${r.unchanged.length} unchanged, ${r.created.length} created (${r.root})`
      );
      for (const f of [...r.created, ...r.written]) io.out(`  ${f}`);
      if (r.skipped.length) {
        io.out(`  skipped (edited or foreign):`);
        for (const s of r.skipped) io.out(`    ${s.path}: ${s.reason}`);
      }
      if (r.trashed.length) {
        io.out(`  trashed:`);
        for (const t of r.trashed) io.out(`    ${t}`);
      }
      if (r.errors.length) {
        hadErrors = true;
        for (const e of r.errors) io.err(`  ${worldId}: ${e.path}: ${e.error}`);
      }
    }
    return hadErrors ? 1 : 0;
  } catch (error) {
    io.err(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
