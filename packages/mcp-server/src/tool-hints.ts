/**
 * MCP tool annotations (I-124): every tool carries a title and read/write
 * hints, so Claude Desktop can group the look-ups as read-only (the GM allows
 * them once) and keep its prompt on the tools that change something. The
 * tool-pick test counted 0.6 to 0.8 "allow" clicks per request without them.
 *
 * Kinds:
 * - `read`: changes nothing in Foundry, the bridge vault or the logs. The
 *   `plan-*` tools count as reads: a plan only stages a change (it expires
 *   after 15 minutes); `apply-planned-change` makes it, so the prompt stays on
 *   the apply. Opening a sheet on the GM's screen changes nothing either.
 * - `write`: adds to the world, the bridge vault or a log and changes nothing
 *   already there beyond moving play along (chat messages, rolls, the combat
 *   turn, new documents, a session marker).
 * - `destructive`: can delete something or overwrite stored values (MCP:
 *   destructiveHint false means additive only): applying a plan (plans may
 *   delete), undo, using an item (spends charges, can delete a spent
 *   consumable), setting initiative, rests (reset HP and resources), journal
 *   page updates, world item updates, clearing the error buffer.
 *
 * `openWorldHint` and `idempotentHint` are left out: I-124 asks for these
 * three, and core and prep sit close to their size budgets.
 *
 * Read and write stay separate tools: a tool that writes on any action is a
 * write. Every tool has exactly one entry (the tool catalog test checks this,
 * and that no tool named like a write is marked read-only).
 *
 * No SDK and no I/O of its own; the hints are written in the tool modules (tools/modules/*.ts),
 * which this file reads through the static module list.
 */

import { TOOL_MODULES } from './tools/index.js';

export type ToolKind = 'read' | 'write' | 'destructive';

export interface ToolHintSpec {
  /** Short human title Claude Desktop shows instead of the tool name. */
  title: string;
  kind: ToolKind;
}

/** MCP `ToolAnnotations`, as this bridge sets them. */
export interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  /** Set on writes only (the MCP spec ignores it on read-only tools). */
  destructiveHint?: boolean;
}

/** Title and kind of every tool, derived from the `tools` maps of the tool modules (R10). */
export const TOOL_HINTS: Readonly<Record<string, ToolHintSpec>> = Object.fromEntries(
  TOOL_MODULES.flatMap(m =>
    Object.entries(m.tools).map(([name, { title, kind }]) => [name, { title, kind }] as const)
  )
);

/** The annotations for one tool, or undefined for a name with no entry. */
export function toolAnnotations(name: string): ToolAnnotations | undefined {
  const spec = Object.hasOwn(TOOL_HINTS, name) ? TOOL_HINTS[name] : undefined;
  if (!spec) return undefined;
  if (spec.kind === 'read') return { title: spec.title, readOnlyHint: true };
  return {
    title: spec.title,
    readOnlyHint: false,
    destructiveHint: spec.kind === 'destructive',
  };
}

/** The tools with their annotations attached (a tool with no entry is left as it is). */
export function withToolHints<T extends { name: string }>(
  tools: readonly T[]
): (T & { annotations?: ToolAnnotations })[] {
  return tools.map(tool => {
    const annotations = toolAnnotations(tool.name);
    return annotations ? { ...tool, annotations } : tool;
  });
}
