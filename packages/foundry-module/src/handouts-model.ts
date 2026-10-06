/**
 * The "Handouts" window's data model and HTML (I-108 part 2): pure functions, so the
 * queue, the next page, the read receipts and the escaping are tested without Foundry.
 *
 * The data is the backend's `list-revealed-pages` result (the same one the dashboard's
 * handouts drawer shows): `queue` (staged pages, oldest first) and `pages` (the
 * revealed pages, with `seenBy`). Every string that comes from the backend is
 * escaped before it goes into the HTML.
 */
import { escapeHtml, formatLocalTime } from './ai-changes-model.js';

/** One staged page of `list-revealed-pages` `queue`. */
export interface QueueItem {
  entryId: string;
  uuid: string;
  title: string;
  exists: boolean;
  /** The scene it is queued for; null: any scene. */
  sceneId: string | null;
  /** Foundry user ids it is queued for; empty: every player. */
  players: string[];
}

/** One revealed page of `list-revealed-pages` `pages`. */
export interface RevealedItem {
  uuid: string;
  title: string;
  exists: boolean;
  observable: boolean;
  feature: string;
  /** A reveal copy in "Handouts" (set to the page it copies). */
  copied: boolean;
  /** Foundry user ids it was revealed to; empty: every player. */
  players: string[];
  seenBy: Array<{ userId: string; at: string }>;
}

/** What the window needs to know about the world to name things. */
export interface HandoutsContext {
  /** The scene players are on; null when none is active. */
  activeSceneId: string | null;
  /** A scene's name, or null when it is not known here. */
  sceneName(id: string): string | null;
  /** A user's name, or null when it is not known here. */
  playerName(id: string): string | null;
  /** Every player's user id (the audience of a page revealed to "all players"). */
  playerIds: readonly string[];
}

/** What the window shows for one queued page. */
export interface QueueRow {
  entryId: string;
  uuid: string;
  title: string;
  exists: boolean;
  /** The scene's name, "another scene", or "any scene". */
  sceneText: string;
  /** "for Danni, Chris" or "for all players". */
  audienceText: string;
  /** The page "Reveal next" takes. */
  isNext: boolean;
}

/** One player's read receipt on a revealed page. */
export interface ReceiptTick {
  name: string;
  seen: boolean;
  /** Local time, HH:MM; empty when not opened yet. */
  time: string;
}

/** What the window shows for one revealed page. */
export interface RevealedRow {
  uuid: string;
  title: string;
  exists: boolean;
  observable: boolean;
  audienceText: string;
  ticks: ReceiptTick[];
}

export type HandoutsStatus = 'loading' | 'ready' | 'error';

