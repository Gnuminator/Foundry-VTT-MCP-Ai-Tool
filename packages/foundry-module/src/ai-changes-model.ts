/**
 * The "AI changes" window's data model and HTML (I-108): pure functions, so the
 * rows, their state text and the escaping are tested without Foundry.
 *
 * The list is the backend's `list-recent-changes` result (the same entries as
 * the dashboard's Recent Changes). Every string that comes from the backend is
 * escaped before it goes into the HTML.
 */

/** One entry of `list-recent-changes` (the backend's `RecentChange`). */
export interface AiChange {
  changeId: string;
  feature: string;
  summary: string;
  mode: 'apply' | 'undo';
  appliedAt: string;
  risk: string;
  diff: string[];
  undoOf?: string;
  undoneBy?: string;
  canUndo: boolean;
}

/** What the window shows for one entry. */
export interface ChangeRow {
  id: string;
  /** Local time, HH:MM. */
  time: string;
  /** The summary as shown ("Undo of ..." for an undo entry). */
  summary: string;
  /** The feature, readable ("live play"). */
  feature: string;
  isUndo: boolean;
  /** "undone" when a later undo reverted this change, else empty. */
  state: string;
  diff: string[];
  canUndo: boolean;
}

export type ChangesStatus = 'loading' | 'ready' | 'error';

/** Everything the window renders. */
export interface ChangesView {
  status: ChangesStatus;
  rows: ChangeRow[];
  /** The one-line message when `status` is `error`. */
  error: string;
  /** How many entries were asked for (20, or 100 after "Show more"). */
  limit: number;
  /** The change whose undo is running (its button is disabled). */
  busyId: string | null;
  /** Entries whose diff is expanded; kept across refreshes. */
  openIds: ReadonlySet<string>;
}

export const FIRST_PAGE_LIMIT = 20;
export const MORE_LIMIT = 100;

/** Escape a value for HTML text and quoted attributes (Foundry's helper when it exists). */
export function escapeHtml(value: unknown): string {
  const foundryEscape = (globalThis as { foundry?: { utils?: { escapeHTML?: unknown } } }).foundry
    ?.utils?.escapeHTML;
  if (typeof foundryEscape === 'function') return String(foundryEscape(String(value ?? '')));
  return String(value ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[c] as string
  );
}

/** HH:MM in the viewer's local time; `--:--` when the date is missing or invalid. */
export function formatLocalTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--';
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
}

function readableFeature(feature: string): string {
  return feature.replace(/[-_]+/g, ' ').trim();
}

