/**
 * The "Tarokka" window's data model and HTML (I-108 part 3): pure functions, so the
 * reading, the veil over the cards, the reveal forms and the escaping are tested
 * without Foundry.
 *
 * The data is the backend's `get-tarokka-reading` result (the same one the dashboard's
 * Tarokka drawer shows). The card names and the GM's notes are only written into the
 * HTML when "Show cards" is ticked; otherwise a placeholder stands in their place, so
 * nothing about the reading is on screen (or in the page) by accident. Every string
 * that comes from the backend, or that the GM typed, is escaped before it goes into
 * the HTML.
 */
import { escapeHtml } from './ai-changes-model.js';
import type { RevealPlan } from './handouts-model.js';

/** The longest text a reveal may carry (the backend's own limit). */
export const MAX_REVEAL_TEXT = 5000;
/** The longest page title (the backend's own limit). */
export const MAX_REVEAL_TITLE = 120;

/** What a link button is called, as the dashboard's drawer calls it. */
export const LINK_LABELS: Readonly<Record<string, string>> = {
  journalPageUuid: 'Journal',
  sceneUuid: 'Scene',
  actorUuid: 'Actor',
};

/** One "Open ..." button. */
export interface LinkButton {
  label: string;
  uuid: string;
}

/** What the window shows for one of the five positions. */
export interface PositionRow {
  position: string;
  label: string;
  cardId: string;
  cardName: string;
  gmNote: string;
  links: LinkButton[];
  revealed: boolean;
  revealPageUuid: string | null;
}

/** The reading: where it came from, when, how many older ones are archived, and its positions. */
export interface ReadingRow {
  source: string;
  /** The ISO time the reading was dealt or imported. */
  readAt: string;
  archived: number;
  positions: PositionRow[];
}

/** What the GM has typed in one position's reveal form. */
export interface RevealFormState {
  text: string;
  title: string;
  showNow: boolean;
}

export type TarokkaStatus = 'loading' | 'ready' | 'error';

