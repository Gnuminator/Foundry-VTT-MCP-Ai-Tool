/**
 * Tests for the control-channel call_tool dispatch table. This routing used to
 * live in a ~70-case switch inside backend.ts (untestable — backend.ts runs a
 * process lock + server bootstrap at import). As a pure builder it can now be
 * checked directly: the route count is pinned (a dropped/added route fails), and
 * both dispatch shapes are verified — direct `tool.method(args)` and the generic
 * `ownershipTools.handleToolCall(name, args)` dispatcher.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildToolRouter, type ToolRouterDeps } from './tool-router.js';

/** A tool whose every method is a memoized spy resolving to a marker. */
function toolMock() {
  const fns: Record<string, any> = {};
  return new Proxy(
    {},
    {
      get(_t, prop: string) {
        fns[prop] ??= vi.fn(async (...a: any[]) => ({ called: prop, args: a }));
        return fns[prop];
      },
    }
  );
}

/** Deps where each tool instance is a memoized catch-all mock. */
function makeDeps(): ToolRouterDeps {
  const cache: Record<string, any> = {};
  return new Proxy(
    {},
    {
      get(_t, prop: string) {
        cache[prop] ??= toolMock();
        return cache[prop];
      },
    }
  ) as unknown as ToolRouterDeps;
}

describe('buildToolRouter', () => {
  it('exposes a handler for every call_tool route', () => {
    const router = buildToolRouter(makeDeps());
    expect(Object.keys(router)).toHaveLength(86);
  });

  it('routes direct tools to the owning method with the call args', async () => {
    const deps = makeDeps();
    const router = buildToolRouter(deps);
    const args = { x: 1 };

    await router['get-character'](args);
    expect((deps as any).characterTools.handleGetCharacter).toHaveBeenCalledWith(args);

    await router['plan-scene-change'](args);
    expect((deps as any).sceneChangeTools.handlePlanSceneChange).toHaveBeenCalledWith(args);

    await router['play-playlist'](args);
    expect((deps as any).sceneChangeTools.handlePlayPlaylist).toHaveBeenCalledWith(args);

    await router['list-changes'](args);
    expect((deps as any).changeHistoryTools.handleListChanges).toHaveBeenCalledWith(args);

    await router['plan-undo-changes'](args);
    expect((deps as any).changeHistoryTools.handlePlanUndoChanges).toHaveBeenCalledWith(args);

    await router['list-scenes'](args);
    expect((deps as any).sceneTools.listScenes).toHaveBeenCalledWith(args);

    await router['switch-scene'](args);
    expect((deps as any).sceneTools.switchScene).toHaveBeenCalledWith(args);
  });

  it('passes who asked to the writes that record a name, and nothing without a context', async () => {
    const deps = makeDeps();
    const router = buildToolRouter(deps);
    const args = { planId: 'p1', confirm: true };

    await router['apply-planned-change'](args, { requestedBy: 'GM (dashboard)' });
    expect((deps as any).guardedChangeTools.handleApplyPlannedChange).toHaveBeenCalledWith(
      args,
      'GM (dashboard)'
    );
    await router['undo-change']({ changeId: 'c1' }, { requestedBy: 'GM (dashboard)' });
    expect((deps as any).guardedChangeTools.handleUndoChange).toHaveBeenCalledWith(
      { changeId: 'c1' },
      'GM (dashboard)'
    );
    await router['apply-planned-change'](args);
    expect((deps as any).guardedChangeTools.handleApplyPlannedChange).toHaveBeenLastCalledWith(
      args,
      undefined
    );
  });

  it('routes ownership tools through the generic handleToolCall dispatcher', async () => {
    const deps = makeDeps();
    const router = buildToolRouter(deps);
    const args = { y: 2 };

    await router['plan-ownership-change'](args);
    expect((deps as any).ownershipTools.handleToolCall).toHaveBeenCalledWith(
      'plan-ownership-change',
      args
    );
    await router['list-actor-ownership'](args);
    expect((deps as any).ownershipTools.handleToolCall).toHaveBeenCalledWith(
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
