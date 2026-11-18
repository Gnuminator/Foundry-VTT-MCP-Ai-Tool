// Pinned tool calls and recent runs for the Tool Runner (item tool-runner-pins). A pin is a tool
// with its form filled in, saved under a name; it shows as a button on the During bar. The store
// lives in this browser (localStorage, like the other remembered choices: each GM has their own
// browser, and a blocked store only means nothing is remembered). A pin never skips a gate: the
// button runs the same guarded path the Tool Runner does.
import { useSyncExternalStore } from 'react';

import { readJson, writeJson } from './remember';

const PINS_KEY = 'cogm_tool_pins';

/** How many recent runs the list keeps. */
export const MAX_RECENT = 8;
/** How many pins one browser keeps (the During row has to stay a row). */
export const MAX_PINS = 12;
/** How many calls the "used most" list suggests. */
const SUGGEST_COUNT = 3;
/** Distinct calls whose run counts are remembered; the least used fall off. */
const MAX_COUNTED = 60;

export interface Pin {
  id: string;
  label: string;
  tool: string;
  args: Record<string, unknown>;
  /** The tool's class when it was pinned; anything unknown is run as a write. */
  mutates: 'read' | 'write' | 'destructive';
}

export interface RunRecord {
  tool: string;
  args: Record<string, unknown>;
  mutates: Pin['mutates'];
  at: number;
}

interface CountRecord {
  tool: string;
  args: Record<string, unknown>;
  mutates: Pin['mutates'];
  count: number;
  at: number;
}

export interface PinStore {
  pins: Pin[];
  recent: RunRecord[];
  counts: CountRecord[];
}

const EMPTY: PinStore = { pins: [], recent: [], counts: [] };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const asMutates = (v: unknown): Pin['mutates'] =>
  v === 'read' || v === 'write' || v === 'destructive' ? v : 'write';

/** A stable text for a call: the same tool with the same args is the same call. */
export function callKey(tool: string, args: Record<string, unknown>): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : isObject(v)
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map(k => [k, sort(v[k])])
          )
        : v;
  return `${tool}\n${JSON.stringify(sort(args))}`;
}

/** What a saved value is worth: bad entries are dropped, never repaired. */
export function parseStore(raw: unknown): PinStore {
  if (!isObject(raw)) return EMPTY;
  const list = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? v.filter(isObject) : [];
  const pins: Pin[] = [];
  for (const p of list(raw['pins'])) {
    const { id, label, tool, args } = p;
    if (typeof id !== 'string' || typeof label !== 'string' || typeof tool !== 'string') continue;
    pins.push({
      id,
      label,
      tool,
      args: isObject(args) ? args : {},
      mutates: asMutates(p['mutates']),
    });
  }
  const recent: RunRecord[] = [];
  for (const r of list(raw['recent'])) {
    if (typeof r['tool'] !== 'string' || typeof r['at'] !== 'number') continue;
    recent.push({
      tool: r['tool'],
      args: isObject(r['args']) ? r['args'] : {},
      mutates: asMutates(r['mutates']),
      at: r['at'],
    });
  }
  const counts: CountRecord[] = [];
  for (const c of list(raw['counts'])) {
    if (typeof c['tool'] !== 'string' || typeof c['count'] !== 'number') continue;
    counts.push({
      tool: c['tool'],
      args: isObject(c['args']) ? c['args'] : {},
      mutates: asMutates(c['mutates']),
      count: c['count'],
      at: typeof c['at'] === 'number' ? c['at'] : 0,
    });
  }
  return {
    pins: pins.slice(0, MAX_PINS).map(p => ({ ...p, label: p.label.slice(0, 60) })),
    recent: recent.slice(0, MAX_RECENT),
    counts: counts.slice(0, MAX_COUNTED),
  };
}

/** A run recorded: newest first, the same call once, the count of that call up by one. */
export function withRun(
  store: PinStore,
  run: { tool: string; args: Record<string, unknown>; mutates: Pin['mutates'] },
  at: number
): PinStore {
  const key = callKey(run.tool, run.args);
  const recent = [
    { ...run, at },
    ...store.recent.filter(r => callKey(r.tool, r.args) !== key),
  ].slice(0, MAX_RECENT);
  const seen = store.counts.find(c => callKey(c.tool, c.args) === key);
  const others = store.counts.filter(c => c !== seen);
  const counted = [{ ...run, count: (seen?.count ?? 0) + 1, at }, ...others]
    .sort((a, b) => b.count - a.count || b.at - a.at)
    .slice(0, MAX_COUNTED);
  return { ...store, recent, counts: counted };
}

/** The most used calls that are not pinned, at least used twice, most used first. */
export function suggestions(store: PinStore, count = SUGGEST_COUNT): CountRecord[] {
  const pinned = new Set(store.pins.map(p => callKey(p.tool, p.args)));
  return store.counts
    .filter(c => c.count >= 2 && !pinned.has(callKey(c.tool, c.args)))
    .sort((a, b) => b.count - a.count || b.at - a.at)
    .slice(0, count);
}

/** A name for a new pin: the tool and its action, e.g. "plan-scene-mood restore". */
export function defaultLabel(tool: string, args: Record<string, unknown>): string {
  const action = args['action'];
  return typeof action === 'string' && action ? `${tool} ${action}` : tool;
}

export function withPin(store: PinStore, pin: Omit<Pin, 'id'>, id: string): PinStore {
  if (store.pins.length >= MAX_PINS) return store;
  return { ...store, pins: [...store.pins, { ...pin, id }] };
}

export const withoutPin = (store: PinStore, id: string): PinStore => ({
  ...store,
  pins: store.pins.filter(p => p.id !== id),
});

/** A pin renamed; an empty name changes nothing. */
export function withRename(store: PinStore, id: string, label: string): PinStore {
  const name = label.trim();
  if (!name) return store;
  return { ...store, pins: store.pins.map(p => (p.id === id ? { ...p, label: name } : p)) };
}

// The live copy, shared by the During row and the Tool Runner.
let current: PinStore | null = null;
const listeners = new Set<() => void>();

function load(): PinStore {
  current ??= parseStore(readJson(PINS_KEY));
  return current;
}

function update(next: PinStore): void {
  current = next;
  writeJson(PINS_KEY, next);
  listeners.forEach(l => l());
}

// Another dashboard window changed the pins: read them again, so this window never writes over them.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key !== PINS_KEY) return;
    current = null;
    listeners.forEach(l => l());
  });
}

/** The pin store, up to date in every component that asks. */
export function usePinStore(): PinStore {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb);
      return (): void => void listeners.delete(cb);
    },
    load,
    () => EMPTY
  );
}

export const pinActions = {
  pin: (pin: Omit<Pin, 'id'>): boolean => {
    const before = load();
    const next = withPin(before, pin, `pin-${Date.now().toString(36)}-${before.pins.length}`);
    if (next === before) return false;
    update(next);
    return true;
  },
  remove: (id: string): void => update(withoutPin(load(), id)),
  rename: (id: string, label: string): void => update(withRename(load(), id, label)),
  ran: (run: { tool: string; args: Record<string, unknown>; mutates: Pin['mutates'] }): void =>
    update(withRun(load(), run, Date.now())),
  /** For tests: forget the in-memory copy so the next read goes to the store. */
  reset: (): void => {
    current = null;
    listeners.forEach(l => l());
  },
};
