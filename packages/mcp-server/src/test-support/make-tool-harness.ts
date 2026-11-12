/**
 * Test helper: the one logger stub and the one `makeTools` factory for server tool tests.
 * Do not write another `logger = { error: vi.fn(), ... }` or `function makeTools` in a test file;
 * `harness-ratchet.test.ts` counts those and the count may only fall.
 *
 *   import { makeTools } from '../test-support/make-tool-harness.js';
 *   const { tools, query } = makeTools(ChatLogTools);
 *   const { tools, query } = makeTools(ChatLogTools, () => ({ success: true, data: 1 }));
 *   const { tools } = makeTools(PlayStatsTools, { extra: { store } });   // options form
 *
 * Tools that take more than `{ foundryClient, logger }` pass `extra`, which is spread into the
 * constructor options. Anything beyond that (a different constructor shape) builds on
 * `makeLogger()` and `makeFoundryClient()` directly instead of a new local stub.
 */
import { vi, type Mock } from 'vitest';

export type QueryImpl = (method: string, data: any) => unknown;

/** A Logger stub: every level is a mock; `.child()` returns the same stub. */
export function makeLogger(): any {
  const logger: any = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  logger.child = (): unknown => logger;
  return logger;
}

/** A FoundryClient stub whose `query` is a mock (default: resolves `{ success: true }`). */
export function makeFoundryClient(queryImpl?: QueryImpl): {
  foundryClient: any;
  query: Mock<QueryImpl>;
} {
  const query = vi.fn<QueryImpl>(queryImpl ?? ((): unknown => ({ success: true })));
  return { foundryClient: { query }, query };
}

export interface MakeToolsOptions {
  queryImpl?: QueryImpl;
  /** Extra constructor options, spread after `foundryClient` and `logger`. */
  extra?: Record<string, unknown>;
}

export interface ToolHarness<T> {
  tools: T;
  query: Mock<QueryImpl>;
  foundryClient: any;
  logger: any;
}

/** Build a tool class with a mocked Foundry client and logger stub. */
export function makeTools<T>(
  ToolClass: new (options: any) => T,
  queryImplOrOptions?: QueryImpl | MakeToolsOptions
): ToolHarness<T> {
  const options: MakeToolsOptions =
    typeof queryImplOrOptions === 'function'
      ? { queryImpl: queryImplOrOptions }
      : (queryImplOrOptions ?? {});
  const logger = makeLogger();
  const { foundryClient, query } = makeFoundryClient(options.queryImpl);
  const tools = new ToolClass({ foundryClient, logger, ...options.extra });
  return { tools, query, foundryClient, logger };
}
