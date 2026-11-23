// Which chapters were filmed before a commit (a UI change)? Reads the `<cut>.builds.json` files
// compose wrote, so no take folder is needed.
//   node scripts/demo/older-builds.mjs <compose-out or a .builds.json> --since <commit>
// Prints one line per chapter filmed before <commit> (or with no recorded build); exit 1 when any.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO_ROOT } from './lib/env.mjs';
import { gitIsAncestor, olderThan } from './lib/build-info.mjs';

function main() {
  const [target, flag, commit] = process.argv.slice(2);
  if (!target || flag !== '--since' || !commit)
    throw new Error('usage: older-builds.mjs <compose-out | file.builds.json> --since <commit>');
  const path = resolve(target);
  const files = statSync(path).isDirectory()
    ? readdirSync(path)
        .filter(f => f.endsWith('.builds.json'))
        .map(f => join(path, f))
    : [path];
  if (!files.length) throw new Error(`no .builds.json in ${path}`);
  const seen = new Map();
  for (const f of files)
    for (const c of JSON.parse(readFileSync(f, 'utf8')).chapters) seen.set(c.id, c);
  const old = olderThan([...seen.values()], commit, gitIsAncestor(REPO_ROOT));
  for (const c of old)
    console.log(
      `${c.id}: ${c.build?.commit ? `filmed on ${c.build.commit.slice(0, 9)} (dashboard ${c.build.dashboardVersion})` : 'no build recorded'}`
    );
  console.log(`${old.length} of ${seen.size} chapters filmed before ${commit.slice(0, 9)}.`);
  process.exitCode = old.length ? 1 : 0;
}

try {
  main();
} catch (e) {
  console.error(`older-builds: ${e.message}`);
  process.exit(2);
}
