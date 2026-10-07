/**
 * Change history (I-109 part 2): everyone's recent changes in Foundry, in one place.
 *
 * The change-journal pump (`change-journal-pump.ts`) keeps every journal record in the GM
 * vault, one file per local day. This index holds the last `CHANGE_HISTORY_DAYS` days of
 * them in memory (read from the files on first use, then kept current from the pump's
 * appends) and turns them into ACTIONS: the records one user action made (they share an
 * `actionId`: a long rest writes the actor and every item), with who, when, the "things"
 * touched and readable lines such as `Ireena: HP 10 -> 5`.
 *
 * `list()` merges those human actions with the AI changes of the guarded-write audit log
 * (`listRecentChanges`) into one newest-first list. The journal marks the records an AI
 * guarded write made (`changeId`); those belong to the AI change and are listed from the
 * audit log, never as a human action. Records without the mark in the same burst are the
 * system's own follow-ups when they touch a thing the AI wrote (dnd5e adds Bloodied after an
 * HP change) and belong to the AI change too; on any other thing they are a person's own
 * change made in the same browser within the action gap, split into an action of their own.
 * A failed apply and its rollback (a `changeId` with any `rollback` record) cancel out and are
 * hidden.
 *
 * Read-only. The undo planner (`guarded-write/undo-planner.ts`) reads the actions from here
 * (`humanActions`); `undoBlocker` says which of them can be undone, and `list()` marks what is
 * already undone from the audit log's derived undo state.
 */
import type { ChangeRecord, PathValue } from '@gnuminator/shared';

import {
  CHANGE_JOURNAL_RETENTION_DAYS,
  changeJournalFileName,
  isChangeRecord,
} from './change-journal-pump.js';
import { localDateKey } from './event-pump.js';
import { pathLabel, type RecentChange } from './guarded-write/service.js';
import type { UndoState } from './guarded-write/undo-state.js';
import { actionKey } from './guarded-write/undo-state.js';
import { formatValue } from './guarded-write/values.js';
import type { Logger } from './logger.js';
import type { VaultStore } from './vault/store.js';
import type { WorldIdResolver } from './vault/world-id.js';

/** How many days of changes the index keeps and lists (the pump keeps the files as long). */
export const CHANGE_HISTORY_DAYS = CHANGE_JOURNAL_RETENTION_DAYS;
/** Most readable lines an action carries (the last one says how many more there were). */
export const MAX_ACTION_LINES = 8;
/**
 * Appended to the actionId of a person's records that shared a burst with an AI write but
 * touched other things (see the file comment): their own action, undoable on its own.
 */
export const OWN_ACTION_SUFFIX = ':own';

/** User id to user name, as the journal records have seen them (for ownership lines). */
export type UserNames = ReadonlyMap<string, string>;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ChangeThing {
  uuid: string;
  name: string | null;
}

/** The records one user action made, with a readable description. */
export interface ChangeAction {
  actionId: string;
  /** First record's time and the newest record's time (epoch ms). */
  t: number;
  tEnd: number;
  userId: string | null;
  userName: string | null;
  userIsGM: boolean;
  /** Every visible record of the action, in pump order (AI records included, see `changeId`). */
  records: ChangeRecord[];
  /** The distinct things (`rootUuid`) the records touch. */
  things: ChangeThing[];
  /** Set when any record was made by an AI guarded write. */
  changeId?: string;
  summary: string;
  lines: string[];
}

export interface HumanChangeItem {
  kind: 'human';
  /** `act:<actionId>` */
  id: string;
  /** ISO time of the first change. */
  at: string;
  by: string;
  userId: string | null;
  isGM: boolean;
  summary: string;
  lines: string[];
  things: ChangeThing[];
  records: number;
  /** Not undone yet, and every record needed is there (see `undoBlocker`). */
  canUndo: boolean;
  undone: boolean;
  /** The changeId of the undo entry that undid it. */
  undoneBy?: string;
}

