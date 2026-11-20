/**
 * Old parameter names that tool calls may still send (the dashboard, saved prompts, older
 * Claude Desktop wrappers). The router renames them to the current name before the tool sees
 * the call, so each tool reads one name only.
 *
 * - Every tool whose input schema has an `actor` property accepts the six old actor names
 *   (`ACTOR_ALIASES`) as `actor`.
 * - `TOOL_ALIASES` holds the renames that belong to one tool.
 *
 * An alias applies only when the current name is absent, so a call that sends both keeps the
 * current one. The aliases stay for as long as the dashboard and the docs may name the old
 * names; param-aliases.test.ts lists them, so removing one is a visible change.
 */

/** The six old names for "the actor", accepted wherever a tool takes `actor`. */
export const ACTOR_ALIASES: readonly string[] = [
  'identifier',
  'characterIdentifier',
  'actorIdentifier',
  'actorName',
  'targetPlayer',
  'character',
];

/**
 * Tool names that no longer exist, answered by the tool that took over, with the parameter
 * renames the old call needs. Kept for one release so saved prompts and cached tool lists work:
 * `until` is the first release (major.minor) that no longer carries the alias, and a test fails
 * once the package version reaches it, so the entry has to be deleted then.
 */
export const RENAMED_TOOLS: Readonly<
  Record<string, { to: string; params: Readonly<Record<string, string>>; until: string }>
> = {};

/** Per-tool renames: tool name, then old parameter name to current parameter name. */
export const TOOL_ALIASES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'list-scenes': { include_active_only: 'activeOnly' },
  'switch-scene': { scene_identifier: 'scene', sceneId: 'scene' },
};

function hasActorParam(inputSchema: unknown): boolean {
  const properties = (inputSchema as { properties?: Record<string, unknown> } | null)?.properties;
  return properties !== undefined && properties !== null && Object.hasOwn(properties, 'actor');
}

/** The tool names whose schema takes `actor`, from the tool definitions. */
export function actorToolNames(
  definitions: readonly { name: string; inputSchema: unknown }[]
): ReadonlySet<string> {
  return new Set(definitions.filter(d => hasActorParam(d.inputSchema)).map(d => d.name));
}

/** Return `args` with old parameter names renamed for `tool`; other input is returned as is. */
export function applyParamAliases(
  tool: string,
  args: unknown,
  actorTools: ReadonlySet<string>
): unknown {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return args;
  const renames: [string, string][] = [];
  if (actorTools.has(tool)) {
    for (const old of ACTOR_ALIASES) renames.push([old, 'actor']);
  }
  for (const [old, current] of Object.entries(TOOL_ALIASES[tool] ?? {})) {
    renames.push([old, current]);
  }
  if (renames.length === 0) return args;
  const input = args as Record<string, unknown>;
  const out: Record<string, unknown> = { ...input };
  for (const [old, current] of renames) {
    if (!Object.hasOwn(input, old)) continue;
    if (!Object.hasOwn(out, current)) out[current] = input[old];
    delete out[old];
  }
  return out;
}
