// The live stream (/api/stream, sse.ts on the server): one EventSource for the whole page, as the
// old page has. Each event the new page uses lands in the TanStack Query cache under its own key,
// so a panel reads it like any other query and re-renders when it changes. EventSource reconnects
// by itself; the server replays what a new connection needs (status, recent errors, ...).
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { streamUrl } from './auth';

/** One Foundry module error or warning (feed/types.ts ModuleError on the server). */
export interface ModuleError {
  id: string;
  timestampMs: number;
  level: 'error' | 'warn';
  message: string;
  stack: string | null;
  /** "module:<id>", "system:<id>" or "world:<id>" from the stack, or null. */
  module: string | null;
}

/** The errors this page has seen, newest first, with counts since the page loaded. */
export interface ModuleErrorLog {
  entries: ModuleError[];
  errors: number;
  warns: number;
}

/** The bridge link (feed/types.ts BridgeStatus on the server). */
export interface BridgeStatus {
  controlChannel: 'connected' | 'disconnected';
  foundry: 'reachable' | 'unreachable' | 'unknown';
  lastError: string | null;
  lastPollAt: string | null;
  foundryDownSince: string | null;
}

export const BRIDGE_STATUS_KEY = ['stream', 'status'] as const;

/** The dashboard's own settings (app.ts settingsPayload, GM only); fields the page uses so far. */
export interface DashboardSettings {
  gmActionsEnabled: boolean;
}

export const SETTINGS_KEY = ['stream', 'settings'] as const;

/** The old page keeps 150 entries on screen; the server keeps the newest 100. */
export const MAX_ERROR_ENTRIES = 150;

export const MODULE_ERRORS_KEY = ['stream', 'errors'] as const;
const EMPTY_LOG: ModuleErrorLog = { entries: [], errors: 0, warns: 0 };

/** Adds a batch to the log: unseen ids only, newest first, capped. */
export function addModuleErrors(log: ModuleErrorLog, batch: ModuleError[]): ModuleErrorLog {
  const seen = new Set(log.entries.map(e => e.id));
  const fresh = batch.filter(e => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
  if (fresh.length === 0) return log;
  const warns = fresh.filter(e => e.level === 'warn').length;
  return {
    entries: [...fresh.reverse(), ...log.entries].slice(0, MAX_ERROR_ENTRIES),
    errors: log.errors + fresh.length - warns,
    warns: log.warns + warns,
  };
}

function onErrors(queryClient: QueryClient, data: unknown): void {
  const batch = (data as { errors?: unknown }).errors;
  if (!Array.isArray(batch)) return;
  queryClient.setQueryData<ModuleErrorLog>(MODULE_ERRORS_KEY, log =>
    addModuleErrors(log ?? EMPTY_LOG, batch as ModuleError[])
  );
}

/** One handler per event this page uses; each puts the event into the query cache. */
const HANDLERS: Record<string, (queryClient: QueryClient, data: unknown) => void> = {
  errors: onErrors,
  status: (queryClient, data) =>
    queryClient.setQueryData<BridgeStatus>(BRIDGE_STATUS_KEY, data as BridgeStatus),
  settings: (queryClient, data) =>
    queryClient.setQueryData<DashboardSettings>(SETTINGS_KEY, data as DashboardSettings),
};

/** Opens the stream while the page is open. Mounted once, in App. */
export function useDashboardStream(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const source = new EventSource(streamUrl());
    for (const [event, handle] of Object.entries(HANDLERS)) {
      source.addEventListener(event, e => {
        try {
          handle(queryClient, JSON.parse((e as MessageEvent<string>).data));
        } catch {
          // A broken event is skipped; the next one carries on.
        }
      });
    }
    return () => source.close();
  }, [queryClient]);
}

/**
 * The module errors the stream has brought so far. They live only in the query cache (the server
 * replays its buffer on connect, not on demand), so a queryClient.clear() empties the pane until
 * the next errors event or reconnect.
 */
export function useModuleErrors(): ModuleErrorLog {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: MODULE_ERRORS_KEY,
    // Filled by the stream, never fetched: read what is there.
    queryFn: () => queryClient.getQueryData<ModuleErrorLog>(MODULE_ERRORS_KEY) ?? EMPTY_LOG,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return data ?? EMPTY_LOG;
}

/** The bridge link as the stream last reported it; undefined until the first status event. */
export function useBridgeStatus(): BridgeStatus | undefined {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: BRIDGE_STATUS_KEY,
    queryFn: () => queryClient.getQueryData<BridgeStatus>(BRIDGE_STATUS_KEY) ?? null,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return data ?? undefined;
}

/** The dashboard settings as the stream last sent them; undefined until the first one. */
export function useDashboardSettings(): DashboardSettings | undefined {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => queryClient.getQueryData<DashboardSettings>(SETTINGS_KEY) ?? null,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return data ?? undefined;
}
