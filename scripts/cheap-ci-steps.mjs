/**
 * The two cheap CI failures a `green --quick` run used to miss (item ci-cheap-failures, idea I-155:
 * 9 failed CI runs in 19 hours, 5 of them `unused-ratchet`, `lint-ratchet` or `typecheck`, 3 a new
 * tool without a live-sweep step). Both steps run the same command as CI and take no heavy lock.
 */

/**
 * @typedef {{ name: string, cmd: string, args: string[], env?: Record<string, string> }} Step
 */

/** Inputs of the unused-code ratchet (knip reads every TypeScript source and the workspace manifests). */
const UNUSED_RATCHET_INPUT =
  /^(?:packages\/.+\.tsx?|shared\/.+\.tsx?|knip\.json|package\.json|packages\/[^/]+\/package\.json|tsconfig[^/]*\.json|scripts\/unused-(?:baseline\.json|ratchet\.mjs))$/;

/** Inputs of the live-sweep coverage test: the tool modules, the sets page, the sweep, the tool policy. */
const SWEEP_COVERAGE_INPUT =
  /^(?:packages\/mcp-server\/src\/tools\/.+|docs\/reference\/TOOL-SETS\.md|scripts\/live-write-sweep\.mjs|packages\/cogm-dashboard\/src\/(?:tool-policy|live-sweep-coverage\.test)\.ts)$/;

/**
 * `unused-ratchet` (whole-repo knip count, measured 7.8 s with a warm install) when TypeScript
 * sources, the knip config or a manifest changed, and the live-sweep coverage test (about 1.4 s,
 * "add a sweep step (or a recorded skip) for: ...") when a tool module, the sets page or the sweep
 * changed. A new tool lives in `packages/mcp-server`, so the cogm-dashboard unit step would not
 * otherwise run.
 * @param {string[]} files repo-relative paths, forward slashes
 * @returns {Step[]}
 */
export function cheapCiQuickSteps(files) {
  /** @type {Step[]} */
  const steps = [];
  if (files.some(f => UNUSED_RATCHET_INPUT.test(f))) {
    steps.push({ name: 'unused-ratchet-quick', cmd: 'npm', args: ['run', 'unused:ratchet'] });
  }
  if (files.some(f => SWEEP_COVERAGE_INPUT.test(f))) {
    steps.push({
      name: 'sweep-coverage-quick',
      cmd: 'npm',
      args: [
        'run',
        'test',
        '-w',
        '@gnuminator/cogm-dashboard',
        '--',
        'src/live-sweep-coverage.test.ts',
      ],
      env: { CI: 'true' },
    });
  }
  return steps;
}
