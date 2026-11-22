/**
 * Who uses what (D-146, item `who-uses-what`): one row per person from counts the server already
 * keeps. Names, versions, tool names and counts only; never typed text, arguments or results.
 *
 * Sources: the tool call log (`_usage/<date>.calls.jsonl`, with who), the client file
 * (`_usage/clients.json`, which version each piece runs), and the usage log events (dashboard,
 * player page and Foundry module controls, with who).
 */
import { promises as fsp } from 'fs';
import * as path from 'path';

import { isClientBehind, type UsageEvent } from '@gnuminator/shared';

import { TOOL_CALL_LOG_DIR, type ToolCallLine } from './tool-call-log.js';

const CLIENTS_FILE = 'clients.json';
const CALLS_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.calls\.jsonl$/;
const MAX_CLIENT_ENTRIES = 200;
const TOP = 5;

type ClientPieceName = 'connectors' | 'claude' | 'player-extension' | 'obsidian';

interface ClientEntry {
  piece: ClientPieceName;
  /** `gm` or a Foundry user id. */
  who: string;
  /** A short random install id (Obsidian plugin per PC), or empty. */
  install: string;
  version: string | null;
  /** The Claude client's own name (clientInfo), for `claude`; empty otherwise. */
  name: string;
  lastSeen: number;
}

const WHO_RE = /^[A-Za-z0-9-]{1,40}$/;
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,39}$/;
const NAME_RE = /^[A-Za-z0-9 ._()-]{0,40}$/;

const PIECES: readonly string[] = ['connectors', 'claude', 'player-extension', 'obsidian'];

/** What the server keeps of who runs which version, a small JSON file that survives restarts. */
export class ClientsFile {
  private entries = new Map<string, ClientEntry>();
  private loaded = false;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly file: string;

  constructor(
    dataDir: string,
    private readonly enabled = true
  ) {
    this.file = path.join(dataDir, TOOL_CALL_LOG_DIR, CLIENTS_FILE);
  }

  private static key(e: Pick<ClientEntry, 'piece' | 'who' | 'install'>): string {
    return `${e.piece}\u0000${e.who}\u0000${e.install}`;
  }

  /** Validate and store one sighting. Resolves to false when the input is not usable. */
  record(raw: unknown, now: number = Date.now()): Promise<boolean> {
    if (!this.enabled || raw === null || typeof raw !== 'object') return Promise.resolve(false);
    const r = raw as Record<string, unknown>;
    const piece = typeof r.piece === 'string' && PIECES.includes(r.piece) ? r.piece : null;
    const who = typeof r.who === 'string' && WHO_RE.test(r.who) ? r.who : null;
    if (!piece || !who) return Promise.resolve(false);
    const install = typeof r.install === 'string' && WHO_RE.test(r.install) ? r.install : '';
    const version =
      typeof r.version === 'string' && VERSION_RE.test(r.version.replace(/^v/, ''))
        ? r.version.replace(/^v/, '')
        : null;
    const name = typeof r.name === 'string' && NAME_RE.test(r.name) ? r.name : '';
    const entry: ClientEntry = {
      piece: piece as ClientPieceName,
      who,
      install,
      version,
      name,
      lastSeen: now,
    };
    return this.enqueue(async () => {
      await this.load();
      const key = ClientsFile.key(entry);
      const before = this.entries.get(key);
      // Same version seen within the last minute: keep the file quiet.
      if (before?.version === version && before.name === name && now - before.lastSeen < 60_000) {
        return true;
      }
      this.entries.delete(key);
      this.entries.set(key, entry);
      while (this.entries.size > MAX_CLIENT_ENTRIES) {
        const oldest = this.entries.keys().next().value;
        if (oldest === undefined) break;
        this.entries.delete(oldest);
      }
      await this.save();
      return true;
    }).catch(() => false);
  }

  async list(): Promise<ClientEntry[]> {
    try {
      await this.queue;
      await this.load();
    } catch {
      // an unreadable file reads as empty
    }
    return [...this.entries.values()];
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = JSON.parse(await fsp.readFile(this.file, 'utf8')) as { entries?: unknown };
      if (Array.isArray(parsed.entries)) {
        for (const e of parsed.entries.slice(0, MAX_CLIENT_ENTRIES)) {
          const c = e as Partial<ClientEntry> | null;
          if (!c || typeof c.piece !== 'string' || !PIECES.includes(c.piece)) continue;
          if (typeof c.who !== 'string' || typeof c.lastSeen !== 'number') continue;
          const entry: ClientEntry = {
            piece: c.piece,
            who: c.who,
            install: typeof c.install === 'string' ? c.install : '',
            version: typeof c.version === 'string' ? c.version : null,
            name: typeof c.name === 'string' ? c.name : '',
            lastSeen: c.lastSeen,
          };
          this.entries.set(ClientsFile.key(entry), entry);
        }
      }
    } catch {
      // first run or a damaged file: start empty
    }
  }

  private async save(): Promise<void> {
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify({ entries: [...this.entries.values()] }), 'utf8');
    await fsp.rename(tmp, this.file);
  }
}