/** Everything the window renders. */
export interface TarokkaView {
  status: TarokkaStatus;
  /** The one-line message when `status` is `error`. */
  error: string;
  /** The message from the last action that failed; empty otherwise. */
  actionError: string;
  /** The reading, or null when there is none (or nothing loaded yet). */
  reading: ReadingRow | null;
  /** The "Show cards" tick: kept across redraws, cleared when the window closes. */
  showCards: boolean;
  /** The open reveal forms, by position (an entry means the form is open). */
  forms: Record<string, RevealFormState>;
  /** A reveal is running; its buttons are disabled. */
  busy: boolean;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

const LINK_KEYS = ['journalPageUuid', 'sceneUuid', 'actorUuid'] as const;

function toPositionRow(raw: unknown): PositionRow | null {
  const p = (raw ?? {}) as Record<string, unknown>;
  const position = text(p.position);
  if (position === '') return null;
  const links = (p.links ?? {}) as Record<string, unknown>;
  const buttons: LinkButton[] = [];
  for (const key of LINK_KEYS) {
    const uuid = text(links[key]);
    if (uuid !== '') buttons.push({ label: LINK_LABELS[key] ?? key, uuid });
  }
  return {
    position,
    label: text(p.label) || position,
    cardId: text(p.cardId),
    cardName: text(p.cardName),
    gmNote: text(p.gmNote),
    links: buttons,
    revealed: p.revealed === true,
    revealPageUuid: text(p.revealPageUuid) || null,
  };
}

/** The reading in a `get-tarokka-reading` result; null when there is none. Malformed positions are dropped. */
export function parseReading(result: unknown): ReadingRow | null {
  const r = (result ?? {}) as Record<string, unknown>;
  const reading = (r.reading ?? null) as Record<string, unknown> | null;
  if (r.available !== true || reading === null || typeof reading !== 'object') return null;
  const positions: PositionRow[] = [];
  for (const raw of Array.isArray(reading.positions) ? reading.positions : []) {
    const row = toPositionRow(raw);
    if (row) positions.push(row);
  }
  const archived = typeof r.archivedReadings === 'number' ? r.archivedReadings : 0;
  return {
    source: text(reading.source),
    readAt: text(reading.readAt),
    archived: Number.isFinite(archived) && archived > 0 ? Math.floor(archived) : 0,
    positions,
  };
}

/** The local date and time of the reading, or the raw text when it is not a date. */
export function formatReadAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** What a new, closed form starts as: nothing typed and "Show it now" unticked. */
export function emptyForm(): RevealFormState {
  return { text: '', title: '', showNow: false };
}

/**
 * The text and title of a reveal form as the plan wants them, or the reason it cannot
 * be planned: the text is trimmed and must be 1 to 5000 characters.
 */
export function checkRevealForm(
  form: RevealFormState
): { ok: true; text: string; title: string } | { ok: false; error: string } {
  const body = form.text.trim();
  if (body === '') return { ok: false, error: 'Write the text the players will read first.' };
  if (body.length > MAX_REVEAL_TEXT) {
    return { ok: false, error: `The text is too long: at most ${MAX_REVEAL_TEXT} characters.` };
  }
  const title = form.title.trim();
  if (title.length > MAX_REVEAL_TITLE) {
    return { ok: false, error: `The title is too long: at most ${MAX_REVEAL_TITLE} characters.` };
  }
  return { ok: true, text: body, title };
}

function renderForm(row: PositionRow, form: RevealFormState, view: TarokkaView): string {
  const pos = escapeHtml(row.position);
  const attrs = `data-position="${pos}"`;
  return (
    `<div class="fmb-tk-form" data-form="${pos}">` +
    `<label class="fmb-tk-field">What the players read` +
    `<textarea rows="4" maxlength="${MAX_REVEAL_TEXT}" required data-field="revealText" ${attrs}` +
    ` placeholder="Exactly what the players may read">${escapeHtml(form.text)}</textarea></label>` +
    `<label class="fmb-tk-field">Page title (optional)` +
    `<input type="text" maxlength="${MAX_REVEAL_TITLE}" data-field="revealTitle" ${attrs}` +
    ` value="${escapeHtml(form.title)}"></label>` +
    `<div class="fmb-tk-formrow">` +
    `<label class="fmb-ho-show"><input type="checkbox" data-field="revealShowNow" ${attrs}` +
    `${form.showNow ? ' checked' : ''}> Show it now</label>` +
    `<button type="button" class="fmb-ai-btn" data-action="revealGo" ${attrs}` +
    `${view.busy ? ' disabled' : ''}><i class="fa-solid fa-eye"></i> Reveal</button>` +
    `<button type="button" class="fmb-ai-btn" data-action="revealCancel" ${attrs}` +
    `${view.busy ? ' disabled' : ''}>Cancel</button></div></div>`
  );
}

function renderPosition(row: PositionRow, view: TarokkaView): string {
  const show = view.showCards;
  const pos = escapeHtml(row.position);
  const card = show
    ? `<span class="fmb-tk-card">${escapeHtml(row.cardName)} <code>${escapeHtml(row.cardId)}</code></span>`
    : '<span class="fmb-tk-card fmb-tk-veiled" title="Tick &quot;Show cards&quot; to see it">Card hidden</span>';
  const note =
    show && row.gmNote !== '' ? `<div class="fmb-tk-note">${escapeHtml(row.gmNote)}</div>` : '';
  const links =
    row.links.length > 0
      ? row.links
          .map(
            l =>
              `<button type="button" class="fmb-ai-btn" data-action="openDoc" data-uuid="${escapeHtml(l.uuid)}">` +
              `Open ${escapeHtml(l.label)}</button>`
          )
          .join('')
      : '<span class="fmb-ai-state">not linked</span>';
  const openPage = row.revealPageUuid
    ? `<button type="button" class="fmb-ai-btn" data-action="openDoc" data-uuid="${escapeHtml(row.revealPageUuid)}">Open page</button>`
    : '';
  const state = row.revealed
    ? `<span class="fmb-ai-tag fmb-tk-revealed">revealed</span>${openPage}`
    : '<span class="fmb-ai-tag">hidden from players</span>';
  const form = view.forms[row.position];
  const reveal = row.revealed
    ? ''
    : form
      ? renderForm(row, form, view)
      : `<div class="fmb-tk-row"><button type="button" class="fmb-ai-btn" data-action="revealOpen" data-position="${pos}"` +
        `${view.busy ? ' disabled' : ''}>Reveal...</button></div>`;
  return (
    `<li class="fmb-ai-row" data-position="${pos}">` +
    `<div class="fmb-ai-head"><span class="fmb-ai-summary">${escapeHtml(row.label)}</span>${card}</div>` +
    `${note}<div class="fmb-tk-row">${links}${state}</div>${reveal}</li>`
  );
}

/** The window's whole content as an HTML string. Card names and notes appear only with "Show cards" ticked. */
export function renderTarokkaHtml(view: TarokkaView): string {
  const toolbar =
    '<div class="fmb-ai-toolbar fmb-ho-toolbar">' +
    `<label class="fmb-ho-show"><input type="checkbox" data-field="showCards"${
      view.showCards ? ' checked' : ''
    }> Show cards</label>` +
    '<button type="button" class="fmb-ai-btn" data-action="refresh">' +
    '<i class="fa-solid fa-rotate"></i> Refresh</button></div>';
  let notice = '';
  if (view.status === 'error') {
    notice = `<p class="fmb-ai-notice fmb-ai-error" role="alert">${escapeHtml(view.error)}</p>`;
  } else if (view.status === 'loading' && view.reading === null) {
    notice = '<p class="fmb-ai-notice">Loading the reading...</p>';
  }
  if (view.actionError !== '') {
    notice += `<p class="fmb-ai-notice fmb-ai-error" role="alert">${escapeHtml(view.actionError)}</p>`;
  }
  let body = '';
  if (view.reading) {
    const r = view.reading;
    const header =
      `<p class="fmb-tk-sub">GM only · ${escapeHtml(r.source)} · ${escapeHtml(formatReadAt(r.readAt))} · ` +
      `${r.archived} archived</p>`;
    body = `${header}<ul class="fmb-ai-list">${r.positions.map(p => renderPosition(p, view)).join('')}</ul>`;
  } else if (view.status === 'ready') {
    body =
      '<p class="fmb-ai-notice">No reading yet. A reading is dealt or imported from the dashboard, ' +
      'or by asking Claude.</p>';
  }
  return `${toolbar}${notice}${body}`;
}

/** The confirm dialog's body for a Tarokka reveal: the plan's summary, its note and its diff lines. */
export function renderTarokkaConfirmHtml(plan: RevealPlan): string {
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
