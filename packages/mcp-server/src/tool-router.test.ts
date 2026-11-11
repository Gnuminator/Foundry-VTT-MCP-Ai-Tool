/**
 * Tests for the control-channel call_tool dispatch table. This routing used to
 * live in a ~70-case switch inside backend.ts (untestable — backend.ts runs a
 * process lock + server bootstrap at import). As a pure builder it can now be
 * checked directly: the route count is pinned (a dropped/added route fails), and
 * both dispatch shapes are verified — direct `tool.method(args)` and the generic
 * `ownershipTools.handleToolCall(name, args)` dispatcher.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildToolRouter, DETACHED_TOOLS, type ToolRouterDeps } from './tool-router.js';
import { TOOL_MODULES } from './tools/index.js';
import { type ToolModule, createToolInstances, defineToolModule } from './tools/tool-module.js';
import { stubToolServices } from './test-support/stub-tool-deps.js';

describe('createToolInstances', () => {
  it('builds each module once, even one another module uses', () => {
    let built = 0;
    const base = defineToolModule({
      id: 'base',
      create: () => ({ n: ++built }),
      definitions: () => [],
      routes: {},
    });
    const user = defineToolModule({
      id: 'user',
      create: ({ use }) => ({ base: use(base) }),
      definitions: () => [],
      routes: {},
    });
    const tools = createToolInstances(stubToolServices(), [user, base]);
    expect(built).toBe(1);
    expect(tools.get(user).base).toBe(tools.get(base));
  });

  it('refuses two modules with one id', () => {
    const a = defineToolModule({ id: 'a', create: () => 1, definitions: () => [], routes: {} });
    expect(() => createToolInstances(stubToolServices(), [a, { ...a }])).toThrow(/Duplicate/);
  });
});

/** A tool whose every method is a memoized spy resolving to a marker. */
function toolMock(): object {
  const fns: Record<string, any> = {};
  return new Proxy(
    {},
    {
      get(_t, prop: string): unknown {
        fns[prop] ??= vi.fn(async (...a: any[]) => ({ called: prop, args: a }));
        return fns[prop];
      },
    }
  );
}

/** Every tool module, each instance a memoized catch-all mock. */
function makeDeps(): ToolRouterDeps {
  const cache = new Map<unknown, object>();
  return {
    modules: TOOL_MODULES,
    get: <T>(module: ToolModule<T>): T => {
      if (!cache.has(module)) cache.set(module, toolMock());
      return cache.get(module) as T;
    },
  };
}

/** The mock instance of the module with this id (tools/modules/<id>.ts). */
function tool(deps: ToolRouterDeps, id: string): any {
  const module = TOOL_MODULES.find(m => m.id === id);
  if (!module) throw new Error(`no tool module ${id}`);
  return deps.get(module);
}

