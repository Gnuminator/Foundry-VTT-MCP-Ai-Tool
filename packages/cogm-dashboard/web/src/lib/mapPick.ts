// Live screen B: the Foundry window tells the strip which tokens the GM controls on the map, and
// the strip picks the same creatures. A tiny store the strip reads (useMapPick) and the frame
// page fills (listenForMapPick). The message carries token ids only, from the page that frames
// this one; the dashboard's frame-ancestors header lets only Foundry do that.
import { useSyncExternalStore } from 'react';

/** The `type` the Foundry module posts (packages/foundry-module/src/live-window.ts). */
export const LIVE_PICK_MESSAGE = 'fmb-live-pick';
/** The `type` the strip page posts to its parent once it listens. */
export const LIVE_READY_MESSAGE = 'fmb-live-ready';
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

/**
 * Start listening on this window; only the parent frame's messages count, or, for the strip in its
 * own window (the GM page opened it), the opener's, from this page's own origin. Returns the stop.
 */
export function listenForMapPick(target: Window = window): () => void {
  const framed = target.parent !== target;
  const opener: Window | null = framed ? null : ((target.opener as Window | null) ?? null);
  const onMessage = (event: MessageEvent): void => {
    if (event.source === null) return;
    const fromParent = framed && event.source === target.parent;
    const fromOpener =
      opener !== null && event.source === opener && event.origin === target.location.origin;
    if (!fromParent && !fromOpener) return;
    const ids = parsePickMessage(event.data);
    if (ids !== null) setMapPick(ids);
  };
  target.addEventListener('message', onMessage);
  // The page is a lazy chunk and can start listening after the frame's load event: say so, and the
  // Foundry window (or the GM page) sends the current pick again. The message carries nothing.
  if (framed) target.parent.postMessage({ type: LIVE_READY_MESSAGE }, '*');
  else if (opener !== null) {
    try {
      opener.postMessage({ type: LIVE_READY_MESSAGE }, target.location.origin);
    } catch {
      // A closed opener has nothing to tell.
    }
  }
  return () => target.removeEventListener('message', onMessage);
}

/** Forget the pick (tests). */
export function resetMapPick(): void {
  current = null;
}