export interface AiChangeItem {
  kind: 'ai';
  /** The audit log's changeId (what `undo-change` takes). */
  id: string;
  at: string;
  by: 'AI';
  requestedBy?: string;
  summary: string;
  lines: string[];
  mode: 'apply' | 'undo';
  feature: string;
  canUndo: boolean;
  undone: boolean;
  undoneBy?: string;
  undoneAt?: string;
  documents?: string[];
  /** For an undo made with plan-undo-changes: how many changes it took back (undoing it brings them all back). */
  covers?: number;
}

export type ChangeListItem = HumanChangeItem | AiChangeItem;

export interface ChangeListOptions {
  limit?: number;
  /** A person matches by user id OR user name (case-insensitive); either one is enough. */
  userId?: string;
  userName?: string;
  /** A document uuid: matches changes to it, to anything below it and to a thing it belongs to. */
  thingUuid?: string;
  source?: 'all' | 'ai' | 'human';
  /** ISO time: only changes at or after it. */
  sinceIso?: string;
}

export interface ChangeListResult {
  changes: ChangeListItem[];
  /** Said when the list may be incomplete or the history is off. */
  note?: string;
}

// ---------------------------------------------------------------------------
// Readable lines

/** Labels for paths the live-play labels (`pathLabel`) do not know: items and effects. */
const EXTRA_LABELS: Array<[RegExp, string]> = [
  [/^system\.quantity$/, 'quantity'],
  [/^system\.uses\.spent$/, 'uses spent'],
  [/^system\.equipped$/, 'equipped'],
  [/^system\.attuned$/, 'attuned'],
  [/^system\.attributes\.hp\.max$/, 'max HP'],
  [/^disabled$/, 'disabled'],
];

const OWNERSHIP_PATH = /^ownership\.([A-Za-z0-9]+)$/;

/** The readable label of a path, or null. With `users`, an ownership line names the user. */
export function labelOf(path: string, users?: UserNames): string | null {
  const owner = OWNERSHIP_PATH.exec(path)?.[1];
  if (owner && owner !== 'default') {
    const name = users?.get(owner);
    if (name) return `ownership for ${name}`;
  }
  const known = pathLabel(path);
  if (known) return known;
  return EXTRA_LABELS.find(([re]) => re.test(path))?.[1] ?? null;
}

const DOCUMENT_LABELS: Record<string, string> = {
  ActiveEffect: 'effect',
  JournalEntry: 'Journal',
  JournalEntryPage: 'Journal page',
  AmbientLight: 'Light',
  AmbientSound: 'Sound',
  MeasuredTemplate: 'Template',
};

function documentLabel(documentName: string): string {
  return DOCUMENT_LABELS[documentName] ?? documentName;
}

function quoted(name: string | null): string {
  return name ? ` "${name}"` : '';
}

/** Who the line is about (`Ireena`, `Token "Wolf 2"`) and, for an embedded document, what part (`Item "Dagger"`). */
function subjectOf(r: ChangeRecord): { subject: string; inner: string } {
  const isRoot = r.uuid === r.rootUuid;
  if (r.documentName === 'Actor') {
    return { subject: (isRoot ? r.name : (r.rootName ?? r.name)) ?? 'Actor', inner: '' };
  }
  if (isRoot) return { subject: `${documentLabel(r.documentName)}${quoted(r.name)}`, inner: '' };
  return {
    // An empty name (older records of a Combat) counts as no name.
    subject: r.rootName !== null && r.rootName !== '' ? r.rootName : rootLabel(r.rootUuid),
    inner: `${documentLabel(r.documentName)}${quoted(r.name)}`,
  };
}

/** A nameless root (a Combat) by its kind, read from its uuid (`Combat.cb1` gives `Combat`). */
function rootLabel(rootUuid: string): string {
  const parts = rootUuid.split('.');
  const kind = parts.length >= 2 ? parts[parts.length - 2] : undefined;
  return kind ? documentLabel(kind) : 'Something';
}

function isEmptyValue(v: PathValue): boolean {
  return !v.present || v.value === null || v.value === 0 || v.value === '';
}

function beforeOf(r: ChangeRecord, path: string): PathValue | undefined {
  return r.before?.find(v => v.path === path);
}