describe('buildToolRouter', () => {
  it('exposes a handler for every call_tool route', () => {
    const router = buildToolRouter(makeDeps());
    expect(Object.keys(router)).toHaveLength(102);
  });

  it('routes direct tools to the owning method with the call args', async () => {
    const deps = makeDeps();
    const router = buildToolRouter(deps);
    const args = { x: 1 };

    await router['get-character'](args);
    expect(tool(deps, 'character').handleGetCharacter).toHaveBeenCalledWith(args);

    await router['plan-scene-change'](args);
    expect(tool(deps, 'scene-change').handlePlanSceneChange).toHaveBeenCalledWith(args);

    await router['play-playlist'](args);
    expect(tool(deps, 'scene-change').handlePlayPlaylist).toHaveBeenCalledWith(args);

    await router['list-changes'](args);
    expect(tool(deps, 'change-history').handleListChanges).toHaveBeenCalledWith(args);

    await router['plan-undo-changes'](args);
    expect(tool(deps, 'change-history').handlePlanUndoChanges).toHaveBeenCalledWith(args);

    await router['list-scenes'](args);
    expect(tool(deps, 'scene').listScenes).toHaveBeenCalledWith(args);

    await router['switch-scene'](args);
    expect(tool(deps, 'scene').switchScene).toHaveBeenCalledWith(args);
  });

  it('passes who asked to the writes that record a name, and nothing without a context', async () => {
    const deps = makeDeps();
    const router = buildToolRouter(deps);
    const args = { planId: 'p1', confirm: true };

    await router['apply-planned-change'](args, { requestedBy: 'GM (dashboard)' });
    expect(tool(deps, 'guarded-changes').handleApplyPlannedChange).toHaveBeenCalledWith(
      args,
      'GM (dashboard)'
    );
    await router['undo-change']({ changeId: 'c1' }, { requestedBy: 'GM (dashboard)' });
    expect(tool(deps, 'guarded-changes').handleUndoChange).toHaveBeenCalledWith(
      { changeId: 'c1' },
      'GM (dashboard)'
    );
    await router['apply-planned-change'](args);
    expect(tool(deps, 'guarded-changes').handleApplyPlannedChange).toHaveBeenLastCalledWith(
      args,
      undefined
    );
  });

  it('runs wait-for-game-event detached and every other tool in line', () => {
    expect([...DETACHED_TOOLS]).toEqual(['wait-for-game-event']);
    expect(Object.keys(buildToolRouter(makeDeps()))).toContain('wait-for-game-event');
  });

  it('hands the connection signal to wait-for-game-event, so a closed socket ends the wait', async () => {
    const deps = makeDeps();
    const router = buildToolRouter(deps);
    const signal = new AbortController().signal;
    await router['wait-for-game-event']({ x: 1 }, { signal });
    expect(tool(deps, 'wait-for-event').handleWaitForGameEvent).toHaveBeenCalledWith(
      { x: 1 },
      signal
    );
  });

  it('routes ownership tools through the generic handleToolCall dispatcher', async () => {
    const deps = makeDeps();
    const router = buildToolRouter(deps);
    const args = { y: 2 };

    await router['plan-ownership-change'](args);
    expect(tool(deps, 'ownership').handleToolCall).toHaveBeenCalledWith(
      'plan-ownership-change',
      args
    );
    await router['list-actor-ownership'](args);
    expect(tool(deps, 'ownership').handleToolCall).toHaveBeenCalledWith(
      'list-actor-ownership',
      args
    );
    expect(router['assign-actor-ownership']).toBeUndefined();
    expect(router['remove-actor-ownership']).toBeUndefined();
  });

  it('returns the tool method result', async () => {
    const router = buildToolRouter(makeDeps());
    const res = await router['get-world-info']({});
    expect(res).toMatchObject({ called: 'handleGetWorldInfo' });
  });

  it('has no handler for an unknown tool name (caller throws Unknown tool)', () => {
    const router = buildToolRouter(makeDeps());
    expect(router['definitely-not-a-tool']).toBeUndefined();
  });

  it('refuses a tool name two modules both route', () => {
    const one = defineToolModule({
      id: 'one',
      create: () => ({}),
      definitions: () => [],
      routes: { 'same-name': async () => 1 },
    });
    const two = defineToolModule({ ...one, id: 'two' });
    const deps = { modules: [one, two], get: <T>(): T => ({}) as T };
    expect(() => buildToolRouter(deps)).toThrow(/same-name.*claimed twice/);
  });

  // The map is null-prototype: inherited Object.prototype keys must not resolve
  // to a (truthy) function and slip past the caller's `if (!route)` Unknown-tool
  // guard, which the old switch's `default` arm caught.
  it('does not dispatch Object.prototype keys as handlers', () => {
    const router = buildToolRouter(makeDeps());
    for (const key of ['toString', 'constructor', 'valueOf', 'hasOwnProperty', 'isPrototypeOf']) {
      expect(router[key]).toBeUndefined();
    }
  });
});
