// Recent Changes, "Everyone" tab (I-109): the pure part. No DOM, no network: app.js renders what
// these functions describe and makes the tool calls. The list comes from `list-changes` (players,
// the GM and the AI, newest first); an undo is planned with `plan-undo-changes` and applied with
// `apply-planned-change`. Tested in src/changes-everyone.test.ts.

/** How many changes the Everyone tab asks for (the tool's own default is 30, its limit 200). */
export const EVERYONE_LIMIT = 100;
export const FILTER_ALL = 'all';
export const FILTER_AI = 'ai';
const PERSON_PREFIX = 'person:';

/** The filter value for one person (by the name shown in the list). */
export function personFilter(name) {
  return PERSON_PREFIX + String(name);
}

function whoOf(change) {
  return typeof change.by === 'string' && change.by ? change.by : 'Someone';
}

/** The choices of the person filter: All, AI, then everyone seen in the list, A to Z. */
export function filterOptions(changes) {
  const names = new Set();
  for (const c of changes) if (c.kind === 'human') names.add(whoOf(c));
  const people = [...names]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map(name => ({ value: personFilter(name), label: name }));
  return [{ value: FILTER_ALL, label: 'Everyone' }, { value: FILTER_AI, label: 'AI' }, ...people];
}

/** The changes a filter value keeps (an unknown value keeps all; see `validFilter`). */
export function filterChanges(changes, filter) {
  if (filter === FILTER_AI) return changes.filter(c => c.kind === 'ai');
  if (typeof filter === 'string' && filter.startsWith(PERSON_PREFIX)) {
    const name = filter.slice(PERSON_PREFIX.length);
    return changes.filter(c => c.kind === 'human' && whoOf(c) === name);
  }
  return changes;
}

/** The filter to use for a list: the chosen one while it still exists, else all. */
export function validFilter(changes, filter) {
  return filterOptions(changes).some(o => o.value === filter) ? filter : FILTER_ALL;
}

/** The change that undid `change`, when it is in the list. */
export function undoEntryOf(change, all) {
  if (!change.undone || !change.undoneBy) return null;
  return all.find(c => c.id === change.undoneBy) || null;
}