/** The call lines of the last `days` local dates, oldest first; unreadable lines are skipped. */
export async function readCallLines(
  dataDir: string,
  days: number,
  now: number = Date.now()
): Promise<ToolCallLine[]> {
  const dir = path.join(dataDir, TOOL_CALL_LOG_DIR);
  const files = (await fsp.readdir(dir).catch(() => [] as string[]))
    .filter(f => CALLS_FILE_RE.test(f))
    .sort();
  const since = now - days * 86_400_000;
  const out: ToolCallLine[] = [];
  for (const file of files.slice(-Math.max(1, days + 1))) {
    const text = await fsp.readFile(path.join(dir, file), 'utf8').catch(() => '');
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const l = JSON.parse(line) as ToolCallLine;
        if (typeof l?.tool === 'string' && typeof l.t === 'string' && Date.parse(l.t) >= since) {
          out.push(l);
        }
      } catch {
        // a torn line
      }
    }
  }
  return out;
}

interface WhoRow {
  /** `gm` or a Foundry user id, or `unknown` for lines from before callers were logged. */
  key: string;
  role: 'gm' | 'player' | 'unknown';
  name: string | null;
  /** Every logged call, Claude's and the dashboard's together (the old field). */
  calls: number;
  /** Every failed call, whatever the cause (the old field). */
  errors: number;
  /** Calls people made through Claude (a connector), without the dashboard's own refreshes. */
  claudeCalls: number;
  /** Calls the dashboard made by itself (its refresh timers and buttons). */
  dashboardCalls: number;
  /** Failures that are not a Foundry-down window: the ones worth looking at. */
  realErrors: number;
  lastSeen: string | null;
  /** Top tools by calls made through Claude (dashboard refreshes left out). */
  topTools: Array<{ name: string; calls: number }>;
  /** Top tools the dashboard called by itself. */
  dashboardTools: Array<{ name: string; calls: number }>;
  skills: Array<{ skill: string; stub: number | null; calls: number }>;
  /** Dashboard, player page and Foundry module controls (usage log). */
  controls: { events: number; top: Array<{ name: string; uses: number }> };
  versions: Array<{
    piece: ClientPieceName;
    install: string;
    name: string;
    version: string | null;
    behind: boolean;
    lastSeen: string;
  }>;
}

interface WhoUsesWhatReport {
  schema: 1;
  generatedAt: string;
  days: number;
  current: string;
  people: WhoRow[];
  tools: {
    used: number;
    neverCalled: string[] | null;
    /** Tools with real failures only (Foundry-down failures are left out). */
    errorRates: Array<{ name: string; calls: number; errors: number }>;
  };
  /** Failed calls grouped by cause. Absent in reports from before this field existed. */
  errorCauses: ErrorCauses;
}

interface DownWindow {
  from: string;
  to: string;
  /** Failed calls inside the window. */
  calls: number;
}

interface ErrorCauses {
  total: number;
  /** Foundry was down or not linked: runs of immediate failures, or the not-connected class. */
  foundryDown: { calls: number; windows: DownWindow[] };
  /** Everything else, by logged error class (`unclassified` for lines from before classes). */
  real: Array<{ cause: string; calls: number }>;
}

/** A failure that came back at once with nothing in it: the backend could not reach Foundry. */
function isImmediateFailure(c: ToolCallLine): boolean {
  return !c.ok && c.ms <= 50 && c.size === 0 && (c.err === undefined || c.err === 'not-connected');
}

const DOWN_GAP_MS = 120_000;
const DOWN_MIN_RUN = 3;

/**
 * Mark the failed calls that belong to a Foundry-down window: a run of at least three immediate
 * failures with no more than two minutes between neighbours (the dashboard polls every few
 * seconds, so a real outage makes a dense run). Lines with the `not-connected` class count
 * whatever the run.
 */
