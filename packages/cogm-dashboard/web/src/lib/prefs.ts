// The GM's screen choices for a world (dashboard-prefs.ts on the server): the During layout,
// whether the layout switch has a Full view, the combat buttons and how far the layout trial has
// come. The server keeps them per world and sends them as the `prefs` stream event (GM only), so
// the old page and this one show the same choice. A change goes to POST /api/control as
// `set-prefs`; the answer is the whole prefs object.
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { api, errorText } from './api';
import {
  applyPrefsChange,
  readPrefs,
  rollBackChange,
  type DuringPrefs,
  type PrefsChange,
} from './prefsModel';

export const PREFS_KEY = ['stream', 'prefs'] as const;

/** The `prefs` stream event: the whole object, put in the cache. */
export function onPrefs(queryClient: QueryClient, data: unknown): void {
  if (!data || typeof data !== 'object') return;
  queryClient.setQueryData<DuringPrefs>(PREFS_KEY, readPrefs(data));
}

/** The prefs as the stream last sent them; undefined until the world is known. */
export function usePrefs(): DuringPrefs | undefined {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: PREFS_KEY,
    queryFn: () => queryClient.getQueryData<DuringPrefs>(PREFS_KEY) ?? null,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return data ?? undefined;
}

export interface SavePrefsOptions {
  /** No error toast when it fails (the hint count). */
  quiet?: boolean;
}

/**
 * Each save gets a number; only the newest save's answer is written to the page. An older answer
 * arriving after a newer change would put the screen back to an older state until the newer
 * answer landed (the server's last answer holds every change it took, so the newest says it all).
 */
let latestSave = 0;

/**
 * Saves a screen choice for this world. The page shows it at once; the server's answer confirms
 * it. When it is not saved (no world yet, the server is away) the fields of that change go back
 * to what they were, unless something newer already changed them, and the page says so, unless
 * the change is quiet. Resolves to whether it was saved.
 */
export function useSavePrefs(
  toast: (text: string, kind: 'err') => void
): (change: PrefsChange, options?: SavePrefsOptions) => Promise<boolean> {
  const queryClient = useQueryClient();
  return useCallback(
    async (change, { quiet = false } = {}) => {
      const save = ++latestSave;
      const before = queryClient.getQueryData<DuringPrefs>(PREFS_KEY);
      const optimistic = before !== undefined && Object.keys(change).some(k => k !== 'hintSession');
      if (before && optimistic) {
        queryClient.setQueryData<DuringPrefs>(PREFS_KEY, applyPrefsChange(before, change));
      }
      try {
        const answer = await api<unknown>('/api/control', {
          method: 'POST',
          body: JSON.stringify({ action: 'set-prefs', value: change }),
        });
        if (save === latestSave) {
          queryClient.setQueryData<DuringPrefs>(PREFS_KEY, readPrefs(answer));
        }
        return true;
      } catch (err) {
        const current = queryClient.getQueryData<DuringPrefs>(PREFS_KEY);
        if (before && current && optimistic) {
          queryClient.setQueryData<DuringPrefs>(PREFS_KEY, rollBackChange(current, before, change));
        }
        if (!quiet) toast(`✗ Could not save the screen choice: ${errorText(err)}`, 'err');
        return false;
      }
    },
    [queryClient, toast]
  );
}
