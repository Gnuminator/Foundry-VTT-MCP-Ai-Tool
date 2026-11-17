// Where the folders at the root of the drive live (FoundryAI, FoundryCampaign, FoundryPlanB,
// FoundryPlanB-drill2): C:\<name> until they are moved, <FVTT_DATA_DIR>\<name> after. The same rule
// as rootFolder() in shared/src/root-folders.ts and Get-RootFolder in scripts/data-folder.ps1.
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT_RE = /^C:[\\/]+(Foundry(?:AI|Campaign|PlanB(?:-drill2)?))(?:[\\/]+(.*))?$/;

/** @param {string} name @param {string | undefined} [dataDir] @param {string} [legacyBase] */
export function rootFolder(name, dataDir = process.env.FVTT_DATA_DIR, legacyBase = 'C:\\') {
  const legacy = path.join(legacyBase, name);
  if (!dataDir) return legacy;
  const moved = path.join(dataDir, name);
  return existsSync(moved) || !existsSync(legacy) ? moved : legacy;
}

/**
 * Maps `C:\<name>\...` (as machine-paths.json writes it) to where that folder is now; any other
 * path comes back unchanged.
 * @param {string} p @param {string | undefined} [dataDir] @param {string} [legacyBase]
 */
export function resolveRootPath(p, dataDir = process.env.FVTT_DATA_DIR, legacyBase = 'C:\\') {
  const m = ROOT_RE.exec(p);
  if (!m) return p;
  const base = rootFolder(m[1], dataDir, legacyBase);
  return m[2] ? path.join(base, m[2]) : base;
}
