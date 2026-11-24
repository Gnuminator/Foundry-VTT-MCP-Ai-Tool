import * as fs from 'node:fs';
import * as path from 'node:path';

function newestSource(dir: string): number {
  let newest = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') newest = Math.max(newest, newestSource(p));
    } else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) {
      newest = Math.max(newest, fs.statSync(p).mtimeMs);
    }
  }
  return newest;
}

/**
 * Why a build cannot be trusted: its file is missing, or older than the newest non-test source in
 * `srcDir`. Returns undefined when it is fine.
 */
export function staleBuildReason(distFile: string, srcDir: string): string | undefined {
  if (!fs.existsSync(distFile)) return `${distFile} is not built`;
  if (fs.statSync(distFile).mtimeMs < newestSource(srcDir)) {
    return `${distFile} is older than its source (stale build)`;
  }
  return undefined;
}

/**
 * The skip reason for a suite that runs against a build, outside CI only. CI (`GITHUB_ACTIONS`)
 * always builds, so there a stale or missing build must fail, never skip.
 */
export function skipReasonOutsideCi(distFile: string, srcDir: string): string | undefined {
  if (process.env['GITHUB_ACTIONS']) return undefined;
  const why = staleBuildReason(distFile, srcDir);
  return why ? `${why}; run "npm run build" to run this suite` : undefined;
}
