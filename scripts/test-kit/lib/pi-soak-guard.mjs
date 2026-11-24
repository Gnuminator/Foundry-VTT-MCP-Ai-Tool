/**
 * The guard for the Pi soak (scripts/test-kit/pi-soak.mjs): the tools-only guard of the pi target
 * (pi-guard.mjs) plus ONE narrow write path, so the soak can time plan, apply, undo and a roll on
 * the Pi's throwaway world `strahd-kit` and nowhere else. `--target pi` of the kit stays tools-only;
 * this guard is used by the soak runner only.
 *
 * What a write may be (everything else is refused, with an EnvError that ends the run):
 *  - `damageRoundTrip`: `plan-actor-change` with action damage or healing, one named target, an amount
 *    of 1 to 5; the plan must come back non-destructive; the very planId it returned is applied
 *    (with `confirm` only, never `confirmDestructive`), and the change is undone in the same call,
 *    with `finally`, so the net change is zero. A failed undo is reported (the changeId) and ends the run.
 *  - `roll`: `roll-npc-check`, an ability check, whispered to the GM (a chat card in the throwaway world).
 * Before the plan, before the apply, before the undo and before the roll the bridge must report the
 * world `strahd-kit` (no TTL: every write checks), so a kit session that was stopped mid-run, which
 * moves Foundry to the campaign world, is never written to.
 * Never: another plan tool, another action, `confirmDestructive` on an apply, the GM Actions switch,
 * more than `maxWrites` writes in all, or any write unless the runner was started with `--writes`.
 */
import { createPiGuard } from './pi-guard.mjs';
import { EnvError } from './errors.mjs';

export const SOAK_PLAN_TOOL = 'plan-actor-change';
export const SOAK_ACTIONS = new Set(['damage', 'healing']);
export const SOAK_MAX_AMOUNT = 5;
export const SOAK_ABILITIES = new Set(['str', 'dex', 'con', 'int', 'wis', 'cha']);
export const DEFAULT_MAX_WRITES = 400;

/**
 * @param {ReturnType<typeof import('./dashboard.mjs').createDashboardClient>} dashboard the real client
 * @param {{world: string, allowWrites?: boolean, maxWrites?: number, now?: () => number}} opts
 */
export function createPiSoakGuard(
  dashboard,
  { world, allowWrites = false, maxWrites = DEFAULT_MAX_WRITES, now = () => performance.now() }
) {
  const base = createPiGuard(dashboard, { world });
  let writes = 0;
  /** @type {string[]} */
  const stranded = [];

  const refuse = (/** @type {string} */ why) => {
    throw new EnvError(`REFUSED: pi soak write: ${why}`);
  };

  /** Every write looks at the world first, whatever the tools-only guard trusts. */
  async function assertWorldNow() {
    const info = await dashboard.tool('get-world-info', {});
    const id = info && typeof info.id === 'string' ? info.id : '';
    if (id !== world) {
      refuse(`the bridge reports the world "${id || '(none)'}", not ${world}. No write was made.`);
    }
  }

  function openWrite(/** @type {string} */ what) {
    if (!allowWrites) refuse(`${what}: writes are off (start the soak with --writes)`);
    if (writes >= maxWrites) refuse(`${what}: the limit of ${maxWrites} writes is used up`);
    writes += 1;
  }

  return {
    /** Writes made so far. */
    get writes() {
      return writes;
    },
    /** Changes that were applied and could not be undone: the run ends when this is not empty. */
    stranded,
    /** The tools-only guard for the soak's own scenario (reads and plan-* tools it names). */
    forSoak(/** @type {string[]} */ tools) {
      return base.forScenario({ id: 'pi-soak', tools });
    },
    /**
     * Plan, apply and undo one small HP change; timings in ms.
     * @param {{target: string, action: 'damage' | 'healing', amount: number, damageType?: string}} a
     * @returns {Promise<{planMs: number, applyMs: number, undoMs: number, changeId: string}>}
     */
    async damageRoundTrip({ target, action, amount, damageType = 'bludgeoning' }) {
      if (!SOAK_ACTIONS.has(action)) refuse(`action "${action}" is not damage or healing`);
      if (!Number.isInteger(amount) || amount < 1 || amount > SOAK_MAX_AMOUNT) {
        refuse(`amount ${amount} is not a whole number from 1 to ${SOAK_MAX_AMOUNT}`);
      }
      if (typeof target !== 'string' || !target.trim()) refuse('no target actor name');
      openWrite('plan, apply and undo');
      await assertWorldNow();
      const t0 = now();
      const plan = await dashboard.tool(SOAK_PLAN_TOOL, {
        action,
        targets: [target],
        amount,
        ...(action === 'damage' ? { damageType } : {}),
      });
      const planMs = now() - t0;
      if (!plan || typeof plan.planId !== 'string' || !plan.planId) {
        refuse(`${SOAK_PLAN_TOOL} gave no plan`);
      }
      if (plan.risk === 'destructive') refuse('the plan is destructive; the soak applies none');
      await assertWorldNow();
      const t1 = now();
      const change = await dashboard.tool(
        'apply-planned-change',
        { planId: plan.planId },
        { confirm: true }
      );
      const applyMs = now() - t1;
      const changeId = change && typeof change.changeId === 'string' ? change.changeId : '';
      if (!changeId) refuse('the apply gave no changeId, so there is nothing to undo');
      let undoMs = 0;
      try {
        await assertWorldNow();
        const t2 = now();
        await dashboard.tool(
          'undo-change',
          { changeId },
          { confirm: true, confirmDestructive: true }
        );
        undoMs = now() - t2;
      } catch (e) {
        stranded.push(changeId);
        throw e instanceof EnvError
          ? e
          : new EnvError(
              `REFUSED: pi soak write: change ${changeId} was applied and its undo failed (${String(e)}); undo it by hand`
            );
      }
      return { planMs, applyMs, undoMs, changeId };
    },
    /**
     * One whispered NPC ability check, timed in ms.
     * @param {{actor: string, ability: string}} a
     */
    async roll({ actor, ability }) {
      if (!SOAK_ABILITIES.has(ability))
        refuse(`ability "${ability}" is not str, dex, con, int, wis or cha`);
      if (typeof actor !== 'string' || !actor.trim()) refuse('no actor name');
      openWrite('roll');
      await assertWorldNow();
      const t0 = now();
      await dashboard.tool('roll-npc-check', {
        actor,
        rollType: 'ability',
        rollTarget: ability,
        isPublic: false,
      });
      return { rollMs: now() - t0 };
    },
  };
}
