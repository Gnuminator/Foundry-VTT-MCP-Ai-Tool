#!/usr/bin/env node
/**
 * The one list of checks (D-122 restructure R1). Every command the CI job `build-test` runs, every
 * step of `npm run green`, and every guard of `npm run drift:check` is one entry here:
 *
 *   - `green.mjs` runs STEPS (the entries that are CI steps) and takes HEAVY_STEPS from `heavy`.
 *   - `drift-check.mjs` keeps a literal copy of its guards: the merge gate runs main's copy of that
 *     file on its own and falls back to the branch's copy when it imports another repo file
 *     (lane-merge.mjs, driftCheck), so it must not import this module. `green.test.mjs` compares
 *     that copy with `driftChecks()` below, so the two cannot drift apart.
 *   - `green.test.mjs` parses `.github/workflows/ci.yml` with a YAML parser (scripts/ci-yaml.mjs) and
 *     fails when a CI command is neither an entry nor in CI_ONLY, or an entry is gone from CI.
 *
 * Adding a script test means one `nodeTest(...)` line here and one `run:` line in ci.yml.
 *
 *   node scripts/checks.mjs --list      print every entry: name, group and where it runs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {{ name: string, cmd: string, args: string[], env?: Record<string, string> }} Step
 * @typedef {Step & { group: string, steps?: false, cwd?: string, drift?: Drift }} Check
 * @typedef {{ name: string, order: number, when?: string[], needs?: string, cwd?: string, heavy?: boolean }} Drift
 */

/** A guard with `when` runs only if the branch or main since the merge base changed a file under it. */
const DASHBOARD_PATH = ['packages/cogm-dashboard/', 'shared/']; // the web bundle imports shared/src

/**
 * The steps that need a lot of RAM or CPU (lint, type check, build, the test suites, the browser
 * run). A run takes the heavy-check lock once, at its first heavy step, and keeps it until its last
 * one, so parallel greens and the gate's drift check take turns per run instead of queueing again
 * for every step (see scripts/heavy-lock.mjs).
 */
export const HEAVY_STEPS = new Set([
  'typecheck',
  'lint-ratchet',
  'build',
  'kit-test',
  'test-shared',
  'test-foundry-module',
  'test-mcp-server',
  'test-cogm-dashboard',
  'test-discord-bot',
  'test-obsidian-plugin',
  'e2e',
]);

/** The unit-test steps run with CI=true, as on the runner (vitest then runs once, not in watch mode). */
const CI = { CI: 'true' };

/** A step that runs `npm run <script>`. */
const npmRun = (
  /** @type {string} */ name,
  /** @type {string} */ group,
  /** @type {string} */ script,
  /** @type {Partial<Check>} */ extra = {}
) => ({
  name,
  group,
  cmd: 'npm',
  args: ['run', script],
  ...extra,
});

/** A step that runs `node --test <file>`. */
const nodeTest = (
  /** @type {string} */ name,
  /** @type {string} */ group,
  /** @type {string[]} */ ...files
) => ({
  name,
  group,
  cmd: 'node',
  args: ['--test', ...files],
  env: CI,
});

/** A step that runs `npm test -w <workspace>`. */
const workspaceTest = (/** @type {string} */ name, /** @type {string} */ ws) => ({
  name,
  group: 'unit',
  cmd: 'npm',
  args: ['test', '-w', `@gnuminator/${ws}`],
  env: CI,
});

/**
 * Every check, in CI order (the order of the commands in the `build-test` job). A chained CI
 * command (`a && b`) is one entry per part, so a failure names the part that broke. `group` names
 * the family a check belongs to (for the grouped CI steps that follow this list). An entry with
 * `steps: false` is only a drift guard: CI and green do not run it as a step of their own.
 * An entry's `drift` says that `npm run drift:check` runs it too, under that guard name.
 * @type {Check[]}
 */