/** The badge text of an undone change: "Undone", with who when the undo is in the list. */
export function undoneLabel(change, all) {
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
export function redoTarget(change, all) {
  const entry = undoEntryOf(change, all);
  return entry && entry.kind === 'ai' && entry.canUndo && !entry.undone ? entry : null;
}

/** What the change touched, for "This is not the latest change to <thing>". */
export function thingLabel(change) {
  const names = Array.isArray(change.things)
    ? change.things.map(t => (t && typeof t.name === 'string' ? t.name : '')).filter(Boolean)
    : [];
  if (names.length === 0) return 'this thing';
  return names.length === 1 ? names[0] : `${names[0]} and ${names.length - 1} more`;
}

/** One row of the Everyone tab, as plain data. */
export function rowView(change, all) {
  const redo = redoTarget(change, all);
  return {
    id: change.id,
    kind: change.kind,
    who: whoOf(change),
    at: change.at,
    summary: typeof change.summary === 'string' ? change.summary : '',
    lines: Array.isArray(change.lines) ? change.lines : [],
    canUndo: change.canUndo === true && !change.undone,
    undone: change.undone === true,
    undoneText: undoneLabel(change, all),
    redoId: redo ? redo.id : null,
    thing: thingLabel(change),
  };
}

// ---------------------------------------------------------------------------
// The undo choice

/** The plan's lines for the window: notes (what is kept or not restored) are flagged. */
export function planLines(plan) {
  const diff = Array.isArray(plan && plan.diff) ? plan.diff : [];
  return diff
    .filter(d => d && typeof d.text === 'string')
    .map(d => ({ text: d.text, note: d.kind === 'note' }));
}

/** The later changes of a just-this plan, newest first as the plan has them. */
export function laterOf(plan) {
  return Array.isArray(plan && plan.later) ? plan.later : [];
}

/** Whether applying the plan needs the second (destructive) confirmation. */
export function needsDestructive(plan) {
  return (
    !!plan && (!!(plan.requires && plan.requires.confirmDestructive) || plan.risk === 'destructive')
  );
}

/**
 * How many changes a rewind plan undoes: the plan view's `count`; a plan from a bridge without it
 * falls back to the number in its summary ("...: 12 changes").
 */
export function rewindCount(plan) {
  if (plan && Number.isInteger(plan.count) && plan.count >= 0) return plan.count;
  const m = /:\s*(\d+)\s+changes?\s*$/.exec((plan && plan.summary) || '');
  return m ? Number(m[1]) : null;
}

/** "Undo all 12 changes" (the count is in the button, so it is read before it is pressed). */
export function rewindButtonLabel(count) {
  if (count === null || count === undefined) return 'Undo all changes';
  return count === 1 ? 'Undo 1 change' : `Undo all ${count} changes`;
}

const CANCEL = { key: 'cancel', label: 'Cancel' };

function applyButton(plan, label, danger) {
  return {
    key: 'apply',
    label,
    primary: true,
    danger: !!danger,
    needsCheck: needsDestructive(plan),
  };
}

/**
 * What the window shows at one stage of the flow. Stages:
 *   confirm      a plan of one change (or of everything since): its lines, Cancel / Undo
 *   choose       the change is not the latest on its thing: Just this / Everything since
 *   rewind-1     rewind the whole table: the count and the full list, Cancel / Continue
 *   rewind-2     rewind, asked again with the count on the button
 * `change` is the row being undone (its `thing` names what it touched).
 */
export function dialogFor(stage, plan, change) {
  const lines = planLines(plan);
  if (stage === 'choose') {
    return {
      stage,
      title: 'Undo this change?',
      intro: `This is not the latest change to ${change.thing}.`,
      laterTitle: 'Changed since then:',
      later: laterOf(plan),
      lines: [],
      destructive: false,
      advanced: {
        title: 'Advanced',
        text: 'Put the whole table back to how it was at this change, not only this one thing.',
        button: { key: 'rewind', label: 'Rewind the whole table to here' },
      },
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
          : `This undoes every change at the table since then: ${count} ${count === 1 ? 'change' : 'changes'}, listed below.`,
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
          : `Everything at the table goes back to how it was: ${count} ${count === 1 ? 'change' : 'changes'} will be undone. This is a big change to the live game.`,
      lines: [],
      destructive: true,
      buttons: [CANCEL, applyButton(plan, rewindButtonLabel(count), true)],
    };
  }
  // confirm
  const everything = plan && plan.scope === 'everything-since';
  return {
    stage: 'confirm',
    title: everything ? 'Undo everything since?' : 'Undo this change?',
    intro: (plan && plan.summary) || '',
    lines,
    destructive: needsDestructive(plan),
    buttons: [CANCEL, applyButton(plan, 'Undo', false)],
  };
}

/**
 * Which plan the choice needs next. A plan of one change with later changes on the same thing
 * asks first (`choose`); one without them goes straight to `confirm`.
 */
export function firstStage(plan) {
  return laterOf(plan).length > 0 ? 'choose' : 'confirm';
}

/**
 * The step after a button: `{ stage }` to show another stage with the plan already in hand,
 * `{ plan: { scope, rewindTable? }, stage }` to plan again first, `{ apply: true }` to apply the
 * plan, or `{ done: true }` to stop. The plan to ask for is the same change with another scope.
 */
export function nextStep(stage, key) {
  if (key === 'cancel') return { done: true };
  if (stage === 'choose') {
    if (key === 'just-this') return { stage: 'confirm' };
    if (key === 'everything-since')
      return { plan: { scope: 'everything-since' }, stage: 'confirm' };
    if (key === 'rewind')
      return { plan: { scope: 'world-since', rewindTable: true }, stage: 'rewind-1' };
  }
  if (stage === 'rewind-1' && key === 'next') return { stage: 'rewind-2' };
  if (key === 'apply' && (stage === 'confirm' || stage === 'rewind-2')) return { apply: true };
  return { done: true };
}

/** The arguments of `plan-undo-changes` for a change and a scope. */
export function planArgs(id, scope) {
  const args = { id, scope: scope.scope };
  if (scope.rewindTable) args.rewindTable = true;
  return args;
}
