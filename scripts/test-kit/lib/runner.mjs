/**
 * Runs scenarios: builds the ScenarioContext (see contract.mjs), times and records every step,
 * runs the cleanups last in first out, and collects the module's console errors per scenario.
 * Free of Foundry specifics beyond the console-error check.
 */
import { isDeepStrictEqual } from 'node:util';
import { KitAssertion, EnvError, SkipError } from './errors.mjs';
import { brief } from './dashboard.mjs';

const DEFAULT_TIMEOUT_MS = 120000;
const MODULE_ID = 'foundry-mcp-bridge';

/** Thrown out of a failed step to end the scenario; never reported twice. */
class StepFailed extends Error {}
/** Thrown by step() once the scenario's time is up. */
class TimedOut extends Error {}

/**
 * @typedef {import('./contract.mjs').Scenario} Scenario
 * @typedef {import('./contract.mjs').ScenarioResult} ScenarioResult
 * @typedef {import('./contract.mjs').StepResult} StepResult
 * @typedef {{call: (action: string, args?: object) => Promise<any>}} GmLike
 * @typedef {{state: () => Promise<any>, html: () => Promise<string>}} PlayerLike
 * @typedef {object} RunOptions
 * @property {ReturnType<typeof import('./dashboard.mjs').createDashboardClient>} dashboard
 * @property {GmLike} [gm]
 * @property {PlayerLike} [player]   defaults to /api/player/state and /player on the dashboard
 * @property {import('./contract.mjs').KitManifest | null} [manifest]
 * @property {boolean} [fake]
 * @property {'smoke'|'full'|'long'} [size]   the kit size of the run; scenarios read it as `t.size` (default smoke)
 * @property {(line: string) => void} [log]   one line per step, as the live scripts print them
 */

/** @param {unknown} e */
function errorInfo(e) {
  const err = /** @type {any} */ (e);
  const message = err && err.message ? String(err.message) : String(e);
  /** @type {{message: string, kind?: string, reply?: unknown}} */
  const info = { message };
  if (err && typeof err === 'object') {
    if (err.kind) info.kind = String(err.kind);
    else if (err.name && err.name !== 'Error') info.kind = String(err.name);
    if (err.reply !== undefined) info.reply = err.reply;
    else if (err.details !== undefined) info.reply = err.details;
  }
  return info;
}

/**
 * Runs the scenarios in order and returns their results. An EnvError ends the whole run (it is
 * thrown with the results so far in `partialResults`).
 * @param {Array<{scenario: Scenario, file: string, dir?: string}>} list
 * @param {RunOptions} opts
 * @returns {Promise<ScenarioResult[]>}
 */
export async function runScenarios(list, opts) {
  return (await runScenariosDetailed(list, opts)).results;
}

/**
 * Like {@link runScenarios}, plus every console error the GM page reported during the run.
 * @param {Array<{scenario: Scenario, file: string, dir?: string}>} list
 * @param {RunOptions} opts
 * @returns {Promise<{results: ScenarioResult[], consoleErrors: Array<{at: string, message: string, source: string}>}>}
 */
export async function runScenariosDetailed(list, opts) {
  /** @type {ScenarioResult[]} */
  const results = [];
  /** @type {Array<{at: string, message: string, source: string}>} */
  const consoleErrors = [];
  for (const entry of list) {
    try {
      results.push(await runOne(entry, opts, consoleErrors));
    } catch (e) {
      if (e instanceof EnvError) {
        const partial = /** @type {any} */ (e).partialResult;
        if (partial) results.push(partial);
        /** @type {any} */ (e).partialResults = results;
        /** @type {any} */ (e).partialConsoleErrors = consoleErrors;
      }
      throw e;
    }
  }
  return { results, consoleErrors };
}

/**
 * @param {{scenario: Scenario, file: string, dir?: string}} entry
 * @param {RunOptions} opts
 * @param {Array<{at: string, message: string, source: string}>} consoleSink
 * @returns {Promise<ScenarioResult>}
 */
