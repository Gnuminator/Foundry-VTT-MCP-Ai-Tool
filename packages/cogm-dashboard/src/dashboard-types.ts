import type { Express } from 'express';
import type { RecordUsageResult, UsageEvent } from '@gnuminator/shared';

import type { AccessJwtVerifier } from './access-jwt.js';
import type { Config } from './config.js';
import type { GameFeedHandlers } from './feed/types.js';
import type { Logger } from './logger.js';
import type { OpenRouteOptions } from './open-route.js';
import type { PlayerConnectorOptions } from './player-connector.js';
import type { SessionNotesAction } from './session-notes-route.js';
import type { SessionSwitchAction } from './session-switches.js';

/**
 * The dashboard's public types (moved out of app.ts; app.ts re-exports them, so imports from
 * `./app.js` keep working).
 */

/** The bridge calls the dashboard makes (the MCP control client satisfies it). */
export interface DashboardClient {
  callTool<T = unknown>(
    name: string,
    args?: Record<string, unknown>,
    options?: { timeoutMs?: number }
  ): Promise<T>;
  listTools(): Promise<unknown[]>;
  /** Hand usage events to the bridge (I-084); absent on fakes, "Unknown method" on old backends. */
  recordUsage?(events: UsageEvent[]): Promise<RecordUsageResult>;
  /** A player opened a handout (I-039 seen log); absent on fakes and old backends. */
  recordHandoutSeen?(pageId: string, userId: string, name: string): Promise<{ recorded: boolean }>;
  /** The live write sweep's helper (I-016; test world only); absent on fakes. */
  liveSweep?(request: Record<string, unknown>): Promise<unknown>;
  /** Turn on for tonight (D3): read, turn on or turn back off tonight's switches; absent on fakes. */
  sessionSwitches?(action: SessionSwitchAction): Promise<unknown>;
  /** The feature cards (I-064): every feature switch, read-only; absent on fakes. */
  featureSwitches?(): Promise<unknown>;
  /** My character (I-096): one player's character sheets; absent on fakes. */
  characterSheet?(userId: string): Promise<unknown>;
  /** The player's roll button: the module rolls for their character; absent on fakes. */
  playerRoll?(userId: string, buttonId: string): Promise<unknown>;
  /** "Upload my portrait": a player's picture for their own character; absent on fakes. */
  playerPortrait?(
    userId: string,
    actorId: string,
    target: 'portrait' | 'both',
    data: string
  ): Promise<unknown>;
  /** The player connector (D-136): the five tool definitions and one tool run; absent on fakes. */
  listPlayerTools?(): Promise<unknown>;
  playerTool?(userId: string, tool: string, args: unknown): Promise<unknown>;
  /** Session notes (recap lane, D-087): list, get, put, approve; absent on fakes. */
  sessionNotes?(action: SessionNotesAction, params?: Record<string, unknown>): Promise<unknown>;
  readonly isConnected?: boolean;
}

export interface DashboardDeps {
  config: Config;
  logger: Logger;
  client: DashboardClient;
  /** `/open` options (O4): the P1 origin allowlist (default none) and a test clock. */
  openRoute?: OpenRouteOptions;
  /** The built help (I-064); default dist/help.json next to the server. */
  helpFile?: string | URL;
  /** Fetches Cloudflare Access's public keys (I-022); default the global fetch. Tests stub it. */
  accessFetch?: ConstructorParameters<typeof AccessJwtVerifier>[1];
  /** The player connector (D-136); default from the environment (`FOUNDRY_AI_PLAYER_CONNECTOR*`). */
  playerConnector?: PlayerConnectorOptions;
  /** The storage space check's status file; default env FOUNDRY_AI_SPACE_STATUS, else the Pi's path. */
  spaceStatusFile?: string;
  /** Test clock for the space check's age. */
  spaceNow?: () => number;
  /** Test only: the status heartbeat interval in ms (default STATUS_HEARTBEAT_MS). */
  statusHeartbeatMs?: number;
  /** Test only: the bot status URL (default config.botStatusUrl). */
  botStatusUrl?: string;
  /** Test only: how often the Recorder and Play log dots are re-read (default RECORDING_HEALTH_MS). */
  recordingHealthMs?: number;
  /** The test kit's last-run.json for the version tracker; default env or the PC's kit home. */
  kitLastRunFile?: string | null;
}

export interface Dashboard {
  app: Express;
  handlers: GameFeedHandlers;
  /** The feed's way to read events at once; server.ts sets it once the feed exists. */
  onFeed(feed: { pollNow: () => void; resync?: () => void }): void;
  /** Start background work (player view polling). */
  start(): void;
  /** Stop background work and end every stream. */
  close(): void;
}