/** Everything the window renders. */
export interface HandoutsView {
  status: HandoutsStatus;
  /** The one-line message when `status` is `error`. */
  error: string;
  /** The message from the last Remove or Reveal that failed; empty otherwise. */
  actionError: string;
  queue: QueueRow[];
  revealed: RevealedRow[];
  /** The title "Reveal next" would reveal, or null when nothing is queued for the active scene. */
  nextTitle: string | null;
  /** A Remove or a Reveal is running; the buttons are disabled. */
  busy: boolean;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function toQueueItem(raw: unknown): QueueItem | null {
  const q = (raw ?? {}) as Record<string, unknown>;
  const entryId = text(q.entryId);
  const uuid = text(q.uuid);
  if (entryId === '' || uuid === '') return null;
  return {
    entryId,
    uuid,
    title: text(q.title),
    exists: q.exists !== false,
    sceneId: typeof q.sceneId === 'string' && q.sceneId !== '' ? q.sceneId : null,
    players: ids(q.players),
  };
}

function toRevealedItem(raw: unknown): RevealedItem | null {
  const p = (raw ?? {}) as Record<string, unknown>;
  const uuid = text(p.uuid);
  if (uuid === '') return null;
  const seenBy: RevealedItem['seenBy'] = [];
  if (Array.isArray(p.seenBy)) {
    for (const s of p.seenBy) {
      const e = (s ?? {}) as Record<string, unknown>;
      if (text(e.userId) !== '') seenBy.push({ userId: text(e.userId), at: text(e.at) });
    }
  }
  return {
    uuid,
    title: text(p.title),
    exists: p.exists === true,
    observable: p.observable === true,
    feature: text(p.feature),
    copied: typeof p.copiedFrom === 'string' && p.copiedFrom !== '',
    players: ids(p.players),
    seenBy,
  };
}

/** The queue and the revealed pages in a `list-revealed-pages` result; malformed entries are dropped. */
export function parseHandouts(result: unknown): { queue: QueueItem[]; pages: RevealedItem[] } {
  const r = (result ?? {}) as { queue?: unknown; pages?: unknown };
  const queue: QueueItem[] = [];
  for (const raw of Array.isArray(r.queue) ? r.queue : []) {
    const item = toQueueItem(raw);
    if (item) queue.push(item);
  }
  const pages: RevealedItem[] = [];
  for (const raw of Array.isArray(r.pages) ? r.pages : []) {
    const item = toRevealedItem(raw);
    if (item) pages.push(item);
  }
  return { queue, pages };
}

/**
 * The queue entry "Reveal next" takes: the oldest one for the active scene or for any
 * scene (same rule as the dashboard and as `plan-page-reveal` `reveal-next`).
 */
export function findNext(
  queue: readonly QueueItem[],
  activeSceneId: string | null
): QueueItem | null {
  return (
    queue.find(q => q.sceneId === null || activeSceneId === null || q.sceneId === activeSceneId) ??
    null
  );
}

function audienceText(players: readonly string[], ctx: HandoutsContext): string {
  return players.length > 0
    ? `for ${players.map(id => ctx.playerName(id) ?? id).join(', ')}`
    : 'for all players';
}

/** The rows for a `list-revealed-pages` result. */
export function buildHandoutsRows(
  result: unknown,
  ctx: HandoutsContext
): { queue: QueueRow[]; revealed: RevealedRow[]; nextTitle: string | null } {
  const { queue, pages } = parseHandouts(result);
  const next = findNext(queue, ctx.activeSceneId);
  const queueRows = queue.map<QueueRow>(q => ({
    entryId: q.entryId,
    uuid: q.uuid,
    title: q.title || 'Untitled',
    exists: q.exists,
    sceneText: q.sceneId === null ? 'any scene' : (ctx.sceneName(q.sceneId) ?? 'another scene'),
    audienceText: audienceText(q.players, ctx),
    isNext: next !== null && next.entryId === q.entryId,
  }));
  // Handouts the dashboard lists: ones the handouts feature revealed, and their copies.
  const revealed = pages
    .filter(p => p.feature === 'handouts' || p.copied)
    .map<RevealedRow>(p => {
      const audience = p.players.length > 0 ? p.players : [...ctx.playerIds];
      const seen = new Map(p.seenBy.map(s => [s.userId, s]));
      return {
        uuid: p.uuid,
        title: p.exists ? p.title || 'Untitled' : '(page deleted)',
        exists: p.exists,
        observable: p.observable,
        audienceText: audienceText(p.players, ctx),
        ticks: audience.map<ReceiptTick>(id => {
          const s = seen.get(id);
          return {
            name: ctx.playerName(id) ?? id,
            seen: s !== undefined,
            time: s ? formatLocalTime(s.at) : '',
          };
        }),
      };
    });
  return {
    queue: queueRows,
    revealed,
    nextTitle: next ? next.title || 'Untitled' : null,
  };
}

/** What the confirm dialog shows for a reveal plan. */
export interface RevealPlan {
  planId: string;
  summary: string;
  diff: string[];
  note: string;
}

/** The plan in a `plan-page-reveal` result, or null when the result carries no plan. */
export function parseRevealPlan(result: unknown): RevealPlan | null {
  const r = (result ?? {}) as Record<string, unknown>;
  if (typeof r.planId !== 'string' || r.planId === '') return null;
  const diff: string[] = [];
  if (Array.isArray(r.diff)) {
    for (const line of r.diff) {
      const t = typeof line === 'string' ? line : text((line as { text?: unknown } | null)?.text);
      if (t !== '') diff.push(t);
    }
  }
  return { planId: r.planId, summary: text(r.summary), diff, note: text(r.note) };
}

function renderQueueRow(row: QueueRow, view: HandoutsView): string {
  const missing = row.exists ? '' : ' <span class="fmb-ai-state">page deleted</span>';
  const next = row.isNext ? '<span class="fmb-ai-tag">next</span>' : '';
  return (
    `<li class="fmb-ai-row${row.isNext ? ' fmb-ho-next' : ''}" data-entry-id="${escapeHtml(row.entryId)}">` +
    `<div class="fmb-ai-head"><span class="fmb-ai-summary">${escapeHtml(row.title)}${missing}</span>` +
    `<button type="button" class="fmb-ai-btn" data-action="remove" data-page-uuid="${escapeHtml(row.uuid)}"` +
    `${view.busy ? ' disabled' : ''}><i class="fa-solid fa-xmark"></i> Remove</button></div>` +
    `<div class="fmb-ai-meta"><span class="fmb-ai-tag">${escapeHtml(row.sceneText)}</span>` +
    `<span class="fmb-ai-tag">${escapeHtml(row.audienceText)}</span>${next}</div></li>`
  );
}

function renderRevealedRow(row: RevealedRow): string {
  const ticks = row.ticks
    .map(t => {
      const title = t.seen ? `Opened ${escapeHtml(t.time)}` : 'Not opened yet';
      return (
        `<span class="fmb-ho-tick${t.seen ? ' fmb-ho-seen' : ''}" title="${title}">` +
        `${t.seen ? '&#10003;' : '&middot;'} ${escapeHtml(t.name)}</span>`
      );
    })
    .join(' ');
  const hidden = row.observable ? '' : '<span class="fmb-ai-state">not visible in Foundry</span>';
  return (
    '<li class="fmb-ai-row">' +
    `<div class="fmb-ai-head"><span class="fmb-ai-summary">${escapeHtml(row.title)}</span></div>` +
    `<div class="fmb-ai-meta"><span class="fmb-ai-tag">${escapeHtml(row.audienceText)}</span>${hidden}</div>` +
    `<div class="fmb-ho-ticks">${ticks || '<span class="fmb-ai-state">No players known yet.</span>'}</div></li>`
  );
}

/** The window's whole content as an HTML string. The "Show it now" box is never ticked here. */
export function renderHandoutsHtml(view: HandoutsView): string {
  const refresh =
    '<button type="button" class="fmb-ai-btn" data-action="refresh">' +
    '<i class="fa-solid fa-rotate"></i> Refresh</button>';
  const reveal =
    `<button type="button" class="fmb-ai-btn" data-action="reveal"${
      view.nextTitle === null || view.busy ? ' disabled' : ''
    }><i class="fa-solid fa-eye"></i> ${
      view.nextTitle === null ? 'Reveal next' : `Reveal next: ${escapeHtml(view.nextTitle)}`
    }</button>` +
    '<label class="fmb-ho-show"><input type="checkbox" data-show-now> Show it now</label>';
  let notice = '';
  if (view.status === 'error') {
    notice = `<p class="fmb-ai-notice fmb-ai-error" role="alert">${escapeHtml(view.error)}</p>`;
  } else if (view.status === 'loading' && view.queue.length === 0 && view.revealed.length === 0) {
    notice = '<p class="fmb-ai-notice">Loading the handouts...</p>';
  }
  if (view.actionError !== '') {
    notice += `<p class="fmb-ai-notice fmb-ai-error" role="alert">${escapeHtml(view.actionError)}</p>`;
  }
  const queue =
    view.queue.length > 0
      ? `<ol class="fmb-ai-list">${view.queue.map(row => renderQueueRow(row, view)).join('')}</ol>`
      : view.status === 'ready'
        ? '<p class="fmb-ai-notice">Nothing queued. Queue pages during prep, then reveal each in one click.</p>'
        : '';
  const revealed =
    view.revealed.length > 0
      ? `<ul class="fmb-ai-list">${view.revealed.map(renderRevealedRow).join('')}</ul>`
      : view.status === 'ready'
        ? '<p class="fmb-ai-notice">No handout revealed yet.</p>'
        : '';
  return (
    `<div class="fmb-ai-toolbar fmb-ho-toolbar">${reveal}${refresh}</div>${notice}` +
    `<h3 class="fmb-ho-heading">Queue</h3>${queue}` +
    `<h3 class="fmb-ho-heading">Who has read what</h3>${revealed}`
  );
}

/** The confirm dialog's body for a reveal: the plan's summary, its note and its diff lines. */
export function renderRevealConfirmHtml(plan: RevealPlan): string {
  const lines =
    plan.diff.length > 0
      ? `<ul class="fmb-ai-diff">${plan.diff.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
      : '';
  const note = plan.note !== '' ? `<p>${escapeHtml(plan.note)}</p>` : '';
  return (
    `<p>Reveal this to the players?</p><p><strong>${escapeHtml(plan.summary)}</strong></p>${note}${lines}` +
    '<p>A reveal cannot be taken back at the table (Undo restores the settings, not what the players already saw).</p>'
  );
}