/** The readable lines of one record: one per changed path for an update, one for a create or delete. */
export function describeRecord(r: ChangeRecord, users?: UserNames): string[] {
  const { subject, inner } = subjectOf(r);
  const target = inner ? `${subject}: ${inner}` : subject;

  if (r.op === 'create' || r.op === 'delete') {
    if (r.documentName === 'ActiveEffect') {
      const verb = r.op === 'create' ? 'added' : 'removed';
      return [
        r.rootName
          ? `${r.rootName}: effect${quoted(r.name)} ${verb}`
          : `Effect${quoted(r.name)} ${verb}`,
      ];
    }
    const thing = `${documentLabel(r.documentName)}${quoted(r.name)}`;
    const onRoot = r.uuid !== r.rootUuid && r.rootName ? r.rootName : null;
    if (r.op === 'create') return [`Created ${thing}${onRoot ? ` on ${onRoot}` : ''}`];
    return [`Deleted ${thing}${onRoot ? ` from ${onRoot}` : ''}`];
  }

  if (r.oversize) return [`${target} changed (the details were too large to keep)`];
  const after = r.after ?? [];
  if (after.length > 0 && after.every(a => a.path === 'x' || a.path === 'y')) {
    return [`${target} moved`];
  }
  const prefix = inner ? `${subject}: ${inner} ` : `${subject}: `;
  const lines: string[] = [];
  for (const a of after) {
    const named = labelOf(a.path, users) ?? a.path;
    const before = beforeOf(r, a.path);
    // dnd5e fills empty fields on the way (temp HP null -> 0): no news for the reader.
    if (before && isEmptyValue(before) && isEmptyValue(a)) continue;
    lines.push(
      before
        ? `${prefix}${named} ${formatValue(before)} -> ${formatValue(a)}`
        : `${prefix}${named} now ${formatValue(a)}`
    );
  }
  if (lines.length === 0) {
    for (const path of r.unknownBefore ?? [])
      lines.push(`${prefix}${labelOf(path, users) ?? path} changed`);
  }
  return lines.length > 0 ? lines : [`${target} changed`];
}

/** One sentence for the whole action, and at most MAX_ACTION_LINES lines. */
export function summarizeLines(all: string[]): { summary: string; lines: string[] } {
  const first = all[0] ?? 'Changed something';
  const more = all.length - 1;
  const summary = more > 0 ? `${first} and ${more} more change${more === 1 ? '' : 's'}` : first;
  const lines =
    all.length > MAX_ACTION_LINES
      ? [
          ...all.slice(0, MAX_ACTION_LINES - 1),
          `and ${all.length - (MAX_ACTION_LINES - 1)} more changes`,
        ]
      : all;
  return { summary, lines };
}

// ---------------------------------------------------------------------------
// Actions

/** A record of an update that can be put back: it has at least one recorded `before` value. */
function recordUndoable(r: ChangeRecord): boolean {
  if (r.op === 'create') return true;
  if (r.op === 'delete') return !!r.data;
  return (r.before?.length ?? 0) > 0;
}

/**
 * Why people's change cannot be undone, or null when it can: some record was too large to keep,
 * or nothing in it has the old values (the AI's own records belong to the audit entry).
 */
export function undoBlocker(action: ChangeAction): string | null {
  const records = action.records.filter(r => !r.changeId);
  if (records.length === 0) return 'the AI made it; undo it by its change id';
  if (records.some(r => r.oversize)) {
    return 'part of it was too large to keep, so it cannot be put back exactly';
  }
  if (!records.some(recordUndoable)) return 'the values before it were not recorded';
  return null;
}

/**
 * Group records into actions by `actionId` (records keep their order; actions are in the
 * order of their first record). Records of a guarded write that was rolled back are left out.
 * In a burst with an AI write, a person's records on things the AI did not touch become an
 * action of their own (`<actionId>:own`, right after the AI's).
 */
