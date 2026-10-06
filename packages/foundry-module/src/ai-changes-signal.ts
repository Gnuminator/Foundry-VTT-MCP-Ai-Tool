/**
 * "The AI change log changed" signal (I-108): tells every GM client that has the
 * "AI changes" window open to fetch the list again.
 *
 * The bridge client calls {@link announceAiChangesUpdated} wherever it logs a
 * guarded change (an apply, an undo, a vault-only change). It emits one message
 * on the module's game socket for the other clients and tells its own window
 * directly (Foundry does not send a client its own socket message). Nothing
 * secret travels in it: only the type.
 */
import { MODULE_ID } from './constants.js';

/** The `type` of the module game-socket message. */
export const AI_CHANGES_SOCKET_TYPE = 'ai-changes-updated';

/** How long after an apply the signal goes out: the backend writes its audit entry just after the module answers. */
export const AI_CHANGES_APPLY_DELAY_MS = 800;

const listeners = new Set<() => void>();

/** Run `listener` whenever the change log changes; returns the way to stop. */
export function onAiChangesUpdated(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyLocal(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.warn(`[${MODULE_ID}] AI changes listener failed:`, error);
    }
  }
}

function emitNow(): void {
  try {
    game.socket?.emit(`module.${MODULE_ID}`, { type: AI_CHANGES_SOCKET_TYPE });
  } catch (error) {
    console.warn(`[${MODULE_ID}] Could not announce the AI change:`, error);
  }
  notifyLocal();
}

/**
 * Tell every GM client (and this one) the change log changed. `delayMs` waits
 * first, for callers that run before the backend has recorded the change.
 */
export function announceAiChangesUpdated(delayMs = 0): void {
  if (delayMs > 0) setTimeout(emitNow, delayMs);
  else emitNow();
}

/**
 * Socket handler: true when `data` is the signal (handled here), so the caller
 * can stop. Only GM clients react; others ignore it.
 */
export function handleAiChangesSocketMessage(data: unknown): boolean {
  if ((data as { type?: unknown } | null)?.type !== AI_CHANGES_SOCKET_TYPE) return false;
  if (game.user?.isGM) notifyLocal();
  return true;
}
