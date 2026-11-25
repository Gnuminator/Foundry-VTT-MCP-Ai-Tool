// Builds the Claude Code plugin "foundry-lane-kit" from .claude/ (skills, agents, commands, hooks).
// .claude/ stays the one place to edit; plugin/foundry-lane-kit/ is generated and never edited by hand.
//   node scripts/build-lane-plugin.mjs           write the plugin folder and the marketplace file
//   node scripts/build-lane-plugin.mjs --check   exit 1 when the committed plugin differs (drift)
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const NAME = 'foundry-lane-kit';

const isTest = f => /\.test\.mjs$/.test(f);

/** Hooks locate the repo from their own folder (here/../..); in a plugin the project is CLAUDE_PROJECT_DIR. */
export function retargetHook(src) {
  const out = src
    .replace(
      /path\.resolve\(\s*(?:here|path\.dirname\(fileURLToPath\(import\.meta\.url\)\)),\s*'\.\.',\s*'\.\.'\s*\)/g,
      'path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd())'
    )
    // The plugin folder has no node_modules: load acorn from the project, as the repo copy does.
    .replace(
      /await import\('acorn'\)/g,
      "await import(pathToFileURL((await import('node:module')).createRequire(path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), 'x.js')).resolve('acorn')).href)"
    );
  if (/REPO_ROOT\s*=/.test(src) && out === src) {
    throw new Error('retargetHook: a REPO_ROOT shape it does not know; teach build-lane-plugin.mjs');
  }
  return out;
}

/** hooks.json for the plugin: same events and matchers as .claude/settings.json, plugin-root paths. */
export function hooksJson(settings) {
  const out = JSON.parse(JSON.stringify(settings.hooks ?? {}));
  for (const entries of Object.values(out)) {
    for (const e of entries) {
      for (const h of e.hooks ?? []) {
        h.command = String(h.command).replace(
          /\$CLAUDE_PROJECT_DIR\/\.claude\/hooks\//g,
          '${CLAUDE_PLUGIN_ROOT}/hooks/'
        );
      }
    }
  }
  return { hooks: out };
}

/**
 * The plugin version: the tool version plus a short hash of the plugin's files, so a change to a skill
 * or hook reaches every PC's `plugin update` even between releases (Claude Code compares the string).
 */
export function pluginVersion(toolVersion, files) {
  const h = createHash('sha256');
  for (const rel of [...files.keys()].sort()) h.update(rel).update('\0').update(files.get(rel)).update('\0');
  return `${toolVersion}+${h.digest('hex').slice(0, 8)}`;
}

/** The files the plugin should hold: Map<relative path, string|Buffer>. */
export function plan(repo = REPO) {
  const files = new Map();
  const claude = path.join(repo, '.claude');
  const walk = (dir, rel, take) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, d.name);
      const r = `${rel}/${d.name}`;
      if (d.isDirectory()) walk(p, r, take);
      else take(p, r, d.name);
    }
  };
  for (const sub of ['skills', 'agents', 'commands']) {
    if (existsSync(path.join(claude, sub))) {
      walk(path.join(claude, sub), sub, (p, r) => files.set(r, readFileSync(p)));
    }
  }
  walk(path.join(claude, 'hooks'), 'hooks', (p, r, n) => {
    if (isTest(n)) return;
    files.set(r, n.endsWith('.mjs') ? retargetHook(readFileSync(p, 'utf8')) : readFileSync(p));
  });
  const settings = JSON.parse(readFileSync(path.join(claude, 'settings.json'), 'utf8'));
  files.set('hooks/hooks.json', `${JSON.stringify(hooksJson(settings), null, 2)}\n`);
  const version = pluginVersion(JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8')).version, files);
  files.set(
    '.claude-plugin/plugin.json',
    `${JSON.stringify(
      {
        name: NAME,
        version,
        description:
          'Foundry AI Tool lane kit: lane, planner, pi-work and foundry-* skills, the guard hooks and the review agents.',
        author: { name: 'Gnuminator' },
      },
      null,
      2
    )}\n`
  );
  return files;
}

export function marketplaceJson() {
  return `${JSON.stringify(
    {
      name: 'foundry-ai-tool',
      owner: { name: 'Gnuminator' },
      plugins: [{ name: NAME, source: `./plugin/${NAME}`, description: 'The lane kit for the Foundry AI Tool repo.' }],
    },
    null,
    2
  )}\n`;
}

const same = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

/** plugin.json with the tool-version prefix of its version removed: only the kit hash decides drift. */
const withoutToolVersion = (text) => String(text).replace(/("version": ")[^"+]*(\+)/, '$1$2');
const norm = (rel, c) => (rel === '.claude-plugin/plugin.json' ? withoutToolVersion(c) : c);

/** Differences between the plan and what is on disk (missing, changed, stale). */
export function drift(repo = REPO) {
  const root = path.join(repo, 'plugin', NAME);
  const want = plan(repo);
  const problems = [];
  for (const [rel, content] of want) {
    const p = path.join(root, rel);
    if (!existsSync(p)) problems.push(`missing: plugin/${NAME}/${rel}`);
    else if (!same(norm(rel, readFileSync(p)), norm(rel, content))) problems.push(`changed: plugin/${NAME}/${rel}`);
  }
  const have = [];
  const walk = (dir, rel) => {
    if (!existsSync(dir)) return;
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) walk(path.join(dir, d.name), r);
      else have.push(r);
    }
  };
  walk(root, '');
  for (const r of have) if (!want.has(r)) problems.push(`stale: plugin/${NAME}/${r}`);
  const mp = path.join(repo, '.claude-plugin', 'marketplace.json');
  if (!existsSync(mp) || readFileSync(mp, 'utf8') !== marketplaceJson()) problems.push('changed: .claude-plugin/marketplace.json');
  return problems;
}

export function write(repo = REPO) {
  const root = path.join(repo, 'plugin', NAME);
  rmSync(root, { recursive: true, force: true });
  for (const [rel, content] of plan(repo)) {
    const p = path.join(root, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  mkdirSync(path.join(repo, '.claude-plugin'), { recursive: true });
  writeFileSync(path.join(repo, '.claude-plugin', 'marketplace.json'), marketplaceJson());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const problems = drift();
    if (problems.length) {
      console.error(`lane plugin drift (run: node scripts/build-lane-plugin.mjs):\n${problems.join('\n')}`);
      process.exit(1);
    }
    console.log('lane plugin: in sync with .claude/');
  } else {
    write();
    console.log(`lane plugin written to plugin/${NAME}`);
  }
}
