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
 * Foundry's own follow-ups on other things are kept with the AI change too: deleting a token
 * removes its combatant and moves the turn (root Combat, not the token's scene), so records on a
 * Combat in an AI burst are never split off as a person's action. The same goes for dnd5e's
 * dependent deletes: when the AI deleted an effect or an item, the effects on other actors, the
 * templates, regions and summoned tokens dnd5e removes with it (in the active GM's browser)
 * stay with the AI change, and the undo planner puts them back with it (`aiFollowUps`). A GM's
 * own click on the tracker within the action gap of such an AI write, in the bridge's browser,
 * is the one case this cannot tell apart (it is then hidden under the AI change). When the
 * active GM is another browser, dnd5e's dependent deletes run there and show as that person's
 * action.
 *
 * `historyStart()` says from when the history is complete: the pump's retention can remove
 * files inside the span when they exceed the byte cap, the module's buffer can wrap before the
 * pump read it, and the undo planner refuses a rewind that reaches back before that.
 *
 * Read-only. The undo planner (`guarded-write/undo-planner.ts`) reads the actions from here
 * (`humanActions`); `undoBlocker` says which of them can be undone, and `list()` marks what is
 * already undone from the audit log's derived undo state.
 */
import type { ChangeRecord, PathValue } from '@gnuminator/shared';

import {
  CHANGE_JOURNAL_RETENTION_DAYS,
  DEFAULT_CHANGE_JOURNAL_MAX_BYTES,
  type ChangeJournalPump,
  changeJournalFileName,
  dateKeyStart,
  isChangeRecord,
} from './change-journal-pump.js';
import { localDateKey } from './event-pump.js';
import { pathLabel, type RecentChange } from './guarded-write/service.js';
import type { UndoState } from './guarded-write/undo-state.js';
import { actionKey } from './guarded-write/undo-state.js';
import { formatValue } from './guarded-write/values.js';
import type { Logger } from './logger.js';
import { AUDIT_RING_SIZE } from './vault/audit.js';
import type { VaultStore } from './vault/store.js';
import type { WorldIdResolver } from './vault/world-id.js';

/** How many days of changes the index keeps and lists (the pump keeps the files as long). */
export const CHANGE_HISTORY_DAYS = CHANGE_JOURNAL_RETENTION_DAYS;
/**
 * Default cap on the records the history holds in memory, as the length of their journal lines
 * (about bytes): the pump's cap on its files. A bulk delete (every deleted actor's data in its
 * record) can fill one day's file far past it.
 */
export const DEFAULT_CHANGE_HISTORY_MAX_CHARS = DEFAULT_CHANGE_JOURNAL_MAX_BYTES;
/** Most readable lines an action carries (the last one says how many more there were). */
export const MAX_ACTION_LINES = 8;
/**
 * Appended to the actionId of a person's records that shared a burst with an AI write but
 * touched other things (see the file comment): their own action, undoable on its own.
 */
export const OWN_ACTION_SUFFIX = ':own';
/**
 * Root document kinds Foundry itself writes to as a follow-up of a change elsewhere (deleting a
 * token deletes its combatant and may move the turn): never split off as a person's own action.
 */
const CASCADE_ROOT_KINDS: ReadonlySet<string> = new Set(['Combat']);
/**
 * Document kinds dnd5e 6 deletes as dependents of an effect or item delete (ending concentration
 * removes the effects it put on other actors, its templates and its summoned tokens; a region
 * can be one too), in the active GM's browser. In an AI burst where the AI deleted an effect or
 * an item, the deletes of the documents the deleted ones name as their dependents
 * (`flags.dnd5e.dependents`, followed through: an item, its concentration effect, that effect's
 * dependents) stay with the AI change instead of becoming the bridge user's own action; when a
 * deleted document's data was too large to keep, any delete of these kinds in the burst does
 * (see the file comment).
 */
const DEPENDENT_DELETE_KINDS: ReadonlySet<string> = new Set([
  'ActiveEffect',
  'Region',
  'MeasuredTemplate',
  'Token',
]);
/** The AI deletes whose dependents dnd5e removes (see DEPENDENT_DELETE_KINDS). */
const DEPENDENT_SOURCE_KINDS: ReadonlySet<string> = new Set(['ActiveEffect', 'Item']);

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
  /**
   * An AI change's follow-ups: what Foundry and dnd5e removed or changed with it on other
   * things (a cascade root, the dependents of an ended concentration), for the undo planner to
   * put back with it. dnd5e's derived records on the AI's own targets (Bloodied) are in
   * `records` but not here: Foundry makes them again by itself. Empty for a person's action.
   */
  followUps: ChangeRecord[];
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
  /** For an undo: how many changes it took back (undoing it brings them all back); 1 for an undo-change undo. */
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

/** One local day's changes, oldest first (`byDay`). */
export interface ChangeDay {
  /** `YYYY-MM-DD`, the bridge's local date. */
  date: string;
  changes: ChangeListItem[];
  /**
   * Set when the day may be missing changes before this time (epoch ms): the history is only
   * known to be complete from there (the span cutoff, a day the size cap removed, lost records,
   * or the AI audit ring being full). Only today is returned in that state; an older day that
   * is not whole is left out, so its note stays as it was last written.
   */
  incompleteBefore?: number;
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

/** The document kind of a root uuid (`Combat.cb1` gives `Combat`), or null. */
function rootKind(rootUuid: string): string | null {
  const parts = rootUuid.split('.');
  return parts.length >= 2 ? parts[parts.length - 2] : null;
}

/** A nameless root (a Combat) by its kind, read from its uuid. */
function rootLabel(rootUuid: string): string {
  const kind = rootKind(rootUuid);
  return kind ? documentLabel(kind) : 'Something';
}

/** Foundry's own follow-up of an AI write on another thing (see CASCADE_ROOT_KINDS). */
function isCascade(r: ChangeRecord): boolean {
  const kind = rootKind(r.rootUuid);
  return kind !== null && CASCADE_ROOT_KINDS.has(kind);
}

/** The uuids a deleted document's data names as its dnd5e dependents. */
function dependentUuidsOf(r: ChangeRecord): string[] {
  const flags = r.data?.flags as { dnd5e?: { dependents?: unknown } } | undefined;
  const list = flags?.dnd5e?.dependents;
  if (!Array.isArray(list)) return [];
  return list
    .map(d => (d as { uuid?: unknown } | null)?.uuid)
    .filter((u): u is string => typeof u === 'string');
}

/** A deleted effect's data says it was a concentration effect, or it named dependents. */
function isConcentrationEffect(r: ChangeRecord): boolean {
  const statuses = r.data?.statuses;
  return (
    (Array.isArray(statuses) && statuses.includes('concentrating')) ||
    dependentUuidsOf(r).length > 0
  );
}

/** The dnd5e dependents link of one AI change, read from its deleted documents. */
interface DependentsLink {
  /** The uuids the chain names, followed through the burst's deletes. */
  linked: ReadonlySet<string>;
  /** A source lost its data (oversize): the link cannot be read. */
  unreadable: boolean;
}

/**
 * Which deletes in a burst dnd5e made as dependents of one AI change's effect or item delete
 * (see DEPENDENT_DELETE_KINDS): the documents named in `flags.dnd5e.dependents` of the change's
 * deleted documents (`sources`, its own records) and of the same-root deletes that went with
 * them (an item's concentration effect, which counts as a dependent itself), followed through
 * `others` (the burst's records that are not the AI's and arrived from the change's start on,
 * as late as they may come). When a source
 * lost its data (oversize), the link cannot be read and every delete of a dependent kind that
 * arrived with the change counts (`isDependentDelete`); a dependent without data only cannot be
 * followed further.
 */
function dependentsLink(
  sources: ChangeRecord[],
  others: ChangeRecord[],
  aiRoots: ReadonlySet<string>
): DependentsLink {
  const linked = new Set<string>();
  const roots = sources.filter(
    r => r.op === 'delete' && DEPENDENT_SOURCE_KINDS.has(r.documentName)
  );
  if (roots.length === 0) return { linked, unreadable: false };
  const itemSource = roots.some(r => r.documentName === 'Item');
  // The records whose data names the dependents: the sources and, when the AI deleted an item,
  // the concentration effect dnd5e ended with it on the same actor (a dependent itself).
  const chain = new Set(roots);
  let unreadable = false;
  if (itemSource) {
    for (const r of others) {
      if (
        r.op === 'delete' &&
        aiRoots.has(r.rootUuid) &&
        r.documentName === 'ActiveEffect' &&
        isConcentrationEffect(r)
      ) {
        linked.add(r.uuid);
        chain.add(r);
      }
    }
  }
  // Only the chain's dependents count: another delete on the same actor is no part of it.
  const queue = [...chain];
  for (let i = 0; i < queue.length; i += 1) {
    const r = queue[i];
    if (chain.has(r) && (r.oversize === true || !r.data)) unreadable = true;
    for (const uuid of dependentUuidsOf(r)) {
      if (linked.has(uuid)) continue;
      linked.add(uuid);
      queue.push(...others.filter(x => x.uuid === uuid && x.op === 'delete'));
    }
  }
  return { linked, unreadable };
}

/** A delete dnd5e made as a dependent of the change whose link this is. */
function isDependentDelete(r: ChangeRecord, link: DependentsLink): boolean {
  return (
    r.op === 'delete' &&
    DEPENDENT_DELETE_KINDS.has(r.documentName) &&
    (link.linked.has(r.uuid) || link.unreadable)
  );
}

/** The Token a deleted Combatant stood for (`Scene.<sceneId>.Token.<tokenId>` from its data), or null. */
function combatantTokenUuid(r: ChangeRecord): string | null {
  if (r.op !== 'delete' || r.documentName !== 'Combatant') return null;
  const data = r.data as { tokenId?: unknown; sceneId?: unknown } | undefined;
  if (typeof data?.tokenId !== 'string') return null;
  const sceneId = typeof data.sceneId === 'string' ? data.sceneId : r.sceneId;
  return sceneId ? `Scene.${sceneId}.Token.${data.tokenId}` : null;
}

/**
 * The local date of `ms`, with the time of day (`YYYY-MM-DD HH:MM`) unless it is midnight: the
 * history start is a day when retention removed a file, a time when the buffer wrapped.
 */
export function historyStartLabel(ms: number): string {
  const d = new Date(ms);
  const date = localDateKey(ms);
  if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) return date;
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${date} ${two(d.getHours())}:${two(d.getMinutes())}`;
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
 * In a burst with AI writes, each AI change is an action of its own (`<actionId>`, then
 * `<actionId>:2` and so on) with the records that followed it; a person's records on things the
 * AI did not touch become one action of their own (`<actionId>:own`, after the AI's); Foundry's
 * own cascades (a combatant removed with its token) and dnd5e's dependent deletes (the effects,
 * templates and summons that go when the AI deleted an effect or an item) stay with the AI's.
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

  const split: Array<[string, ChangeRecord[], ChangeRecord[]]> = [];
  for (const [actionId, group] of groups) {
    if (!group.some(r => r.changeId)) {
      split.push([actionId, group, []]);
      continue;
    }
    // A burst with AI writes: one action per AI change (fast consecutive writes share a burst),
    // each with the records that followed it until the next AI change. Foundry's and dnd5e's
    // follow-ups are unawaited round trips that may land after the next change's first record,
    // so a follow-up the data ties to its change goes there however late it arrived: a document
    // in the change's dnd5e dependents chain, and a Combatant whose data names a Token the change
    // deleted (never to a change that started after it). The rest is filed by position; what came before the first AI record, and what a
    // change did not touch, is the person's own action.
    const own: ChangeRecord[] = [];
    const segments: Array<{ changeId: string; ai: ChangeRecord[] }> = [];
    /** Where a record that is not the AI's arrived: the segment index, -1 before the first. */
    const position = new Map<ChangeRecord, number>();
    for (const r of group) {
      const current = segments[segments.length - 1];
      if (!r.changeId) position.set(r, segments.length - 1);
      else if (r.changeId !== current?.changeId) segments.push({ changeId: r.changeId, ai: [r] });
      else current.ai.push(r);
    }
    const others = group.filter(r => !r.changeId);
    const at = (r: ChangeRecord): number => position.get(r) ?? -1;
    const links = segments.map((segment, i) => {
      const aiRoots: ReadonlySet<string> = new Set(segment.ai.map(r => r.rootUuid));
      const since = others.filter(r => at(r) >= i);
      return { aiRoots, link: dependentsLink(segment.ai, since, aiRoots) };
    });
    // Only a change that started at or before a record arrived can own it; of those, the latest
    // whose data ties it (a change that deleted the same thing again later owns its own cascade).
    const latestOwner = (r: ChangeRecord, owns: (i: number) => boolean): number => {
      for (let i = at(r); i >= 0; i -= 1) if (owns(i)) return i;
      return -1;
    };
    const segmentOf = (r: ChangeRecord): number => {
      if (r.op === 'delete' && DEPENDENT_DELETE_KINDS.has(r.documentName)) {
        const linked = latestOwner(r, i => links[i].link.linked.has(r.uuid));
        if (linked >= 0) return linked;
      }
      const token = combatantTokenUuid(r);
      if (token) {
        const deleter = latestOwner(r, i =>
          segments[i].ai.some(a => a.op === 'delete' && a.uuid === token)
        );
        if (deleter >= 0) return deleter;
      }
      return at(r);
    };
    const filed = new Map<number, ChangeRecord[]>();
    for (const r of others) {
      const i = segmentOf(r);
      if (i < 0) own.push(r);
      else filed.set(i, [...(filed.get(i) ?? []), r]);
    }
    segments.forEach((segment, i) => {
      const { aiRoots, link } = links[i];
      const mine = new Set(filed.get(i) ?? []);
      const followUps = [...mine].filter(r => isCascade(r) || isDependentDelete(r, link));
      const theirs = new Set(
        [...mine].filter(r => !aiRoots.has(r.rootUuid) && !followUps.includes(r))
      );
      own.push(...theirs);
      split.push([
        i === 0 ? actionId : `${actionId}:${i + 1}`,
        group.filter(r => (r.changeId ? segment.ai.includes(r) : mine.has(r) && !theirs.has(r))),
        followUps,
      ]);
    });
    if (own.length > 0) {
      const ownSet = new Set(own);
      split.push([`${actionId}${OWN_ACTION_SUFFIX}`, group.filter(r => ownSet.has(r)), []]);
    }
  }

  const actions: ChangeAction[] = [];
  for (const [actionId, group, followUps] of split) {
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
      followUps,
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
  /** Each record's journal line length (`DEFAULT_CHANGE_HISTORY_MAX_CHARS`), and their sum. */
  sizes: WeakMap<ChangeRecord, number>;
  chars: number;
  /** Epoch ms from which no record was left out for the size cap (0: none was). */
  trimmedBefore: number;
  /**
   * The actions left out (the size cap, or the journal's `cutActions`): an action is kept whole
   * or not at all, so their later records are left out too.
   */
  dropped: Set<string>;
  /** The size cap warning was logged (once per world). */
  warned: boolean;
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
  /**
   * Epoch ms from which the pump's records are complete (its `historyStart`: local midnight of
   * the first day retention left whole, or `completeFrom` after the module's buffer wrapped,
   * whichever is later), 0 when neither happened; absent when the journal is off.
   */
  journalStart?: (worldId: string) => Promise<number>;
  /** The actions the journal's day cap cut through (the pump's `cutActions`): left out whole. */
  journalCutActions?: (worldId: string) => Promise<ReadonlySet<string>>;
  /** Most records to hold, as their journal lines' length (default DEFAULT_CHANGE_HISTORY_MAX_CHARS). */
  maxChars?: number;
  now?: () => number;
}

/**
 * The history's links to the change-journal pump, for the backend: `pullNow` and `journalStart`
 * delegate to the pump the getter returns at call time (the pump is made after the history,
 * once the Foundry link starts) and stand in for it while there is none.
 */
export function journalLinks(
  pump: () => Pick<ChangeJournalPump, 'pullNow' | 'historyStart' | 'cutActions'> | null
): Required<Pick<ChangeHistoryOptions, 'pullNow' | 'journalStart' | 'journalCutActions'>> {
  return {
    pullNow: (): Promise<void> => pump()?.pullNow() ?? Promise.resolve(),
    journalStart: (worldId: string): Promise<number> =>
      pump()?.historyStart(worldId) ?? Promise.resolve(0),
    journalCutActions: (worldId: string): Promise<ReadonlySet<string>> =>
      pump()?.cutActions(worldId) ?? Promise.resolve(new Set<string>()),
  };
}

export class ChangeHistory {
  private readonly store: VaultStore;
  private readonly worldIds: ChangeHistoryOptions['worldIds'];
  private readonly guardedWrites: ChangeHistoryOptions['guardedWrites'];
  private readonly logger: Logger;
  private readonly pullNow: ChangeHistoryOptions['pullNow'];
  private readonly journalStart: ChangeHistoryOptions['journalStart'];
  private readonly journalCutActions: ChangeHistoryOptions['journalCutActions'];
  private readonly maxChars: number;
  private readonly now: () => number;
  private readonly worlds = new Map<string, WorldIndex>();

  constructor(options: ChangeHistoryOptions) {
    this.store = options.store;
    this.worldIds = options.worldIds;
    this.guardedWrites = options.guardedWrites;
    this.logger = options.logger.child({ component: 'ChangeHistory' });
    this.pullNow = options.pullNow;
    this.journalStart = options.journalStart;
    this.journalCutActions = options.journalCutActions;
    this.maxChars = options.maxChars ?? DEFAULT_CHANGE_HISTORY_MAX_CHARS;
    this.now = options.now ?? ((): number => Date.now());
  }

  /**
   * Epoch ms from which people's changes are all known: the span's cutoff, or later when the
   * pump's retention removed a file inside the span (the byte cap) or the history left its
   * oldest records out (its own size cap). Changes before it may be missing, so a rewind must
   * not reach back past it.
   */
  async historyStart(): Promise<number> {
    const cutoff = this.now() - CHANGE_HISTORY_DAYS * DAY_MS;
    const worldId = await this.worldIds.current();
    const { trimmedBefore: trimmed } = await this.load(worldId);
    if (!this.journalStart) return Math.max(cutoff, trimmed);
    return Math.max(cutoff, trimmed, await this.journalStart(worldId));
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

  /**
   * Foundry's and dnd5e's own follow-ups of an AI change on other things (the combatant that
   * went with a token, the dependents of an ended concentration; see `ChangeAction.followUps`),
   * for the undo planner to put back with it. Empty when the journal has none. No pull:
   * `humanActions` (called first by the planner) fetched the newest records.
   */
  async aiFollowUps(changeId: string): Promise<ChangeRecord[]> {
    const worldId = await this.worldIds.current();
    // One AI apply whose ops are over the action gap apart spans two actions with the changeId.
    return (await this.actionsFor(worldId))
      .filter(a => a.changeId === changeId)
      .flatMap(a => a.followUps);
  }

  /** The readable lines of every AI change's follow-ups (see `aiFollowUps`), by changeId. */
  private async followUpLines(worldId: string): Promise<Map<string, string[]>> {
    const users = (await this.load(worldId)).users;
    const lines = new Map<string, string[]>();
    for (const action of await this.actionsFor(worldId)) {
      if (!action.changeId || action.followUps.length === 0) continue;
      lines.set(action.changeId, [
        ...(lines.get(action.changeId) ?? []),
        ...action.followUps.flatMap(r => describeRecord(r, users)),
      ]);
    }
    return lines;
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
    const start = await this.historyStart();
    if (start > cutoff && source !== 'ai') {
      notes.push(
        `People's changes before ${historyStartLabel(start)} are gone: the change journal lost them (its size cap removed old files or left the oldest records out, or Foundry's buffer wrapped before the bridge read it).`
      );
    }

    const { entries } = await this.collect(options, from);
    entries.sort((a, b) => b.at - a.at);
    return {
      changes: entries.slice(0, limit).map(e => e.item),
      ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
    };
  }

  /**
   * Everyone's changes grouped by local day, oldest day first and oldest change first within a
   * day (by each change's own start time); no filter, no limit, no pull (for the GM vault's
   * daily notes, rendered right after the pump appended). Only whole days are returned: a day
   * that begins before the time the history is complete from (the span cutoff, a day the size
   * cap removed, lost records, or the oldest entry of a full AI audit ring) is left out, so its
   * note stays as it was last written instead of being cut down with every render; today is
   * always returned, marked `incompleteBefore` when it is such a day. Days without changes are
   * left out. Null when `worldId` is not the current world (the index reads the current one).
   */
  async byDay(worldId: string): Promise<ChangeDay[] | null> {
    if (worldId !== (await this.worldIds.current())) return null;
    const now = this.now();
    const cutoff = now - CHANGE_HISTORY_DAYS * DAY_MS;
    const { entries, aiFrom } = await this.collect({}, cutoff);
    const completeFrom = Math.max(await this.historyStart(), aiFrom);
    const today = localDateKey(now);
    const days = new Map<string, Array<{ at: number; item: ChangeListItem }>>();
    for (const entry of entries) {
      const started = Date.parse(entry.item.at);
      const at = Number.isFinite(started) ? started : entry.at;
      const date = localDateKey(at);
      let list = days.get(date);
      if (!list) {
        list = [];
        days.set(date, list);
      }
      list.push({ at, item: entry.item });
    }
    const result: ChangeDay[] = [];
    for (const [date, list] of [...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const midnight = dateKeyStart(date);
      const whole = midnight >= completeFrom;
      if (!whole && date !== today) continue;
      list.sort((a, b) => a.at - b.at);
      result.push({
        date,
        changes: list.map(l => l.item),
        ...(whole ? {} : { incompleteBefore: completeFrom }),
      });
    }
    return result;
  }

  /**
   * The matching changes of both sources, with the time they sort by (the human action's last
   * record), and `aiFrom`: the time of the oldest AI change when the audit ring is full (older
   * AI changes have fallen out of it), 0 otherwise.
   */
  private async collect(
    options: ChangeListOptions,
    from: number
  ): Promise<{ entries: Array<{ at: number; item: ChangeListItem }>; aiFrom: number }> {
    const source = options.source ?? 'all';
    const worldId = await this.worldIds.current();
    const entries: Array<{ at: number; item: ChangeListItem }> = [];
    let aiFrom = 0;
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
      const recent = await this.guardedWrites.listRecentChanges(AUDIT_RING_SIZE);
      if (recent.length >= AUDIT_RING_SIZE) {
        // Newest first: the last one is the oldest the ring still holds.
        const oldest = Date.parse(recent[recent.length - 1].appliedAt);
        if (Number.isFinite(oldest)) aiFrom = oldest;
      }
      const followUps = await this.followUpLines(worldId);
      for (const change of recent) {
        const at = Date.parse(change.appliedAt);
        if (Number.isFinite(at) && at < from) continue;
        if (!matchesPerson(options, null, change.requestedBy ?? null)) continue;
        if (options.thingUuid) {
          const wanted = options.thingUuid;
          const hit = change.documents?.some(d => d === wanted || d.startsWith(`${wanted}.`));
          if (!hit) continue;
        }
        entries.push({
          at: Number.isFinite(at) ? at : 0,
          item: aiItem(change, followUps.get(change.changeId) ?? []),
        });
      }
    }
    return { entries, aiFrom };
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
        sizes: new WeakMap(),
        chars: 0,
        trimmedBefore: 0,
        dropped: new Set(),
        warned: false,
        users: new Map(),
        loading: null,
        pending: [],
        actions: null,
      };
      index = created;
      this.worlds.set(worldId, created);
      created.loading = this.readFiles(worldId, created).then(
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

  /**
   * The records of the last CHANGE_HISTORY_DAYS days (and the part of the day before), oldest
   * first, read line by line and at most `maxChars` of the newest: the oldest are left out while
   * the files are read, so a huge day never sits in memory whole. Their sizes go into `sizes`.
   * An action is kept whole or not at all: the rest of one the cap reached, and the actions the
   * journal's day cap cut through, are left out too.
   */
  private async readFiles(worldId: string, index: WorldIndex): Promise<ChangeRecord[]> {
    for (const id of (await this.journalCutActions?.(worldId)) ?? []) index.dropped.add(id);
    const today = new Date(this.now());
    // A slot is cleared once its record is left out, so a large one is not held to the end.
    let out: Array<ChangeRecord | undefined> = [];
    let first = 0;
    let chars = 0;
    for (let back = CHANGE_HISTORY_DAYS; back >= 0; back--) {
      // Noon of that day, so a daylight-saving shift never repeats or skips a date.
      const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back, 12);
      const file = changeJournalFileName(localDateKey(day.getTime()));
      await this.store.forEachLine(worldId, 'gm', file, (line, size) => {
        if (!isChangeRecord(line)) return;
        if (index.dropped.has(line.actionId)) {
          markTrimmed(index, line);
          return;
        }
        out.push(line);
        index.sizes.set(line, size);
        chars += size;
        while (chars > this.maxChars && out.length - first > 1) {
          const dropped = out[first];
          out[first] = undefined;
          first += 1;
          if (!dropped) continue;
          chars -= index.sizes.get(dropped) ?? 0;
          markTrimmed(index, dropped);
          index.dropped.add(dropped.actionId);
        }
        if (first > 1024 && first > out.length / 2) {
          out = out.slice(first);
          first = 0;
        }
      });
    }
    // A day's cut made while the files were read: the actions it went through go too.
    for (const id of (await this.journalCutActions?.(worldId)) ?? []) index.dropped.add(id);
    const kept: ChangeRecord[] = [];
    for (let i = first; i < out.length; i += 1) {
      const r = out[i];
      if (!r) continue;
      // The kept part of an action the cap reached (its records need not be next to each other).
      if (index.dropped.has(r.actionId)) markTrimmed(index, r);
      else kept.push(r);
    }
    if (index.trimmedBefore > 0) this.warnTrimmed(index);
    return kept;
  }

  /**
   * Leave the oldest records out while they hold more than `maxChars` (the newest one stays),
   * with every other record of their actions, so no action is ever kept in part.
   */
  private trim(index: WorldIndex): void {
    if (index.chars <= this.maxChars) return;
    let drop = 0;
    const ids = new Set<string>();
    while (index.chars > this.maxChars && drop < index.records.length - 1) {
      const dropped = index.records[drop];
      index.chars -= index.sizes.get(dropped) ?? 0;
      index.keys.delete(dropped.key);
      markTrimmed(index, dropped);
      ids.add(dropped.actionId);
      drop += 1;
    }
    index.records = index.records.slice(drop).filter(r => {
      if (!ids.has(r.actionId)) return true;
      index.chars -= index.sizes.get(r) ?? 0;
      index.keys.delete(r.key);
      markTrimmed(index, r);
      return false;
    });
    for (const id of ids) index.dropped.add(id);
    index.actions = null;
    this.warnTrimmed(index);
  }

  /** Said once per world: while a bulk change runs, every poll trims a little more. */
  private warnTrimmed(index: WorldIndex): void {
    if (index.warned) return;
    index.warned = true;
    this.logger.warn('Change history over its size cap: the oldest records were left out', {
      maxChars: this.maxChars,
      completeFrom: new Date(index.trimmedBefore).toISOString(),
    });
  }

  private ingest(index: WorldIndex, records: ChangeRecord[]): void {
    let added = false;
    for (const record of records) {
      if (typeof record?.key !== 'string' || index.keys.has(record.key)) continue;
      if (index.dropped.has(record.actionId)) {
        // The rest of an action already left out: keeping it would keep that action in part.
        markTrimmed(index, record);
        continue;
      }
      index.keys.add(record.key);
      index.records.push(record);
      let size = index.sizes.get(record);
      if (size === undefined) {
        size = JSON.stringify(record).length;
        index.sizes.set(record, size);
      }
      index.chars += size;
      if (record.userId && record.userName) {
        if (index.users.get(record.userId) !== record.userName) index.actions = null;
        index.users.set(record.userId, record.userName);
      }
      added = true;
    }
    if (added) index.actions = null;
    this.trim(index);
  }

  /** Leave out the actions that began before the span (whole: the cutoff may fall inside one). */
  private prune(index: WorldIndex): void {
    const cutoff = this.now() - CHANGE_HISTORY_DAYS * DAY_MS;
    const old = new Set(index.records.filter(r => r.t < cutoff).map(r => r.actionId));
    if (old.size === 0) return;
    index.records = index.records.filter(r => {
      if (!old.has(r.actionId)) return true;
      // Inside the span: the history is complete only after it.
      if (r.t >= cutoff) markTrimmed(index, r);
      return false;
    });
    index.keys = new Set(index.records.map(r => r.key));
    index.chars = index.records.reduce((sum, r) => sum + (index.sizes.get(r) ?? 0), 0);
    index.actions = null;
  }
}

/** A record was left out for the size cap: the history is complete only after it. */
function markTrimmed(index: WorldIndex, dropped: ChangeRecord): void {
  if (dropped.t + 1 > index.trimmedBefore) index.trimmedBefore = dropped.t + 1;
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

/** An AI change as a list item; `followUps` are the lines of what Foundry and dnd5e did with it. */
function aiItem(change: RecentChange, followUps: string[] = []): AiChangeItem {
  const { summary, lines } = summarizeLines([
    ...(change.diff.length > 0 ? change.diff : [change.summary]),
    ...followUps,
  ]);
  // An undo made with undo-change (the AI tab, the toast) took back exactly the one it undoes.
  const covers =
    (change.undoes?.actions?.length ?? 0) + (change.undoes?.changes?.length ?? 0) ||
    (change.undoOf ? 1 : 0);
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
