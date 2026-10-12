/**
 * The guard between a tools-only scenario and the Pi's dashboard. The pi target calls tools on the
 * Pi's live bridge (the one Danni's dashboard and the Desktop connectors use), so the `tools-only`
 * tag is not trusted on its own: every call a scenario makes goes through here, and
 *
 * - a tool the scenario did not declare in `tools` is refused,
 * - so is a tool that is not a read or `plan-*` tool (see isToolsOnlyTool),
 * - `confirm` and `confirmDestructive` are never sent (a read or plan tool needs neither),
 * - raw `t.http` is GET only, and the guarded plan/apply/undo helpers and the GM Actions switch
 *   are closed,
 * - and before every call except get-world-info the bridge must still say it is in the pi world
 *   (checked at most every `ttlMs`, 2 s): if someone stops the kit session during a run, Foundry
 *   moves to the campaign world and the rest of the run must not follow it.
 *
 * Every refusal is an EnvError, which ends the run with exit code 2.
 */
import { isToolsOnlyTool } from './dashboard.mjs';
import { EnvError } from './errors.mjs';

/** How long a world check is trusted. */
export const WORLD_CHECK_TTL_MS = 2000;

/**
 * @param {ReturnType<typeof import('./dashboard.mjs').createDashboardClient>} dashboard the real client
 * @param {{world: string, ttlMs?: number, now?: () => number}} opts
 * @returns {{forScenario: (scenario: {id: string, tools?: string[]}) => ReturnType<typeof import('./dashboard.mjs').createDashboardClient>}}
 */
export function createPiGuard(dashboard, { world, ttlMs = WORLD_CHECK_TTL_MS, now = Date.now }) {
  let checkedAt = -Infinity;

  /** The bridge must still be in the pi world. */
  async function assertWorld() {
    if (now() - checkedAt < ttlMs) return;
    const info = await dashboard.tool('get-world-info', {});
    const id = info && typeof info.id === 'string' ? info.id : '';
    if (id !== world) {
      throw new EnvError(
        `REFUSED: the Pi's bridge now reports the world "${id || '(none)'}", not ${world} (was the kit session stopped during the run?). No further call was made.`
      );
    }
    checkedAt = now();
  }

  return {
    forScenario(scenario) {
      const declared = new Set(scenario.tools ?? []);
      const refuse = (/** @type {string} */ why) => {
        throw new EnvError(`REFUSED: pi run, scenario "${scenario.id}": ${why}`);
      };
      const closed = (/** @type {string} */ what) => () =>
        refuse(`${what} is not available on the Pi`);

      /** @type {any} */
      const guarded = {
        base: dashboard.base,
        health: () => dashboard.health(),
        tools: refresh => dashboard.tools(refresh),
        getGmActions: () => dashboard.getGmActions(),
        setGmActions: closed('the GM Actions switch'),
        planApply: closed('plan and apply'),
        undo: closed('undo'),
        async http(path, opts = {}) {
          const method = String(opts.method ?? 'GET').toUpperCase();
          if (method !== 'GET') refuse(`${method} ${path} (the Pi run sends GET requests only)`);
          return dashboard.http(path, opts);
        },
        async tool(name, args = {}, flags = {}) {
          if (!declared.has(name)) refuse(`tool "${name}" is not in the scenario's declared tools`);
          if (!isToolsOnlyTool(name)) refuse(`tool "${name}" is not a read or plan tool`);
          if (flags && (flags.confirm || flags.confirmDestructive)) {
            refuse(`tool "${name}" was called with a confirmation, which the Pi run never sends`);
          }
          if (name !== 'get-world-info') await assertWorld();
          return dashboard.tool(name, args, {});
        },
      };
      return guarded;
    },
  };
}
