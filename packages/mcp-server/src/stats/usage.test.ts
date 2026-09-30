import type { UsageCatalogEntry, UsageEvent } from '@gnuminator/shared';
import { describe, expect, it } from 'vitest';

import { usageEvent } from '../test-support/usage-events.js';

import { buildUsageModel } from './usage.js';

const T = new Date(2026, 8, 28, 20, 0, 0).getTime();
const MIN = 60_000;

const GM = { role: 'gm', userId: 'u-gm', name: 'Gamemaster' } as const;
const ADA = { role: 'player', userId: 'u-ada', name: 'Ada' } as const;

const CATALOG: UsageCatalogEntry[] = [
  { name: 'dash.tarokka.roll', kind: 'action', surface: 'dashboard', file: 'a.js' },
  { name: 'dash.tarokka.reveal', kind: 'action', surface: 'dashboard', file: 'a.js' },
  { name: 'dash.main.view', kind: 'view', surface: 'dashboard', file: 'a.js' },
  { name: 'dash.toast.error', kind: 'error', surface: 'dashboard', file: 'a.js' },
  { name: 'player.handouts.open', kind: 'action', surface: 'player', file: 'p.js' },
  { name: 'module.chat.roll-button', kind: 'action', surface: 'module', file: 'm.ts' },
];

const SESSIONS = [
  {
    label: '2026-09-28 S01',
    startedAt: new Date(T).toISOString(),
    endedAt: new Date(T + 60 * MIN).toISOString(),
  },
];

function events(): UsageEvent[] {
  return [
    usageEvent({ t: T + MIN, name: 'dash.tarokka.roll', who: GM, count: 3 }),
    usageEvent({
      t: T + 2 * MIN,
      name: 'dash.main.view',
      kind: 'view',
      who: GM,
      durationMs: 90_000,
    }),
    usageEvent({
      t: T + 3 * MIN,
      name: 'tool.get-world-info',
      kind: 'tool',
      who: GM,
      outcome: 'ok',
    }),
    usageEvent({
      t: T + 4 * MIN,
      name: 'tool.get-world-info',
      kind: 'tool',
      who: GM,
      outcome: 'error',
      code: 'timeout',
    }),
    usageEvent({
      t: T + 5 * MIN,
      surface: 'player',
      name: 'player.handouts.open',
      who: ADA,
    }),
    usageEvent({ t: T + 6 * MIN, name: 'dash.toast.error', kind: 'error', who: GM, code: '403' }),
    usageEvent({ t: T + 7 * MIN, name: 'dash.old.thing', who: GM }),
    // Outside the play session (the next day).
    usageEvent({ t: T + 24 * 60 * MIN, name: 'dash.tarokka.roll', who: ADA }),
  ];
}

describe('buildUsageModel', () => {
  const model = buildUsageModel({
    events: events(),
    catalog: CATALOG,
    toolNames: ['get-world-info', 'list-scenes'],
    sessions: SESSIONS,
  });

  it('gives period and totals (count merges repeats)', () => {
    expect(model.period).toEqual({ firstDay: '2026-09-28', lastDay: '2026-09-29', days: 2 });
    expect(model.totals).toEqual({
      events: 10,
      views: 1,
      actions: 6,
      tools: 2,
      shortcuts: 0,
      errors: 1,
      people: 2,
      timeOnViewMs: 90_000,
    });
  });

  it('ranks most used by uses, then name, with the people who used each', () => {
    expect(model.mostUsed[0]).toEqual({
      name: 'dash.tarokka.roll',
      kind: 'action',
      uses: 4,
      people: ['Ada', 'Gamemaster'],
    });
    expect(model.mostUsed.map(m => m.name)).toEqual([
      'dash.tarokka.roll',
      'tool.get-world-info',
      'dash.main.view',
      'dash.old.thing',
      'player.handouts.open',
    ]);
  });

  it('limits most used to 20', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      usageEvent({ t: T, name: `dash.many.c${String(i).padStart(2, '0')}` })
    );
    const m = buildUsageModel({ events: many, catalog: [], toolNames: null, sessions: [] });
    expect(m.mostUsed).toHaveLength(20);
  });

  it('lists catalogue controls never used by surface, and tools never run', () => {
    expect(model.neverUsed.bySurface.dashboard).toEqual([
      { name: 'dash.tarokka.reveal', kind: 'action' },
    ]);
    expect(model.neverUsed.bySurface.player).toEqual([]);
    expect(model.neverUsed.bySurface.module).toEqual([
      { name: 'module.chat.roll-button', kind: 'action' },
    ]);
    expect(model.neverUsed.tools).toEqual(['list-scenes']);
  });

  it('leaves the tool list out when none is given and then treats every tool as known', () => {
    const m = buildUsageModel({
      events: events(),
      catalog: CATALOG,
      toolNames: null,
      sessions: [],
    });
    expect(m.neverUsed.tools).toBeNull();
    expect(m.unknown.map(u => u.name)).toEqual(['dash.old.thing']);
  });

  it('summarizes each person with their top three', () => {
    const gm = model.people.find(p => p.name === 'Gamemaster');
    expect(gm).toMatchObject({ role: 'gm', views: 1, timeOnViewMs: 90_000, actions: 4, tools: 2 });
    expect(gm?.top).toEqual([
      { name: 'dash.tarokka.roll', uses: 3 },
      { name: 'tool.get-world-info', uses: 2 },
      { name: 'dash.main.view', uses: 1 },
    ]);
    expect(model.people.map(p => p.name)).toEqual(['Ada', 'Gamemaster']);
  });

  it('assigns events to play sessions by start and end, the rest to outside', () => {
    expect(model.sessions).toEqual([
      { label: '2026-09-28 S01', events: 9, people: 2, views: 1, actions: 5, tools: 2, errors: 1 },
      { label: null, events: 1, people: 1, views: 0, actions: 1, tools: 0, errors: 0 },
    ]);
  });

  it('counts errors by name and code (failed tool runs too)', () => {
    expect(model.errors).toEqual([
      { name: 'dash.toast.error', code: '403', count: 1 },
      { name: 'tool.get-world-info', code: 'timeout', count: 1 },
    ]);
  });

  it('lists names seen but not in the catalogue', () => {
    expect(model.unknown).toEqual([{ name: 'dash.old.thing', uses: 1 }]);
  });

  it('keys people by user id, then name, then role', () => {
    const m = buildUsageModel({
      events: [
        usageEvent({ t: T, who: { role: 'player', userId: null, name: 'Bo' } }),
        usageEvent({ t: T, who: { role: 'player', userId: null, name: null } }),
        usageEvent({ t: T, who: { role: 'gm', userId: null, name: null } }),
      ],
      catalog: CATALOG,
      toolNames: null,
      sessions: [],
    });
    expect(m.people.map(p => p.name)).toEqual(['Bo', 'GM', 'Unknown player']);
  });

  it('is empty and stable without events', () => {
    const m = buildUsageModel({ events: [], catalog: CATALOG, toolNames: [], sessions: [] });
    expect(m.period).toEqual({ firstDay: null, lastDay: null, days: 0 });
    expect(m.totals.events).toBe(0);
    expect(m.neverUsed.bySurface.dashboard).toHaveLength(4);
    expect(m.lastEventAt).toBeNull();
  });
});
