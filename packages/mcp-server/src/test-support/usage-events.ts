import type { UsageEvent } from '@gnuminator/shared';

let counter = 0;

/** A valid usage event; `key` and `seq` are unique per call unless given. */
export function usageEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
  counter += 1;
  const clientId = overrides.clientId ?? 'client-a';
  const seq = overrides.seq ?? counter;
  return {
    v: 1,
    key: `${clientId}:${seq}`,
    t: new Date(2026, 8, 28, 20, 0, 0).getTime(),
    seq,
    clientId,
    surface: 'dashboard',
    kind: 'action',
    name: 'dash.tarokka.roll',
    who: { role: 'gm', userId: 'u-gm', name: 'Gamemaster' },
    ...overrides,
  };
}
