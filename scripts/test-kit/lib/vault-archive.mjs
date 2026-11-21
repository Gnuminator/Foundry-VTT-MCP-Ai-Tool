/**
 * Old, oversized logs in a kit world's bridge vault slow the dashboard sweep down.
 *
 * `get-prep-digest` reads every `sessions/*.jsonl` of the world and `list-changes` reads the
 * `gm/changes-*.jsonl` journal; after a few full kit builds those files hold tens of megabytes
 * (one day's spell-slot and item churn). The bridge then needs longer than the dashboard's 15
 * second limit, its control channel drops, and the sweep sees "Foundry took too long to answer"
 * and an Undo window that never opens. The sweep moves such files, from days before today, to
 * `<root>/vault-archive/<world>/` first. They are kept (test data is never deleted), only no
 * longer read.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

/** Files over this size are moved (bytes). */
export const ARCHIVE_OVER_BYTES = 2 * 1024 * 1024;

const DATED = /(\d{4}-\d{2}-\d{2})(?:\.play)?\.jsonl$/;

/**
 * @param {{vaultRoot: string, world: string, today?: string, overBytes?: number}} o
 *   vaultRoot is `<test server root>/vault`; today is `YYYY-MM-DD` (default: local date).
 * @returns {string[]} the moved files, relative to the world folder
 */
export function archiveOldBigLogs({ vaultRoot, world, today, overBytes = ARCHIVE_OVER_BYTES }) {
  const day = today ?? new Date().toLocaleDateString('sv-SE');
  const moved = [];
  for (const sub of ['sessions', 'gm']) {
    const dir = path.join(vaultRoot, world, sub);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const m = DATED.exec(name);
      // Only the dated logs, and never today's: the bridge may still be appending to it.
      if (!m || m[1] >= day) continue;
      if (sub === 'gm' && !name.startsWith('changes-')) continue;
      const from = path.join(dir, name);
      if (statSync(from).size <= overBytes) continue;
      const toDir = path.join(path.dirname(vaultRoot), 'vault-archive', world, sub);
      mkdirSync(toDir, { recursive: true });
      let to = path.join(toDir, name);
      if (existsSync(to)) to = path.join(toDir, `${Date.now()}-${name}`);
      renameSync(from, to);
      moved.push(`${sub}/${name}`);
    }
  }
  return moved;
}
