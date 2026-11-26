/**
 * Keepsake ledgers (item `keepsake-ledgers`): a short list a player picks for their character that
 * fills itself from the play log. Three kinds:
 *
 * - `names`: every named creature that "went down" in the public log, with the date (a book of the
 *   names of the dead). The player log only holds NPC events whose token players could see, under
 *   the name players know it by, so an unrevealed creature never reaches this list.
 * - `count`: how many log events of one type happened (a prayer per long rest, once the module
 *   logs rests; an event type with no events counts zero).
 * - `purse`: the character's net coin change from the allowed play stats.
 *
 * Inputs are only player-safe data (projected events, `PlayerStats`), so `/me` and the vault note
 * render the same ledger. The rules are the player's own words and live in a small JSON store,
 * like the diaries.
 */
import crypto from 'crypto';
import { promises as fsp, readFileSync } from 'fs';
import * as path from 'path';

import type { PlayerStats } from './stats.js';
import type { VaultSession } from './types.js';

export type KeepsakeKind = 'names' | 'count' | 'purse';

export interface KeepsakeRule {
  id: string;
  /** The character the keepsake belongs to (matched by name for the purse). */
  character: string;
  kind: KeepsakeKind;
  /** The player's words for it: "The book of the names of the dead". */
  title: string;
  /** `count` only: the log event type counted. */
  eventType?: string;
  /** `count` only: what one tick is called ("prayers"). */
  unit?: string;
}

export interface KeepsakeLine {
  /** Local `YYYY-MM-DD`, or null for a line with no date (the purse). */
  date: string | null;
  text: string;
}

export interface KeepsakeLedger {
  id: string;
  character: string;
  kind: KeepsakeKind;
  title: string;
  /** One line that says where the ledger stands. */
  summary: string;
  lines: KeepsakeLine[];
}

/** The event types a count may use: only types the player projection can produce. */
export const KEEPSAKE_EVENT_TYPES = [
  'rest',
  'death',
  'stabilize',
  'combat-start',
  'combat-end',
  'item-use',
] as const;

