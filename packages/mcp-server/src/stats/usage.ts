/**
 * Usage statistics (I-084, `docs/design/USAGE-LOG.md`): a pure, deterministic
 * model built from the day files `sessions/<date>.usage.jsonl`, the generated
 * control catalogue, the MCP tool list and the play sessions. Nothing here is
 * stored as truth; the Obsidian note `AI Tool/Usage/Dashboard usage.md` is
 * rendered from it (`obsidian/render-usage.ts`).
 *
 * Rules: names go through `canonicalUsageName` first (renamed controls keep
 * their history); an event counts `count ?? 1` times; `tool.<name>` events are
 * tool runs of the dashboard's tool runner, known when `<name>` is in the MCP
 * tool list (when no list is given, every tool name counts as known and the
 * "tools never run" list is left out).
 */
import {
  canonicalUsageName,
  type UsageCatalogEntry,
  type UsageEvent,
  type UsageKind,
  type UsageSurface,
} from '@gnuminator/shared';

import { localDateKey } from '../event-pump.js';

/** A play session as the usage model needs it (a slice of `SessionStats`). */
export interface UsageSessionRef {
  label: string;
  startedAt: string;
  endedAt: string;
}

export interface UsageMostUsed {
  name: string;
  kind: UsageKind;
  uses: number;
  /** Display names of the people who used it, sorted. */
  people: string[];
}

export interface UsageNeverUsedEntry {
  name: string;
  kind: UsageKind;
}

export interface UsagePerson {
  key: string;
  name: string;
  role: 'gm' | 'player';
  /** View reports (each merged repeat counts). */
  views: number;
  timeOnViewMs: number;
  actions: number;
  tools: number;
  /** Up to three most used names with their counts. */
  top: Array<{ name: string; uses: number }>;
}

export interface UsageSessionRow {
  /** The play session's label (`<date> S<NN>`), or null for events outside every session. */
  label: string | null;
  events: number;
  people: number;
  views: number;
  actions: number;
  tools: number;
  errors: number;
}

export interface UsageErrorRow {
  name: string;
  code: string;
  count: number;
}

export interface UsageUnknownRow {
  name: string;
  uses: number;
}

export interface UsageModel {
  schema: 1;
  period: { firstDay: string | null; lastDay: string | null; days: number };
  /** Newest event time (epoch ms), or null. */
  lastEventAt: number | null;
  totals: {
    events: number;
    views: number;
    actions: number;
    tools: number;
    shortcuts: number;
    errors: number;
    people: number;
    timeOnViewMs: number;
  };
  mostUsed: UsageMostUsed[];
  neverUsed: {
    /** Catalogue entries never seen, by surface (sorted by name). */
    bySurface: Record<UsageSurface, UsageNeverUsedEntry[]>;
    /** MCP tools never run from the dashboard's tool runner; null when no tool list was given. */
    tools: string[] | null;
  };
  people: UsagePerson[];
  sessions: UsageSessionRow[];
  errors: UsageErrorRow[];
  unknown: UsageUnknownRow[];
}

export const USAGE_MOST_USED_LIMIT = 20;

const SURFACES: readonly UsageSurface[] = ['dashboard', 'player', 'module'];

function uses(event: UsageEvent): number {
  return event.count ?? 1;
}

function personKey(event: UsageEvent): string {
  const { who } = event;
  if (who.userId) return `id:${who.userId}`;
  if (who.name) return `name:${who.name}`;
  return `role:${who.role}`;
}

function personName(event: UsageEvent): string {
  const { who } = event;
  if (who.name) return who.name;
  return who.role === 'gm' ? 'GM' : 'Unknown player';
}

function byUsesThenName<T extends { uses: number; name: string }>(a: T, b: T): number {
  return b.uses - a.uses || a.name.localeCompare(b.name);
}

