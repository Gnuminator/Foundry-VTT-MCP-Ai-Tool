/**
 * Narrowing helpers for untyped bridge replies and Foundry/dnd5e document data. A reply is
 * `unknown` until a guard has looked at it; these keep the call sites short.
 */

export type Rec = Record<string, unknown>;

function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The value as a record, or an empty one when it is not an object. */
export function rec(value: unknown): Rec {
  return isRec(value) ? value : {};
}

/** The value as an array, or an empty one when it is not an array. */
export function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A property chain read without throwing: `at(item, 'system', 'attributes', 'hp')`. */
export function at(value: unknown, ...path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Rec)[key];
  }
  return current;
}
