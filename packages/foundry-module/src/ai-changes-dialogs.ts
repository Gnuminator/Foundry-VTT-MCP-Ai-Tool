/**
 * The Changes window's undo dialogs (I-109 part 4): pure functions that turn an undo plan
 * (the backend's `plan-undo-changes` answer) into the text and buttons of each dialog, so the
 * wording and the escaping are tested without Foundry. The window asks them through one
 * `ask(spec)` call (a Foundry DialogV2 in the browser, a fake in tests) that answers with the
 * clicked button's `action`, or null when the dialog was closed.
 */
import { escapeHtml, formatLocalTime, type ChangeRow } from './ai-changes-model.js';

export interface DialogButton {
  action: string;
  label: string;
  default?: boolean;
}

export interface DialogSpec {
  title: string;
  /** HTML. A `<button data-choice="x">` inside it answers `x` when clicked. */
  content: string;
  buttons: DialogButton[];
}

/** A later change to the same thing (the backend's `LaterChange`). */
export interface LaterChange {
  id: string;
  at: string;
  by: string;
  summary: string;
}

/** What the window needs from a `plan-undo-changes` answer. */
export interface UndoPlan {
  planId: string;
  summary: string;
  /** How many changes the plan undoes, or null when the backend did not say. */
  count: number | null;
  /** The readable diff lines (without the notes). */
  lines: string[];
  /** The notes ("Kept, changed later: ...", "Not restored: ..."). */
  notes: string[];
  /** Later live changes to the same thing (`just-this` plans only). */
  later: LaterChange[];
  confirmDestructive: boolean;
}

export const ACTION_YES = 'yes';
export const ACTION_CANCEL = 'cancel';
export const CHOICE_JUST_THIS = 'just-this';
export const CHOICE_EVERYTHING_SINCE = 'everything-since';
export const CHOICE_REWIND = 'rewind';

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Read a `plan-undo-changes` answer; throws when it carries no plan id (nothing could be applied). */
export function parsePlan(result: unknown): UndoPlan {
  const r = (result ?? {}) as Record<string, unknown>;
  const planId = text(r.planId);
  if (planId === '') throw new Error('The AI Tool bridge did not return an undo plan');
  const summary = text(r.summary);
  const diff = Array.isArray(r.diff) ? (r.diff as Array<Record<string, unknown>>) : [];
  const lines: string[] = [];
  const notes: string[] = [];
  for (const line of diff) {
    const t = text(line?.text).trim();
    if (t === '') continue;
    (line.kind === 'note' ? notes : lines).push(t);
  }
  const later: LaterChange[] = [];
  for (const raw of Array.isArray(r.later) ? (r.later as Array<Record<string, unknown>>) : []) {
    const id = text(raw?.id);
    if (id === '') continue;
    later.push({ id, at: text(raw.at), by: text(raw.by), summary: text(raw.summary) });
  }
  const fromSummary = /:\s*(\d+) changes?\b/.exec(summary);
  const count =
    typeof r.count === 'number' && Number.isFinite(r.count)
      ? r.count
      : fromSummary
        ? Number(fromSummary[1])
        : null;
  const requires = (r.requires ?? {}) as { confirmDestructive?: unknown };
  return {
    planId,
    summary,
    count,
    lines,
    notes,
    later,
    confirmDestructive: requires.confirmDestructive === true,
  };
}

function list(lines: readonly string[]): string {
  if (lines.length === 0) return '';
  return `<div class="fmb-ai-scroll"><ul class="fmb-ai-diff">${lines
    .map(line => `<li>${escapeHtml(line)}</li>`)
    .join('')}</ul></div>`;
}

function notesHtml(notes: readonly string[]): string {
  return notes.map(note => `<p class="fmb-ai-plan-note">${escapeHtml(note)}</p>`).join('');
}

function changes(n: number | null): string {
  return n === null ? 'the changes' : `${n} change${n === 1 ? '' : 's'}`;
}

const cancel: DialogButton = { action: ACTION_CANCEL, label: 'Cancel' };

/** Undo one change: what will be reverted. The undo is refused if the thing was edited since. */
export function undoPlanDialog(row: ChangeRow, plan: UndoPlan, rewind = false): DialogSpec {
  const advanced = rewind
    ? advancedRewind('This also undoes what everyone at the table did since then, on anything.')
    : '';
  return {
    title: 'Undo change',
    content:
      `<p>Undo this change?</p><p><strong>${escapeHtml(row.summary)}</strong></p>` +
      `${list(plan.lines)}${notesHtml(plan.notes)}` +
      `<p>If something was edited since, the undo is refused and nothing is changed.</p>${advanced}`,
    buttons: [{ action: ACTION_YES, label: 'Undo', default: true }, cancel],
  };
}