export function buildActions(records: ChangeRecord[], users?: UserNames): ChangeAction[] {
  const rolledBack = new Set<string>();
  for (const r of records)
    if (r.changeId && r.changeMode === 'rollback') rolledBack.add(r.changeId);

  const groups = new Map<string, ChangeRecord[]>();
  for (const r of records) {
    if (r.changeId && rolledBack.has(r.changeId)) continue;
    const group = groups.get(r.actionId);
    if (group) group.push(r);
    else groups.set(r.actionId, [r]);
  }

  const split: Array<[string, ChangeRecord[]]> = [];
  for (const [actionId, group] of groups) {
    const aiRoots = new Set(group.filter(r => r.changeId).map(r => r.rootUuid));
    if (aiRoots.size === 0) {
      split.push([actionId, group]);
      continue;
    }
    const own = group.filter(r => !r.changeId && !aiRoots.has(r.rootUuid));
    split.push([actionId, own.length > 0 ? group.filter(r => !own.includes(r)) : group]);
    if (own.length > 0) split.push([`${actionId}${OWN_ACTION_SUFFIX}`, own]);
  }

  const actions: ChangeAction[] = [];
  for (const [actionId, group] of split) {
    const first = group[0];
    const things = new Map<string, ChangeThing>();
    for (const r of group) {
      if (!things.has(r.rootUuid)) things.set(r.rootUuid, { uuid: r.rootUuid, name: r.rootName });
    }
    const changeId = group.find(r => r.changeId)?.changeId;
    // The text describes what people did: the AI's own records are listed from the audit log.
    const { summary, lines } = summarizeLines(
      group.filter(r => !r.changeId).flatMap(r => describeRecord(r, users))
    );
    actions.push({
      actionId,
      t: first.t,
      tEnd: group.reduce((max, r) => Math.max(max, r.t), first.t),
      userId: first.userId,
      userName: first.userName,
      userIsGM: first.userIsGM,
      records: group,
      things: [...things.values()],
      ...(changeId ? { changeId } : {}),
      summary,
      lines,
    });
  }
  return actions;
}

// ---------------------------------------------------------------------------
// The index

interface WorldIndex {
  records: ChangeRecord[];
  keys: Set<string>;
  /** Every user the records have named, by id (kept through pruning: names stay useful). */
  users: Map<string, string>;
  /** Set while the files are being read; appends that arrive meanwhile wait in `pending`. */
  loading: Promise<void> | null;
  pending: ChangeRecord[];
  actions: ChangeAction[] | null;
}

export interface ChangeHistoryOptions {
  store: VaultStore;
  worldIds: Pick<WorldIdResolver, 'current'>;
  guardedWrites: {
    listRecentChanges(limit?: number): Promise<RecentChange[]>;
    undoState(): Promise<UndoState>;
  };
  logger: Logger;
  /** Fetch the newest journal records first (the pump's `pullNow`); absent when the journal is off. */
  pullNow?: () => Promise<void>;
  now?: () => number;
}

export class ChangeHistory {
  private readonly store: VaultStore;
  private readonly worldIds: ChangeHistoryOptions['worldIds'];
  private readonly guardedWrites: ChangeHistoryOptions['guardedWrites'];
  private readonly logger: Logger;
  private readonly pullNow: ChangeHistoryOptions['pullNow'];
  private readonly now: () => number;
  private readonly worlds = new Map<string, WorldIndex>();

  constructor(options: ChangeHistoryOptions) {
    this.store = options.store;
    this.worldIds = options.worldIds;
    this.guardedWrites = options.guardedWrites;
    this.logger = options.logger.child({ component: 'ChangeHistory' });
    this.pullNow = options.pullNow;
    this.now = options.now ?? ((): number => Date.now());
  }

  /** The pump's `onAppended`: add what it just wrote. Ignored until the first read loaded the files. */
  addRecords(worldId: string, records: ChangeRecord[]): void {
    const index = this.worlds.get(worldId);
    if (!index) return; // the first read will find these in the files
    if (index.loading) index.pending.push(...records);
    else this.ingest(index, records);
  }

