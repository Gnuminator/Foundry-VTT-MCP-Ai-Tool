// Where the dashboard keeps its data and where it looks for Claude Code's files.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Claude Code names a project folder after the path with every non-alphanumeric character as "-".
export function slugify(p) {
  return String(p).replace(/[^A-Za-z0-9]/g, '-');
}

// This file is scripts/dev/project-dashboard/paths.mjs: three levels up is the checkout root.
// When that checkout is a worktree (.claude/worktrees/<name>), the project is the main checkout.
export function resolveRepoRoot(here = path.dirname(fileURLToPath(import.meta.url))) {
  let root = path.resolve(here, '..', '..', '..');
  const m = /[\\/]\.claude[\\/]worktrees[\\/]/.exec(root);
  if (m) root = root.slice(0, m.index);
  return root;
}

function readTestEnvRoot(repoRoot) {
  const fallback =
    process.platform === 'win32' ? 'C:\\FoundryTest' : path.join(os.homedir(), 'foundry-test');
  try {
    const raw = fs.readFileSync(path.join(repoRoot, 'scripts', 'test-env', 'local.json'), 'utf8');
    const root = JSON.parse(raw)?.Root;
    if (typeof root === 'string' && root) return root;
  } catch {
    // no local.json: use the default
  }
  return fallback;
}

export function getPaths(env = process.env) {
  const home = os.homedir();
  // Not under AppData: the Claude desktop app is an MSIX package and virtualizes files its processes
  // write under AppData, so a server started from a normal terminal would not see them.
  const dataDir =
    env.PROJECT_DASHBOARD_DATA || path.join(home, '.foundry-ai-tool', 'project-dashboard');
  const claudeDir = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  const repoRoot = env.PROJECT_DASHBOARD_REPO || resolveRepoRoot();
  return {
    dataDir,
    claudeDir,
    projectsDir: path.join(claudeDir, 'projects'),
    sessionsDir: path.join(claudeDir, 'sessions'),
    // Play-session recordings for the session-notes watchdog.
    recordingsDir: env.FVTT_SESSIONS_DIR || path.join(home, 'Documents', 'FoundrySessions'),
    repoRoot,
    slug: slugify(repoRoot),
    testEnvRoot: readTestEnvRoot(repoRoot),
    // The Obsidian vault the measured Usage notes go to; PROJECT_DASHBOARD_VAULT=off turns it off.
    vaultDir:
      env.PROJECT_DASHBOARD_VAULT === 'off'
        ? null
        : env.PROJECT_DASHBOARD_VAULT ||
          env.FOUNDRY_AI_OBSIDIAN_DIR ||
          path.join(home, 'Documents', 'Obsidian', 'vault'),
  };
}
