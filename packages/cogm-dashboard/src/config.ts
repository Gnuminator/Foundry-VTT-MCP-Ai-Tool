import 'dotenv/config';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * Centralised, typed configuration for the Co-GM dashboard.
 *
 * Everything is sourced from environment variables (loaded from a local `.env`
 * via dotenv) with sensible defaults so the dashboard runs out of the box
 * against a bridge on the standard 127.0.0.1:31414 control channel. No secrets
 * are ever hard-coded — the Anthropic key only comes from the environment.
 */

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export type Tone = 'tactical' | 'narrative';

export interface Config {
  /** HTTP port the dashboard (and its SSE stream) listens on. */
  readonly port: number;
  /**
   * Interface the dashboard binds. Loopback by default so the only path in is via
   * a front proxy / tunnel (Tailscale, cloudflared). Set BIND_HOST=0.0.0.0 only if
   * you deliberately expose it (e.g. LAN testing) — and then auth is REQUIRED.
   */
  readonly bindHost: string;
  /**
   * Fail closed: when true, the server refuses to start unless the GM/player split
   * is configured (a GM token or GM-email allow-list). Defaults true whenever the
   * bind host is not loopback, so a non-localhost dashboard can never silently
   * grant GM to everyone (code review H5). Override with REQUIRE_AUTH.
   */
  readonly requireAuth: boolean;
  /**
   * Value for Express `trust proxy` when behind a reverse proxy / tunnel (so
   * req.ip and X-Forwarded-* are honoured for rate-limiting). Empty ⇒ not set.
   */
  readonly trustProxy: string | number | boolean;
  /** MCP backend control-channel host (JSON-lines TCP). */
  readonly mcpHost: string;
  /** MCP backend control-channel port. */
  readonly mcpPort: number;
  /** How often to poll the session-event delta, in ms. */
  readonly pollIntervalMs: number;
  /** How often to poll combat state, in ms. */
  readonly combatPollIntervalMs: number;
  /** Minimum spacing between auto-generated AI comments, in ms. */
  readonly commentMinIntervalMs: number;
  /** Debounce window used to batch a burst of events into one comment, in ms. */
  readonly commentDebounceMs: number;
  /** Anthropic API key (empty string ⇒ AI features disabled, feed still runs). */
  readonly anthropicApiKey: string;
  /** Default Claude model id. */
  readonly anthropicModel: string;
  /** Starting commentary tone. */
  readonly defaultTone: Tone;
  /** Rolling window size for the in-memory event buffer. */
  readonly maxEvents: number;
  /** Token cap for an auto-generated comment. */
  readonly commentMaxTokens: number;
  /** Token cap for an "ask the co-GM" answer. */
  readonly askMaxTokens: number;
  /** How often to poll module diagnostics (errors/warnings), in ms. */
  readonly errorPollIntervalMs: number;
  /** Rolling window size for the in-memory module-error buffer. */
  readonly maxErrors: number;
  /** Whether the co-GM auto-comments on new module errors. */
  readonly commentOnErrors: boolean;
  /** Minimum spacing between diagnostics comments, in ms. */
  readonly errorCommentMinIntervalMs: number;
  /** Token cap for a diagnostics comment. */
  readonly errorCommentMaxTokens: number;
  /** Control-channel per-request reply timeout, in ms. */
  readonly controlRequestTimeoutMs: number;
  /** Control-channel TCP connect timeout, in ms. */
  readonly controlConnectTimeoutMs: number;
  /** Control-channel heartbeat cadence, in ms. */
  readonly controlHeartbeatIntervalMs: number;
  /** Window after last activity before the control channel is treated as stale, in ms. */
  readonly controlStalenessThresholdMs: number;
  /** Absolute path to the static frontend assets. */
  readonly publicDir: string;
  /** Log verbosity. */
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** Player/GM split + auth (Phase 6). */
  readonly auth: AuthConfig;
  /** What a player view is allowed to see of GM-only combat data (Phase 6). */
  readonly playerView: PlayerViewConfig;
}

/**
 * Player/GM split + auth configuration.
 *
 * The split is OPT-IN: with no GM token and no GM email allow-list configured,
 * `splitEnabled` is false and the dashboard runs in legacy single-user GM mode
 * (every request is the GM, zero config — today's localhost behavior). Setting
 * `GM_DASHBOARD_TOKEN` and/or `GM_EMAILS` turns the split on, after which a
 * caller must prove GM identity (token or Cloudflare Access email) to reach the
 * GM surface; everyone else gets the read-only player view.
 */
export interface AuthConfig {
  /** Derived: true once a GM token or GM email allow-list is configured. */
  readonly splitEnabled: boolean;
  /** Shared GM secret. Presenting it (header/query/cookie) ⇒ GM role. '' = unset. */
  readonly gmToken: string;
  /** Optional second factor for players. '' = the player view is open to non-GMs. */
  readonly playerToken: string;
  /** Cloudflare Access email allow-list that maps to the GM role. */
  readonly gmEmails: readonly string[];
  /** Request header Cloudflare Access injects with the authenticated user email. */
  readonly cfAccessEmailHeader: string;
  /**
   * Only trust the Cloudflare-Access email header when we are ACTUALLY behind
   * Access. Default false: the header is otherwise trivially forgeable by anyone
   * who can reach the dashboard directly. Set CF_ACCESS_ENABLED=true only when a
   * real Cloudflare Access gate is in front (code review H5).
   */
  readonly cfAccessEnabled: boolean;
}

