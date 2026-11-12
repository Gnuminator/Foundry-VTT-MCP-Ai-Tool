import type { Request, Response } from 'express';

import type { Config } from '../config.js';
import type { Logger } from '../logger.js';
import type { BridgeStatus, WorldInfo } from '../feed/types.js';
import type { RecordingHealth } from '../recording-health.js';
import type { SseHub } from '../sse.js';
import type { GameState } from '../state.js';
import type { buildPlayerState } from '../player/projection.js';
import type { buildRollRows, openRolls } from '../roll-status.js';

/**
 * What the route groups in this folder read from the dashboard's closure (app.ts). The state
 * stays in `createDashboard`; a route reads it through these accessors, so a route file never
 * holds a copy that could go stale.
 */
export interface RouteContext {
  config: Config;
  logger: Logger;
  state: GameState;
  /** The GM stream hub; every broadcast on it is `gmOnly`. */
  sse: SseHub;
  world(): WorldInfo | null;
  status(): BridgeStatus;
  recordingHealth(): RecordingHealth;
  /** Express middleware: 401/403 unless the caller resolves to the GM role. */
  requireGm: (req: Request, res: Response, next: () => void) => void;
  /** The status as the stream sends it, with the server's clock. */
  stamped<S extends object>(s: S): S & { now: string };
  currentPlayerState(): ReturnType<typeof buildPlayerState>;
  currentRolls(): { rows: ReturnType<typeof buildRollRows>; open: ReturnType<typeof openRolls> };
  attachPlayerStream(res: Response): void;
  themePayload(): { theme: string; themes: readonly string[] };
  prefsPayload(): Record<string, unknown>;
  settingsPayload(): Record<string, unknown>;
}