/** The row for one entry. */
export function buildChangeRow(change: AiChange): ChangeRow {
  const isUndo = change.mode === 'undo';
  const undone = typeof change.undoneBy === 'string' && change.undoneBy !== '';
  return {
    id: change.changeId,
    time: formatLocalTime(change.appliedAt),
    summary: isUndo ? `Undo of ${change.summary.replace(/^Undo:\s*/, '')}` : change.summary,
    feature: readableFeature(change.feature),
    isUndo,
    state: undone ? 'undone' : '',
    diff: change.diff,
    canUndo: change.canUndo === true && !undone && !isUndo,
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * The entries in a `list-recent-changes` result, newest first as the backend
 * sends them. Anything that is not a well-formed entry is dropped.
 */
export function parseChanges(result: unknown): AiChange[] {
  const list = (result as { changes?: unknown } | null | undefined)?.changes;
  if (!Array.isArray(list)) return [];
  const out: AiChange[] = [];
  for (const raw of list) {
    const c = (raw ?? {}) as Record<string, unknown>;
    if (typeof c.changeId !== 'string' || c.changeId === '') continue;
    const undoneBy = text(c.undoneBy);
    const undoOf = text(c.undoOf);
    out.push({
      changeId: c.changeId,
      feature: text(c.feature),
      summary: text(c.summary),
      mode: c.mode === 'undo' ? 'undo' : 'apply',
      appliedAt: text(c.appliedAt),
      risk: text(c.risk),
      diff: Array.isArray(c.diff) ? c.diff.filter((l): l is string => typeof l === 'string') : [],
      ...(undoOf ? { undoOf } : {}),
      ...(undoneBy ? { undoneBy } : {}),
      canUndo: c.canUndo === true,
    });
  }
  return out;
}

/** The rows for a `list-recent-changes` result. */
export function buildRows(result: unknown): ChangeRow[] {
  return parseChanges(result).map(buildChangeRow);
}

/** Whether "Show more" is offered: the first page came back full. */
export function canShowMore(view: Pick<ChangesView, 'limit' | 'rows'>): boolean {
  return view.limit < MORE_LIMIT && view.rows.length >= view.limit;
}

function renderRow(row: ChangeRow, view: ChangesView): string {
  const id = escapeHtml(row.id);
  const classes = ['fmb-ai-row', row.isUndo ? 'fmb-ai-undo' : '', row.state ? 'fmb-ai-undone' : '']
    .filter(Boolean)
    .join(' ');
  const state = row.state ? `<span class="fmb-ai-state">${escapeHtml(row.state)}</span>` : '';
  const tag = row.feature ? `<span class="fmb-ai-tag">${escapeHtml(row.feature)}</span>` : '';
  const diff =
    row.diff.length > 0
      ? `<details class="fmb-ai-details" data-change-id="${id}"${view.openIds.has(row.id) ? ' open' : ''}>` +
        `<summary>Changes (${row.diff.length})</summary>` +
        `<ul class="fmb-ai-diff">${row.diff.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` +
        '</details>'
      : '';
  const undo = row.canUndo
    ? `<button type="button" class="fmb-ai-btn fmb-ai-undo-btn" data-action="undo" data-change-id="${id}"` +
      `${view.busyId !== null ? ' disabled' : ''}>` +
      `<i class="fa-solid fa-rotate-left"></i> Undo</button>`
    : '';
  return (
    `<li class="${classes}" data-change-id="${id}">` +
    `<div class="fmb-ai-head"><span class="fmb-ai-time">${escapeHtml(row.time)}</span>` +
    `<span class="fmb-ai-summary">${escapeHtml(row.summary)}</span></div>` +
    `<div class="fmb-ai-meta">${tag}${state}</div>${diff}${
      undo ? `<div class="fmb-ai-actions">${undo}</div>` : ''
    }</li>`
  );
}

/** The window's whole content as an HTML string. */
export function renderChangesHtml(view: ChangesView): string {
  const refresh =
    '<button type="button" class="fmb-ai-btn" data-action="refresh">' +
    '<i class="fa-solid fa-rotate"></i> Refresh</button>';
  let notice = '';
  if (view.status === 'error') {
    notice = `<p class="fmb-ai-notice fmb-ai-error" role="alert">${escapeHtml(view.error)}</p>`;
  } else if (view.status === 'loading' && view.rows.length === 0) {
    notice = '<p class="fmb-ai-notice">Loading the changes...</p>';
  } else if (view.status === 'ready' && view.rows.length === 0) {
    notice = '<p class="fmb-ai-notice">No AI changes yet.</p>';
  }
  const list =
    view.rows.length > 0
      ? `<ol class="fmb-ai-list">${view.rows.map(row => renderRow(row, view)).join('')}</ol>`
      : '';
  const more = canShowMore(view)
    ? '<div class="fmb-ai-more"><button type="button" class="fmb-ai-btn" data-action="more">' +
      'Show more</button></div>'
    : '';
  return `<div class="fmb-ai-toolbar">${refresh}</div>${notice}${list}${more}`;
}

/** The confirm dialog's body for an undo: what will be reverted, with its diff lines. */
export function renderUndoConfirmHtml(row: ChangeRow): string {
  const lines =
    row.diff.length > 0
      ? `<ul class="fmb-ai-diff">${row.diff.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
      : '';
  return (
    `<p>Undo this change?</p><p><strong>${escapeHtml(row.summary)}</strong></p>${lines}` +
    '<p>If something was edited since, the undo is refused and nothing is changed.</p>'
  );
}
