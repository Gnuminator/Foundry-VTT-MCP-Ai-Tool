import type { QueryClient, QueryKey } from '@tanstack/react-query';

/** How long the quiet run on reconnect waits after the page loads. */
export const PREFLIGHT_QUIET_DELAY_MS = 2_000;

/**
 * The delayed quiet pre-flight run. The Pre-flight drawer (docked in Before) may have run it
 * meanwhile: a run that is fetching, or that finished within the delay, is not repeated.
 */
export function runQuietPreflight<T>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  fetcher: () => Promise<T>
): void {
  const state = queryClient.getQueryState(queryKey);
  if (state?.fetchStatus === 'fetching') return;
  if (state?.dataUpdatedAt && Date.now() - state.dataUpdatedAt < PREFLIGHT_QUIET_DELAY_MS) return;
  queryClient.fetchQuery({ queryKey, queryFn: fetcher, staleTime: 0 }).catch(() => undefined);
}
