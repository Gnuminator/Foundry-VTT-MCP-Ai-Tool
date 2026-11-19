// Install check for the lane kit plugin (I-161): builds it into a temp marketplace, installs it into a
// clean Claude Code profile (CLAUDE_CONFIG_DIR), checks what landed, runs the installed hooks and
// proves a version bump reaches the profile. Touches nothing outside the temp folder.
//   node scripts/lane-plugin-install-check.mjs [--keep]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAME, REPO, marketplaceJson, plan } from './build-lane-plugin.mjs';

const MARKETPLACE = 'foundry-ai-tool';
const ID = `${NAME}@${MARKETPLACE}`;

/** Script paths a hooks.json command points at, relative to the plugin root. */
export function referencedHooks(hooks) {
  const out = new Set();
  for (const entries of Object.values(hooks.hooks ?? {})) {
    for (const e of entries) {
      for (const h of e.hooks ?? []) {
        for (const m of String(h.command).matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\s]+)/g)) out.add(m[1]);
      }
    }
  }
  return [...out].sort();
}

/** Writes the plan as a marketplace folder (what `claude plugin marketplace add <dir>` reads). */
export function writeMarketplace(root) {
  for (const [rel, content] of plan()) {
    const p = path.join(root, 'plugin', NAME, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), marketplaceJson());
}

function claude(profile, args) {
  const r = spawnSync('claude', args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: { ...process.env, CLAUDE_CONFIG_DIR: profile },
  });
  if (r.status !== 0) throw new Error(`claude ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

const installed = profile => JSON.parse(claude(profile, ['plugin', 'list', '--json'])).find(p => p.id === ID);

function runHook(installPath, name, command) {
  const r = spawnSync(process.execPath, [path.join(installPath, 'hooks', name)], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: REPO },
  });
  return { status: r.status, out: r.stdout };
}

export function main() {
  const failures = [];
  const check = (ok, what) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) failures.push(what);
  };
  const tmp = mkdtempSync(path.join(tmpdir(), 'lane-plugin-'));
  const mp = path.join(tmp, 'mp');
  const profile = path.join(tmp, 'profile');
  mkdirSync(profile, { recursive: true });
  try {
    writeMarketplace(mp);
    claude(profile, ['plugin', 'marketplace', 'add', mp]);
    claude(profile, ['plugin', 'install', ID]);
    const first = installed(profile);
    check(Boolean(first?.enabled), 'installed and enabled in a clean profile');
    const root = first?.installPath ?? '';

    const skills = readdirSync(path.join(root, 'skills'));
    check(['lane', 'planner', 'pi-work'].every(s => skills.includes(s)), `skills installed (${skills.length})`);
    check(readdirSync(path.join(root, 'agents')).some(a => a.startsWith('review-')), 'review agents installed');
    check(existsSync(path.join(root, 'commands', 'ready.md')), '/ready installed');

    const hooks = JSON.parse(readFileSync(path.join(root, 'hooks', 'hooks.json'), 'utf8'));
    const refs = referencedHooks(hooks);
    check(refs.length > 0 && refs.every(r => existsSync(path.join(root, r))), `all ${refs.length} hook scripts resolve in the install`);

    const py = runHook(root, 'guard-python-stdin.mjs', 'python3 -c 1');
    check(py.out.includes('"permissionDecision":"deny"'), 'installed guard-python-stdin denies python3');
    check(runHook(root, 'guard-python-stdin.mjs', 'ls').out === '', 'installed guard-python-stdin allows ls');
    const sh = runHook(root, 'guard-shell-edits.mjs', "sed -i 's/a/b/' package.json");
    check(sh.out.includes('"permissionDecision":"deny"'), 'installed guard-shell-edits (acorn from project) denies sed -i');
    check(runHook(root, 'guard-shell-edits.mjs', 'git status').out === '', 'installed guard-shell-edits allows git status');

    // A version bump in the marketplace must reach the profile.
    const manifest = path.join(mp, 'plugin', NAME, '.claude-plugin', 'plugin.json');
    const meta = JSON.parse(readFileSync(manifest, 'utf8'));
    const bumped = `${meta.version}-check.1`;
    writeFileSync(manifest, `${JSON.stringify({ ...meta, version: bumped }, null, 2)}\n`);
    claude(profile, ['plugin', 'marketplace', 'update', MARKETPLACE]);
    claude(profile, ['plugin', 'update', ID]);
    const second = installed(profile);
    check(second?.version === bumped, `version bump reaches the profile (${first?.version} -> ${second?.version})`);
    check(existsSync(path.join(second?.installPath ?? '', 'hooks', 'hooks.json')), 'bumped install is complete');
  } catch (err) {
    check(false, String(err.message ?? err));
  } finally {
    if (!process.argv.includes('--keep')) rmSync(tmp, { recursive: true, force: true });
    else console.log(`kept ${tmp}`);
  }
  if (failures.length) {
    console.error(`lane plugin install check: ${failures.length} failed`);
    process.exitCode = 1;
  } else console.log('lane plugin install check: all ok');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
