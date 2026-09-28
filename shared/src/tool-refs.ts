/**
 * Pickers for tool parameters that name something (dashboard ease of use).
 *
 * A tool parameter that names a Foundry document (a token, an actor, a journal
 * page, ...) or another choosable thing (a pending plan, a Tarokka card) carries
 * an `x-foundry-ref` annotation in its input schema. The dashboard's tool runner
 * reads it and offers a searchable list of the current candidates next to the
 * manual input; the read-only `list-ref-choices` tool supplies the candidates.
 *
 * Every parameter whose name looks like a reference must be annotated (the
 * tool catalog test checks all tools): with a {@link ToolRef}, or with
 * `freeText(reason)` when it only looks like one (a name for something new).
 * MCP clients never see the annotation: the MCP ListTools handler strips it.
 */

/** The JSON Schema extension keyword on a tool parameter. */
export const TOOL_REF_KEY = 'x-foundry-ref';

/** Kinds the Foundry module lists (`foundry-mcp-bridge.listRefChoices`). */
export const FOUNDRY_REF_KINDS = [
  'actor',
  'token',
  'scene',
  'journal',
  'journal-page',
  'item',
  'actor-item',
  'combatant',
  'user',
  'folder',
  'compendium-pack',
  'compendium-entry',
  'playlist',
  'note',
  'template',
  'condition',
  'module',
  'skill',
  'ability',
  'document',
] as const;

/** Kinds the backend lists itself. */
export const BACKEND_REF_KINDS = ['plan', 'change', 'tarokka-card', 'map-job'] as const;

export type FoundryRefKind = (typeof FOUNDRY_REF_KINDS)[number];
export type BackendRefKind = (typeof BACKEND_REF_KINDS)[number];
export type RefKind = FoundryRefKind | BackendRefKind;

export const REF_KINDS: readonly RefKind[] = [...FOUNDRY_REF_KINDS, ...BACKEND_REF_KINDS];

/** What the field receives from a chosen row: the id, the uuid, or the name. */
export type RefValue = 'id' | 'uuid' | 'name';

/** Narrows the candidates. Each kind reads only the fields that make sense for it. */
export interface RefFilter {
  /** actor / item / actor-item / compendium-entry: subtypes, e.g. ['npc'] or ['weapon', 'spell']. */
  types?: string[];
  /** actor: only actors a player owns (player characters). */
  playerOwned?: boolean;
  /** user: only GMs or only players. */
  role?: 'gm' | 'player';
  /** folder / compendium-pack / compendium-entry / document: the document class, e.g. 'Actor'. */
  documentName?: string;
  /** change: only changes that can still be undone. */
  undoable?: boolean;
  /** module: also list the game system (for tools that accept its id). */
  includeSystem?: boolean;
}

export interface ToolRefExtra {
  value: string;
  label: string;
}

/** The annotation on a parameter whose value names something choosable. */
export interface ToolRef {
  /** One kind, or several listed together in groups (e.g. users and their characters). */
  kind: RefKind | RefKind[];
  /** What goes into the field. */
  value: RefValue;
  filter?: RefFilter;
  /**
   * A sibling parameter whose value narrows the list: the scene for tokens, the
   * pack for compendium entries, the actor for its items, the journal for its
   * pages, the Tarokka position for cards. Empty means the default (the
   * current scene, all packs, ...).
   */
  parent?: string;
  /** Fixed choices shown first, e.g. `{ value: 'self', label: 'Self (the user of the item)' }`. */
  extra?: ToolRefExtra[];
}

/** For a parameter that looks like a reference but takes free text. */
export interface FreeTextRef {
  kind: 'free';
  reason: string;
}

export type ToolRefAnnotation = ToolRef | FreeTextRef;

/** Spread into a parameter schema: `{ type: 'string', ...toolRef('token', 'id') }`. */
export function toolRef(
  kind: RefKind | RefKind[],
  value: RefValue,
  options: Omit<ToolRef, 'kind' | 'value'> = {}
): { [TOOL_REF_KEY]: ToolRef } {
  return { [TOOL_REF_KEY]: { kind, value, ...options } };
}