export function findDownWindows(calls: readonly ToolCallLine[]): {
  down: Set<ToolCallLine>;
  windows: DownWindow[];
} {
  const down = new Set<ToolCallLine>();
  const windows: DownWindow[] = [];
  const imm = calls
    .filter(isImmediateFailure)
    .map(c => ({ c, ts: Date.parse(c.t) }))
    .filter(x => Number.isFinite(x.ts))
    .sort((a, b) => a.ts - b.ts);
  let run: typeof imm = [];
  const flush = (): void => {
    if (run.length >= DOWN_MIN_RUN) {
      for (const x of run) down.add(x.c);
      windows.push({
        from: new Date(run[0]!.ts).toISOString(),
        to: new Date(run[run.length - 1]!.ts).toISOString(),
        calls: run.length,
      });
    }
    run = [];
  };
  for (const x of imm) {
    if (run.length > 0 && x.ts - run[run.length - 1]!.ts > DOWN_GAP_MS) flush();
    run.push(x);
  }
  flush();
  for (const c of calls) if (!c.ok && c.err === 'not-connected') down.add(c);
  return { down, windows };
}

function topN<T extends { n: number; name: string }>(
  map: Map<string, number>,
  make: (name: string, n: number) => T
): T[] {
  return [...map.entries()]
    .map(([name, n]) => make(name, n))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
    .slice(0, TOP);
}

interface WhoUsesWhatDeps {
  dataDir: string;
  clients: Pick<ClientsFile, 'list'>;
  /** Usage events of the current world (empty when none is known). */
  usageEvents: () => Promise<UsageEvent[]>;
  toolNames: () => string[];
  current: string;
}

/** The control method `who_uses_what` (`{days?}` to the report). */
export async function handleWhoUsesWhat(
  deps: WhoUsesWhatDeps,
  params: unknown
): Promise<WhoUsesWhatReport> {
  const asked = Number((params as { days?: unknown } | null | undefined)?.days);
  const days = Number.isFinite(asked) ? Math.min(90, Math.max(1, Math.round(asked))) : 7;
  const [calls, clients, usageEvents] = await Promise.all([
    readCallLines(deps.dataDir, days),
    deps.clients.list(),
    deps.usageEvents().catch(() => [] as UsageEvent[]),
  ]);
  const since = Date.now() - days * 86_400_000;
  // A player's name comes from the usage log (the player page asks for it once).
  const names = new Map<string, string>();
  for (const e of usageEvents) if (e.who.userId && e.who.name) names.set(e.who.userId, e.who.name);
  return buildWhoUsesWhat({
    calls,
    clients,
    usageEvents: usageEvents.filter(e => e.t >= since),
    toolNames: deps.toolNames(),
    names,
    current: deps.current,
    days,
  });
}

