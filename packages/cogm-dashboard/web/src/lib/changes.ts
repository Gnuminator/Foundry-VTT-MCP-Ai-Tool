// Recent Changes (guarded writes, D-077, I-109), as plain data and rules: reading the two lists the
// bridge answers (`list-recent-changes`, the AI's guarded changes, and `list-changes`, everyone's),
// the state a row shows, the person filter, the redo rule, and the undo choice (just this,
// everything since, rewind the table) as the dialogs it walks through. No React here, so the rules
// have unit tests; panels/RecentChanges.tsx draws them and makes the calls. A typed port of the old
// page's changes-everyone.js and the AI tab in public/app.js.

/** How many changes the AI tab asks for. */
export const AI_LIMIT = 20;

/** How many changes the Everyone tab asks for (the tool's own default is 30, its limit 200). */
export const EVERYONE_LIMIT = 100;

/** The bridge tool that lists everyone's changes; an older bridge has none and the tab is hidden. */
export const EVERYONE_TOOL = 'list-changes';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

// ---------------------------------------------------------------------------
// The AI tab: list-recent-changes

/** One guarded change as the AI tab shows it (the bridge's list-recent-changes). */
export interface AiChange {
  changeId: string;
  summary: string;
  /** The feature that made it (`actor-change`, `page-reveal`, ...). */
  feature: string;
  /** What it touched, as the bridge words it. */
  target: string;
  /** ISO time it was applied (UTC). */
  appliedAt: string;
  /** `undo` for the entry an undo left. */
  mode: string;
  undoneBy: string;
  risk: string;
  canUndo: boolean;
  /** The lines of the diff. */
  diff: string[];
  /** Set only for a change a GM made from the AI changes or Handouts window in Foundry. */
  requestedBy: string;
}

/** The AI changes of a list-recent-changes answer; entries without an id are dropped. */
export function readAiChanges(result: unknown): AiChange[] {
  const list = isRecord(result) ? result['changes'] : undefined;
  if (!Array.isArray(list)) return [];
  const changes: AiChange[] = [];
  for (const c of list) {
    if (!isRecord(c) || str(c['changeId']) === '') continue;
    changes.push({
      changeId: str(c['changeId']),
      summary: str(c['summary']),
      feature: str(c['feature']),
      target: str(c['target']),
      appliedAt: str(c['appliedAt']),
      mode: str(c['mode']),
      undoneBy: str(c['undoneBy']),
      risk: str(c['risk']),
      canUndo: c['canUndo'] === true,
      diff: strings(c['diff']),
      requestedBy: str(c['requestedBy']),
    });
  }
  return changes;
}

export type ChangeState = 'undo' | 'undone' | 'destructive' | 'applied';

/** The state word and colour of an AI row: an undo entry, an undone change, a delete, or a change. */
export function changeState(c: Pick<AiChange, 'mode' | 'undoneBy' | 'risk'>): ChangeState {
  if (c.mode === 'undo') return 'undo';
  if (c.undoneBy) return 'undone';
  return c.risk === 'destructive' ? 'destructive' : 'applied';
}

/**
 * The note an AI change is filed in, by UTC month of `appliedAt` (obsidian/export.ts files them by
 * `appliedAt.slice(0, 7)`): the path under the world's folder of the vault, or null without a month.
 */
export function obsidianChangePath(c: Pick<AiChange, 'appliedAt'>): string | null {
  const month = c.appliedAt.slice(0, 7);
  return /^\d{4}-\d{2}$/.test(month) ? `AI Tool/Changes/${month}` : null;
}

// ---------------------------------------------------------------------------
// The Everyone tab: list-changes

/** One change of anyone's (the bridge's list-changes): a player, the GM or the AI. */
export interface EveryoneChange {
  kind: 'human' | 'ai';
  id: string;
  at: string;
  by: string;
  summary: string;
  lines: string[];
  canUndo: boolean;
  /** Also wrote the AI Tool's own data (a reveal): a planned undo cannot take it back. */
  ownData: boolean;
  undone: boolean;
  undoneBy: string;
  requestedBy: string;
  mode: string;
  feature: string;
  /** How many changes an undo entry took back, when the backend says. */
  covers: number | null;
  things: { uuid: string; name: string | null }[];
}

