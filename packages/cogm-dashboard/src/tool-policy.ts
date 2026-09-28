/**
 * GM Actions policy for the `/api/tool` proxy: which bridge tools only read,
 * which change the game, and which are destructive. Reads are always free;
 * writes need the GM Actions switch plus a confirm; destructive tools also need
 * a second confirm.
 *
 * Guarded writes (plan step 0.2): features plan with read-only `plan-*` /
 * `suggest-*` tools, and the one generic `apply-planned-change` tool applies a
 * plan. That tool and `undo-change` carry their own `confirm` /
 * `confirmDestructive` arguments, which the proxy sets only from the
 * dashboard's own confirmation (the body-level flags), never from the `args` a
 * caller sends.
 */

export type ToolKind = 'read' | 'write' | 'destructive';

export const DESTRUCTIVE_TOOLS: ReadonlySet<string> = new Set([
  'delete-tokens',
  'delete-map-note',
  'delete-measured-template',
  'remove-actor-ownership',
  'clear-module-errors',
  'clear-stale-conditions',
  'undo-change',
]);

/** Tools that read state but don't match the read prefixes. */
export const READ_TOOLS_EXTRA: ReadonlySet<string> = new Set([
  'check-map-status',
  'open-in-foundry',
]);

/** Tools whose confirm arguments come only from the dashboard's confirmation. */
export const CONFIRM_FORWARDED_TOOLS: ReadonlySet<string> = new Set([
  'apply-planned-change',
  'undo-change',
]);

const READ_PREFIX = /^(get|list|search|measure|plan|suggest)-/;

export function classifyTool(name: string): ToolKind {
  if (DESTRUCTIVE_TOOLS.has(name)) return 'destructive';
  if (READ_PREFIX.test(name) || READ_TOOLS_EXTRA.has(name)) return 'read';
  return 'write';
}

/**
 * The args to send for `name`: unchanged, except that the confirm-forwarded
 * tools get `confirm` / `confirmDestructive` from the request body's flags.
 */
export function toolArgs(
  name: string,
  args: Record<string, unknown>,
  body: Record<string, unknown>
): Record<string, unknown> {
  if (!CONFIRM_FORWARDED_TOOLS.has(name)) return args;
  const { confirm: _confirm, confirmDestructive: _destructive, ...rest } = args;
  return {
    ...rest,
    confirm: body.confirm === true,
    confirmDestructive: body.confirmDestructive === true,
  };
}
