// Pre-flight (I-068): the checks before the players join. The tool's own checks come from
// `GET /api/preflight` (preflight.ts: the bridge's get-preflight list plus Turn on for tonight and
// the /player secret-terms check); the hand checklist stays in this browser, under the same
// localStorage key as the old page, so ticks carry over between the two pages. This file holds what
// the first paint needs (button, banner, quiet run); the drawer is its own chunk (PreflightDrawer).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, type JSX } from 'react';

import { api } from '../lib/api';
import { PREFLIGHT_QUIET_DELAY_MS, runQuietPreflight } from '../lib/preflightQuiet';
import { useBridgeStatus } from '../lib/stream';
import { Button } from '../ui';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'info' | 'unknown';

export interface PreflightCheck {
  id: string;
  label: string;
  status: string;
  detail: string;
}

export interface PreflightScan {
  settings?: { setting: string; masked: string; reason: string }[];
  names?: { kind: string; name: string; terms?: string[] }[];
  modules?: { title: string; reason: string }[];
}

interface PreflightResult {
  ready: boolean;
  checks: PreflightCheck[];
  scan: PreflightScan | null;
}

export const PREFLIGHT_KEY = ['preflight'] as const;

export const PREFLIGHT_ICONS: Record<CheckStatus, string> = {
  ok: '✓',
  warn: '!',
  fail: '✗',
  info: 'i',
  unknown: '?',
};

export const fetchPreflight = (): Promise<PreflightResult> =>
  api<PreflightResult>('/api/preflight');

/** The last run's result; runs only when asked (the drawer, or Foundry coming back). */
export function usePreflightResult(): ReturnType<typeof useQuery<PreflightResult>> {
  return useQuery({
    queryKey: PREFLIGHT_KEY,
    queryFn: fetchPreflight,
    enabled: false,
    retry: false,
    staleTime: Infinity,
  });
}

export function statusOf(check: PreflightCheck): CheckStatus {
  return check.status in PREFLIGHT_ICONS ? (check.status as CheckStatus) : 'unknown';
}

export function counts(result: PreflightResult): { fails: number; warns: number } {
  return {
    fails: result.checks.filter(c => c.status === 'fail').length,
    warns: result.checks.filter(c => c.status === 'warn').length,
  };
}

/**
 * Runs the checks quietly each time Foundry becomes reachable (also on the first status after
 * the page loads), so the header button and the version banner are current. Mounted in App.
 */
export function usePreflightOnReconnect(): void {
  const queryClient = useQueryClient();
  const foundry = useBridgeStatus()?.foundry;
  const wasReachable = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const reachable = foundry === 'reachable';
    if (reachable && !wasReachable.current) {
      // A quiet run: a failure leaves the last result as it was. It waits a moment so the
      // panels' own first reads (the visible part of the page) get the bridge first.
      clearTimeout(timer.current);
      timer.current = setTimeout(
        () => runQuietPreflight(queryClient, PREFLIGHT_KEY, fetchPreflight),
        PREFLIGHT_QUIET_DELAY_MS
      );
    } else if (!reachable) {
      clearTimeout(timer.current);
    }
    wasReachable.current = reachable;
  }, [foundry, queryClient]);
  // Only on unmount (a dev double mount must not drop a timer the effect above just set).
  useEffect(() => (): void => clearTimeout(timer.current), []);
}

/** The header button: it shows the last run's verdict. */
export function PreflightButton({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}): JSX.Element {
  const { data } = usePreflightResult();
  const fails = data ? counts(data).fails : 0;
  const label = !data
    ? '✈ Pre-flight'
    : fails > 0
      ? `✈ Pre-flight: ${fails} to fix`
      : '✈ Pre-flight: ready';
  return (
    <Button
      id="btn-preflight"
      className={fails > 0 ? 'preflight-bad' : undefined}
      data-track="dash.header.preflight"
      title="Pre-flight check before the players join (GM only)"
      aria-expanded={open}
      onClick={onToggle}
    >
      {label}
    </Button>
  );
}

/** The page-wide warning when the bridge, module and dashboard versions do not match. */
export function VersionBanner(): JSX.Element | null {
  const { data } = usePreflightResult();
  const versions = data?.checks.find(c => c.id === 'versions');
  if (versions?.status !== 'fail') return null;
  return (
    <div className="link-banner" id="version-banner" role="alert">
      {versions.detail}
    </div>
  );
}