/** What list-changes answers: the changes and an optional note ("older changes are not kept"). */
export interface EveryoneList {
  changes: EveryoneChange[];
  note: string;
}

export function readEveryoneChanges(result: unknown): EveryoneList {
  const list = isRecord(result) ? result['changes'] : undefined;
  const changes: EveryoneChange[] = [];
  for (const c of Array.isArray(list) ? list : []) {
    if (!isRecord(c) || str(c['id']) === '') continue;
    const things = Array.isArray(c['things']) ? c['things'] : [];
    changes.push({
      kind: c['kind'] === 'human' ? 'human' : 'ai',
      id: str(c['id']),
      at: str(c['at']),
      by: str(c['by']),
      summary: str(c['summary']),
      lines: strings(c['lines']),
      canUndo: c['canUndo'] === true,
      ownData: c['ownData'] === true,
      undone: c['undone'] === true,
      undoneBy: str(c['undoneBy']),
      requestedBy: str(c['requestedBy']),
      mode: str(c['mode']),
      feature: str(c['feature']),
      covers: typeof c['covers'] === 'number' ? c['covers'] : null,
      things: things.filter(isRecord).map(t => ({
        uuid: str(t['uuid']),
        name: typeof t['name'] === 'string' ? t['name'] : null,
      })),
    });
  }
  return { changes, note: isRecord(result) ? str(result['note']) : '' };
}

export const FILTER_ALL = 'all';
export const FILTER_AI = 'ai';
const PERSON_PREFIX = 'person:';

/** The filter value for one person (by the name shown in the list). */
export function personFilter(name: string): string {
  return PERSON_PREFIX + name;
}

/** An undo or redo a person asked for in a Foundry window or here: theirs, not the AI's. */
function isPersonUndo(change: EveryoneChange): boolean {
  return (
    change.kind === 'ai' &&
    (change.mode === 'undo' || change.feature === 'change-undo') &&
    change.requestedBy !== ''
  );
}

function whoOf(change: EveryoneChange): string {
  if (isPersonUndo(change)) return change.requestedBy;
  return change.by || 'Someone';
}

/** Undoing an undo is a redo: "Undo: Undo: 4 damage" reads "Redo: 4 damage". */
function summaryOf(change: EveryoneChange): string {
  const twice = /^Undo:\s*Undo:\s*/;
  return twice.test(change.summary) ? `Redo: ${change.summary.replace(twice, '')}` : change.summary;
}

export interface FilterOption {
  value: string;
  label: string;
}

/** The choices of the person filter: Everyone, AI, then everyone seen in the list, A to Z. */
export function filterOptions(changes: readonly EveryoneChange[]): FilterOption[] {
  const names = new Set<string>();
  for (const c of changes) if (c.kind === 'human' || isPersonUndo(c)) names.add(whoOf(c));
  const people = [...names]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map(name => ({ value: personFilter(name), label: name }));
  return [{ value: FILTER_ALL, label: 'Everyone' }, { value: FILTER_AI, label: 'AI' }, ...people];
}

/** The changes a filter value keeps (an unknown value keeps all; see `validFilter`). */
export function filterChanges(
  changes: readonly EveryoneChange[],
  filter: string
): EveryoneChange[] {
  if (filter === FILTER_AI) return changes.filter(c => c.kind === 'ai' && !isPersonUndo(c));
  if (filter.startsWith(PERSON_PREFIX)) {
    const name = filter.slice(PERSON_PREFIX.length);
    return changes.filter(c => (c.kind === 'human' || isPersonUndo(c)) && whoOf(c) === name);
  }
  return [...changes];
}

/** The filter to use for a list: the chosen one while it still exists, else all. */
export function validFilter(changes: readonly EveryoneChange[], filter: string): string {
  return filterOptions(changes).some(o => o.value === filter) ? filter : FILTER_ALL;
}

