/**
 * Small value helpers for guarded writes: dot paths inside vault JSON data,
 * stable equality, and readable formatting for diffs.
 */
import type { PathValue } from '@gnuminator/shared';

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9_ -]{0,99}$/;
const MAX_DEPTH = 12;

/** Split and validate a vault data path (`regions.vallaki.level`). */
export function parseDataPath(path: unknown): string[] {
  if (typeof path !== 'string' || !path) throw new Error('A vault op needs a path');
  const segments = path.split('.');
  if (segments.length > MAX_DEPTH) throw new Error(`Vault path too deep: ${path}`);
  for (const segment of segments) {
    if (!SEGMENT.test(segment) || FORBIDDEN_KEYS.has(segment)) {
      throw new Error(`Invalid vault path segment "${segment}" in ${path}`);
    }
  }
  return segments;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The value at `segments` inside `data`. */
export function readDataPath(data: unknown, path: string): PathValue {
  let node: unknown = data;
  for (const key of parseDataPath(path)) {
    if (!isPlainObject(node) || !Object.prototype.hasOwnProperty.call(node, key)) {
      return { path, present: false };
    }
    node = node[key];
  }
  return node === undefined ? { path, present: false } : { path, present: true, value: node };
}

/**
 * A copy of `data` with the value at `path` set (`present`) or removed.
 * Intermediate objects are created; a non-object in the way is an error.
 */
export function writeDataPath(data: unknown, target: PathValue): Record<string, unknown> {
  const segments = parseDataPath(target.path);
  const root: Record<string, unknown> = isPlainObject(data) ? structuredClone(data) : {};
  let node = root;
  for (const key of segments.slice(0, -1)) {
    const next = node[key];
    if (next === undefined) {
      if (!target.present) return root;
      node[key] = {};
    } else if (!isPlainObject(next)) {
      throw new Error(`Cannot write ${target.path}: "${key}" is not an object`);
    }
    node = node[key] as Record<string, unknown>;
  }
  const last = segments[segments.length - 1];
  if (target.present) node[last] = structuredClone(target.value);
  else delete node[last];
  return root;
}

/** JSON-stable stringify (sorted keys), for equality of plain data. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export function samePathValue(a: PathValue, b: PathValue): boolean {
  if (a.present !== b.present) return false;
  return !a.present || stableStringify(a.value) === stableStringify(b.value);
}

const MAX_SHOWN = 80;

/** A short readable rendering of a value for diff lines. */
export function formatValue(value: PathValue | undefined): string {
  if (!value?.present) return '(unset)';
  const text = JSON.stringify(value.value) ?? String(value.value);
  return text.length > MAX_SHOWN ? `${text.slice(0, MAX_SHOWN - 1)}…` : text;
}
