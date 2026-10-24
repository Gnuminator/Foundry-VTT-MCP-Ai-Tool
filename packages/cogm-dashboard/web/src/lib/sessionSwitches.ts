// Turn on for tonight's switches (`/api/session/switches`): the module's write switches that one
// click turns on for tonight, and the dashboard's GM Actions. Shared by the Ready block in
// Pre-flight and by the header's End session, which turns them off again as the old page did.
import type { QueryClient } from '@tanstack/react-query';

import { SETTINGS_KEY, type DashboardSettings } from './stream';

export interface SessionSwitch {
  id: string;
  name: string;
  on: boolean;
}

/** The module's answer (session-switches.ts SessionSwitches on the server). */
export interface SessionSwitches {
  switches: SessionSwitch[];
  /** What Ready turned on and when, or null when the world is not "ready". */
  ready: { at: number; turnedOn: string[] } | null;
  changed: string[];
  failed: string[];
}

export interface SwitchesRead {
  switches: SessionSwitches | null;
  gmActionsEnabled: boolean;
  error: string | null;
}

export interface SwitchesWrite {
  ok: boolean;
  switches: SessionSwitches | null;
  gmActionsEnabled: boolean;
  gmActionsChanged: boolean;
}

export type SwitchAction = 'ready' | 'end';

export const SWITCHES_KEY = ['session-switches'] as const;

/** "AI Tool: Handouts (writes)" reads "Handouts (writes)" on the chips and in toasts. */
export const shortName = (name: string): string => name.replace(/^AI Tool: /, '');

export function switchNames(list: SessionSwitch[], ids: string[]): string[] {
  return ids.map(id => shortName(list.find(s => s.id === id)?.name ?? id));
}

/**
 * What a switches write changed, in the caches and in the toasts: the read the Ready block shows,
 * GM Actions in the stream's settings, and the lines "Turn on for tonight. Turned on: ..." or
 * "Turned off again: ...", plus the switches Foundry did not change.
 */
export function applySwitchesWrite(
  queryClient: QueryClient,
  toast: (text: string, kind: 'ok' | 'err') => void,
  data: SwitchesWrite,
  action: SwitchAction
): void {
  const before = queryClient.getQueryData<SwitchesRead>(SWITCHES_KEY);
  queryClient.setQueryData<SwitchesRead>(SWITCHES_KEY, old => ({
    switches: data.switches ?? old?.switches ?? null,
    gmActionsEnabled: data.gmActionsEnabled,
    error: null,
  }));
  queryClient.setQueryData<DashboardSettings>(SETTINGS_KEY, old => ({
    ...old,
    gmActionsEnabled: data.gmActionsEnabled,
  }));
  const all = data.switches?.switches ?? before?.switches?.switches ?? [];
  const changed = switchNames(all, data.switches?.changed ?? []);
  if (data.gmActionsChanged) changed.push('GM Actions');
  const failed = switchNames(all, data.switches?.failed ?? []);
  if (action === 'ready') {
    toast(
      changed.length > 0
        ? `✓ Turn on for tonight. Turned on: ${changed.join(', ')}`
        : '✓ Already on',
      'ok'
    );
  } else if (changed.length > 0) {
    toast(`✓ Turned off again: ${changed.join(', ')}`, 'ok');
  }
  if (failed.length > 0) {
    toast(`✗ Foundry did not change: ${failed.join(', ')}. Check the module settings.`, 'err');
  }
}