export function buildWhoUsesWhat(input: {
  calls: readonly ToolCallLine[];
  clients: readonly ClientEntry[];
  usageEvents: readonly UsageEvent[];
  toolNames: readonly string[] | null;
  names?: ReadonlyMap<string, string>;
  current: string;
  days: number;
  now?: number;
}): WhoUsesWhatReport {
  const now = input.now ?? Date.now();
  const rows = new Map<string, WhoRow>();
  const perTool = new Map<string, Map<string, number>>();
  const perSkill = new Map<
    string,
    Map<string, { skill: string; stub: number | null; calls: number }>
  >();
  const perControl = new Map<string, Map<string, number>>();
  const toolTotals = new Map<string, { calls: number; errors: number }>();
  const perDashTool = new Map<string, Map<string, number>>();
  const { down, windows } = findDownWindows(input.calls);
  const realCauses = new Map<string, number>();
  let errorTotal = 0;
  let downCalls = 0;

  const row = (key: string, role: WhoRow['role'], name: string | null): WhoRow => {
    let r = rows.get(key);
    if (!r) {
      r = {
        key,
        role,
        name: name ?? input.names?.get(key) ?? null,
        calls: 0,
        errors: 0,
        claudeCalls: 0,
        dashboardCalls: 0,
        realErrors: 0,
        lastSeen: null,
        topTools: [],
        dashboardTools: [],
        skills: [],
        controls: { events: 0, top: [] },
        versions: [],
      };
      rows.set(key, r);
    }
    if (!r.name && name) r.name = name;
    return r;
  };
  const later = (a: string | null, t: string): string => (a === null || t > a ? t : a);

  for (const c of input.calls) {
    const key = c.who === 'gm' ? 'gm' : c.who === 'player' && c.userId ? c.userId : 'unknown';
    const r = row(key, c.who === 'gm' ? 'gm' : c.who === 'player' ? 'player' : 'unknown', null);
    r.calls += 1;
    r.lastSeen = later(r.lastSeen, c.t);
    const viaDashboard = c.via === 'dashboard';
    if (viaDashboard) r.dashboardCalls += 1;
    else r.claudeCalls += 1;
    const toolMap = viaDashboard ? perDashTool : perTool;
    const tools = toolMap.get(key) ?? new Map<string, number>();
    tools.set(c.tool, (tools.get(c.tool) ?? 0) + 1);
    toolMap.set(key, tools);
    const t = toolTotals.get(c.tool) ?? { calls: 0, errors: 0 };
    t.calls += 1;
    if (!c.ok) {
      r.errors += 1;
      errorTotal += 1;
      if (down.has(c)) {
        downCalls += 1;
      } else {
        r.realErrors += 1;
        t.errors += 1;
        const cause = c.err ?? 'unclassified';
        realCauses.set(cause, (realCauses.get(cause) ?? 0) + 1);
      }
    }
    toolTotals.set(c.tool, t);
    if (c.skill) {
      const skills =
        perSkill.get(key) ??
        new Map<string, { skill: string; stub: number | null; calls: number }>();
      const sk = `${c.skill}\u0000${c.stub ?? ''}`;
      const s = skills.get(sk) ?? { skill: c.skill, stub: c.stub ?? null, calls: 0 };
      s.calls += 1;
      skills.set(sk, s);
      perSkill.set(key, skills);
    }
  }

  for (const e of input.usageEvents) {
    const key = e.who.role === 'gm' ? 'gm' : (e.who.userId ?? 'unknown');
    const r = row(
      key,
      e.who.role === 'gm' ? 'gm' : e.who.userId ? 'player' : 'unknown',
      e.who.name
    );
    const n = e.count ?? 1;
    r.controls.events += n;
    const m = perControl.get(key) ?? new Map<string, number>();
    m.set(e.name, (m.get(e.name) ?? 0) + n);
    perControl.set(key, m);
    r.lastSeen = later(r.lastSeen, new Date(e.t).toISOString());
  }

  for (const c of input.clients) {
    const key = c.who === 'gm' ? 'gm' : c.who;
    const r = row(key, key === 'gm' ? 'gm' : 'player', null);
    r.versions.push({
      piece: c.piece,
      install: c.install,
      name: c.name,
      version: c.version,
      // Only our own pieces are compared with the Pi's version; the Claude client has its own numbers.
      behind: c.piece === 'claude' ? false : isClientBehind(c.version, input.current),
      lastSeen: new Date(c.lastSeen).toISOString(),
    });
    r.lastSeen = later(r.lastSeen, new Date(c.lastSeen).toISOString());
  }

  for (const [key, r] of rows) {
    r.topTools = topN(perTool.get(key) ?? new Map<string, number>(), (name, n) => ({
      name,
      calls: n,
      n,
    })).map(({ name, calls }) => ({ name, calls }));
    r.dashboardTools = topN(perDashTool.get(key) ?? new Map<string, number>(), (name, n) => ({
      name,
      calls: n,
      n,
    })).map(({ name, calls }) => ({ name, calls }));
    r.skills = [...(perSkill.get(key)?.values() ?? [])].sort(
      (a, b) => b.calls - a.calls || a.skill.localeCompare(b.skill)
    );
    r.controls.top = topN(perControl.get(key) ?? new Map<string, number>(), (name, n) => ({
      name,
      uses: n,
      n,
    })).map(({ name, uses }) => ({ name, uses }));
    r.versions.sort((a, b) => a.piece.localeCompare(b.piece) || a.install.localeCompare(b.install));
  }

  const people = [...rows.values()].sort(
    (a, b) =>
      (a.role === 'gm' ? -1 : b.role === 'gm' ? 1 : 0) ||
      b.calls - a.calls ||
      a.key.localeCompare(b.key)
  );
  const used = new Set(toolTotals.keys());
  return {
    schema: 1,
    generatedAt: new Date(now).toISOString(),
    days: input.days,
    current: input.current,
    people,
    tools: {
      used: used.size,
      neverCalled: input.toolNames ? input.toolNames.filter(n => !used.has(n)).sort() : null,
      errorRates: [...toolTotals.entries()]
        .filter(([, v]) => v.errors > 0)
        .map(([name, v]) => ({ name, calls: v.calls, errors: v.errors }))
        .sort((a, b) => b.errors / b.calls - a.errors / a.calls || a.name.localeCompare(b.name))
        .slice(0, 20),
    },
    errorCauses: {
      total: errorTotal,
      foundryDown: { calls: downCalls, windows },
      real: [...realCauses.entries()]
        .map(([cause, n]) => ({ cause, calls: n }))
        .sort((a, b) => b.calls - a.calls || a.cause.localeCompare(b.cause)),
    },
  };
}
