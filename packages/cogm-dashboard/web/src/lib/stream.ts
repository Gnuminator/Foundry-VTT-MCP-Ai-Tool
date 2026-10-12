// The live stream (/api/stream, sse.ts on the server): one EventSource for the whole page, as the
// old page has. Each event the new page uses lands in the TanStack Query cache under its own key,
// so a panel reads it like any other query and re-renders when it changes. EventSource reconnects
// by itself; the server replays what a new connection needs (status, recent errors, ...).
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { streamUrl } from './auth';
import { bridgeAway, readCombat, type CombatState } from './combat';
import { onPrefs } from './prefs';

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
  /** The Obsidian vault the "Open in Obsidian" links point into; null when the mirror is off. */
  obsidian?: { vault: string } | null;
}

export const SETTINGS_KEY = ['stream', 'settings'] as const;

/** The Foundry world (app.ts world event, GM only); null while Foundry is not reachable. */
export interface WorldInfo {
  id: string;
  title?: string;
}

export const WORLD_KEY = ['stream', 'world'] as const;

/** The fight the stream last reported (`combat`, GM only, `{combat}`); null when none is active. */
export type { CombatState } from './combat';

export const COMBAT_KEY = ['stream', 'combat'] as const;

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

/**
 * The Handouts drawer's data, under GAME_STATE_KEY (guarded.ts) so an apply or an undo refetches
 * it too. Spelled out here because guarded.ts imports this file.
 */
export const HANDOUTS_KEY = ['game', 'handouts'] as const;

/** The Tarokka drawer's reading, under GAME_STATE_KEY for the same reason. */
export const TAROKKA_KEY = ['game', 'tarokka'] as const;

/** One handler per event this page uses; each puts the event into the query cache. */
const HANDLERS: Record<string, (queryClient: QueryClient, data: unknown) => void> = {
  errors: onErrors,
  // A player opened a handout for the first time (GM only, no payload): the drawer reloads its
  // seen ticks when it is open. A closed drawer loads afresh on its next opening anyway.
  'handouts-seen': queryClient => void queryClient.invalidateQueries({ queryKey: HANDOUTS_KEY }),
  status: (queryClient, data) =>
    queryClient.setQueryData<BridgeStatus>(BRIDGE_STATUS_KEY, data as BridgeStatus),
  settings: (queryClient, data) =>
    queryClient.setQueryData<DashboardSettings>(SETTINGS_KEY, data as DashboardSettings),
  world: (queryClient, data) =>
    queryClient.setQueryData<WorldInfo | null>(WORLD_KEY, (data as WorldInfo | null) ?? null),
  // The GM's screen choices for this world (lib/prefs.ts).
  prefs: onPrefs,
  // The whole fight (lib/combat.ts), null when none runs: the During layouts and the strip read it.
  combat: (queryClient, data) => {
    const combat = readCombat((data as { combat?: unknown } | null)?.combat);
    queryClient.setQueryData<CombatState | null>(COMBAT_KEY, () => combat);
  },
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

/** The world as the stream last reported it; null until the first world event or while away. */
export function useWorld(): WorldInfo | null {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: WORLD_KEY,
    queryFn: () => queryClient.getQueryData<WorldInfo | null>(WORLD_KEY) ?? null,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return data ?? null;
}

/** The fight as the stream last said, in the bridge's order; null when none runs. */
export function useCombat(): CombatState | null {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: COMBAT_KEY,
    queryFn: () => queryClient.getQueryData<CombatState | null>(COMBAT_KEY) ?? null,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return data ?? null;
}

/** Whether a fight is running, as the stream last said; false until it says. */
export function useCombatActive(): boolean {
  return useCombat()?.active === true;
}

/** Whether the bridge is away, as the stream's status last said (false before the first one). */
export function useBridgeAway(): boolean {
  return bridgeAway(useBridgeStatus());
}

/**
 * An obsidian:// link to a note in this world's folder of the vault (the old page's
 * obsidianFileUrl), or null until both the vault name and the world id are known.
 */
export function useObsidianFileUrl(relativePath: string): string | null {
  const vault = useDashboardSettings()?.obsidian?.vault;
  const worldId = useWorld()?.id;
  if (!vault || !worldId) return null;
  const file = `Campaigns/${worldId}/${relativePath}`;
  return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(file)}`;
}
