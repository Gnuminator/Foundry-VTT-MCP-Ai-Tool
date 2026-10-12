/**
 * Which bridge tools need Foundry's canvas? The Orange Pi's GM browser has none (core.noCanvas),
 * so a tool that reaches for `canvas` can fail or fall back there (backlog I-028). This scenario
 * calls every read or plan tool whose module code touches the canvas, one `continueOnFail` step
 * per tool, and logs one line each:
 *
 *   canvas-probe <tool>: ok
 *   canvas-probe <tool>: FAILED needs-canvas        (the error text mentions the canvas)
 *   canvas-probe <tool>: FAILED other: <message>
 *   canvas-probe <tool>: skipped (<why>)             (the world has no scene, tokens or party)
 *
 * and a final summary line. It only reads or plans: nothing is applied, nothing is written, no
 * scene is switched (open-in-foundry views the scene that is already current). It finds its inputs
 * in the world it runs in and assumes nothing about the kit build, so it is tagged `tools-only` and
 * runs through the Pi's dashboard (`kit run --target pi`) as well as on this PC.
 */
import { brief } from '../lib/dashboard.mjs';
import { EnvError } from '../lib/errors.mjs';
import { listOf } from '../lib/helpers.mjs';

/** A probe that has nothing to work on here: reported as skipped, not as a failure. */
class Skipped extends Error {}

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'canvas-tools-headless',
  title: 'Bridge tools that touch the canvas work without one (read and plan only)',
  sizes: ['smoke', 'full'],
  tags: ['bridge', 'tools-only', 'canvas'],
  needs: [],
  tools: [
    'list-scenes',
    'get-current-scene',
    'get-token-positions',
    'measure-distance',
    'get-targets',
    'get-token-details',
    'get-party',
    'plan-party-change',
    'plan-scene-change',
    'open-in-foundry',
  ],
  timeoutMs: 120000,

  async run(t) {
    /** @type {Array<{tool: string, outcome: 'ok' | 'needs-canvas' | 'other' | 'skipped'}>} */
    const outcomes = [];

    /**
     * One tool, one step. `fn` returns the tool's answer, or throws {@link Skipped}.
     * @param {string} tool
     * @param {() => Promise<any>} fn
     * @returns {Promise<any>} the answer, or undefined when the probe failed or was skipped
     */
    async function probe(tool, fn) {
      /** @type {any} */
      let value;
      await t.step(
        `canvas probe: ${tool}`,
        async () => {
          try {
            value = await fn();
          } catch (e) {
            if (e instanceof Skipped) {
              outcomes.push({ tool, outcome: 'skipped' });
              t.log(`canvas-probe ${tool}: skipped (${e.message})`);
              return `skipped: ${e.message}`;
            }
            if (e instanceof EnvError) throw e;
            const err = /** @type {any} */ (e);
            const text = String(err && (err.error ?? err.message) ? (err.error ?? err.message) : e);
            if (/canvas/i.test(text)) {
              outcomes.push({ tool, outcome: 'needs-canvas' });
              t.log(`canvas-probe ${tool}: FAILED needs-canvas`);
            } else {
              outcomes.push({ tool, outcome: 'other' });
              t.log(`canvas-probe ${tool}: FAILED other: ${brief(text, 300)}`);
            }
            throw e;
          }
          outcomes.push({ tool, outcome: 'ok' });
          t.log(`canvas-probe ${tool}: ok`);
          return 'ok';
        },
        { continueOnFail: true }
      );
      return value;
    }

    // --- find the scene and what stands on it ---------------------------------------------
    const scenes = await probe('list-scenes', async () => {
      const list = listOf(await t.tool('list-scenes', {}), 'scenes');
      if (!list.length) throw new Skipped('the world has no scene');
      return list;
    });

    const current = await probe('get-current-scene', async () => {
      if (!scenes) throw new Skipped('no scene list to look in');
      if (!scenes.some((/** @type {any} */ s) => s.active)) throw new Skipped('no scene is active');
      const scene = await t.tool('get-current-scene', {});
      t.check(scene && typeof scene.id === 'string', 'get-current-scene names the scene', scene);
      return scene;
    });

    /** @type {Array<{id: string, name: string}>} */
    const tokens = listOf(current, 'tokens').filter(
      (/** @type {any} */ x) =>
        x && typeof x.id === 'string' && typeof x.name === 'string' && x.name
    );
    /** @type {string | null} */
    const sceneId = current && typeof current.id === 'string' ? current.id : null;

    // --- the tools ------------------------------------------------------------------------
    await probe('get-token-positions', async () => {
      if (!sceneId) throw new Skipped('no current scene');
      const result = await t.tool('get-token-positions', { sceneId });
      t.check(Array.isArray(listOf(result, 'tokens')), 'get-token-positions lists tokens', result);
      return result;
    });

    await probe('measure-distance', async () => {
      const first = tokens[0];
      const second = first && tokens.find(x => x.name !== first.name);
      if (!first || !second)
        throw new Skipped('fewer than two tokens with different names in the scene');
      const result = await t.tool('measure-distance', {
        fromTokenName: first.name,
        toTokenName: second.name,
      });
      t.check(
        result && typeof result.distance === 'number',
        'measure-distance returns a distance',
        result
      );
      return result;
    });

    await probe('get-targets', async () => {
      const result = await t.tool('get-targets', {});
      t.check(result && typeof result.count === 'number', 'get-targets returns a count', result);
      return result;
    });

    await probe('get-token-details', async () => {
      if (!tokens.length) throw new Skipped('no tokens in the scene');
      const result = await t.tool('get-token-details', { tokenId: tokens[0].id });
      t.equal(result && result.id, tokens[0].id, 'token id in get-token-details');
      return result;
    });

    const party = await probe('get-party', async () => {
      const state = await t.tool('get-party', {});
      t.check(state && Array.isArray(state.groups), 'get-party lists groups', state);
      return state;
    });

    await probe('plan-party-change', async () => {
      const groups = (party && party.groups) || [];
      if (!groups.length) throw new Skipped('the world has no party group');
      const group = groups.find((/** @type {any} */ g) => g.primary) ?? groups[0];
      try {
        const plan = await t.tool('plan-party-change', {
          action: 'place',
          groupId: group.actorId,
        });
        t.check(plan && plan.planId, 'plan-party-change returns a plan', plan);
        return plan;
      } catch (e) {
        const text = String(/** @type {any} */ (e)?.error ?? /** @type {any} */ (e)?.message ?? e);
        if (/Nobody to place/i.test(text)) throw new Skipped(brief(text, 160));
        throw e;
      }
    });

    await probe('plan-scene-change', async () => {
      if (!sceneId) throw new Skipped('no current scene');
      const where = tokens.length ? { originTokenName: tokens[0].name } : { x: 100, y: 100 };
      const plan = await t.tool('plan-scene-change', {
        action: 'template',
        shape: 'circle',
        distance: 10,
        ...where,
      });
      t.check(plan && plan.planId, 'plan-scene-change returns a plan', plan);
      return plan;
    });

    await probe('open-in-foundry', async () => {
      if (!sceneId) throw new Skipped('no current scene');
      // The scene that is already current: no change of view, only the canvas draw it asks for.
      const result = await t.tool('open-in-foundry', { uuid: `Scene.${sceneId}` });
      t.check(result && result.opened === true, 'open-in-foundry opened the scene', result);
      return result;
    });

    // --- summary --------------------------------------------------------------------------
    const names = (/** @type {string} */ outcome) =>
      outcomes.filter(o => o.outcome === outcome).map(o => o.tool);
    const part = (/** @type {string} */ outcome) => {
      const list = names(outcome);
      return `${list.length} ${outcome}${list.length ? ` (${list.join(', ')})` : ''}`;
    };
    t.log(
      `canvas-probe summary: ${outcomes.length} tools, ${part('ok')}, ${part('needs-canvas')}, ${part('other')}, ${part('skipped')}`
    );
  },
};