const TITLE_MAX = 60;
const UNIT_MAX = 30;
const NAME_MAX = 80;
const RULES_MAX = 6;
const LINES_MAX = 200;
export const KEEPSAKE_KINDS: readonly KeepsakeKind[] = ['names', 'count', 'purse'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** The player-facing line of an NPC death: "<name> went down." (a PC's line is not a keepsake). */
const WENT_DOWN = /^(.{1,120}) went down\.$/;

function namesLedger(rule: KeepsakeRule, sessions: VaultSession[]): KeepsakeLedger {
  const lines: KeepsakeLine[] = [];
  for (const session of sessions) {
    for (const event of session.events) {
      if (event.type !== 'death') continue;
      const name = WENT_DOWN.exec(event.text)?.[1]?.trim();
      if (!name) continue;
      lines.push({ date: localDay(event.timestampMs), text: name });
    }
  }
  const shown = lines.slice(-LINES_MAX);
  return {
    id: rule.id,
    character: rule.character,
    kind: 'names',
    title: rule.title,
    summary:
      lines.length === 0
        ? 'No names yet.'
        : `${lines.length} name${lines.length === 1 ? '' : 's'}.`,
    lines: shown,
  };
}

function countLedger(rule: KeepsakeRule, sessions: VaultSession[]): KeepsakeLedger {
  const type = rule.eventType ?? 'rest';
  const dates: string[] = [];
  for (const session of sessions) {
    for (const event of session.events) {
      if (event.type === type) dates.push(localDay(event.timestampMs));
    }
  }
  const unit = rule.unit || 'times';
  const last = dates[dates.length - 1];
  return {
    id: rule.id,
    character: rule.character,
    kind: 'count',
    title: rule.title,
    summary: `${dates.length} ${unit}${last ? `, the last on ${last}` : ''}.`,
    lines: [],
  };
}

function purseLedger(rule: KeepsakeRule, stats: PlayerStats | null): KeepsakeLedger {
  const pc = stats?.pcs.find(p => p.name === rule.character);
  const lines: KeepsakeLine[] = [];
  for (const [coin, n] of Object.entries(pc?.currencyDelta ?? {})) {
    lines.push({ date: null, text: `${n > 0 ? '+' : ''}${n} ${coin}` });
  }
  return {
    id: rule.id,
    character: rule.character,
    kind: 'purse',
    title: rule.title,
    summary:
      lines.length === 0 ? 'No coin won or lost yet.' : `${lines.map(l => l.text).join(', ')}.`,
    lines,
  };
}

/** The ledgers of one player's rules, from the public log and the allowed stats. */
export function buildKeepsakeLedgers(
  rules: readonly KeepsakeRule[],
  sessions: VaultSession[],
  stats: PlayerStats | null
): KeepsakeLedger[] {
  return rules.map(rule =>
    rule.kind === 'names'
      ? namesLedger(rule, sessions)
      : rule.kind === 'count'
        ? countLedger(rule, sessions)
        : purseLedger(rule, stats)
  );
}

interface KeepsakeFile {
  worlds: Record<string, Record<string, KeepsakeRule[]>>;
}

interface KeepsakeStoreLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

type KeepsakeSaveResult =
  | { ok: true; rule: KeepsakeRule }
  | { ok: false; code: 'bad-kind' | 'no-title' | 'bad-event' | 'full' };

const ID_RE = /^[A-Za-z0-9_-]{12}$/;
const USER_ID_RE = /^[A-Za-z0-9]{16}$/;

function validRule(r: unknown): r is KeepsakeRule {
  const v = r as Partial<KeepsakeRule> | null;
  return (
    !!v &&
    ID_RE.test(v.id ?? '') &&
    typeof v.character === 'string' &&
    typeof v.title === 'string' &&
    KEEPSAKE_KINDS.includes(v.kind as KeepsakeKind)
  );
}

export class KeepsakeStore {
  private readonly worlds = new Map<string, Map<string, KeepsakeRule[]>>();
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: string | null,
    private readonly logger?: KeepsakeStoreLogger
  ) {
    if (!file) return;
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<KeepsakeFile>;
      for (const [world, users] of Object.entries(parsed.worlds ?? {})) {
        const map = new Map<string, KeepsakeRule[]>();
        for (const [userId, rules] of Object.entries(users ?? {})) {
          if (USER_ID_RE.test(userId) && Array.isArray(rules))
            map.set(userId, rules.filter(validRule));
        }
        this.worlds.set(world, map);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger?.warn('Keepsake file unreadable; starting without keepsakes', {
          file,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  get persistent(): boolean {
    return this.file !== null;
  }

  list(worldId: string, userId: string): KeepsakeRule[] {
    return [...(this.worlds.get(worldId)?.get(userId) ?? [])];
  }

  /** Add a keepsake (a player picks it; the words are theirs, trimmed and capped). */
  add(
    worldId: string,
    userId: string,
    input: {
      character?: unknown;
      kind?: unknown;
      title?: unknown;
      eventType?: unknown;
      unit?: unknown;
    }
  ): KeepsakeSaveResult {
    const kind = KEEPSAKE_KINDS.find(k => k === input.kind);
    if (!kind) return { ok: false, code: 'bad-kind' };
    const title = typeof input.title === 'string' ? input.title.trim().slice(0, TITLE_MAX) : '';
    if (!title) return { ok: false, code: 'no-title' };
    const character =
      typeof input.character === 'string' ? input.character.trim().slice(0, NAME_MAX) : '';
    const rule: KeepsakeRule = {
      id: crypto.randomBytes(9).toString('base64url'),
      character,
      kind,
      title,
    };
    if (kind === 'count') {
      const type = typeof input.eventType === 'string' ? input.eventType : 'rest';
      if (!(KEEPSAKE_EVENT_TYPES as readonly string[]).includes(type)) {
        return { ok: false, code: 'bad-event' };
      }
      rule.eventType = type;
      const unit = typeof input.unit === 'string' ? input.unit.trim().slice(0, UNIT_MAX) : '';
      if (unit) rule.unit = unit;
    }
    let users = this.worlds.get(worldId);
    if (!users) this.worlds.set(worldId, (users = new Map<string, KeepsakeRule[]>()));
    const rules = users.get(userId) ?? [];
    if (rules.length >= RULES_MAX) return { ok: false, code: 'full' };
    rules.push(rule);
    users.set(userId, rules);
    this.persist();
    return { ok: true, rule };
  }

  remove(worldId: string, userId: string, id: string): boolean {
    const users = this.worlds.get(worldId);
    const rules = users?.get(userId);
    if (!users || !rules) return false;
    const next = rules.filter(r => r.id !== id);
    if (next.length === rules.length) return false;
    users.set(userId, next);
    this.persist();
    return true;
  }

  private persist(): void {
    const file = this.file;
    if (!file) return;
    const out: KeepsakeFile = { worlds: {} };
    for (const [world, users] of this.worlds) out.worlds[world] = Object.fromEntries(users);
    const json = JSON.stringify(out);
    this.writing = this.writing
      .then(async () => {
        await fsp.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        await fsp.writeFile(tmp, json, 'utf8');
        await fsp.rename(tmp, file);
      })
      .catch(error => {
        this.logger?.warn('Could not save the keepsakes', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  flush(): Promise<void> {
    return this.writing;
  }
}