export interface PlayerViewConfig {
  /** Show (publicly-visible) status conditions on enemy/NPC combatants. */
  readonly showEnemyConditions: boolean;
  /** Show a coarse HP band (e.g. "bloodied") on enemies — never exact numbers. */
  readonly showEnemyHpBands: boolean;
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readString(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw !== undefined && raw.trim() !== '' ? raw.trim() : fallback;
}

function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function readList(name: string): string[] {
  const raw = process.env[name];
  if (raw === undefined) return [];
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(s => s !== '');
}

const gmToken = readString('GM_DASHBOARD_TOKEN', '');
const gmEmails = readList('GM_EMAILS').map(e => e.toLowerCase());
const auth: AuthConfig = {
  splitEnabled: gmToken !== '' || gmEmails.length > 0,
  gmToken,
  playerToken: readString('PLAYER_DASHBOARD_TOKEN', ''),
  gmEmails,
  cfAccessEmailHeader: readString(
    'CF_ACCESS_EMAIL_HEADER',
    'cf-access-authenticated-user-email'
  ).toLowerCase(),
  cfAccessEnabled: readBool('CF_ACCESS_ENABLED', false),
};

const bindHost = readString('BIND_HOST', '127.0.0.1');
const isLoopbackBind =
  bindHost === '127.0.0.1' || bindHost === '::1' || bindHost.toLowerCase() === 'localhost';
// Fail closed off-loopback: a non-localhost bind requires the auth split unless
// explicitly overridden. On loopback the legacy single-user default is fine.
const requireAuth = readBool('REQUIRE_AUTH', !isLoopbackBind);

/** Parse TRUST_PROXY into the shape Express `trust proxy` accepts. Empty ⇒ false. */
function readTrustProxy(): string | number | boolean {
  const raw = process.env.TRUST_PROXY;
  if (raw === undefined || raw.trim() === '') return false;
  const v = raw.trim();
  if (/^(true|false)$/i.test(v)) return /^true$/i.test(v);
  if (/^\d+$/.test(v)) return Number(v);
  return v; // e.g. 'loopback' or a subnet
}

const pollIntervalMs = readNumber('POLL_INTERVAL_MS', 4000);

const tone: Tone = readString('COGM_TONE', 'tactical') === 'narrative' ? 'narrative' : 'tactical';

const logLevelRaw = readString('LOG_LEVEL', 'info');
const logLevel: Config['logLevel'] =
  logLevelRaw === 'debug' || logLevelRaw === 'warn' || logLevelRaw === 'error'
    ? logLevelRaw
    : 'info';

export const config: Config = {
  port: readNumber('PORT', 3000),
  bindHost,
  requireAuth,
  trustProxy: readTrustProxy(),
  mcpHost: readString('MCP_CONTROL_HOST', '127.0.0.1'),
  mcpPort: readNumber('MCP_CONTROL_PORT', 31414),
  pollIntervalMs,
  combatPollIntervalMs: readNumber('COMBAT_POLL_INTERVAL_MS', pollIntervalMs),
  commentMinIntervalMs: readNumber('COMMENT_MIN_INTERVAL_MS', 20000),
  commentDebounceMs: readNumber('COMMENT_DEBOUNCE_MS', 1500),
  anthropicApiKey: readString('ANTHROPIC_API_KEY', ''),
  anthropicModel: readString('ANTHROPIC_MODEL', 'claude-opus-4-8'),
  defaultTone: tone,
  maxEvents: readNumber('COGM_MAX_EVENTS', 80),
  commentMaxTokens: readNumber('COGM_COMMENT_MAX_TOKENS', 320),
  askMaxTokens: readNumber('COGM_ASK_MAX_TOKENS', 700),
  errorPollIntervalMs: readNumber('ERROR_POLL_INTERVAL_MS', 6000),
  maxErrors: readNumber('COGM_MAX_ERRORS', 100),
  commentOnErrors: readBool('COGM_COMMENT_ON_ERRORS', true),
  errorCommentMinIntervalMs: readNumber('ERROR_COMMENT_MIN_INTERVAL_MS', 60000),
  errorCommentMaxTokens: readNumber('COGM_ERROR_COMMENT_MAX_TOKENS', 280),
  controlRequestTimeoutMs: readNumber('MCP_REQUEST_TIMEOUT_MS', 15000),
  controlConnectTimeoutMs: readNumber('MCP_CONNECT_TIMEOUT_MS', 5000),
  controlHeartbeatIntervalMs: readNumber('MCP_HEARTBEAT_INTERVAL_MS', 10000),
  controlStalenessThresholdMs: readNumber('MCP_STALENESS_THRESHOLD_MS', 30000),
  publicDir: path.join(moduleDir, '..', 'public'),
  logLevel,
  auth,
  playerView: {
    showEnemyConditions: readBool('PLAYER_SHOW_ENEMY_CONDITIONS', true),
    showEnemyHpBands: readBool('PLAYER_SHOW_ENEMY_HP_BANDS', false),
  },
};
