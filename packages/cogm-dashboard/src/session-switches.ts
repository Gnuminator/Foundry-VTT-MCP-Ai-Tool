/**
 * Ready for session (D3, PB-17), the dashboard's half. The module keeps the switches and
 * what Ready turned on (`sessionSwitches` query, reached through the bridge's control method
 * `session_switches`, never an MCP tool); the dashboard adds its own GM Actions switch and
 * turns the result into the pre-flight row.
 */
import type { DashboardPreflightCheck } from './preflight.js';

export type SessionSwitchAction = 'get' | 'ready' | 'end';

export function isSessionSwitchAction(value: unknown): value is SessionSwitchAction {
  return value === 'get' || value === 'ready' || value === 'end';
}

export interface SessionSwitch {
  id: string;
  name: string;
  on: boolean;
}

export interface SessionSwitches {
  switches: SessionSwitch[];
  /** What Ready turned on and when, or null when the world is not "ready". */
  ready: { at: number; turnedOn: string[] } | null;
  changed: string[];
  failed: string[];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** The module's answer, checked; null when it is not one (an old module, an error object). */
export function parseSessionSwitches(raw: unknown): SessionSwitches | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.switches)) return null;
  const switches: SessionSwitch[] = [];
  for (const s of r.switches as unknown[]) {
    if (!s || typeof s !== 'object') continue;
    const { id, name, on } = s as Record<string, unknown>;
    if (typeof id !== 'string') continue;
    switches.push({ id, name: typeof name === 'string' ? name : id, on: on === true });
  }
  let ready: SessionSwitches['ready'] = null;
  if (r.ready && typeof r.ready === 'object') {
    const rr = r.ready as Record<string, unknown>;
    ready = { at: typeof rr.at === 'number' ? rr.at : 0, turnedOn: strings(rr.turnedOn) };
  }
  return { switches, ready, changed: strings(r.changed), failed: strings(r.failed) };
}

/**
 * The pre-flight row: ok once every switch and GM Actions are on, a warning before that
 * (the mockup's "The tool may not change anything yet"). Without an answer from the module
 * (an older module) it falls back to the GM Actions row alone.
 */
export function readyCheck(
  state: SessionSwitches | null,
  gmActionsEnabled: boolean
): DashboardPreflightCheck {
  const label = 'Ready for session';
  if (!state) {
    return {
      id: 'ready',
      label,
      status: gmActionsEnabled ? 'ok' : 'warn',
      detail: gmActionsEnabled
        ? 'GM Actions are on. This module is too old to report its switches.'
        : 'GM Actions are off. This module is too old to report its switches.',
    };
  }
  const off = state.switches.filter(s => !s.on).map(s => s.name);
  if (!gmActionsEnabled) off.push('GM Actions');
  if (off.length === 0) {
    return {
      id: 'ready',
      label,
      status: 'ok',
      detail: 'Everything tonight needs is on. Every change can still be undone.',
    };
  }
  return {
    id: 'ready',
    label,
    status: 'warn',
    detail: `The tool may not change anything yet (off: ${off.join(', ')}). Ready for session turns on what tonight needs.`,
  };
}