/** Spread into a parameter schema that takes free text although its name looks like a reference. */
export function freeText(reason: string): { [TOOL_REF_KEY]: FreeTextRef } {
  return { [TOOL_REF_KEY]: { kind: 'free', reason } };
}

/** One row of `list-ref-choices`. */
export interface RefChoice {
  id: string;
  uuid?: string;
  name: string;
  /** Short context shown after the name: type, disposition, owner, position, ... */
  detail?: string;
  /** Heading the row is listed under (folder, scene, pack, disposition, ...). */
  group?: string;
  /** Hidden from players (hidden token, GM-only thing): shown with a marker. */
  hidden?: boolean;
}

export interface RefChoicesResult {
  kind: RefKind;
  choices: RefChoice[];
  /** More candidates exist than were returned; search to narrow them. */
  truncated: boolean;
  /** Why the list is empty or partial, e.g. "No active combat". */
  note?: string;
}

/**
 * Parameter names that look like references and so must be annotated: names
 * ending in id(s), uuid(s), name(s), identifier(s), target(s), packs, or folder.
 */
export function looksLikeRefParam(name: string): boolean {
  return /(?:ids?|uuids?|names?|identifiers?|targets?|packs|folder)$/i.test(name);
}

interface SchemaLike {
  type?: unknown;
  items?: unknown;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ToolLike {
  name: string;
  inputSchema?: unknown;
}

const FILTER_KEYS = new Set([
  'types',
  'playerOwned',
  'role',
  'documentName',
  'undoable',
  'includeSystem',
]);

/** Problems with one tool's annotations (empty when all is well). */
export function checkToolRefs(tool: ToolLike): string[] {
  const problems: string[] = [];
  const schema = (tool.inputSchema ?? {}) as SchemaLike;
  const props = schema.properties ?? {};
  for (const [param, raw] of Object.entries(props)) {
    const def = (raw ?? {}) as SchemaLike;
    const where = `${tool.name}.${param}`;
    const annotation = def[TOOL_REF_KEY] as Partial<ToolRef> | Partial<FreeTextRef> | undefined;
    if (annotation === undefined) {
      if (looksLikeRefParam(param)) {
        problems.push(`${where} looks like a reference: add toolRef(...) or freeText(reason)`);
      }
      continue;
    }
    if (annotation.kind === 'free') {
      const reason = annotation.reason;
      if (typeof reason !== 'string' || reason.trim() === '') {
        problems.push(`${where}: freeText needs a reason`);
      }
      continue;
    }
    const ref = annotation as Partial<ToolRef>;
    const kinds = Array.isArray(ref.kind) ? ref.kind : [ref.kind];
    if (kinds.length === 0 || kinds.some(k => !REF_KINDS.includes(k as RefKind))) {
      problems.push(`${where}: unknown kind ${JSON.stringify(ref.kind)}`);
    }
    if (ref.value !== 'id' && ref.value !== 'uuid' && ref.value !== 'name') {
      problems.push(`${where}: value must be id, uuid or name`);
    }
    if (ref.parent !== undefined && (ref.parent === param || !(ref.parent in props))) {
      problems.push(`${where}: parent "${String(ref.parent)}" is not another parameter`);
    }
    for (const key of Object.keys(ref.filter ?? {})) {
      if (!FILTER_KEYS.has(key)) problems.push(`${where}: unknown filter "${key}"`);
    }
    const type = def.type;
    const itemType = (def.items as SchemaLike | undefined)?.type;
    if (type !== 'string' && !(type === 'array' && itemType === 'string')) {
      problems.push(`${where}: a picker needs a string or an array of strings`);
    }
  }
  return problems;
}

function withoutRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutRefs);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (key === TOOL_REF_KEY) continue;
    out[key] = withoutRefs(inner);
  }
  return out;
}

/** A copy of the tools without picker annotations (what MCP clients get). */
export function stripToolRefs<T extends ToolLike>(tools: readonly T[]): T[] {
  return tools.map(tool => withoutRefs(tool) as T);
}
