/**
 * MockCollection — a stand-in for Foundry's `Collection` / `WorldCollection` /
 * embedded-document collections (`game.actors`, `actor.items`, `scene.tokens`, …).
 *
 * Foundry's `Collection` extends `Map` and layers array-like helpers on top
 * (`get`, `getName`, `find`, `filter`, `map`, `forEach`, `some`, `contents`,
 * `size`, iteration). `data-access.ts` only ever leans on that subset, so this
 * reproduces exactly those semantics — keyed by each entry's `id`, iterating in
 * insertion order — without pulling in the real Foundry runtime.
 *
 * Part of the Phase 9 Foundry-mock harness (see `index.ts`). Test-only: this
 * folder is excluded from the shipped `tsc` build via `tsconfig.json`.
 */

export interface Identified {
  id?: string | null;
  name?: string | null;
}

export class MockCollection<T extends Identified> implements Iterable<T> {
  private readonly entries_ = new Map<string, T>();

  constructor(initial: readonly T[] = []) {
    for (const entry of initial) this.add(entry);
  }

  /** Insert/replace an entry, keyed by its own `id` (blank id allowed but discouraged). */
  add(entry: T): this {
    this.entries_.set(entry.id ?? '', entry);
    return this;
  }

  // --- Map-ish surface -------------------------------------------------------

  get size(): number {
    return this.entries_.size;
  }

  get(id: string): T | undefined {
    return this.entries_.get(id);
  }

  has(id: string): boolean {
    return this.entries_.has(id);
  }

  set(id: string, value: T): this {
    this.entries_.set(id, value);
    return this;
  }

  delete(id: string): boolean {
    return this.entries_.delete(id);
  }

  // --- Foundry Collection helpers -------------------------------------------

  /** Foundry resolves documents by display name via `getName`. First match wins. */
  getName(name: string): T | undefined {
    return this.contents.find(entry => entry.name === name);
  }

  /** Array snapshot in insertion order — mirrors Foundry's `Collection#contents`. */
  get contents(): T[] {
    return [...this.entries_.values()];
  }

  find(predicate: (entry: T, index: number) => boolean): T | undefined {
    return this.contents.find(predicate);
  }

  filter(predicate: (entry: T, index: number) => boolean): T[] {
    return this.contents.filter(predicate);
  }

  map<U>(transform: (entry: T, index: number) => U): U[] {
    return this.contents.map(transform);
  }

  forEach(callback: (entry: T, index: number) => void): void {
    this.contents.forEach(callback);
  }

  some(predicate: (entry: T, index: number) => boolean): boolean {
    return this.contents.some(predicate);
  }

  every(predicate: (entry: T, index: number) => boolean): boolean {
    return this.contents.every(predicate);
  }

  reduce<U>(reducer: (acc: U, entry: T, index: number) => U, initial: U): U {
    return this.contents.reduce(reducer, initial);
  }

  values(): IterableIterator<T> {
    return this.entries_.values();
  }

  keys(): IterableIterator<string> {
    return this.entries_.keys();
  }

  entries(): IterableIterator<[string, T]> {
    return this.entries_.entries();
  }

  [Symbol.iterator](): IterableIterator<T> {
    return this.entries_.values();
  }
}
