/**
 * Dashboard pre-flight (I-068): the bridge's `get-preflight` checklist plus the
 * two checks only the dashboard can make: Turn on for tonight (the module's session
 * switches and GM Actions, D3) and the `/player` page free of secret terms. Read-only.
 */
import type { PreflightCheck, PreflightChecksResult } from '@gnuminator/shared';

import { gmPageInfo } from './gm-page.js';
import type { PlayerVaultHealth } from './player-vault/service.js';
import { readyCheck, type SessionSwitches } from './session-switches.js';

/** The checks this file adds to the bridge's list. */
export type DashboardPreflightCheckId =
  | 'ready'
  | 'player-page'
  | 'bridge-checks'
  | 'foundry-address'
  | 'player-vault';

export interface DashboardPreflightCheck extends Omit<PreflightCheck, 'id'> {
  id: PreflightCheck['id'] | DashboardPreflightCheckId;
}

export interface DashboardPreflightResult extends Omit<PreflightChecksResult, 'checks'> {
  checks: DashboardPreflightCheck[];
}

export interface DashboardPreflightInput {
  callTool: <T>(name: string, args?: Record<string, unknown>) => Promise<T>;
  gmActionsEnabled: boolean;
  /**
   * The module's session switches (D3), or null when the module is too old to report them.
   * When present, the Ready row replaces the bridge's informational "Write switches" row.
   */
  sessionSwitches: SessionSwitches | null;
  /** What `/api/player/state` would send right now (with handouts). */
  playerState: unknown;
  /** `DASHBOARD_FOUNDRY_URL` as configured; unset or empty gives a warning. */
  foundryUrl?: string | undefined;
  /** How the player vault passes went; null or absent when the player vaults are off. */
  playerVaultHealth?: PlayerVaultHealth | null;
  /** Tests only: the clock (default Date.now). */
  now?: () => number;
}

/** A player vault with no clean pass for this long (Foundry connected) is stale. */
export const PLAYER_VAULT_STALE_MS = 10 * 60_000;

/**
 * Whether the Pi-side player vault folders are being kept current (D-134). Nobody opens the vault
 * to see its age, so a service that stopped or fails for one player would look current. The
 * Syncthing hop to each player's PC is a separate read-only check (Pi stage 33).
 */
function playerVaultCheck(input: DashboardPreflightInput): DashboardPreflightCheck | null {
  const health = input.playerVaultHealth;
  if (!health) return null;
  const label = 'Player vaults up to date';
  const now = (input.now ?? Date.now)();
  const at = (ms: number): string => `${new Date(ms).toISOString().slice(11, 16)} UTC`;
  if (health.failed.length > 0) {
    return {
      id: 'player-vault',
      label,
      status: 'warn',
      detail: `The vault of ${health.failed.join(', ')} was not written in the last pass, so ${health.failed.length === 1 ? 'that player sees' : 'those players see'} older notes${health.lastCleanPassAt ? ` (last clean pass ${at(health.lastCleanPassAt)})` : ''}.`,
    };
  }
  if (health.lastCleanPassAt === null) {
    return {
      id: 'player-vault',
      label,
      status: 'unknown',
      detail: 'No player vault pass has finished since the dashboard started.',
    };
  }
  if (now - health.lastCleanPassAt > PLAYER_VAULT_STALE_MS) {
    return {
      id: 'player-vault',
      label,
      status: 'warn',
      detail: `The player vaults were last checked at ${at(health.lastCleanPassAt)}, so they may be out of date.`,
    };
  }
  return {
    id: 'player-vault',
    label,
    status: 'ok',
    detail: `Checked at ${at(health.lastCleanPassAt)}${health.lastWriteAt ? `; last changed at ${at(health.lastWriteAt)}` : ''}.`,
  };
}

/** Foundry's address for the GM page and the Live window: both stay blank without it. */
function foundryAddressCheck(foundryUrl: string | undefined): DashboardPreflightCheck {
  const label = 'Foundry address set';
  if (gmPageInfo(foundryUrl).foundryUrl !== null) {
    return {
      id: 'foundry-address',
      label,
      status: 'ok',
      detail: 'The GM page and the Live window know where Foundry is.',
    };
  }
  return {
    id: 'foundry-address',
    label,
    status: 'warn',
    detail:
      'The dashboard does not know Foundry’s address, so the GM page cannot open Foundry and the Live window inside Foundry stays blank. Ask whoever set up the dashboard to add the address your browser uses for Foundry.',
  };
}

