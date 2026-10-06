/**
 * The one place that knows whether this browser holds the open bridge link.
 *
 * `main.ts` registers the socket bridge here when it starts the link and clears
 * it when the link is stopped. The GM helper queries and the "AI changes" window
 * read it from here, so they never import `main.ts` (which builds the whole
 * module at import time). Only one browser per world holds the link (the bridge
 * user; on the Orange Pi, the headless Assistant GM).
 */
import type { ModuleRequester } from './constants.js';

/** What the helpers need from the socket bridge. */
export interface BridgeLink {
  isConnected(): boolean;
  request(
    tool: string,
    args: Record<string, unknown>,
    requestedBy: ModuleRequester,
    timeoutMs?: number
  ): Promise<unknown>;
}

let link: BridgeLink | null = null;

/** Register (or clear, with null) this browser's socket bridge. */
export function setBridgeLink(next: BridgeLink | null): void {
  link = next;
}

/** This browser's bridge link when it is open right now, else null. */
export function getOpenBridgeLink(): BridgeLink | null {
  return link?.isConnected() === true ? link : null;
}
