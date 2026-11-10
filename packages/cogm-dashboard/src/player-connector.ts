import crypto from 'crypto';
import { readFileSync } from 'fs';

import { isLoopbackHost } from './bind-policy.js';
import { parseTeamDomain } from './access-jwt.js';

/**
 * The player connector's login table (D-136, design section 2 and 10). The Pi keeps one small
 * file (`FOUNDRY_AI_PLAYER_CONNECTOR_CONFIG`, mode 600, never in the repo or the vault):
 *
 * ```json
 * {
 *   "endpoint": "https://player-ai.example.com/mcp/player",
 *   "audience": "<AUD tag of the Access application for players>",
 *   "players": [{ "clientId": "...", "clientSecret": "...", "userId": "<Foundry user id>" }]
 * }
 * ```
 *
 * The backend reads the same file for its optional `denyTerms` list. A player is a Cloudflare
 * Access service token: the dashboard maps the verified token's Client ID to one Foundry user.
 * The Client Secret is only here to show the player their own pair on /me.
 */

export interface ConnectorPlayer {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly userId: string;
}

export interface ConnectorFile {
  readonly endpoint: string | null;
  readonly audiences: readonly string[];
  readonly players: readonly ConnectorPlayer[];
}

const USER_ID_RE = /^[A-Za-z0-9]{16}$/;

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Parse the file's JSON; entries that are not complete are dropped, never guessed. */
export function parseConnectorFile(
  raw: unknown,
  problem: (message: string) => void = (): void => undefined
): ConnectorFile {
  const rec = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const aud = rec.audience;
  const audiences = (Array.isArray(aud) ? aud : [aud]).map(str).filter(a => a !== '');
  const endpointRaw = str(rec.endpoint);
  let endpoint: string | null = null;
  try {
    const u = new URL(endpointRaw);
    if (u.protocol === 'https:' || (u.protocol === 'http:' && isLoopbackHost(u.hostname))) {
      endpoint = u.toString();
    }
  } catch {
    endpoint = null;
  }
  const seen = new Set<string>();
  const players: ConnectorPlayer[] = [];
  const list = Array.isArray(rec.players) ? (rec.players as unknown[]) : [];
  for (const [index, item] of list.entries()) {
    const p = (item ?? {}) as Record<string, unknown>;
    const clientId = str(p.clientId);
    const clientSecret = str(p.clientSecret);
    const userId = str(p.userId);
    if (!clientId || !clientSecret || !USER_ID_RE.test(userId)) {
      problem(`players[${index}] is incomplete or has a bad user id: dropped`);
      continue;
    }
    // One Client ID, one user: a duplicate id makes the whole mapping ambiguous, so neither stays.
    if (seen.has(clientId)) {
      problem('a Client ID appears twice: both entries dropped');
      const at = players.findIndex(x => x.clientId === clientId);
      if (at >= 0) players.splice(at, 1);
      continue;
    }
    seen.add(clientId);
    players.push({ clientId, clientSecret, userId });
  }
  // Two logins for one Foundry user: /me shows only the first pair; say so.
  if (new Set(players.map(p => p.userId)).size < players.length) {
    problem('two entries share one Foundry user id: /me shows only the first pair');
  }
  return { endpoint, audiences, players };
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Reads the file again on every use (a few lines; an edit needs no restart). */
export class ConnectorStore {
  constructor(
    private readonly file: string | null,
    private readonly warn: (message: string) => void = (): void => undefined
  ) {}

  private warned = false;
  /** The problems last logged, so an unchanged file does not log again on every request. */
  private lastProblems = '';

  read(): ConnectorFile {
    if (!this.file) return { endpoint: null, audiences: [], players: [] };
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      this.lastProblems = ''; // readable again later: its drop warnings are worth repeating
      if (!this.warned) {
        this.warned = true;
        this.warn('Player connector: the config file cannot be read; every login is refused');
      }
      return { endpoint: null, audiences: [], players: [] };
    }
    this.warned = false; // readable again: a later breakage is worth a new line
    const problems: string[] = [];
    const parsed = parseConnectorFile(json, m => problems.push(m));
    const signature = problems.join('|');
    if (signature !== this.lastProblems) {
      this.lastProblems = signature;
      for (const m of problems) this.warn(`Player connector: ${m}`);
    }
    return parsed;
  }

  /** The Foundry user a verified Client ID belongs to, or null (constant-time over every entry). */
  userFor(clientId: string): string | null {
    let found: string | null = null;
    for (const p of this.read().players) {
      if (safeEqual(p.clientId, clientId)) found = p.userId;
    }
    return found;
  }

  /** The pair that belongs to one Foundry user (their own /me page), or null. */
  credentialsFor(
    userId: string
  ): { endpoint: string | null; clientId: string; clientSecret: string } | null {
    const file = this.read();
    const own = file.players.find(p => p.userId === userId);
    return own
      ? { endpoint: file.endpoint, clientId: own.clientId, clientSecret: own.clientSecret }
      : null;
  }
}

/** What createDashboard needs to serve `/mcp/player`; absent or `enabled: false` mounts nothing. */
export interface PlayerConnectorOptions {
  readonly enabled: boolean;
  readonly store: ConnectorStore;
  /** The team domain of the Access application (`<team>.cloudflareaccess.com`), or ''. */
  readonly teamDomain: string;
  /** Local development: act as this Foundry user with no login. Loopback only (see below). */
  readonly devUser: string;
  /** `CF_ACCESS_TEAM_DOMAIN` as set, even when it does not parse (then `teamDomain` is ''). */
  readonly teamDomainRaw?: string;
}

/** The options from the environment (`FOUNDRY_AI_PLAYER_CONNECTOR*`, `CF_ACCESS_TEAM_DOMAIN`). */
export function playerConnectorFromEnv(
  env: NodeJS.ProcessEnv,
  warn: (message: string) => void
): PlayerConnectorOptions {
  const enabled = (env.FOUNDRY_AI_PLAYER_CONNECTOR ?? '').trim().toLowerCase() === 'on';
  const file = (env.FOUNDRY_AI_PLAYER_CONNECTOR_CONFIG ?? '').trim();
  return {
    enabled,
    store: new ConnectorStore(file || null, warn),
    teamDomain: parseTeamDomain(env.CF_ACCESS_TEAM_DOMAIN ?? ''),
    teamDomainRaw: (env.CF_ACCESS_TEAM_DOMAIN ?? '').trim(),
    devUser: (env.FOUNDRY_AI_PLAYER_CONNECTOR_DEV_USER ?? '').trim(),
  };
}