export function buildUsageModel(input: {
  events: readonly UsageEvent[];
  catalog: readonly UsageCatalogEntry[];
  toolNames: readonly string[] | null;
  sessions: readonly UsageSessionRef[];
}): UsageModel {
  const toolSet = input.toolNames ? new Set(input.toolNames) : null;
  const events = input.events
    .map(e => ({ ...e, name: canonicalUsageName(e.name) }))
    .sort((a, b) => a.t - b.t || a.key.localeCompare(b.key));

  const totals = {
    events: 0,
    views: 0,
    actions: 0,
    tools: 0,
    shortcuts: 0,
    errors: 0,
    people: 0,
    timeOnViewMs: 0,
  };
  const days = new Set<string>();
  const peopleSeen = new Set<string>();
  let lastEventAt: number | null = null;

  const byName = new Map<string, { kind: UsageKind; uses: number; people: Map<string, string> }>();
  const persons = new Map<
    string,
    { person: UsagePerson; names: Map<string, number>; role: 'gm' | 'player' }
  >();
  const errorRows = new Map<string, UsageErrorRow>();
  const seenNames = new Set<string>();

  const sessionWindows = input.sessions
    .map(s => ({ label: s.label, from: Date.parse(s.startedAt), to: Date.parse(s.endedAt) }))
    .filter(s => Number.isFinite(s.from) && Number.isFinite(s.to))
    .sort((a, b) => a.from - b.from);
  const sessionRows = new Map<string | null, { row: UsageSessionRow; people: Set<string> }>();
  const sessionRow = (label: string | null): { row: UsageSessionRow; people: Set<string> } => {
    let entry = sessionRows.get(label);
    if (!entry) {
      entry = {
        row: { label, events: 0, people: 0, views: 0, actions: 0, tools: 0, errors: 0 },
        people: new Set(),
      };
      sessionRows.set(label, entry);
    }
    return entry;
  };

  for (const event of events) {
    const n = uses(event);
    totals.events += n;
    days.add(localDateKey(event.t));
    lastEventAt = Math.max(lastEventAt ?? 0, event.t);
    seenNames.add(event.name);
    const key = personKey(event);
    const pname = personName(event);
    peopleSeen.add(key);

    let person = persons.get(key);
    if (!person) {
      person = {
        person: {
          key,
          name: pname,
          role: event.who.role,
          views: 0,
          timeOnViewMs: 0,
          actions: 0,
          tools: 0,
          top: [],
        },
        names: new Map(),
        role: event.who.role,
      };
      persons.set(key, person);
    }

    const window = sessionWindows.find(s => event.t >= s.from && event.t <= s.to);
    const session = sessionRow(window?.label ?? null);
    session.row.events += n;
    session.people.add(key);

    switch (event.kind) {
      case 'view':
        totals.views += n;
        person.person.views += n;
        session.row.views += n;
        totals.timeOnViewMs += event.durationMs ?? 0;
        person.person.timeOnViewMs += event.durationMs ?? 0;
        break;
      case 'action':
        totals.actions += n;
        person.person.actions += n;
        session.row.actions += n;
        break;
      case 'shortcut':
        totals.shortcuts += n;
        person.person.actions += n;
        session.row.actions += n;
        break;
      case 'tool':
        totals.tools += n;
        person.person.tools += n;
        session.row.tools += n;
        break;
      case 'error':
        totals.errors += n;
        session.row.errors += n;
        break;
    }
    if (event.kind === 'error' || (event.kind === 'tool' && event.outcome === 'error')) {
      const code = event.code ?? '-';
      const rowKey = `${event.name}\u0000${code}`;
      const row = errorRows.get(rowKey) ?? { name: event.name, code, count: 0 };
      row.count += n;
      errorRows.set(rowKey, row);
    }

    if (event.kind !== 'error') {
      person.names.set(event.name, (person.names.get(event.name) ?? 0) + n);
      const entry = byName.get(event.name) ?? { kind: event.kind, uses: 0, people: new Map() };
      entry.uses += n;
      entry.people.set(key, pname);
      byName.set(event.name, entry);
    }
  }
  totals.people = peopleSeen.size;

  const mostUsed: UsageMostUsed[] = [...byName.entries()]
    .map(([name, v]) => ({
      name,
      kind: v.kind,
      uses: v.uses,
      people: [...new Set(v.people.values())].sort((a, b) => a.localeCompare(b)),
    }))
    .sort(byUsesThenName)
    .slice(0, USAGE_MOST_USED_LIMIT);

  const bySurface: Record<UsageSurface, UsageNeverUsedEntry[]> = {
    dashboard: [],
    player: [],
    module: [],
  };
  const catalogNames = new Set<string>();
  for (const entry of input.catalog) {
    catalogNames.add(entry.name);
    if (seenNames.has(entry.name)) continue;
    bySurface[entry.surface].push({ name: entry.name, kind: entry.kind });
  }
  for (const surface of SURFACES) {
    const seen = new Set<string>();
    bySurface[surface] = bySurface[surface]
      .filter(e => (seen.has(e.name) ? false : (seen.add(e.name), true)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  let toolsNever: string[] | null = null;
  if (toolSet) {
    const ran = new Set(
      [...seenNames].filter(n => n.startsWith('tool.')).map(n => n.slice('tool.'.length))
    );
    toolsNever = [...toolSet].filter(t => !ran.has(t)).sort((a, b) => a.localeCompare(b));
  }

  const unknownRows = new Map<string, number>();
  for (const event of events) {
    const known = event.name.startsWith('tool.')
      ? toolSet === null || toolSet.has(event.name.slice('tool.'.length))
      : catalogNames.has(event.name);
    if (known) continue;
    unknownRows.set(event.name, (unknownRows.get(event.name) ?? 0) + uses(event));
  }

  const people: UsagePerson[] = [...persons.values()]
    .map(({ person, names }) => ({
      ...person,
      top: [...names.entries()]
        .map(([name, count]) => ({ name, uses: count }))
        .sort(byUsesThenName)
        .slice(0, 3),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));

  const order = new Map(sessionWindows.map((s, i) => [s.label, i]));
  const sessions = [...sessionRows.values()]
    .map(({ row, people: set }) => ({ ...row, people: set.size }))
    .sort((a, b) => {
      if (a.label === null) return 1;
      if (b.label === null) return -1;
      return (order.get(a.label) ?? 0) - (order.get(b.label) ?? 0);
    });

  const dayList = [...days].sort();
  return {
    schema: 1,
    period: {
      firstDay: dayList[0] ?? null,
      lastDay: dayList[dayList.length - 1] ?? null,
      days: dayList.length,
    },
    lastEventAt,
    totals,
    mostUsed,
    neverUsed: { bySurface, tools: toolsNever },
    people,
    sessions,
    errors: [...errorRows.values()].sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name) || a.code.localeCompare(b.code)
    ),
    unknown: [...unknownRows.entries()]
      .map(([name, count]) => ({ name, uses: count }))
      .sort(byUsesThenName),
  };
}