/** `check-secret-terms` takes at most 5000 characters per call. */
const CHUNK = 4900;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Every string a player receives, one per line, in pieces `check-secret-terms` accepts. */
export function playerTextChunks(state: unknown): string[] {
  const strings: string[] = [];
  const walk = (v: unknown, depth: number): void => {
    if (depth > 8) return;
    if (typeof v === 'string') {
      if (v.trim()) strings.push(v);
    } else if (Array.isArray(v)) {
      v.forEach(item => walk(item, depth + 1));
    } else if (v !== null && typeof v === 'object') {
      Object.values(v as Record<string, unknown>).forEach(item => walk(item, depth + 1));
    }
  };
  walk(state, 0);
  const chunks: string[] = [];
  let current = '';
  for (const s of strings) {
    for (let i = 0; i < s.length; i += CHUNK) {
      const piece = s.slice(i, i + CHUNK);
      if (current.length + piece.length + 1 > CHUNK) {
        if (current) chunks.push(current);
        current = piece;
      } else {
        current = current ? `${current}\n${piece}` : piece;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function playerPageCheck(input: DashboardPreflightInput): Promise<DashboardPreflightCheck> {
  const label = 'Player page free of secret terms';
  try {
    const terms = new Set<string>();
    for (const text of playerTextChunks(input.playerState)) {
      const result = await input.callTool<{ matches?: Array<{ term?: unknown }> }>(
        'check-secret-terms',
        { text }
      );
      for (const m of Array.isArray(result?.matches) ? result.matches : []) {
        if (typeof m.term === 'string' && m.term) terms.add(m.term);
      }
    }
    if (terms.size === 0) {
      return {
        id: 'player-page',
        label,
        status: 'ok',
        detail: 'Nothing on /player names a secret term right now.',
      };
    }
    return {
      id: 'player-page',
      label,
      status: 'fail',
      detail: `/player shows secret terms: ${[...terms].join(', ')}. Open /player to find them (combat names, the feed or a handout).`,
    };
  } catch (error) {
    return { id: 'player-page', label, status: 'unknown', detail: message(error) };
  }
}

/** Run the whole pre-flight: never throws; a check that cannot run says so. */
export async function runDashboardPreflight(
  input: DashboardPreflightInput
): Promise<DashboardPreflightResult> {
  let bridge: PreflightChecksResult | null = null;
  let bridgeError: string | null = null;
  try {
    bridge = await input.callTool<PreflightChecksResult>('get-preflight', { action: 'checks' });
  } catch (error) {
    bridgeError = message(error);
  }
  // An answer without a checks list (an older or newer bridge) counts as no answer, so one odd
  // reply cannot throw here and take the dashboard down.
  let malformed = false;
  if (bridge !== null && !Array.isArray(bridge?.checks)) {
    bridge = null;
    malformed = true;
  }
  const checks: DashboardPreflightCheck[] = bridge
    ? bridge.checks.filter(c => !(input.sessionSwitches && c.id === 'write-switches'))
    : [
        {
          id: 'bridge-checks',
          label: 'Bridge checks',
          status: 'unknown',
          detail: malformed
            ? "The bridge answered without a list of checks. Does its version match the dashboard's?"
            : `The bridge did not answer: ${bridgeError ?? 'no result'}. Is Claude Desktop running?`,
        },
      ];
  checks.push(
    readyCheck(input.sessionSwitches, input.gmActionsEnabled),
    foundryAddressCheck(input.foundryUrl),
    await playerPageCheck(input)
  );
  const vault = playerVaultCheck(input);
  if (vault) checks.push(vault);
  return {
    ready: bridge !== null && !checks.some(c => c.status === 'fail'),
    checks,
    scan: bridge?.scan ?? null,
    bridgeVersion: bridge?.bridgeVersion ?? '',
    moduleVersion: bridge?.moduleVersion ?? null,
  };
}