export const CHECKS = [
  { name: 'typecheck', group: 'static', cmd: 'npm', args: ['run', 'typecheck'] },
  npmRun('lint-ratchet', 'static', 'lint:ratchet', { drift: { name: 'lint baseline', order: 1 } }),
  npmRun('emdash-ratchet', 'static', 'emdash:ratchet', {
    drift: { name: 'em-dash baseline', order: 2 },
  }),
  npmRun('line-ratchet', 'static', 'line:ratchet', {
    drift: { name: 'line baseline', order: 7.5 },
  }),
  npmRun('version-check', 'static', 'version:check', { drift: { name: 'version sync', order: 5 } }),
  npmRun('usage-catalog', 'static', 'usage:catalog:check', {
    drift: { name: 'usage catalog', order: 4 },
  }),
  npmRun('unused-ratchet', 'static', 'unused:ratchet', {
    drift: { name: 'unused baseline', order: 13, heavy: true },
  }),
  npmRun('docs-lint', 'docs', 'docs:lint', { drift: { name: 'docs lint', order: 6 } }),
  npmRun('docs-links', 'docs', 'docs:links', { drift: { name: 'docs links', order: 7 } }),
  npmRun('docs-ui', 'docs', 'docs:ui'),
  npmRun('docs-kit', 'docs', 'docs:kit:check'),
  nodeTest('docs-ui-test', 'docs', 'scripts/docs-ui-check.test.mjs'),
  nodeTest('hook-remote-guard', 'hooks', '.claude/hooks/guard-remote-commands.test.mjs'),
  nodeTest('hook-start-alerts', 'hooks', '.claude/hooks/start-alerts.test.mjs'),
  nodeTest('drift-check-test', 'gate', 'scripts/drift-check.test.mjs'),
  nodeTest('workflow-pins', 'gate', 'scripts/workflow-pins.test.mjs'),
  nodeTest('test-env-frame-proxy', 'scripts', 'scripts/test-env/foundry-frame-proxy.test.mjs'),
  nodeTest(
    'hook-context-alert',
    'hooks',
    '.claude/hooks/context-alert.test.mjs',
    '.claude/hooks/context-stop.test.mjs'
  ),
  nodeTest(
    'hook-edit-guard',
    'hooks',
    '.claude/hooks/guard-shell-edits.test.mjs',
    '.claude/hooks/warn-control-bytes.test.mjs',
    '.claude/hooks/guard-model.test.mjs',
    '.claude/hooks/guard-cloudflare.test.mjs',
    '.claude/hooks/format-on-edit.test.mjs',
    '.claude/hooks/guard-backlog.test.mjs'
  ),
  nodeTest('cloudflare-compare', 'scripts', 'scripts/cloudflare-compare.test.mjs'),
  nodeTest(
    'gate-scripts',
    'gate',
    'scripts/green.test.mjs',
    'scripts/lane-merge.test.mjs',
    'scripts/visual-baselines.test.mjs',
    'scripts/changelog-fold.test.mjs',
    'scripts/review-note.test.mjs',
    'scripts/heavy-lock.test.mjs',
    'scripts/test-coverage-check.test.mjs',
    'scripts/planner-wake.test.mjs',
    'scripts/backlog.test.mjs',
    'scripts/merge-runner.test.mjs',
    'scripts/main-red-revert.test.mjs',
    'scripts/line-ratchet.test.mjs',
    'scripts/unused-ratchet.test.mjs',
    'scripts/review-severity-rule.test.mjs'
  ),
  { name: 'dev-scripts', group: 'scripts', cmd: 'npm', args: ['run', 'dev:test'], env: CI },
  nodeTest('gamenight-watch', 'scripts', 'scripts/gamenight-watch.test.mjs'),
  nodeTest('gamenight-watch-pi', 'scripts', 'scripts/gamenight-watch-pi.test.mjs'),
  nodeTest('pi-player-connector-stage', 'pi', 'scripts/pi/player-connector-stage.test.mjs'),
  nodeTest(
    'pi-player-connector-cloudflare',
    'pi',
    'scripts/pi/player-connector-cloudflare.test.mjs'
  ),
  nodeTest('pi-crash-guard-stage', 'pi', 'scripts/pi/crash-guard-stage.test.mjs'),
  nodeTest('pi-gamenight-watch-stage', 'pi', 'scripts/pi/gamenight-watch-stage.test.mjs'),
  nodeTest('pi-space-check', 'pi', 'scripts/pi/space-check.test.mjs'),
  nodeTest('pi-backup-record', 'pi', 'scripts/pi/backup-pull-record.test.mjs'),
  nodeTest('pi-world-refs', 'pi', 'scripts/pi/world-refs.test.mjs'),
  nodeTest('pi-assistant-gm', 'pi', 'scripts/pi/assistant-gm.test.mjs'),
  nodeTest('pi-gm-passwords', 'pi', 'scripts/pi/gm-passwords.test.mjs'),
  nodeTest('pi-system-trial-guard', 'pi', 'scripts/pi/system-trial-guard.test.mjs'),
  nodeTest('pi-ci-filter', 'pi', 'scripts/pi/ci-pi-filter.test.mjs'),
  nodeTest(
    'pi-container-test-units',
    'pi',
    'scripts/pi/gm-watchdog.test.mjs',
    'scripts/pi/modules-stage.test.mjs',
    'scripts/pi/stage11-world.test.mjs',
    'scripts/pi/system-trial.test.mjs'
  ),
  nodeTest('pi-player-creation', 'pi', 'scripts/pi/player-creation.test.mjs'),
  nodeTest('pi-check-studio-pin', 'pi', 'scripts/pi/check-studio-pin.test.mjs'),
  nodeTest('pi-world-switches', 'pi', 'scripts/pi/world-switches.test.mjs'),
  nodeTest('pi-kit-session', 'pi', 'scripts/pi/kit-session.test.mjs'),
  nodeTest('pi-fetch-kit-login', 'pi', 'scripts/pi/fetch-kit-login.test.mjs'),
  nodeTest('pi-health-kit-line', 'pi', 'scripts/pi/health-kit-line.test.mjs'),
  nodeTest('pi-runtime-imports', 'pi', 'scripts/pi/runtime-imports.test.mjs'),
  nodeTest('pi-runuser-helper', 'pi', 'scripts/pi/runuser-helper.test.mjs'),
  nodeTest('pi-stage5-load-check', 'pi', 'scripts/pi/stage5-load-check.test.mjs'),
  nodeTest('pi-bridge-logging', 'pi', 'scripts/pi/bridge-logging.test.mjs'),
  nodeTest('pi-ssh-keys-only', 'pi', 'scripts/pi/ssh-keys-only.test.mjs'),
  nodeTest('pi-board-status', 'pi', 'scripts/pi/board-status.test.mjs'),
  nodeTest('pi-pull-destination', 'pi', 'scripts/pi/pull-destination.test.mjs'),
  nodeTest('pi-gh-runner', 'pi', 'scripts/pi/gh-runner.test.mjs'),
  nodeTest('pi-bot-status-stage', 'pi', 'scripts/pi/bot-status-stage.test.mjs'),
  nodeTest('pi-stage7-foundry-url', 'pi', 'scripts/pi/stage7-foundry-url.test.mjs'),
  nodeTest('pi-time-sync', 'pi', 'scripts/pi/time-sync.test.mjs'),
  nodeTest('pi-discord-game-server', 'pi', 'scripts/pi/discord-game-server.test.mjs'),
  nodeTest('pi-join-page-look', 'pi', 'scripts/pi/join-page-look.test.mjs'),
  nodeTest('pi-vault-sync', 'pi', 'scripts/pi/vault-sync.test.mjs'),
  nodeTest('pi-gm-vault-peers', 'pi', 'scripts/pi/gm-vault-peers.test.mjs'),
  nodeTest('pi-player-vault', 'pi', 'scripts/pi/player-vault.test.mjs'),
  nodeTest(
    'pi-seven-books',
    'pi',
    'scripts/pi/seven-books.test.mjs',
    'scripts/pi/grave-domain-patch.test.mjs'
  ),
  nodeTest('pi-world-switch', 'pi', 'scripts/pi/switch-world.test.mjs'),
  nodeTest('pi-control-port-check', 'pi', 'scripts/pi/control-port-check.test.mjs'),
  nodeTest('pi-stage-safety', 'pi', 'scripts/pi/pi-stage-safety.test.mjs'),
  nodeTest('pi-cutover-guard', 'pi', 'scripts/pi/cutover-guard.test.mjs'),
  nodeTest('pi-ssh-log-secrets', 'pi', 'scripts/pi/ssh-log-secrets.test.mjs'),
  nodeTest('pi-deployed-state', 'pi', 'deploy/pi/deployed-state.test.mjs'),
  nodeTest('tunnel-client', 'scripts', 'installer/nsis/tunnel-client.test.mjs'),
  nodeTest('configure-claude', 'scripts', 'installer/nsis/configure-claude.test.mjs'),
  nodeTest('plan-b', 'scripts', 'scripts/plan-b/plan-b.test.mjs'),
  nodeTest('tv-table-viewer', 'scripts', 'scripts/tv/start-table-viewer.test.mjs'),
  { name: 'wiki-scripts', group: 'scripts', cmd: 'npm', args: ['run', 'wiki:test'], env: CI },
  nodeTest('dnd-helper-test', 'tools', 'tools/dnd-helper/build.test.mjs'),
  nodeTest('player-connector-test', 'tools', 'tools/player-connector/build.test.mjs'),
  {
    name: 'livekit-recorder-install',
    group: 'tools',
    cmd: 'npm',
    args: ['ci', '--prefix', 'tools/livekit/recorder'],
  },
  {
    name: 'livekit-recorder-test',
    group: 'tools',
    cmd: 'npm',
    args: ['test', '--prefix', 'tools/livekit/recorder'],
    env: CI,
  },
  { name: 'coverage-check', group: 'gate', cmd: 'node', args: ['scripts/test-coverage-check.mjs'] },
  npmRun('changelog', 'static', 'changelog:check', {
    drift: { name: 'changelog fragments', order: 3 },
  }),
  nodeTest('gm-coach-test', 'tools', 'tools/gm-coach/build.test.mjs'),
  { name: 'gm-coach-build', group: 'tools', cmd: 'node', args: ['tools/gm-coach/build.mjs'] },
  { name: 'build', group: 'build', cmd: 'npm', args: ['run', 'build'] },
  {
    // CI runs this on Node 24 only; green is run on Node 24.
    name: 'bundle-budget',
    group: 'build',
    cmd: 'npm',
    args: ['run', 'bundle:budget', '-w', '@gnuminator/cogm-dashboard'],
    drift: {
      name: 'dashboard bundle budget',
      order: 11,
      when: DASHBOARD_PATH,
      needs: 'dashboard build',
    },
  },
  { name: 'kit-test', group: 'kit', cmd: 'npm', args: ['run', 'kit:test'], env: CI },
  { name: 'kit-check', group: 'kit', cmd: 'node', args: ['scripts/test-kit/kit.mjs', 'check'] },
  {
    name: 'kit-fake',
    group: 'kit',
    cmd: 'node',
    args: ['scripts/test-kit/kit.mjs', 'all', '--fake'],
    env: { TEST_KIT_HOME: path.join(os.tmpdir(), 'green-test-kit') },
  },
  // The shared unit tests also run in the merge gate's drift check, on the merged tree, whenever
  // the branch or main since the merge base touched shared/: a shared change that breaks them
  // is refused before merge, not found on main afterwards.
  {
    ...workspaceTest('test-shared', 'shared'),
    drift: { name: 'shared unit tests', order: 12, heavy: true, when: ['shared/'] },
  },
  workspaceTest('test-foundry-module', 'foundry-module'),
  workspaceTest('test-mcp-server', 'mcp-server'),
  workspaceTest('test-cogm-dashboard', 'cogm-dashboard'),
  workspaceTest('test-discord-bot', 'discord-bot'),
  workspaceTest('test-obsidian-plugin', 'obsidian-plugin'),
  {
    name: 'mcp-schema-smoke',
    group: 'smoke',
    cmd: 'node',
    args: ['scripts/mcp-schema-smoke-test.mjs'],
  },
  {
    name: 'standalone-smoke',
    group: 'smoke',
    cmd: 'node',
    args: ['scripts/standalone-smoke-test.mjs'],
  },
  { name: 'split-smoke', group: 'smoke', cmd: 'node', args: ['scripts/cogm-split-smoke-test.mjs'] },
  nodeTest('ci-e2e-filter', 'smoke', 'scripts/ci-e2e-filter.test.mjs'),
  {
    name: 'validate-manifest',
    group: 'smoke',
    cmd: 'node',
    args: ['scripts/validate-manifest.js'],
  },
  {
    // CI runs this in the sharded job dashboard-e2e-shard, after build-test. Needs Chromium for Playwright (`npx playwright install chromium`, once on this PC).
    name: 'e2e',
    group: 'smoke',
    cmd: 'npm',
    args: ['run', 'test:e2e', '-w', '@gnuminator/cogm-dashboard'],
    env: CI,
  },
  // Drift guards that are not steps of their own: CI and green run these tests inside the workspace
  // test steps above (so `steps: false`), drift runs them alone on the merged tree.
  {
    name: 'drift-mcp-server-tests',
    group: 'unit',
    steps: false,
    cmd: 'npx',
    args: ['vitest', 'run', '--exclude', 'src/mcp-modern-probe.test.ts'],
    cwd: 'packages/mcp-server',
    // The probe test runs the built dist/index.js, which the merged worktree never builds;
    // CI and `npm run green` run it after a build.
    drift: {
      name: 'mcp-server tests (tool counts, tool reference, tool sets)',
      order: 8,
      heavy: true,
    },
  },
  {
    name: 'drift-write-gate',
    group: 'unit',
    steps: false,
    cmd: 'npx',
    args: ['vitest', 'run', 'src/write-gate.test.ts'],
    cwd: 'packages/foundry-module',
    drift: { name: 'module write gate', order: 9, heavy: true },
  },
  // The dashboard first-load budget is a limit two PRs can overflow together while each fits alone
  // (#642 and #648 turned main red for 11.5 hours on 2026-10-30). The build and the budget run on
  // the merged tree, and only when the branch or main since the merge base touched the dashboard.
  {
    name: 'drift-dashboard-build',
    group: 'build',
    steps: false,
    cmd: 'npm',
    args: ['run', 'build', '-w', '@gnuminator/cogm-dashboard'],
    drift: { name: 'dashboard build', order: 10, heavy: true, when: DASHBOARD_PATH },
  },
];

