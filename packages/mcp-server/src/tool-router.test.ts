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
    expect(Object.keys(router)).toHaveLength(73);
  });

  it('routes direct tools to the owning method with the call args', async () => {
    const deps = makeDeps();
    const router = buildToolRouter(deps);
    const args = { x: 1 };

    await router['get-character'](args);
    expect((deps as any).characterTools.handleGetCharacter).toHaveBeenCalledWith(args);

    await router['drop-loot'](args);
    expect((deps as any).lootTools.handleDropLoot).toHaveBeenCalledWith(args);
  });

  it('routes ownership tools through the generic handleToolCall dispatcher', async () => {
    const deps = makeDeps();
    const router = buildToolRouter(deps);
    const args = { y: 2 };

    await router['assign-actor-ownership'](args);
    expect((deps as any).ownershipTools.handleToolCall).toHaveBeenCalledWith(
      'assign-actor-ownership',
      args
    );
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
