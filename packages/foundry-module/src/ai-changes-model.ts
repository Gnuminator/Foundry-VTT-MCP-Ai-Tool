/**
 * The "Changes" window's data model and HTML (I-108, I-109 part 4): pure functions, so the
 * rows, their state text, the filter and the escaping are tested without Foundry.
 *
 * The list is the backend's `list-changes` result (everyone's changes: players, the GM and the
 * AI). A bridge that does not know `list-changes` yet answers only `list-recent-changes` (the
 * AI's changes); both shapes are read into the same {@link ChangeEntry}. Every string that comes
 * from the backend is escaped before it goes into the HTML. The undo dialogs are in
 * `ai-changes-dialogs.ts`.
 */

/** One change, from either `list-changes` or `list-recent-changes`. */
export interface ChangeEntry {
  /** What undo takes: `act:<actionId>` (a person's) or the audit changeId (the AI's). */
  id: string;
  kind: 'human' | 'ai';
  at: string;
  /** The person's name, or `AI`. */
  by: string;
  userId: string;
  summary: string;
  lines: string[];
  feature: string;
  mode: 'apply' | 'undo';
  /** Who asked, when a GM did it from a window in Foundry or the dashboard (absent for Claude). */
  requestedBy: string;
  /** The first thing it touched, by name ("Ireena"), or empty. */
  thing: string;
  canUndo: boolean;
  undone: boolean;
  /** The changeId of the undo entry that undid it. */
  undoneBy: string;
  /**
   * For an undo entry: it took back more than one change (the backend's `covers` count; an older
   * bridge sends none, then more than one line is the hint), so a redo brings all of them back.
   */
  coversSeveral: boolean;
}

/** What the window shows for one entry. */
export interface ChangeRow {
  id: string;
  /** Local time, HH:MM. */
  time: string;
  /** ISO time, for the dialogs. */
  at: string;
  /** The summary as shown ("Undo of ..." for an undo entry). */
  summary: string;
  /** The feature, readable ("live play"), for the AI's changes. */
  feature: string;
  isUndo: boolean;
  isAi: boolean;
  /** Who made it: the person's name, or `AI`. */
  who: string;
  /** Who asked ("by Danni" is shown), or empty when Claude or the dashboard did. */
  requestedBy: string;
  /** The thing it changed, by name, or empty. */
  thing: string;
  /** "undone" when a later undo reverted this change, else empty. */
  state: string;
  /** Who undid it ("Danni"), when the undo entry is in the list and says so. */
  undoneByWho: string;
  diff: string[];
  /** The Undo button is offered. */
  canUndo: boolean;
  /** The change that took this one back, when the Redo button is offered (undoing that brings this back). */
  redoId: string;
  /** An undo entry that took back more than one change (see `ChangeEntry.coversSeveral`). */
  coversSeveral: boolean;
}

/** A person the "Show" filter can pick. */
export interface ChangeUser {
  id: string;
  name: string;
}

export type ChangesStatus = 'loading' | 'ready' | 'error';

/** Everything the window renders. */
export interface ChangesView {
  status: ChangesStatus;
  rows: ChangeRow[];
  /** The one-line message when `status` is `error`. */
  error: string;
  /** A line from the backend about the list (it may be incomplete, or the history is off). */
  note: string;
  /** How many entries were asked for (20, or 100 after "Show more"). */
  limit: number;
  /** The change whose undo is running (its button is disabled). */
  busyId: string | null;
  /** Entries whose diff is expanded; kept across refreshes. */
  openIds: ReadonlySet<string>;
  /** `all`, `ai` or `user:<id>`. */
  filter: string;
  users: ChangeUser[];
  /** The bridge is older and lists only the AI's changes: no filter, no redo. */
  legacy: boolean;
}

export const FIRST_PAGE_LIMIT = 20;
export const MORE_LIMIT = 100;
export const FILTER_ALL = 'all';
export const FILTER_AI = 'ai';
const FILTER_USER_PREFIX = 'user:';

