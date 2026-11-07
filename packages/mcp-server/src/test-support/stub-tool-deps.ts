/**
 * Test helper: every tool module built from the real tool classes with stub services
 * (tools/index.ts). Tool definitions never touch their services, so this is enough to call
 * `collectToolDefinitions()` / `buildToolRouter()` in a unit test (tool-catalog.test.ts,
 * prompts/prompts.test.ts). A new tool family needs nothing here unless it needs a new service.
 */
import { vi } from 'vitest';

import { GameEventHub } from '../game-event-hub.js';
import type { ToolRouterDeps } from '../tool-router.js';
import { createTools } from '../tools/index.js';
import type { ToolServices } from '../tools/tool-module.js';

/** Stand-ins for every tool service: a mock Foundry client and logger, empty objects otherwise. */
export function stubToolServices(): ToolServices {
  const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  logger.child = (): unknown => logger;
  return {
    foundryClient: { query: vi.fn() } as any,
    logger,
    gameEventHub: new GameEventHub(),
    guardedWrites: {} as any,
    worldIds: { current: vi.fn(() => Promise.resolve('world')) } as any,
    store: {} as any,
    changeHistory: {} as any,
    undoPlanner: {} as any,
    tarokka: {} as any,
    secretTerms: { findSecretTermsInMany: vi.fn(() => Promise.resolve([])) } as any,
    handouts: {} as any,
    onPlaySessionMarked: (): void => {},
    wrapperStatus: () => ({}) as any,
    pumpHealth: () => [],
    obsidianVaultDir: null,
    sessionsDir: '',
    mirrorStatus: () => null,
    mirrorEnv: {} as any,
    playerExtraDenyTerms: () => [],
  };
}

export function stubToolRouterDeps(): ToolRouterDeps {
  return createTools(stubToolServices());
}
