/**
 * The GM's screen choices for a world (D-092, I-107): which During layout the dashboard uses,
 * whether the combat buttons (Damage / Heal, Condition, Clear) show in the turn-order strip,
 * and how far the layout trial has come. Stored like the theme (theme.ts): one JSON file keyed
 * by world id, so the choice follows the GM to any browser or device. Without a file (tests, or
 * no state folder) the choices live in memory only. Not game state and never sent to players.
 */
import { promises as fsp, readFileSync } from 'fs';
import * as path from 'path';

/** A: layered cards (the default until the GM picks), B: a Simple/Full switch, C: auto. */
export const DURING_LAYOUTS = ['layered', 'toggle', 'auto'] as const;
export type DuringLayout = (typeof DURING_LAYOUTS)[number];

/** How many sessions the quiet "try the other layouts" hint shows on the During screen. */
export const LAYOUT_HINT_SESSIONS = 3;

export interface DashboardPrefs {
  duringLayout: DuringLayout;
  /** Layout B: the Full view instead of Simple. */
  duringFull: boolean;
  /** Damage / Heal, Condition and Clear in the strip; off by default (D-092, Advanced). */
  combatButtons: boolean;
  /** The GM picked a layout in the trial (or with the switcher); the Before card goes away. */
  layoutPicked: boolean;
  /** The During hint was dismissed. */
  hintDismissed: boolean;
  /** Sessions the During hint has shown in, by session start time. */
  hintSessions: string[];
}

export const DEFAULT_PREFS: DashboardPrefs = {
  duringLayout: 'layered',
  duringFull: false,
  combatButtons: false,
  layoutPicked: false,
  hintDismissed: false,
  hintSessions: [],
};

export function isDuringLayout(value: unknown): value is DuringLayout {
  return typeof value === 'string' && (DURING_LAYOUTS as readonly string[]).includes(value);
}

/**
 * The known fields of a change, checked; unknown or wrong-typed fields are dropped.
 * `hintSession` (a session start time) counts a session for the During hint.
 */
export interface PrefsChange {
  duringLayout?: DuringLayout;
  duringFull?: boolean;
  combatButtons?: boolean;
  layoutPicked?: boolean;
  hintDismissed?: boolean;
  hintSession?: string;
}

export function parsePrefsChange(raw: unknown): PrefsChange | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const change: PrefsChange = {};
  if (isDuringLayout(r.duringLayout)) change.duringLayout = r.duringLayout;
  for (const key of ['duringFull', 'combatButtons', 'layoutPicked', 'hintDismissed'] as const) {
    if (typeof r[key] === 'boolean') change[key] = r[key];
  }
  if (typeof r.hintSession === 'string' && r.hintSession.trim() !== '') {
    change.hintSession = r.hintSession.trim().slice(0, 64);
  }
  return Object.keys(change).length > 0 ? change : null;
}

/** A stored entry, checked field by field so an old or hand-edited file cannot break the page. */
function readPrefs(raw: unknown): DashboardPrefs {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    duringLayout: isDuringLayout(r.duringLayout) ? r.duringLayout : DEFAULT_PREFS.duringLayout,
    duringFull: r.duringFull === true,
    combatButtons: r.combatButtons === true,
    layoutPicked: r.layoutPicked === true,
    hintDismissed: r.hintDismissed === true,
    hintSessions: Array.isArray(r.hintSessions)
      ? r.hintSessions
          .filter((s): s is string => typeof s === 'string')
          .slice(0, LAYOUT_HINT_SESSIONS)
      : [],
  };
}

interface PrefsFile {
  worlds: Record<string, DashboardPrefs>;
}

export interface PrefsStoreLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export class DashboardPrefsStore {
  private readonly worlds = new Map<string, DashboardPrefs>();
  /** Writes run one after another: two tabs saving at once must not race on the tmp file. */
  private writing: Promise<void> = Promise.resolve();

  /** @param file the JSON file to persist to, or null to keep the choices in memory only */
  constructor(
    private readonly file: string | null,
    private readonly logger?: PrefsStoreLogger
  ) {
    if (!file) return;
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<PrefsFile>;
      for (const [world, prefs] of Object.entries(parsed.worlds ?? {})) {
        this.worlds.set(world, readPrefs(prefs));
      }
    } catch (error) {
      // A missing file is the normal first start; anything else is worth a line in the log.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger?.warn('Dashboard prefs file unreadable; using the defaults', {
          file,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /** The world's choices, or the defaults before the world is known or anything is chosen. */
  get(worldId: string | null | undefined): DashboardPrefs {
    const stored = worldId ? this.worlds.get(worldId) : undefined;
    return stored
      ? { ...stored, hintSessions: [...stored.hintSessions] }
      : { ...DEFAULT_PREFS, hintSessions: [] };
  }

  /** Apply a change to a world's choices and save them. Resolves to the new choices. */
  async update(worldId: string, change: PrefsChange): Promise<DashboardPrefs> {
    const next = this.get(worldId);
    if (change.duringLayout !== undefined) next.duringLayout = change.duringLayout;
    if (change.duringFull !== undefined) next.duringFull = change.duringFull;
    if (change.combatButtons !== undefined) next.combatButtons = change.combatButtons;
    if (change.layoutPicked !== undefined) next.layoutPicked = change.layoutPicked;
    if (change.hintDismissed !== undefined) next.hintDismissed = change.hintDismissed;
    if (
      change.hintSession !== undefined &&
      !next.hintSessions.includes(change.hintSession) &&
      next.hintSessions.length < LAYOUT_HINT_SESSIONS
    ) {
      next.hintSessions.push(change.hintSession);
    }
    this.worlds.set(worldId, next);
    const write = (): Promise<void> => this.write();
    this.writing = this.writing.then(write, write);
    await this.writing;
    return this.get(worldId);
  }

  /** Save every world's choices as they are now (the newest state wins). */
  private async write(): Promise<void> {
    if (!this.file) return;
    const data: PrefsFile = { worlds: Object.fromEntries(this.worlds) };
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fsp.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await fsp.rename(tmp, this.file);
  }
}