/** The steps of the CI job `build-test` that `npm run green` runs, in CI order. @type {Step[]} */
export const STEPS = CHECKS.filter(c => c.steps !== false).map(({ name, cmd, args, env }) => ({
  name,
  cmd,
  args,
  ...(env ? { env } : {}),
}));

/** The guards `npm run drift:check` runs, in drift order, in the shape drift-check.mjs holds them. */
export function driftChecks() {
  return CHECKS.filter(c => c.drift)
    .sort((a, b) => (a.drift?.order ?? 0) - (b.drift?.order ?? 0))
    .map(c => {
      const d = /** @type {Drift} */ (c.drift);
      /** @type {Record<string, unknown>} */
      const out = { name: d.name, command: [c.cmd, ...c.args].join(' ') };
      if (d.heavy || HEAVY_STEPS.has(c.name)) out.heavy = true;
      if (d.when) out.when = d.when;
      if (d.needs) out.needs = d.needs;
      if (c.cwd) out.cwd = c.cwd;
      return out;
    });
}

/**
 * CI commands of `build-test` that green does not run, each with the reason. The key is the command
 * with its whitespace collapsed. The parity test accepts a CI command that a step covers or that is
 * listed here.
 * @type {Record<string, string>}
 */
export const CI_ONLY = {
  'bash scripts/ci-install-chromium.sh':
    'Installs Chromium and its system packages on the CI runner, retrying on a DNS blip; on a PC it is a one-time `npx playwright install chromium`.',
};