/** The Advanced section with the whole-table rewind (its button answers with CHOICE_REWIND). */
function advancedRewind(explain: string): string {
  return (
    '<details class="fmb-ai-advanced"><summary>Advanced</summary>' +
    `<p>${explain}</p>` +
    `<button type="button" class="fmb-ai-btn" data-choice="${CHOICE_REWIND}">` +
    'Rewind the whole table to here</button></details>'
  );
}

/** Bring a change back (undo the undo that took it back). */
export function redoDialog(row: ChangeRow, undo?: ChangeRow): DialogSpec {
  // One undo can cover several changes (Everything since): a redo brings all of them back.
  const whole =
    undo && undo.coversSeveral
      ? `<p>It was undone together with other changes in <strong>${escapeHtml(
          undo.summary
        )}</strong>. The redo brings all of them back.</p>`
      : '';
  return {
    title: 'Redo change',
    content:
      `<p>Bring this change back?</p><p><strong>${escapeHtml(row.summary)}</strong></p>${whole}` +
      '<p>This undoes the undo. If something was edited since, it is refused and nothing is changed.</p>',
    buttons: [{ action: ACTION_YES, label: 'Redo', default: true }, cancel],
  };
}

/** The change is not the latest on its thing: list what came after, and offer the choices. */
export function laterChoiceDialog(row: ChangeRow, later: readonly LaterChange[]): DialogSpec {
  const items = later
    .map(
      l =>
        `<li>${escapeHtml(l.by || 'Someone')}: ${escapeHtml(l.summary)} (${escapeHtml(
          formatLocalTime(l.at)
        )})</li>`
    )
    .join('');
  const advanced = advancedRewind(
    'This also undoes what everyone else at the table did since then, on anything.'
  );
  return {
    title: 'Undo change',
    content:
      `<p>This is not the latest change to ${escapeHtml(row.thing || 'the same thing')}.</p>` +
      `<p><strong>${escapeHtml(row.summary)}</strong></p>` +
      '<p>These came after it:</p>' +
      `<div class="fmb-ai-scroll"><ul class="fmb-ai-diff">${items}</ul></div>` +
      '<p><strong>Just this</strong> undoes only this change and keeps the later ones. ' +
      `<strong>Everything since</strong> undoes this change and the later ones too.</p>${advanced}`,
    buttons: [
      { action: CHOICE_JUST_THIS, label: 'Just this', default: true },
      { action: CHOICE_EVERYTHING_SINCE, label: 'Everything since' },
      cancel,
    ],
  };
}

/** "Everything since": the full list of what goes back. */
export function everythingSinceDialog(row: ChangeRow, plan: UndoPlan): DialogSpec {
  return {
    title: 'Undo everything since',
    content:
      `<p>This undoes ${escapeHtml(changes(plan.count))} to ${escapeHtml(
        row.thing || 'the same thing'
      )}, ` +
      `from this one on:</p><p><strong>${escapeHtml(row.summary)}</strong></p>` +
      `${list(plan.lines)}${notesHtml(plan.notes)}` +
      '<p>If something was edited since, the undo is refused and nothing is changed.</p>',
    buttons: [{ action: ACTION_YES, label: 'Undo everything since', default: true }, cancel],
  };
}

/** Rewind, step 1: the count and the full list. */
export function rewindFirstDialog(row: ChangeRow, plan: UndoPlan): DialogSpec {
  return {
    title: 'Rewind the whole table',
    content:
      `<p>This undoes ${escapeHtml(changes(plan.count))} by everyone at the table since ` +
      `${escapeHtml(formatLocalTime(row.at))}.</p>` +
      `${list(plan.lines)}${notesHtml(plan.notes)}` +
      '<p>Players, the GM and the AI are all included. You can undo the rewind afterwards ' +
      'with Redo.</p>',
    buttons: [
      { action: ACTION_YES, label: 'Continue' },
      { ...cancel, default: true },
    ],
  };
}

/** Rewind, step 2: ask again, with the count on the button. */
export function rewindSecondDialog(plan: UndoPlan): DialogSpec {
  const label =
    plan.count === null
      ? 'Undo all changes'
      : plan.count === 1
        ? 'Undo 1 change'
        : `Undo all ${plan.count} changes`;
  return {
    title: 'Rewind the whole table',
    content:
      `<p>Are you sure? This undoes ${escapeHtml(changes(plan.count))} by everyone at the ` +
      'table.</p><p>If something was edited since, the rewind is refused and nothing is changed.</p>',
    buttons: [
      { action: ACTION_YES, label },
      { ...cancel, default: true },
    ],
  };
}
