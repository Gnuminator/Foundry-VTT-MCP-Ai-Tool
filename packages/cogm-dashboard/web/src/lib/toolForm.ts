// The Tool runner's form logic, without React: the catalog's categories, the form a tool's input
// schema gives, and the args a filled form sends. Port of the old page's categoryOf, buildControl,
// pickerRef and collectArgs (public/app.js), with numbers checked before they are sent.
import { CONFIRM_FORWARDED_TOOLS } from '../../../src/tool-policy';

/** One bridge tool as GET /api/tools lists it (app.ts ToolInfo). */
export interface ToolInfo {
  name: string;
  description: string;
  inputSchema: { properties?: Record<string, ParamDef>; required?: string[] };
  /** How the dashboard's /api/tool gates it (tool-policy.ts classifyTool). */
  mutates: 'read' | 'write' | 'destructive';
}

/** A parameter's JSON schema; the keywords the form reads. */
export interface ParamDef {
  type?: string;
  enum?: unknown[];
  default?: unknown;
  description?: string;
  items?: { type?: string };
  'x-foundry-ref'?: unknown;
}

/** What the picker lists (shared/src/tool-refs.ts ToolRef). */
export interface ToolRef {
  kind: string | string[];
  value: 'id' | 'uuid' | 'name';
  filter?: Record<string, unknown>;
  parent?: string;
  extra?: { value: string; label: string }[];
}

/** One row of list-ref-choices (tool-refs.ts RefChoice). */
export interface RefChoice {
  id: string;
  uuid?: string;
  name: string;
  detail?: string;
  group?: string;
  hidden?: boolean;
}

/** What a field holds while the GM edits it: text (one value per line for a list) or a tick. */
export type FieldValue = string | boolean;
export type Draft = Record<string, FieldValue>;

/** First match wins, in this order (the old page's CATEGORY_RULES). */
const CATEGORY_RULES: [RegExp, string][] = [
  [/(planned-change|recent-changes|undo-change|open-in-foundry)/, 'Guarded changes'],
  [/(initiative|combat|turn)/, 'Combat'],
  [/(damage|heal|saving|ability|attack|roll|check|rest|activity|condition|effect)/, 'Resolution'],
  [/(token|move|template|vision|light|map-note)/, 'Tokens & Scene'],
  [/(scene|map|mood)/, 'Scenes & Maps'],
  [/(actor|npc|character|feature|archetype|ownership)/, 'Actors'],
  [/(item|loot|resource)/, 'Items & Loot'],
  [/(quest|journal|campaign)/, 'Journals & Quests'],
  [/(compendium|creature)/, 'Compendium'],
];

export function categoryOf(name: string): string {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(name)) return cat;
  return 'World & Info';
}

/** The tools whose name or description has the search text, grouped by category in list order. */
export function groupTools(tools: ToolInfo[], search: string): [string, ToolInfo[]][] {
  const q = search.trim().toLowerCase();
  const groups = new Map<string, ToolInfo[]>();
  for (const t of tools) {
    if (q && !t.name.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) {
      continue;
    }
    const cat = categoryOf(t.name);
    groups.set(cat, [...(groups.get(cat) ?? []), t]);
  }
  return [...groups];
}

/** A plan-* tool: planned, then applied after the confirm window. */
export const isPlanTool = (name: string): boolean => /^plan-/.test(name);

/**
 * A plan-page-reveal call that changes nothing in Foundry and makes no plan (queue, unqueue): it
 * runs at once and needs no GM Actions, as Remove in the Handouts drawer does.
 */
export const isQueueCall = (name: string, args: Record<string, unknown>): boolean =>
  name === 'plan-page-reveal' && (args['action'] === 'queue' || args['action'] === 'unqueue');

// CONFIRM_FORWARDED_TOOLS: the tools whose own `confirm` and `confirmDestructive` args the server
// sets from the confirm window's flags. The form never asks for them.
const CONFIRM_FLAGS = ['confirm', 'confirmDestructive'];

/**
 * The tag on a tool: read, write or destructive as the dashboard gates it, and "plan" for a
 * plan-* tool (a read to the gate, but its apply changes the game, after the confirm window).
 */
export function kindOf(tool: ToolInfo): { label: string; className: string } {
  if (isPlanTool(tool.name)) return { label: 'plan', className: 'write' };
  return { label: tool.mutates, className: tool.mutates };
}

export function paramsOf(tool: ToolInfo): {
  props: Record<string, ParamDef>;
  required: string[];
} {
  const schema = tool.inputSchema;
  const all =
    schema && typeof schema.properties === 'object' && schema.properties ? schema.properties : {};
  const required = Array.isArray(schema?.required) ? schema.required : [];
  if (!CONFIRM_FORWARDED_TOOLS.has(tool.name)) return { props: all, required };
  // The confirm window answers these; the server fills them from its flags (toolArgs).
  const props = Object.fromEntries(
    Object.entries(all).filter(([key]) => !CONFIRM_FLAGS.includes(key))
  );
  return { props, required: required.filter(key => !CONFIRM_FLAGS.includes(key)) };
}

