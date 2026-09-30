/**
 * Dashboard pre-flight (I-068): the bridge's `get-preflight` checklist plus the
 * two checks only the dashboard can make: GM Actions off, and the `/player`
 * page free of secret terms. Read-only.
 */
import type { PreflightCheck, PreflightChecksResult } from '@gnuminator/shared';

/** The checks this file adds to the bridge's list. */
export type DashboardPreflightCheckId = 'gm-actions' | 'player-page' | 'bridge-checks';

export interface DashboardPreflightCheck extends Omit<PreflightCheck, 'id'> {
  id: PreflightCheck['id'] | DashboardPreflightCheckId;
}

export interface DashboardPreflightResult extends Omit<PreflightChecksResult, 'checks'> {
  checks: DashboardPreflightCheck[];
}

export interface DashboardPreflightInput {
  callTool: <T>(name: string, args?: Record<string, unknown>) => Promise<T>;
  gmActionsEnabled: boolean;
  /** What `/api/player/state` would send right now (with handouts). */
  playerState: unknown;
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

function gmActionsCheck(enabled: boolean): DashboardPreflightCheck {
  return enabled
    ? {
        id: 'gm-actions',
        label: 'GM Actions off',
        status: 'warn',
        detail: 'GM Actions are on. Turn them off in the header until you act from the dashboard.',
      }
    : { id: 'gm-actions', label: 'GM Actions off', status: 'ok', detail: 'GM Actions are off.' };
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
  const checks: DashboardPreflightCheck[] = bridge
    ? [...bridge.checks]
    : [
        {
          id: 'bridge-checks',
          label: 'Bridge checks',
          status: 'unknown',
          detail: `The bridge did not answer: ${bridgeError ?? 'no result'}. Is Claude Desktop running?`,
        },
      ];
  checks.push(gmActionsCheck(input.gmActionsEnabled), await playerPageCheck(input));
  return {
    ready: bridge !== null && !checks.some(c => c.status === 'fail'),
    checks,
    scan: bridge?.scan ?? null,
    bridgeVersion: bridge?.bridgeVersion ?? '',
    moduleVersion: bridge?.moduleVersion ?? null,
  };
}
