/**
 * The machine folders at the root of the drive: FoundryAI, FoundryCampaign, FoundryPlanB and
 * FoundryPlanB-drill2. `C:\<name>` while a folder has not been moved, `<FVTT_DATA_DIR>\<name>` once
 * it has: the same rule as `dataFolder` in sessions-dir.ts, with the drive root as the old place.
 * scripts/data-folder.ps1 (Get-RootFolder) and scripts/data-folder.mjs say it in their own language.
 *
 * It uses only `node:fs` and `node:path`: do not import it from the Foundry module.
 */

import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/** One root folder by name. `legacyBase` is the drive root (a parameter for tests). */
export function rootFolder(
  name: string,
  dataDir: string | undefined = process.env.FVTT_DATA_DIR,
  legacyBase: string = 'C:\\'
): string {
  const legacy = join(legacyBase, name);
  if (!dataDir || !isAbsolute(dataDir)) return legacy;
  const moved = join(dataDir, name);
  return existsSync(moved) || !existsSync(legacy) ? moved : legacy;
}
