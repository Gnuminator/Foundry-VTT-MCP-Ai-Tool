/**
 * Field readers for the "My character" sheet (I-096, character-sheet.ts): small, defensive
 * readers over dnd5e data, which changed shape between dnd5e 3 and 6 (for example saves,
 * spell preparation and item uses). Each returns a plain value or a safe default.
 */
import type { SheetUses } from '@gnuminator/shared';

export type Rec = Record<string, unknown>;

export function rec(value: unknown): Rec {
  return value !== null && typeof value === 'object' ? (value as Rec) : {};
}

export function num(value: unknown, fallback = 0): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

export function numOrNull(value: unknown): number | null {
  const n = num(value, Number.NaN);
  return Number.isNaN(n) ? null : n;
}

export function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function strOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Keys of a Set, an array or the true-valued keys of an object. */
export function keysOf(value: unknown): string[] {
  if (value instanceof Set) return [...value].map(String);
  if (Array.isArray(value)) return value.map(String);
  if (value && typeof value === 'object') {
    return Object.entries(value as Rec)
      .filter(([, v]) => v === true || (typeof v === 'number' && v > 0))
      .map(([k]) => k);
  }
  return [];
}

/** Localize when Foundry is there (tests pass plain text through). */
export function localize(text: string): string {
  const i18n = (globalThis as { game?: { i18n?: { localize?: (k: string) => string } } }).game
    ?.i18n;
  return typeof i18n?.localize === 'function' ? i18n.localize(text) : text;
}

/** A label from a dnd5e config table whose entries are strings or {label}, nested or not. */
export function configLabel(table: unknown, key: string): string {
  const find = (t: unknown): string | null => {
    const entry = rec(t)[key];
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object' && typeof (entry as Rec).label === 'string') {
      return (entry as Rec).label as string;
    }
    for (const value of Object.values(rec(t))) {
      const children = rec(value).children;
      if (children) {
        const hit = find(children);
        if (hit) return hit;
      }
    }
    return null;
  };
  const label = find(table);
  return label ? localize(label) : key;
}

/** The dnd5e config (CONFIG.DND5E), or an empty object in tests. */
export function dnd5eConfig(): Rec {
  return rec(rec((globalThis as { CONFIG?: unknown }).CONFIG).DND5E);
}

/** Classes that mark GM-only content (the same set as the bridge's handout copy stripper). */
const SECRET_CLASSES = new Set(['secret', 'gm-only', 'gmonly', 'gm-note', 'gmnote']);
/** Elements without a closing tag. */
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);
/** One tag or comment; quoted attribute values may hold `>`. */
const TAG = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

function isSecretTag(name: string, attrs: string): boolean {
  if (name === 'secret-block') return true;
  const cls = /(?:^|\s)class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
  const classes = (cls?.[1] ?? cls?.[2] ?? cls?.[3] ?? '').toLowerCase().split(/\s+/);
  return classes.some(c => SECRET_CLASSES.has(c) || c.includes('secret'));
}

/**
 * `html` without secret elements (with everything inside them, nested ones too) and comments.
 * A secret element that never closes takes the rest of the text with it.
 */
export function stripSecrets(html: string): string {
  let out = '';
  let last = 0;
  let skipTag: string | null = null;
  let depth = 0;
  for (const m of html.matchAll(TAG)) {
    const start = m.index ?? 0;
    if (skipTag === null) out += html.slice(last, start);
    last = start + m[0].length;
    if (m[2] === undefined) continue; // a comment
    const name = m[2].toLowerCase();
    const closing = m[1] === '/';
    const selfClosing = VOID_TAGS.has(name) || /\/\s*$/.test(m[3] ?? '');
    if (skipTag !== null) {
      if (name !== skipTag || selfClosing) continue;
      depth += closing ? -1 : 1;
      if (depth === 0) skipTag = null;
    } else if (!closing && !selfClosing && isSecretTag(name, m[3] ?? '')) {
      skipTag = name;
      depth = 1;
    } else {
      out += m[0];
    }
  }
  if (skipTag === null) out += html.slice(last);
  return out;
}

/**
 * Plain text from item or biography HTML, without secret blocks, at most `max` characters.
 * Secret sections (`<section class="secret">`) are the GM's even on a player's own sheet.
 */
export function plainText(html: unknown, max = 600): string {
  const text = stripSecrets(str(html))
    .replace(/<(br|\/p|\/li|\/h[1-6])\s*\/?>/gi, '\n')
    .replace(TAG, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Last, so `&amp;lt;` (a literal "&lt;" in the text) stays "&lt;" and never decodes twice.
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * Item uses across dnd5e versions: `{value, max}` (older) or `{spent, max, recovery: [...]}`
 * (dnd5e 4 and later). Null when the item has no limited uses.
 */
export function usesOf(system: Rec): SheetUses | null {
  const uses = rec(system.uses);
  const max = num(uses.max, 0);
  if (max <= 0) return null;
  const value = 'spent' in uses ? max - num(uses.spent, 0) : num(uses.value, max);
  const period = Array.isArray(uses.recovery)
    ? strOrNull(rec(uses.recovery[0]).period)
    : strOrNull(uses.per);
  // dnd5e keeps a short key ("sr", "lr", "day"); the sheet shows its label ("Short Rest").
  const recovery = period ? configLabel(dnd5eConfig().limitedUsePeriods, period) : null;
  return { value: Math.max(0, Math.min(max, value)), max, recovery };
}

/**
 * Whether a dnd5e 6 spellcasting method needs preparing (`CONFIG.DND5E.spellcasting[m].prepares`,
 * as the system's `SpellData#canPrepare`): `spell` and `pact` do; `atwill`, `innate` and `ritual`
 * do not. Without the config (tests) the 6.0 defaults apply.
 */
export function spellMethodPrepares(method: string): boolean {
  const config = rec(dnd5eConfig().spellcasting)[method];
  if (config && typeof config === 'object') return (config as Rec).prepares === true;
  return method === 'spell' || method === 'pact';
}

/**
 * Whether a spell is ready to cast: a cantrip, a spell whose method never prepares (innate, at
 * will, ritual), or a prepared or always-prepared spell (`prepared` 1 or 2 in dnd5e 6). NPCs
 * never prepare: their spells (often granted by a feat, `method` "spell", `prepared` 0) are ready.
 */
export function spellPrepared(system: Rec, actorType?: string): boolean {
  if (actorType === 'npc') return true;
  if (num(system.level, 0) === 0) return true;
  const method = str(system.method);
  if (method && !spellMethodPrepares(method)) return true;
  if (typeof system.prepared === 'boolean') return system.prepared;
  return num(system.prepared, 0) >= 1;
}

/** A labels value (dnd5e's computed `item.labels.*`) as text. */
export function labelText(value: unknown): string | null {
  if (typeof value === 'string') return strOrNull(value);
  if (Array.isArray(value)) {
    const parts = value
      .map(v => (typeof v === 'string' ? v : str(rec(v).label) || str(rec(v).formula)))
      .filter(Boolean);
    return parts.length > 0 ? parts.join(' + ') : null;
  }
  return null;
}