/** The change that undid `change`, when it is in the list. */
export function undoEntryOf(
  change: EveryoneChange,
  all: readonly EveryoneChange[]
): EveryoneChange | null {
  if (!change.undone || !change.undoneBy) return null;
  return all.find(c => c.id === change.undoneBy) ?? null;
}

/** The badge text of an undone change: "Undone", with who when the undo is in the list. */
export function undoneLabel(change: EveryoneChange, all: readonly EveryoneChange[]): string {
  if (!change.undone) return '';
  const entry = undoEntryOf(change, all);
  if (!entry) return 'Undone';
  const who = entry.requestedBy || (entry.kind === 'ai' ? 'the AI Tool' : whoOf(entry));
  return `Undone by ${who}`;
}

/**
 * The undo entry to redo an undone change with: it must be an AI-list change that can itself be
 * undone (a later change to the same things may have blocked that). Redo is undoing that entry.
 */
export function redoTarget(
  change: EveryoneChange,
  all: readonly EveryoneChange[]
): EveryoneChange | null {
  const entry = undoEntryOf(change, all);
  return entry?.kind === 'ai' && entry.canUndo && !entry.undone ? entry : null;
}

/** What the change touched, for "This is not the latest change to <thing>". */
export function thingLabel(change: Pick<EveryoneChange, 'things'>): string {
  const names = change.things.map(t => t.name ?? '').filter(Boolean);
  const [first] = names;
  if (first === undefined) return 'this thing';
  return names.length === 1 ? first : `${first} and ${names.length - 1} more`;
}

/** One row of the Everyone tab, as plain data. */
export interface RowView {
  id: string;
  who: string;
  at: string;
  summary: string;
  lines: string[];
  canUndo: boolean;
  ownData: boolean;
  undone: boolean;
  undoneText: string;
  redoId: string | null;
  thing: string;
}

export function rowView(change: EveryoneChange, all: readonly EveryoneChange[]): RowView {
  const redo = redoTarget(change, all);
  return {
    id: change.id,
    who: whoOf(change),
    at: change.at,
    summary: summaryOf(change),
    lines: change.lines,
    canUndo: change.canUndo && !change.undone,
    ownData: change.ownData,
    undone: change.undone,
    undoneText: undoneLabel(change, all),
    redoId: redo ? redo.id : null,
    thing: thingLabel(change),
  };
}

// ---------------------------------------------------------------------------
// The undo choice

/** A change made after the one being undone, on the same things (plan-undo-changes `later`). */
export interface LaterChange {
  id: string;
  at: string;
  by: string;
  summary: string;
}

/** What plan-undo-changes answers (guarded-write/service.ts on the bridge); the fields used here. */
export interface UndoPlan {
  planId: string;
  summary: string;
  scope: string;
  risk: string;
  requires: { confirmDestructive: boolean };
  diff: { kind: string; text: string }[];
  later: LaterChange[];
  count: number | null;
}

export function readUndoPlan(result: unknown): UndoPlan | null {
  if (!isRecord(result) || str(result['planId']) === '') return null;
  const requires = isRecord(result['requires']) ? result['requires'] : {};
  const diff = Array.isArray(result['diff']) ? result['diff'] : [];
  const later = Array.isArray(result['later']) ? result['later'] : [];
  const count = result['count'];
  return {
    planId: str(result['planId']),
    summary: str(result['summary']),
    scope: str(result['scope']),
    risk: str(result['risk']),
    requires: { confirmDestructive: requires['confirmDestructive'] === true },
    diff: diff.filter(isRecord).map(d => ({ kind: str(d['kind']), text: str(d['text']) })),
    later: later.filter(isRecord).map(l => ({
      id: str(l['id']),
      at: str(l['at']),
      by: str(l['by']),
      summary: str(l['summary']),
    })),
    count: typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : null,
  };
}