  /** People's actions of the last days (not the AI's), oldest first, after fetching the newest records. */
  async humanActions(): Promise<ChangeAction[]> {
    await this.pull([]);
    const worldId = await this.worldIds.current();
    // Same rule as `list()`: an action with an AI record is the AI change's.
    return (await this.actionsFor(worldId)).filter(a => !a.changeId);
  }

  /** User names by id, as seen in the records of the current world (no pull). */
  async userNames(): Promise<UserNames> {
    const worldId = await this.worldIds.current();
    return (await this.load(worldId)).users;
  }

  /** Fetch the newest journal records; says in `notes` when that did not work. */
  private async pull(notes: string[]): Promise<void> {
    if (this.pullNow) {
      try {
        await this.pullNow();
      } catch (error) {
        this.logger.warn('Change history could not pull the newest records', {
          error: error instanceof Error ? error.message : String(error),
        });
        notes.push('The newest changes may be missing: Foundry could not be asked just now.');
      }
    } else {
      notes.push(
        'The change journal is switched off on this bridge (FOUNDRY_AI_CHANGE_JOURNAL=off), so only AI changes are listed.'
      );
    }
  }

  /** Everyone's recent changes, newest first. */
  async list(options: ChangeListOptions = {}): Promise<ChangeListResult> {
    const notes: string[] = [];
    await this.pull(notes);

    const limit = Math.min(Math.max(Math.floor(options.limit ?? 30), 1), 200);
    const source = options.source ?? 'all';
    const cutoff = this.now() - CHANGE_HISTORY_DAYS * DAY_MS;
    const sinceMs = options.sinceIso ? Date.parse(options.sinceIso) : Number.NaN;
    const from = Number.isFinite(sinceMs) ? Math.max(sinceMs, cutoff) : cutoff;
    const worldId = await this.worldIds.current();

    const entries: Array<{ at: number; item: ChangeListItem }> = [];
    if (source !== 'ai') {
      const undoState = await this.guardedWrites.undoState();
      for (const action of await this.actionsFor(worldId)) {
        // An action with any AI record is the AI change's: the rest are the system's own
        // follow-ups on the same things (dnd5e adds or removes Bloodied after an HP change);
        // `buildActions` already split off a person's records on other things.
        if (action.changeId) continue;
        if (action.tEnd < from) continue;
        if (!matchesPerson(options, action.userId, action.userName)) continue;
        if (options.thingUuid && !action.records.some(r => touches(r, options.thingUuid!)))
          continue;
        const undone = undoState.get(actionKey(action.actionId));
        entries.push({
          at: action.tEnd,
          item: {
            kind: 'human',
            id: `act:${action.actionId}`,
            at: new Date(action.t).toISOString(),
            by: action.userName ?? 'Unknown user',
            userId: action.userId,
            isGM: action.userIsGM,
            summary: action.summary,
            lines: action.lines,
            things: action.things,
            records: action.records.filter(r => !r.changeId).length,
            canUndo: !undone && undoBlocker(action) === null,
            undone: !!undone,
            ...(undone ? { undoneBy: undone.undoneBy } : {}),
          },
        });
      }
    }
    if (source !== 'human') {
      for (const change of await this.guardedWrites.listRecentChanges(500)) {
        const at = Date.parse(change.appliedAt);
        if (Number.isFinite(at) && at < from) continue;
        if (!matchesPerson(options, null, change.requestedBy ?? null)) continue;
        if (options.thingUuid) {
          const wanted = options.thingUuid;
          const hit = change.documents?.some(d => d === wanted || d.startsWith(`${wanted}.`));
          if (!hit) continue;
        }
        entries.push({ at: Number.isFinite(at) ? at : 0, item: aiItem(change) });
      }
    }

    entries.sort((a, b) => b.at - a.at);
    return {
      changes: entries.slice(0, limit).map(e => e.item),
      ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
    };
  }

  // -------------------------------------------------------------------------

  private async actionsFor(worldId: string): Promise<ChangeAction[]> {
    const index = await this.load(worldId);
    this.prune(index);
    index.actions ??= buildActions(index.records, index.users);
    return index.actions;
  }