/**
 * Is this module the script node was started with? Real paths on both sides (as lane-merge.mjs;
 * copied, not imported: this file imports no other repo file).
 * @param {string | undefined} argv1 @param {string} self
 */
export function isEntryModule(argv1, self) {
  if (!argv1) return false;
  const norm = (/** @type {string} */ p) => {
    let r;
    try {
      r = fs.realpathSync(p);
    } catch {
      r = path.resolve(p);
    }
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return norm(argv1) === norm(self);
}

/**
 * 'run' when started directly, 'import' when another module loaded it, 'mismatch' when the started
 * file has this file's name but is not this file.
 * @param {string | undefined} argv1 @param {string} self
 */
export function entryDecision(argv1, self) {
  if (isEntryModule(argv1, self)) return 'run';
  if (argv1 && /^file:/i.test(argv1)) return 'import'; // a `node -e` import, as drift-check.mjs
  if (argv1 && path.basename(argv1).toLowerCase() === path.basename(self).toLowerCase()) {
    return 'mismatch';
  }
  return 'import';
}

const entry = entryDecision(process.argv[1], fileURLToPath(import.meta.url));
if (entry === 'mismatch') {
  console.error(
    `checks: started as ${process.argv[1]}, which is not ${fileURLToPath(import.meta.url)}.`
  );
  process.exitCode = 1;
} else if (entry === 'run') {
  if (process.argv.includes('--list')) {
    for (const c of CHECKS) {
      const where = [c.steps === false ? '' : 'ci+green', c.drift ? 'drift' : ''].filter(Boolean);
      console.log(`${c.name.padEnd(28)} ${c.group.padEnd(8)} ${where.join(' ')}`);
    }
  } else {
    console.error('usage: node scripts/checks.mjs --list');
    process.exitCode = 2;
  }
}