/** One line of the plan for the window; notes (what is kept or not restored) are flagged. */
export interface PlanLine {
  text: string;
  note: boolean;
}

export function planLines(plan: UndoPlan): PlanLine[] {
  return plan.diff.filter(d => d.text !== '').map(d => ({ text: d.text, note: d.kind === 'note' }));
}

/** Whether applying the plan needs the second (destructive) confirmation. */
export function needsDestructive(plan: UndoPlan): boolean {
  return plan.requires.confirmDestructive || plan.risk === 'destructive';
}

/**
 * How many changes a rewind plan undoes: the plan view's `count`; a plan from a bridge without it
 * falls back to the number in its summary ("...: 12 changes").
 */
export function rewindCount(plan: UndoPlan): number | null {
  if (plan.count !== null) return plan.count;
  const m = /:\s*(\d+)\s+changes?\s*$/.exec(plan.summary);
  return m?.[1] ? Number(m[1]) : null;
}

/** "Undo all 12 changes" (the count is in the button, so it is read before it is pressed). */
export function rewindButtonLabel(count: number | null): string {
  if (count === null) return 'Undo all changes';
  return count === 1 ? 'Undo 1 change' : `Undo all ${count} changes`;
}

export type UndoStage = 'choose' | 'confirm' | 'rewind-1' | 'rewind-2';
export type UndoKey = 'cancel' | 'just-this' | 'everything-since' | 'rewind' | 'next' | 'apply';

export interface UndoButton {
  key: UndoKey;
  label: string;
  primary?: boolean;
  danger?: boolean;
  /** Disabled until the "I understand" tick is set. */
  needsCheck?: boolean;
}

/** What the undo window shows at one stage of the flow. */
export interface UndoDialogModel {
  stage: UndoStage;
  title: string;
  intro?: string;
  laterTitle?: string;
  later?: LaterChange[];
  lines: PlanLine[];
  /** The second confirmation: a tick before the destructive button works. */
  destructive: boolean;
  advanced?: { title: string; text: string; button: UndoButton };
  buttons: UndoButton[];
}

const CANCEL: UndoButton = { key: 'cancel', label: 'Cancel' };
const REWIND_ADVANCED = {
  title: 'Advanced',
  text: 'Put the whole table back to how it was at this change, not only this one thing.',
  button: { key: 'rewind', label: 'Rewind the whole table to here', danger: true },
} satisfies NonNullable<UndoDialogModel['advanced']>;

function applyButton(plan: UndoPlan, label: string, danger: boolean): UndoButton {
  return { key: 'apply', label, primary: true, danger, needsCheck: needsDestructive(plan) };
}

const changesText = (count: number): string => `${count} ${count === 1 ? 'change' : 'changes'}`;

/**
 * What the window shows at one stage of the flow. Stages:
 *   confirm      a plan of one change (or of everything since): its lines, Cancel / Undo
 *   choose       the change is not the latest on its thing: Just this / Everything since
 *   rewind-1     rewind the whole table: the count and the full list, Cancel / Continue
 *   rewind-2     rewind, asked again with the count on the button
 * `thing` names what the change being undone touched.
 */
