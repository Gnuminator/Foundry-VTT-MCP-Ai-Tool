/**
 * Small, safe readers over untyped Foundry documents (never `any`), plus the hashing and size
 * helpers the export index and the Library queries share. Pure functions only.
 */

/** Names, labels, folder path segments (mirror of `EXPORT_INDEX_LIMITS.nameChars`). */
export const NAME_CHARS = 200;

export type Rec = Record<string, unknown>;

export function rec(value: unknown): Rec | null {
  return value !== null && typeof value === 'object' ? (value as Rec) : null;
}

export function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Walk `keys` down through objects; `undefined` at the first gap. */
export function dig(value: unknown, ...keys: string[]): unknown {
  let node: unknown = value;
  for (const key of keys) {
    const r = rec(node);
    if (!r) return undefined;
    node = r[key];
  }
  return node;
}

/** `collection.contents` (Foundry `Collection#contents`) as an array of objects. */
export function contentsOf(collection: unknown): Rec[] {
  const contents = rec(collection)?.contents;
  if (!Array.isArray(contents)) return [];
  const out: Rec[] = [];
  for (const entry of contents as unknown[]) {
    const r = rec(entry);
    if (r) out.push(r);
  }
  return out;
}

export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** At most `nameChars` characters, never ending on half a surrogate pair. */
export function clip(text: string): string {
  if (text.length <= NAME_CHARS) return text;
  let end = NAME_CHARS;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text.slice(0, end);
}

/** The document's stored name (`_source.name`), so an item's unidentified name never shows. */
export function sourceName(doc: Rec): string {
  return clip(nonEmpty(dig(doc, '_source', 'name')) ?? str(doc.name) ?? '');
}

export function timeOf(doc: unknown): number | null {
  return num(dig(doc, '_stats', 'modifiedTime'));
}

export function maxTime(values: ReadonlyArray<number | null>): number | null {
  let best: number | null = null;
  for (const value of values) {
    if (value !== null && (best === null || value > best)) best = value;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Hashing and sizes
// ---------------------------------------------------------------------------

/** cyrb53: a 53-bit string hash in a few lines of pure JS (Foundry has no hash helper). */
export function cyrb53(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Signature of an entry's exported fields (built with a fixed key order). */
export function signature(fields: object): string {
  return cyrb53(JSON.stringify(fields)).toString(36);
}

/** UTF-8 length of a string without allocating a buffer. */
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/** Bytes a string takes inside JSON (escapes count, the two quotes do not). */
export function jsonStringBytes(text: string): number {
  return utf8Bytes(JSON.stringify(text)) - 2;
}

/** `text` cut to at most `limit` JSON bytes, never inside a surrogate pair. */
export function fitJsonBytes(text: string, limit: number): { content: string; truncated: boolean } {
  if (jsonStringBytes(text) <= limit) return { content: text, truncated: false };
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (jsonStringBytes(text.slice(0, mid)) <= limit) low = mid;
    else high = mid - 1;
  }
  let end = low;
  if (end > 0) {
    const last = text.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  }
  return { content: text.slice(0, end), truncated: true };
}

/** dnd5e `Item5e#identifier`: `system.identifier`, else the slugged name (`dnd5e.mjs:34741`). */
export function identifierOf(item: Rec): string {
  const stored = nonEmpty(dig(item, 'system', 'identifier')) ?? nonEmpty(item.identifier);
  if (stored) return stored;
  return sourceName(item)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
