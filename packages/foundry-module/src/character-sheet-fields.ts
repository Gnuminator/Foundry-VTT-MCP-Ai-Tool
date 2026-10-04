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

/**
 * Plain text from item or biography HTML, without secret blocks, at most `max` characters.
 * Secret sections (`<section class="secret">`) are the GM's even on a player's own sheet.
 */
export function plainText(html: unknown, max = 600): string {
  const text = str(html)
    .replace(/<section[^>]*class="[^"]*secret[^"]*"[^>]*>[\s\S]*?<\/section>/gi, '')
    .replace(/<(br|\/p|\/li|\/h[1-6])\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
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

/** Whether a spell counts as ready to cast (prepared, always prepared, innate, pact, at will). */
export function spellPrepared(system: Rec): boolean {
  if (num(system.level, 0) === 0) return true;
  if (typeof system.prepared === 'number') return system.prepared >= 1;
  if (typeof system.prepared === 'boolean') return system.prepared;
  const prep = rec(system.preparation);
  const mode = str(prep.mode);
  return prep.prepared === true || ['always', 'innate', 'pact', 'atwill'].includes(mode);
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