/** The picker annotation of a parameter, or null (free text, a tick, or none). */
export function pickerRef(def: ParamDef): ToolRef | null {
  if (def.type === 'boolean') return null;
  const ref = def['x-foundry-ref'];
  if (!ref || typeof ref !== 'object') return null;
  const kind = (ref as { kind?: unknown }).kind;
  if (kind === 'free' || (typeof kind !== 'string' && !Array.isArray(kind))) return null;
  return ref as ToolRef;
}

/** What a picked row puts in the field. */
export function refValue(ref: ToolRef, choice: RefChoice): string {
  if (ref.value === 'uuid') return choice.uuid ?? choice.id;
  if (ref.value === 'name') return choice.name;
  return choice.id;
}

/** A field's values: one per line for a list, else the one trimmed value (or none). */
export function fieldValues(value: string, multiple: boolean): string[] {
  if (multiple) {
    return value
      .split('\n')
      .map(v => v.trim())
      .filter(Boolean);
  }
  return value.trim() ? [value.trim()] : [];
}

const isList = (def: ParamDef): boolean => def.type === 'array';
const isObject = (def: ParamDef): boolean => def.type === 'object';

/** One value as field text: a string as it is, anything else as JSON. */
const asText = (value: unknown): string =>
  typeof value === 'string' ? value : (JSON.stringify(value) ?? '');

/** A field's starting value: the prefill, else the schema default, else empty. */
function startValue(def: ParamDef, prefill: unknown): FieldValue {
  const value = prefill !== undefined ? prefill : def.default;
  if (def.type === 'boolean' && !Array.isArray(def.enum)) return value === true;
  if (value === undefined || value === null) return '';
  if (isList(def)) return Array.isArray(value) ? value.map(asText).join('\n') : asText(value);
  if (isObject(def)) return JSON.stringify(value, null, 2);
  return asText(value);
}

/** The form a tool opens with. */
export function startDraft(tool: ToolInfo, prefill: Record<string, unknown> = {}): Draft {
  const { props } = paramsOf(tool);
  return Object.fromEntries(
    Object.entries(props).map(([key, def]) => [key, startValue(def ?? {}, prefill[key])])
  );
}

/** One scalar as its type wants it, or an error text. */
function scalar(key: string, raw: string, type: string | undefined): unknown {
  if (type === 'number' || type === 'integer') {
    const n = Number(raw);
    if (!Number.isFinite(n)) return new Error(`"${key}" must be a number.`);
    if (type === 'integer' && !Number.isInteger(n)) {
      return new Error(`"${key}" must be a whole number.`);
    }
    return n;
  }
  return raw;
}

/** The args a filled form sends, or what is wrong with it (and which fields). */
export function collectArgs(
  tool: ToolInfo,
  draft: Draft
): { args: Record<string, unknown> } | { problems: string[]; fields: string[] } {
  const { props, required } = paramsOf(tool);
  const args: Record<string, unknown> = {};
  const missing: string[] = [];
  const problems: string[] = [];
  const fields: string[] = [];
  const fail = (key: string, err: Error): void => {
    problems.push(err.message);
    fields.push(key);
  };
  for (const [key, defOrNull] of Object.entries(props)) {
    const def = defOrNull ?? {};
    const value = draft[key];
    if (typeof value === 'boolean') {
      // An unticked box is sent only when it is required or defaults to on (then it means off);
      // otherwise the bridge's own default applies.
      if (!value && !required.includes(key) && def.default !== true) continue;
      args[key] = value;
      continue;
    }
    const text = value ?? '';
    if (isList(def)) {
      const items = fieldValues(text, true);
      if (items.length === 0) {
        if (required.includes(key)) missing.push(key);
        continue;
      }
      const parsed = items.map(s => scalar(key, s, def.items?.type));
      const bad = parsed.find((p): p is Error => p instanceof Error);
      if (bad) fail(key, new Error(`${bad.message.replace(/\.$/, '')}, one per line.`));
      else args[key] = parsed;
      continue;
    }
    const raw = text.trim();
    if (!raw) {
      if (required.includes(key)) missing.push(key);
      continue;
    }
    if (isObject(def)) {
      try {
        args[key] = JSON.parse(raw);
      } catch {
        fail(key, new Error(`"${key}" must be valid JSON.`));
      }
      continue;
    }
    const parsed = scalar(key, raw, def.type);
    if (parsed instanceof Error) fail(key, parsed);
    else args[key] = parsed;
  }
  if (missing.length > 0) {
    problems.unshift(`Required: ${missing.join(', ')}`);
    fields.unshift(...missing);
  }
  return problems.length > 0 ? { problems, fields } : { args };
}