export function dialogFor(stage: UndoStage, plan: UndoPlan, thing: string): UndoDialogModel {
  const lines = planLines(plan);
  if (stage === 'choose') {
    return {
      stage,
      title: 'Undo this change?',
      intro: `This is not the latest change to ${thing}.`,
      laterTitle: 'Changed since then:',
      later: plan.later,
      lines: [],
      destructive: false,
      advanced: REWIND_ADVANCED,
      buttons: [
        CANCEL,
        { key: 'just-this', label: 'Just this', primary: true },
        { key: 'everything-since', label: 'Everything since' },
      ],
    };
  }
  if (stage === 'rewind-1') {
    const count = rewindCount(plan);
    return {
      stage,
      title: 'Rewind the whole table?',
      intro:
        count === null
          ? 'This undoes every change at the table since then, not only this one:'
          : `This undoes every change at the table since then: ${changesText(count)}, listed below.`,
      lines,
      destructive: false,
      buttons: [CANCEL, { key: 'next', label: 'Continue', primary: true }],
    };
  }
  if (stage === 'rewind-2') {
    const count = rewindCount(plan);
    return {
      stage,
      title: 'Are you sure?',
      intro:
        count === null
          ? 'Everything at the table goes back to how it was. This is a big change to the live game.'
          : `Everything at the table goes back to how it was: ${changesText(count)} will be undone. This is a big change to the live game.`,
      lines: [],
      destructive: true,
      buttons: [CANCEL, applyButton(plan, rewindButtonLabel(count), true)],
    };
  }
  const everything = plan.scope === 'everything-since';
  return {
    stage: 'confirm',
    title: everything ? 'Undo everything since?' : 'Undo this change?',
    intro: plan.summary,
    lines,
    destructive: needsDestructive(plan),
    // The latest change on its thing: the rewind is under Advanced here too, as in Foundry.
    ...(!everything && plan.later.length === 0 ? { advanced: REWIND_ADVANCED } : {}),
    buttons: [CANCEL, applyButton(plan, 'Undo', false)],
  };
}

/**
 * Whether an undo entry took back more than one change: its `covers` count when the backend sends
 * one (plan-undo-changes entries); for an older entry, more than one line is the hint.
 */
export function coversSeveral(undo: EveryoneChange | null): boolean {
  if (!undo) return false;
  if (undo.covers !== null) return undo.covers > 1;
  return undo.lines.length > 1;
}

/**
 * What the Redo confirm shows. Redo undoes the undo entry, and one undo can cover several changes
 * (Everything since, a rewind): then all of them come back, so it says so and lists the undo
 * entry's lines instead of this row's.
 */
export function redoConfirm(
  change: EveryoneChange,
  all: readonly EveryoneChange[]
): { summary: string; lines: string[] } {
  const row = rowView(change, all);
  const undo = redoTarget(change, all);
  if (undo && coversSeveral(undo)) {
    return {
      summary:
        `Redo: ${row.summary}. It was undone together with other changes in ` +
        `"${summaryOf(undo)}"; the redo brings all of them back (the lines below).`,
      lines: undo.lines,
    };
  }
  return { summary: `Redo: ${row.summary}`, lines: row.lines };
}

/** Which stage the first plan (of one change) opens: a change with later ones on its thing asks. */
export function firstStage(plan: UndoPlan): UndoStage {
  return plan.later.length > 0 ? 'choose' : 'confirm';
}

/** The scope a plan-undo-changes call asks for. */
export interface UndoScope {
  scope: 'just-this' | 'everything-since' | 'world-since';
  rewindTable?: true;
}

/**
 * The step after a button: `{ stage }` to show another stage with the plan already in hand,
 * `{ plan, stage }` to plan again first, `{ apply: true }` to apply the plan, or `{ done: true }`
 * to stop.
 */
export type UndoStep = { done: true } | { apply: true } | { stage: UndoStage; plan?: UndoScope };

export function nextStep(stage: UndoStage, key: UndoKey | null): UndoStep {
  if (key === null || key === 'cancel') return { done: true };
  if (stage === 'choose') {
    if (key === 'just-this') return { stage: 'confirm' };
    if (key === 'everything-since') {
      return { plan: { scope: 'everything-since' }, stage: 'confirm' };
    }
  }
  if ((stage === 'choose' || stage === 'confirm') && key === 'rewind') {
    return { plan: { scope: 'world-since', rewindTable: true }, stage: 'rewind-1' };
  }
  if (stage === 'rewind-1' && key === 'next') return { stage: 'rewind-2' };
  if (key === 'apply' && (stage === 'confirm' || stage === 'rewind-2')) return { apply: true };
  return { done: true };
}

/** The arguments of `plan-undo-changes` for a change and a scope. */
export function planArgs(id: string, scope: UndoScope): Record<string, unknown> {
  return { id, scope: scope.scope, ...(scope.rewindTable ? { rewindTable: true } : {}) };
}
