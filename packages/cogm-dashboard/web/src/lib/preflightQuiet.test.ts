import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runQuietPreflight } from './preflightQuiet';

const KEY = ['preflight'];
const RESULT = { ready: true, checks: [], scan: null };

afterEach(() => {
  vi.useRealTimers();
});

describe('the delayed quiet pre-flight', () => {
  it('runs when nothing ran or is running', () => {
    const client = new QueryClient();
    const fetcher = vi.fn().mockResolvedValue(RESULT);
    runQuietPreflight(client, KEY, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('skips when the drawer is already running it', () => {
    const client = new QueryClient();
    void client.fetchQuery({ queryKey: KEY, queryFn: () => new Promise(() => undefined) });
    const fetcher = vi.fn().mockResolvedValue(RESULT);
    runQuietPreflight(client, KEY, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('skips when a run finished a moment ago, and runs again once it is old', () => {
    vi.useFakeTimers();
    const client = new QueryClient();
    client.setQueryData(KEY, RESULT);
    const fetcher = vi.fn().mockResolvedValue(RESULT);
    runQuietPreflight(client, KEY, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_500);
    runQuietPreflight(client, KEY, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
