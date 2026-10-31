// Live screen B: the Foundry window tells the strip which tokens the GM controls on the map, and
// the strip picks the same creatures. A tiny store the strip reads (useMapPick) and the frame
// page fills (listenForMapPick). The message carries token ids only, from the page that frames
// this one; the dashboard's frame-ancestors header lets only Foundry do that.
import { useSyncExternalStore } from 'react';

/** The `type` the Foundry module posts (packages/foundry-module/src/live-window.ts). */
export const LIVE_PICK_MESSAGE = 'fmb-live-pick';
/** More ids than a fight can hold are noise. */
const MAX_IDS = 200;

let current: readonly string[] | null = null;
const listeners = new Set<() => void>();

/** The token ids of a message, or null when it is not a well-formed pick message. */
export function parsePickMessage(data: unknown): string[] | null {
  if (typeof data !== 'object' || data === null) return null;
  const { type, tokenIds } = data as { type?: unknown; tokenIds?: unknown };
  if (type !== LIVE_PICK_MESSAGE || !Array.isArray(tokenIds)) return null;
  return tokenIds
    .filter((id): id is string => typeof id === 'string' && id !== '')
    .slice(0, MAX_IDS);
}

/** Replace the controlled tokens; a same list changes nothing. */
export function setMapPick(ids: readonly string[]): void {
  const before = current;
  if (before?.length === ids.length && ids.every((id, i) => id === before[i])) return;
  current = ids;
  listeners.forEach(fn => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The token ids the map controls now, outside React. */
export function currentMapPick(): readonly string[] | null {
  return current;
}

/** The token ids the map controls now (null until a Foundry window sends any). */
export function useMapPick(): readonly string[] | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => current
  );
}

/** Start listening on this window; only the parent frame's messages count. Returns the stop. */
export function listenForMapPick(target: Window = window): () => void {
  const onMessage = (event: MessageEvent): void => {
    if (event.source === null || event.source !== target.parent || target.parent === target) return;
    const ids = parsePickMessage(event.data);
    if (ids !== null) setMapPick(ids);
  };
  target.addEventListener('message', onMessage);
  return () => target.removeEventListener('message', onMessage);
}

/** Forget the pick (tests). */
export function resetMapPick(): void {
  current = null;
}
