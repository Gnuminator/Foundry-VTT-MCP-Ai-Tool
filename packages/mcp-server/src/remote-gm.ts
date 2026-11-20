/**
 * The remote GM connector's backend side (item remote-gm-connector): the control messages
 * `remote_gm_list` and `remote_gm_call` that the dashboard's `/mcp/<set>` routes (core, play,
 * prep, build, admin) forward to once Cloudflare Access has signed the GM in. One path serves
 * one tool set, exactly as one stdio wrapper entry does, so the per-set token budgets, the
 * Search and tools switches and the server instructions stay as they are. Plan, confirm and
 * undo live in the tool routes and are untouched.
 *
 * No I/O of its own: the backend passes in the tool list, the router call and the call log.
 * The set always comes from the dashboard's path, never from the request body, and a tool runs
 * only when this set lists it (a dashboard-only route or a tool of another set is refused).
 */
import { stripToolRefs, unknownToolMessage } from '@gnuminator/shared';

import { RENAMED_TOOLS } from './param-aliases.js';
import { type ToolDefinitionLike, type ToolResultLike, capToolResult } from './tool-router.js';
import {
  TOOL_SET_NAMES,
  type ServedToolSetName,
  filterToolsBySets,
  toolSetInstructions,
} from './tool-sets.js';

/** The set a path names, or null (the sixth set, `player`, is never served here). */
export function remoteGmSet(value: unknown): ServedToolSetName | null {
  return typeof value === 'string' && (TOOL_SET_NAMES as readonly string[]).includes(value)
    ? (value as ServedToolSetName)
    : null;
}

/** The definitions one set lists (no picker annotations, no player tools) and its instructions. */
export function remoteGmList(
  allTools: readonly ToolDefinitionLike[],
  set: ServedToolSetName
): { tools: ToolDefinitionLike[]; instructions: string } {
  const selection = { sets: [set], all: false } as const;
  const listed = filterToolsBySets(allTools, selection);
  return {
    tools: stripToolRefs(listed as Parameters<typeof stripToolRefs>[0]) as ToolDefinitionLike[],
    instructions: toolSetInstructions(selection),
  };
}

interface RemoteGmCallDeps {
  allTools: readonly ToolDefinitionLike[];
  /** Runs the tool route (the backend's dispatch table, behind the repeat guard). */
  run(name: string, args: unknown): Promise<unknown>;
  /** One line in the tool call log. */
  record(tool: string, startedAt: number, result: ToolResultLike): void;
}

/** One tool call of one set: the same answer the stdio wrapper would give for that entry. */
export async function remoteGmCall(
  deps: RemoteGmCallDeps,
  set: ServedToolSetName,
  name: unknown,
  args: unknown
): Promise<ToolResultLike> {
  const startedAt = Date.now();
  const tool = typeof name === 'string' ? name : '';
  const target = RENAMED_TOOLS[tool]?.to ?? tool;
  const listed = remoteGmList(deps.allTools, set).tools.find(t => t.name === target);
  if (!listed) {
    const result: ToolResultLike = {
      content: [
        {
          type: 'text',
          text: `Error: ${unknownToolMessage(tool.slice(0, 80))} (not in the ${set} set)`,
        },
      ],
      isError: true,
    };
    deps.record(tool.slice(0, 80) || 'unknown', startedAt, result);
    return result;
  }
  const callArgs = args !== null && typeof args === 'object' && !Array.isArray(args) ? args : {};
  try {
    const raw = await deps.run(tool, callArgs);
    const result: ToolResultLike = {
      content: [{ type: 'text', text: typeof raw === 'string' ? raw : JSON.stringify(raw) }],
    };
    deps.record(tool, startedAt, result);
    return capToolResult(result, tool, listed);
  } catch (e: unknown) {
    const result: ToolResultLike = {
      content: [
        { type: 'text', text: `Error: ${e instanceof Error ? e.message : 'Backend unavailable'}` },
      ],
      isError: true,
    };
    deps.record(tool, startedAt, result);
    return result;
  }
}
