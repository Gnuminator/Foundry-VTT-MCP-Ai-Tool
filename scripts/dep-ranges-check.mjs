#!/usr/bin/env node
/**
 * One range per dependency: fails when a package named by several package.json files (the root,
 * every workspace and `tools/livekit/recorder`) uses different ranges for it. This is the in-place
 * stand-in for pnpm catalogs (decision 25): change the range everywhere or nowhere.
 *
 *   npm run deps:check
 *
 * Shared dependencies that must differ on purpose go in ALLOWED_DIVERGENCE with the reason.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'];

/** Package name -> why its ranges may differ between package.json files. */
export const ALLOWED_DIVERGENCE = /** @type {Record<string, string>} */ ({});

/** The package.json files that count: the root, the workspaces and the standalone recorder. */
export function manifestPaths(root = ROOT) {
  const out = [path.join(root, 'package.json'), path.join(root, 'shared', 'package.json')];
  const packagesDir = path.join(root, 'packages');
  if (fs.existsSync(packagesDir)) {
    for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
      const file = path.join(packagesDir, entry.name, 'package.json');
      if (entry.isDirectory() && fs.existsSync(file)) out.push(file);
    }
  }
  const recorder = path.join(root, 'tools', 'livekit', 'recorder', 'package.json');
  if (fs.existsSync(recorder)) out.push(recorder);
  return out.filter((file) => fs.existsSync(file));
}

/**
 * @param {{ file: string, json: Record<string, unknown> }[]} manifests
 * @returns {{ name: string, ranges: Map<string, string[]> }[]} dependencies that diverge
 */
export function findDivergence(manifests) {
  /** @type {Map<string, Map<string, string[]>>} */
  const byName = new Map();
  for (const { file, json } of manifests) {
    for (const field of FIELDS) {
      const deps = /** @type {Record<string, string> | undefined} */ (json[field]);
      for (const [name, range] of Object.entries(deps ?? {})) {
        if (name.startsWith('@gnuminator/')) continue;
        const ranges = byName.get(name) ?? new Map();
        ranges.set(range, [...(ranges.get(range) ?? []), file]);
        byName.set(name, ranges);
      }
    }
  }
  return [...byName]
    .filter(([name, ranges]) => ranges.size > 1 && !(name in ALLOWED_DIVERGENCE))
    .map(([name, ranges]) => ({ name, ranges }));
}

function main() {
  const manifests = manifestPaths().map((file) => ({
    file: path.relative(ROOT, file).replaceAll('\\', '/'),
    json: JSON.parse(fs.readFileSync(file, 'utf8')),
  }));
  const bad = findDivergence(manifests);
  if (bad.length === 0) {
    console.log(`deps:check: one range per shared dependency (${manifests.length} package.json files).`);
    return 0;
  }
  for (const { name, ranges } of bad) {
    console.error(`deps:check: ${name} has different ranges:`);
    for (const [range, files] of ranges) console.error(`  ${range}  ${files.join(', ')}`);
  }
  console.error('Use one range everywhere (or add the package to ALLOWED_DIVERGENCE with a reason).');
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
