import type { SseRedactor } from './sse.js';

/**
 * GM-hub redaction. Since M2 the player page never joins the GM hub: it has its
 * own stream that only carries the projected player state
 * (`player/projection.ts`, served by `/api/player/*`). Every GM-hub broadcast
 * goes through `gmOnly`, so a non-GM client that somehow joined the GM hub
 * would still receive nothing.
 */
export const gmOnly: SseRedactor = (payload, role) => (role === 'gm' ? payload : undefined);
