/**
 * Tool dispatch table for the control-channel `call_tool` requests, and the tool list.
 *
 * Both are derived from the tool modules (tools/index.ts, R9): each module names the routes and
 * definitions of its family, and the backend builds one instance per module. This file stays
 * pure and imports no tool class, because the stdio wrapper loads it for `capToolResult`.
 */
import { type ToolAnnotations, withToolHints } from './tool-hints.js';
import { type ToolInstances, instanceOf } from './tools/tool-module.js';

/** The built tool instances the router dispatches to (tools/index.ts `createTools`). */
export type ToolRouterDeps = ToolInstances;

/** What the control channel knows about a call besides its arguments. */
export interface ToolCallContext {
  /** Who asked (`CallToolParams.requestedBy`), for the writes that record a person's name. */
  requestedBy?: string;
  /** Aborts when the control connection that asked closes (long waits end then). */
  signal?: AbortSignal;
}

/**
 * Tools the control channel does not await before it reads the next line of the same connection:
 * a long wait must not hold up the calls queued behind it.
 */
export const DETACHED_TOOLS: ReadonlySet<string> = new Set(['wait-for-game-event']);

export type ToolHandler = (args: unknown, context?: ToolCallContext) => Promise<unknown>;

/**
 * Build the `call_tool` name → handler map from every module's routes. Unknown names are absent
 * from the map; the caller throws `Unknown tool: <name>`. Two modules claiming one name is a
 * programming error and throws here.
 *
 * The map has a null prototype so a `name` like 'toString' / 'constructor' can't
 * resolve to an inherited Object.prototype method and slip past that guard.
 */
export function buildToolRouter(deps: ToolRouterDeps): Record<string, ToolHandler> {
  const routes = Object.create(null) as Record<string, ToolHandler>;
  for (const module of deps.modules) {
    const tools = instanceOf(deps, module);
    for (const [name, route] of Object.entries(module.routes)) {
      if (Object.hasOwn(routes, name)) {
        throw new Error(`Tool route "${name}" is claimed twice (module ${module.id})`);
      }
      routes[name] = (args, context): Promise<unknown> => route(tools, args, context);
    }
  }
  return routes;
}

/** A tool as the backend lists it (MCP `tools/list` shape). */
export interface ToolDefinitionLike {
  name: string;
  description?: string | undefined;
  inputSchema: unknown;
  /** MCP tool annotations (tool-hints.ts): title and read/write hints. */
  annotations?: ToolAnnotations | undefined;
}

/**
 * Every tool definition, in the order the backend lists them (the module order of
 * tools/index.ts). Pure, like the router, so the tool catalog test can check all tools (picker
 * annotations, one route per tool, read/write hints). Each tool gets its MCP annotations from
 * tool-hints.ts.
 */
export function collectToolDefinitions(deps: ToolRouterDeps): ToolDefinitionLike[] {
  return withToolHints(
    deps.modules.flatMap(module => module.definitions(instanceOf(deps, module)))
  );
}

/**
 * Most characters of tool result text one call hands Claude (D-109, round C
 * Q11). Claude Desktop handles about 150,000 per call; this leaves room for
 * the cut note and the rest of the turn.
 */
export const TOOL_RESULT_MAX_CHARS = 100_000;

/** A tool call's result as MCP carries it (the control channel's `ToolResultPayload`). */
export interface ToolResultLike {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

/** Parameters that ask for less or for a different part, named first in the cut note. */
const NARROWING_PARAMS = [
  'limit',
  'since',
  'sinceTimestamp',
  'eventType',
  'actorName',
  'session',
  'filter',
  'query',
];

/** What the cut note tells Claude to do next, from the tool's own parameters. */
function nextPageHint(
  tool: Pick<ToolDefinitionLike, 'name' | 'inputSchema'> | undefined,
  name: string
): string {
  const schema = (tool?.inputSchema ?? {}) as { properties?: Record<string, unknown> };
  const params = Object.keys(schema.properties ?? {});
  if (params.length === 0) {
    return tool
      ? `${name} has no parameters to ask for less; ask the GM which part they need, or use a narrower tool.`
      : `call ${name} again with narrower arguments (a filter, a smaller limit, one id or page).`;
  }
  const ordered = [
    ...NARROWING_PARAMS.filter(p => params.includes(p)),
    ...params.filter(p => !NARROWING_PARAMS.includes(p)),
  ];
  return `call ${name} again with: ${ordered.join(', ')}.`;
}

/**
 * The size guard for every tool result Claude receives: text over `maxChars`
 * (all text parts together) is cut, and a note says how much was left out and
 * how to see less or a different part. A result within the cap comes back unchanged
 * (the same object). The dashboard reads results in full; only the MCP wrapper
 * applies this.
 */
export function capToolResult<T extends ToolResultLike>(
  result: T,
  name: string,
  tool?: Pick<ToolDefinitionLike, 'name' | 'inputSchema'>,
  maxChars: number = TOOL_RESULT_MAX_CHARS
): T {
  if (!result || !Array.isArray(result.content)) return result;
  const total = result.content.reduce(
    (sum, part) => sum + (typeof part.text === 'string' ? part.text.length : 0),
    0
  );
  if (total <= maxChars) return result;

  let left = maxChars;
  const content = result.content.map(part => {
    if (typeof part.text !== 'string') return part;
    let keep = Math.min(part.text.length, left);
    // Never split a surrogate pair (an emoji or other astral character).
    if (keep > 0 && keep < part.text.length && /[\uD800-\uDBFF]/.test(part.text[keep - 1] ?? '')) {
      keep -= 1;
    }
    left -= keep;
    return { ...part, text: part.text.slice(0, keep) };
  });
  // Drop text parts the cap emptied (a part that was empty to begin with stays).
  const kept = content.filter((part, i) => part.text !== '' || result.content[i]?.text === '');
  const shown = maxChars - left;
  const note =
    `[Result cut: showing the first ${shown.toLocaleString('en-US')} of ` +
    `${total.toLocaleString('en-US')} characters, the most one call returns. ` +
    'The JSON above is incomplete; do not treat missing fields or items as absent. ' +
    `To see less or a different part, ${nextPageHint(tool, name)}]`;
  kept.push({ type: 'text', text: note });
  return { ...result, content: kept };
}