  private async load(worldId: string): Promise<WorldIndex> {
    let index = this.worlds.get(worldId);
    if (!index) {
      const created: WorldIndex = {
        records: [],
        keys: new Set(),
        users: new Map(),
        loading: null,
        pending: [],
        actions: null,
      };
      index = created;
      this.worlds.set(worldId, created);
      created.loading = this.readFiles(worldId).then(
        records => {
          this.ingest(created, records);
          this.ingest(created, created.pending);
          created.pending = [];
          created.loading = null;
        },
        (error: unknown) => {
          // Not loaded: forget the index so the next read tries again.
          this.worlds.delete(worldId);
          created.loading = null;
          throw error;
        }
      );
    }
    if (index.loading) await index.loading;
    return index;
  }

  /** The records of the last CHANGE_HISTORY_DAYS days (and the part of the day before), oldest first. */
  private async readFiles(worldId: string): Promise<ChangeRecord[]> {
    const today = new Date(this.now());
    const out: ChangeRecord[] = [];
    for (let back = CHANGE_HISTORY_DAYS; back >= 0; back--) {
      // Noon of that day, so a daylight-saving shift never repeats or skips a date.
      const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back, 12);
      const lines = await this.store.readLines(
        worldId,
        'gm',
        changeJournalFileName(localDateKey(day.getTime()))
      );
      for (const line of lines) if (isChangeRecord(line)) out.push(line);
    }
    return out;
  }

  private ingest(index: WorldIndex, records: ChangeRecord[]): void {
    let added = false;
    for (const record of records) {
      if (typeof record?.key !== 'string' || index.keys.has(record.key)) continue;
      index.keys.add(record.key);
      index.records.push(record);
      if (record.userId && record.userName) {
        if (index.users.get(record.userId) !== record.userName) index.actions = null;
        index.users.set(record.userId, record.userName);
      }
      added = true;
    }
    if (added) index.actions = null;
  }

  private prune(index: WorldIndex): void {
    const cutoff = this.now() - CHANGE_HISTORY_DAYS * DAY_MS;
    if (!index.records.some(r => r.t < cutoff)) return;
    index.records = index.records.filter(r => r.t >= cutoff);
    index.keys = new Set(index.records.map(r => r.key));
    index.actions = null;
  }
}

function matchesPerson(
  options: Pick<ChangeListOptions, 'userId' | 'userName'>,
  userId: string | null,
  userName: string | null
): boolean {
  const { userId: wantedId, userName: wantedName } = options;
  if (!wantedId && !wantedName) return true;
  const sameId = !!wantedId && !!userId && userId.toLowerCase() === wantedId.toLowerCase();
  const sameName =
    !!wantedName && !!userName && userName.toLowerCase() === wantedName.toLowerCase();
  return sameId || sameName;
}

/** The record is about this uuid: the document itself, something below it, or the thing it belongs to. */
function touches(r: ChangeRecord, uuid: string): boolean {
  return (
    r.uuid === uuid || r.rootUuid === uuid || r.uuid.startsWith(`${uuid}.`) || r.parentUuid === uuid
  );
}

function aiItem(change: RecentChange): AiChangeItem {
  const { summary, lines } = summarizeLines(
    change.diff.length > 0 ? change.diff : [change.summary]
  );
  const covers = (change.undoes?.actions?.length ?? 0) + (change.undoes?.changes?.length ?? 0);
  return {
    kind: 'ai',
    id: change.changeId,
    at: change.appliedAt,
    by: 'AI',
    ...(change.requestedBy ? { requestedBy: change.requestedBy } : {}),
    summary: change.summary || summary,
    lines,
    mode: change.mode,
    feature: change.feature,
    canUndo: change.canUndo,
    undone: !!change.undoneBy,
    ...(change.undoneBy ? { undoneBy: change.undoneBy } : {}),
    ...(change.undoneAt ? { undoneAt: change.undoneAt } : {}),
    ...(change.documents ? { documents: change.documents } : {}),
    ...(covers > 0 ? { covers } : {}),
  };
}