/** Escape a value for HTML text and quoted attributes (Foundry's helper when it exists). */
export function escapeHtml(value: unknown): string {
  const foundryEscape = (globalThis as { foundry?: { utils?: { escapeHTML?: unknown } } }).foundry
    ?.utils?.escapeHTML;
  const text =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : '';
  if (typeof foundryEscape === 'function') return String(foundryEscape(text));
  return text.replace(
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

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function textLines(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((l): l is string => typeof l === 'string') : [];
}

/**
 * The `list-changes` args for a filter value (`all`, `ai`, `user:<id>`) and a page size. A person
 * goes by name: the backend matches a window undo by its `requestedBy`, which is the name.
 */
export function filterArgs(
  filter: string,
  limit: number,
  users: readonly ChangeUser[] = []
): Record<string, unknown> {
  if (filter === FILTER_AI) return { limit, source: 'ai' };
  if (filter.startsWith(FILTER_USER_PREFIX) && filter.length > FILTER_USER_PREFIX.length) {
    const id = filter.slice(FILTER_USER_PREFIX.length);
    return { limit, person: users.find(u => u.id === id)?.name ?? id };
  }
  return { limit };
}

/** The filter value for one person. */
export function userFilter(userId: string): string {
  return `${FILTER_USER_PREFIX}${userId}`;
}

/** A filter value the select can show: `user:<id>` of someone who is gone falls back to `all`. */
export function validFilter(filter: string, users: readonly ChangeUser[]): string {
  if (filter === FILTER_ALL || filter === FILTER_AI) return filter;
  return users.some(u => userFilter(u.id) === filter) ? filter : FILTER_ALL;
}

/** One raw entry of `list-changes` (`id`) or `list-recent-changes` (`changeId`), or null when malformed. */
function parseEntry(raw: unknown): ChangeEntry | null {
  const c = (raw ?? {}) as Record<string, unknown>;
  const isNew = typeof c.id === 'string' && c.id !== '';
  const id = isNew ? text(c.id) : text(c.changeId);
  if (id === '') return null;
  const things = Array.isArray(c.things) ? (c.things as Array<Record<string, unknown>>) : [];
  const undoneBy = text(c.undoneBy);
  const mode = c.mode === 'undo' ? 'undo' : 'apply';
  if (isNew) {
    const kind = c.kind === 'human' ? 'human' : 'ai';
    const lines = textLines(c.lines);
    return {
      id,
      kind,
      at: text(c.at),
      by: kind === 'ai' ? 'AI' : text(c.by),
      userId: text(c.userId),
      summary: text(c.summary),
      lines,
      feature: text(c.feature),
      mode,
      requestedBy: text(c.requestedBy),
      thing: text(things[0]?.name),
      canUndo: c.canUndo === true,
      undone: c.undone === true || undoneBy !== '',
      undoneBy,
      coversSeveral: typeof c.covers === 'number' ? c.covers > 1 : lines.length > 1,
    };
  }
  // The AI-only list of an older bridge.
  const diff = textLines(c.diff);
  return {
    id,
    kind: 'ai',
    at: text(c.appliedAt),
    by: 'AI',
    userId: '',
    summary: text(c.summary),
    lines: diff,
    feature: text(c.feature),
    mode,
    requestedBy: text(c.requestedBy),
    thing: '',
    canUndo: c.canUndo === true,
    undone: undoneBy !== '',
    undoneBy,
    coversSeveral: diff.length > 1,
  };
}

/**
 * The entries in a `list-changes` or `list-recent-changes` result, newest first as the backend
 * sends them. Anything that is not a well-formed entry is dropped.
 */
export function parseChanges(result: unknown): ChangeEntry[] {
  const list = (result as { changes?: unknown } | null | undefined)?.changes;
  if (!Array.isArray(list)) return [];
  const out: ChangeEntry[] = [];
  for (const raw of list) {
    const entry = parseEntry(raw);
    if (entry) out.push(entry);
  }
  return out;
}

/** The backend's line about the list (`list-changes` only), or empty. */
export function parseNote(result: unknown): string {
  return text((result as { note?: unknown } | null | undefined)?.note);
}

/**
 * The row for one entry. `byId` is every entry of the list, to find the undo entry that took
 * this one back (who undid it, and whether Redo is offered).
 */
export function buildChangeRow(
  entry: ChangeEntry,
  byId: ReadonlyMap<string, ChangeEntry> = new Map(),
  legacy = false
): ChangeRow {
  const isUndo = entry.mode === 'undo';
  // An undo or redo a person asked for in a Foundry window is theirs, not the AI's.
  const personUndo =
    entry.kind === 'ai' && (isUndo || entry.feature === 'change-undo') && entry.requestedBy !== '';
  const isAi = entry.kind === 'ai' && !personUndo;
  const undoer = entry.undone ? byId.get(entry.undoneBy) : undefined;
  const redoable = !legacy && undoer !== undefined && undoer.canUndo && !undoer.undone;
  return {
    id: entry.id,
    time: formatLocalTime(entry.at),
    at: entry.at,
    summary: isUndo ? undoSummary(entry.summary) : entry.summary,
    feature: isAi ? readableFeature(entry.feature) : '',
    isUndo,
    isAi,
    who: personUndo ? entry.requestedBy : entry.by,
    requestedBy: entry.requestedBy,
    thing: entry.thing,
    state: entry.undone ? 'undone' : '',
    undoneByWho: undoer?.requestedBy ?? '',
    diff: entry.lines,
    canUndo: entry.canUndo && !entry.undone && !isUndo,
    redoId: redoable ? undoer.id : '',
    coversSeveral: entry.coversSeveral,
  };
}

/** An undo entry's line: undoing an undo is a redo. */
function undoSummary(summary: string): string {
  const undone = summary.replace(/^Undo:\s*/, '');
  if (/^Undo:\s*/.test(undone)) return `Redo: ${undone.replace(/^Undo:\s*/, '')}`;
  if (/^Undo\b/.test(undone)) return `Redo of ${undone}`;
  return `Undo of ${undone}`;
}

/** The rows for a `list-changes` (or, on an older bridge, `list-recent-changes`) result. */
export function buildRows(result: unknown, options: { legacy?: boolean } = {}): ChangeRow[] {
  const entries = parseChanges(result);
  const byId = new Map(entries.map(e => [e.id, e]));
  return entries.map(e => buildChangeRow(e, byId, options.legacy === true));
}

/**
 * The rows the filter shows, as the dashboard's filter does: "AI" leaves out the undos and
 * redos a person ran from a window, and a person's filter shows only that person's own changes
 * and undos. `rows` keeps the whole page, so a redo still finds its undo entry.
 */
export function shownRows(view: Pick<ChangesView, 'filter' | 'rows'>): ChangeRow[] {
  if (view.filter === FILTER_AI) return view.rows.filter(r => r.isAi);
  if (view.filter.startsWith(FILTER_USER_PREFIX)) return view.rows.filter(r => !r.isAi);
  return view.rows;
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
  const tag = (label: string): string => `<span class="fmb-ai-tag">${escapeHtml(label)}</span>`;
  const state = row.state
    ? `<span class="fmb-ai-state">${escapeHtml(
        row.undoneByWho ? `${row.state} by ${row.undoneByWho}` : row.state
      )}</span>`
    : '';
  const meta =
    (row.isAi ? tag('AI') : row.who ? tag(`by ${row.who}`) : '') +
    (row.feature ? tag(row.feature) : '') +
    (row.isAi && row.requestedBy ? tag(`by ${row.requestedBy}`) : '') +
    state;
  const diff =
    row.diff.length > 0
      ? `<details class="fmb-ai-details" data-change-id="${id}"${view.openIds.has(row.id) ? ' open' : ''}>` +
        `<summary>Changes (${row.diff.length})</summary>` +
        `<ul class="fmb-ai-diff">${row.diff.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` +
        '</details>'
      : '';
  const disabled = view.busyId !== null ? ' disabled' : '';
  const button = (action: string, changeId: string, icon: string, label: string): string =>
    `<button type="button" class="fmb-ai-btn fmb-ai-undo-btn" data-action="${action}" ` +
    `data-change-id="${escapeHtml(changeId)}"${disabled}><i class="fa-solid ${icon}"></i> ${label}</button>`;
  const action = row.canUndo
    ? button('undo', row.id, 'fa-rotate-left', 'Undo')
    : row.redoId
      ? button('redo', row.redoId, 'fa-rotate-right', 'Redo')
      : '';
  return (
    `<li class="${classes}" data-change-id="${id}">` +
    `<div class="fmb-ai-head"><span class="fmb-ai-time">${escapeHtml(row.time)}</span>` +
    `<span class="fmb-ai-summary">${escapeHtml(row.summary)}</span></div>` +
    `<div class="fmb-ai-meta">${meta}</div>${diff}${
      action ? `<div class="fmb-ai-actions">${action}</div>` : ''
    }</li>`
  );
}

function renderFilter(view: ChangesView): string {
  if (view.legacy) return '';
  const option = (value: string, label: string): string =>
    `<option value="${escapeHtml(value)}"${view.filter === value ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  const people = view.users.map(u => option(userFilter(u.id), u.name)).join('');
  return `<label class="fmb-ai-filter">Show: <select data-fmb-filter>${option(FILTER_ALL, 'All')}${option(FILTER_AI, 'AI')}${people}</select></label>`;
}

/** The window's whole content as an HTML string. */
export function renderChangesHtml(view: ChangesView): string {
  const refresh =
    '<button type="button" class="fmb-ai-btn" data-action="refresh">' +
    '<i class="fa-solid fa-rotate"></i> Refresh</button>';
  const rows = shownRows(view);
  let notice = '';
  if (view.status === 'error') {
    notice = `<p class="fmb-ai-notice fmb-ai-error" role="alert">${escapeHtml(view.error)}</p>`;
  } else if (view.status === 'loading' && rows.length === 0) {
    notice = '<p class="fmb-ai-notice">Loading the changes...</p>';
  } else if (view.status === 'ready' && rows.length === 0) {
    // A page can be full of rows the filter hides; a later page may still have some.
    const morePages = view.rows.length > 0 && canShowMore(view);
    notice = `<p class="fmb-ai-notice">${
      view.legacy
        ? 'No AI changes yet.'
        : view.filter === FILTER_ALL
          ? 'No changes yet.'
          : morePages
            ? 'No changes match this filter on this page. Show more may find some.'
            : 'No changes match this filter.'
    }</p>`;
  }
  if (view.note !== '' && view.status !== 'error') {
    notice += `<p class="fmb-ai-notice">${escapeHtml(view.note)}</p>`;
  }
  const list =
    rows.length > 0
      ? `<ol class="fmb-ai-list">${rows.map(row => renderRow(row, view)).join('')}</ol>`
      : '';
  const more = canShowMore(view)
    ? '<div class="fmb-ai-more"><button type="button" class="fmb-ai-btn" data-action="more">' +
      'Show more</button></div>'
    : '';
  return `<div class="fmb-ai-toolbar">${renderFilter(view)}${refresh}</div>${notice}${list}${more}`;
}