async function runOne({ scenario, file }, opts, consoleSink) {
  const { dashboard, gm, manifest = null, fake = false, size = 'smoke' } = opts;
  const out = opts.log || (() => {});
  const declared = new Set(scenario.gmActions || []);
  const t0 = Date.now();
  const sinceMs = t0;

  /** @type {ScenarioResult} */
  const result = {
    id: scenario.id,
    title: scenario.title,
    file,
    licensed: Boolean(scenario.licensed),
    tags: [...scenario.tags],
    status: 'pass',
    durationMs: 0,
    steps: [],
    logs: [],
    attachments: [],
  };
  /** @type {Array<() => Promise<void>>} */
  const cleanups = [];
  let timedOut = false; // once the time is up, late steps and logs of the scenario are dropped
  let stepNo = 0;
  let envError = null;

  /** @param {StepResult} s */
  function record(s) {
    result.steps.push(s);
    stepNo += 1;
    const tag = `[${String(stepNo).padStart(2, '0')}]`;
    const word = s.status === 'pass' ? 'PASS' : s.status === 'fail' ? 'FAIL' : 'SKIP';
    const tail = s.error ? s.error.message : s.detail || '';
    out(`${word} ${tag} ${scenario.id}: ${s.label}${tail ? `: ${brief(tail, 200)}` : ''}`);
  }

  /** @type {import('./contract.mjs').ScenarioContext['step']} */
  async function step(label, fn, { continueOnFail = false } = {}) {
    if (timedOut) throw new TimedOut('scenario time is up');
    const s0 = Date.now();
    try {
      const value = await fn();
      if (timedOut) throw new TimedOut('scenario time is up');
      /** @type {StepResult} */
      const ok = { label, status: 'pass', durationMs: Date.now() - s0 };
      if (typeof value === 'string' && value) ok.detail = brief(value, 200);
      record(ok);
      return value;
    } catch (e) {
      if (e instanceof TimedOut || timedOut) throw e;
      const durationMs = Date.now() - s0;
      if (e instanceof EnvError) {
        record({ label, status: 'fail', durationMs, error: errorInfo(e) });
        throw e;
      }
      if (e instanceof SkipError) {
        record({ label, status: 'skip', durationMs, detail: e.message });
        throw e;
      }
      record({ label, status: 'fail', durationMs, error: errorInfo(e) });
      if (continueOnFail) return undefined;
      throw new StepFailed(label);
    }
  }

  /** @type {PlayerLike} */
  const player = opts.player || {
    async state() {
      const r = await dashboard.http('/api/player/state');
      if (r.status !== 200) throw new Error(`/api/player/state answered HTTP ${r.status}`);
      return r.data;
    },
    async html() {
      const r = await dashboard.http('/player', { text: true });
      if (r.status !== 200) throw new Error(`/player answered HTTP ${r.status}`);
      return r.data;
    },
  };

  /** @type {import('./contract.mjs').ScenarioContext} */
  const t = {
    step,
    check(cond, message, details) {
      if (!cond) throw new KitAssertion(message, details);
    },
    equal(actual, expected, message) {
      if (!isDeepStrictEqual(actual, expected)) {
        throw new KitAssertion(`${message}: expected ${brief(expected)}, got ${brief(actual)}`, {
          actual,
          expected,
        });
      }
    },
    skip(reason) {
      throw new SkipError(reason);
    },
    tool: (name, args, flags) => dashboard.tool(name, args, flags),
    guarded: {
      planApply: (planTool, args) => dashboard.planApply(planTool, args),
      undo: changeId => dashboard.undo(changeId),
    },
    async gm(action, args) {
      if (!declared.has(action)) {
        throw new Error(`scenario "${scenario.id}" did not declare gm action "${action}"`);
      }
      if (!gm) throw new Error(`no GM session: gm action "${action}" is not available`);
      return gm.call(action, args);
    },
    player,
    http: (path, o) => dashboard.http(path, o),
    kit: /** @type {any} */ (manifest),
    log(message) {
      if (timedOut) return;
      result.logs.push(String(message));
      out(`     ${scenario.id}: ${message}`);
    },
    attach(name, data) {
      if (!timedOut) result.attachments.push({ name, data });
    },
    cleanup(fn) {
      cleanups.push(fn);
    },
    fake,
    size,
  };

  // --- run, with a time limit ---
  const limit = scenario.timeoutMs || DEFAULT_TIMEOUT_MS;
  let timer;
  /** @type {'done' | 'skip' | 'stepfailed' | 'timeout' | 'error'} */
  let outcome = 'done';
  let thrown = null;
  try {
    await Promise.race([
      scenario.run(t),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new TimedOut(`timed out after ${limit} ms`)), limit);
      }),
    ]);
  } catch (e) {
    if (e instanceof TimedOut) outcome = 'timeout';
    else if (e instanceof StepFailed) outcome = 'stepfailed';
    else if (e instanceof SkipError) outcome = 'skip';
    else if (e instanceof EnvError) envError = e;
    else {
      outcome = 'error';
      thrown = e;
    }
  } finally {
    clearTimeout(timer);
  }

  // A timed-out scenario's late steps must not record; the thrown error is recorded first.
  if (outcome === 'timeout') {
    timedOut = true;
    record({
      label: 'scenario time limit',
      status: 'fail',
      durationMs: Date.now() - t0,
      error: {
        message: `the scenario ${scenario.id} timed out after ${limit} ms`,
        kind: 'timeout',
      },
    });
  } else if (outcome === 'error') {
    record({
      label: 'scenario threw outside a step',
      status: 'fail',
      durationMs: Date.now() - t0,
      error: errorInfo(thrown),
    });
  } else if (outcome === 'skip' && !result.steps.some(s => s.status === 'skip')) {
    // t.skip() called outside a step: show it as a skipped step.
    const reason = 'skipped';
    record({ label: reason, status: 'skip', durationMs: 0 });
  }

  // --- cleanups, always, last in first out ---
  for (const fn of cleanups.reverse()) {
    const c0 = Date.now();
    try {
      await fn();
    } catch (e) {
      record({
        label: `cleanup: ${/** @type {any} */ (e)?.message || String(e)}`.slice(0, 160),
        status: 'fail',
        durationMs: Date.now() - c0,
        error: errorInfo(e),
      });
    }
  }

  // --- the module's console errors during this scenario ---
  if (gm) {
    try {
      const reply = await gm.call('consoleErrors', { since: sinceMs });
      const errors = (reply && Array.isArray(reply.errors) ? reply.errors : []).map(
        (/** @type {any} */ x) => ({
          at: String(x.at ?? ''),
          message: String(x.message ?? ''),
          source: String(x.source ?? ''),
        })
      );
      consoleSink.push(...errors);
      const ours = errors.filter(
        (/** @type {{message: string, source: string}} */ x) =>
          x.message.includes(MODULE_ID) || x.source.includes(MODULE_ID)
      );
      if (ours.length) {
        record({
          label: 'module console errors',
          status: 'fail',
          durationMs: 0,
          error: {
            message: ours.map((/** @type {{message: string}} */ x) => x.message).join(' | '),
            kind: 'console',
            reply: ours,
          },
        });
      }
    } catch (e) {
      result.logs.push(`console errors could not be read: ${/** @type {any} */ (e)?.message || e}`);
    }
  }

  result.durationMs = Date.now() - t0;
  const failedStep = result.steps.some(s => s.status === 'fail');
  const skippedStep = result.steps.some(s => s.status === 'skip');
  if (outcome === 'error' || outcome === 'timeout') result.status = 'error';
  else if (failedStep) result.status = 'fail';
  else if (skippedStep || outcome === 'skip') result.status = 'skip';
  else result.status = 'pass';

  if (envError) {
    /** @type {any} */ (envError).partialResult = result;
    throw envError;
  }
  return result;
}
