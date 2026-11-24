// Which chapters were filmed before a commit (a UI change)? Reads the `<cut>.builds.json` files
// compose wrote, so no take folder is needed.
//   node scripts/demo/older-builds.mjs <compose-out or a .builds.json> --since <commit>
// Prints one line per chapter filmed before <commit> (or with no recorded build); exit 1 when any.
// "Before" means not a descendant of <commit>, so it needs merge commits (a squashed or rebased
// commit has a new id). `build` is the checkout that ran demo.mjs, which is also the one the
// dashboard under test should run from; a take filmed on a tree with changes is marked.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO_ROOT } from './lib/env.mjs';
import { gitIsAncestor, hasCommit, olderThan } from './lib/build-info.mjs';

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
  if (!hasCommit(REPO_ROOT, commit)) throw new Error(`${commit} is not a commit in this checkout`);
  // The same chapter id from two takes (different commits) is checked once per take.
  const seen = new Map();
  for (const f of files)
    for (const c of JSON.parse(readFileSync(f, 'utf8')).chapters)
      seen.set(`${c.id} ${c.build?.commit ?? ''}`, c);
  const unknown = new Set();
  const old = olderThan([...seen.values()], commit, gitIsAncestor(REPO_ROOT, unknown));
  for (const c of old)
    console.log(
      `${c.id}: ${c.build?.commit ? `filmed on ${c.build.commit.slice(0, 9)} (dashboard ${c.build.dashboardVersion})` : 'no build recorded'}${c.build?.dirty ? ', tree had uncommitted changes' : ''}`
    );
  for (const u of unknown)
    console.log(`Not checked: commit ${u.slice(0, 9)} is not in this checkout (fetch it first).`);
  console.log(`${old.length} of ${seen.size} chapters filmed before ${commit.slice(0, 9)}.`);
  process.exitCode = old.length ? 1 : 0;
}

try {
  main();
} catch (e) {
  console.error(`older-builds: ${e.message}`);
  process.exit(2);
}
