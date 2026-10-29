/**
 * The Tarokka card table's data model and HTML (D-130 step 2): pure functions, so the rules
 * (place in order, flip one at a time), the player projection and the escaping are tested
 * without Foundry.
 *
 * Two kinds of state meet here:
 * - The reading itself (which card is in which position, which are revealed) lives in the
 *   bridge vault and comes from `get-tarokka-reading`. A flip is a normal reveal there
 *   (`plan-tarokka-reveal`), so the dashboard drawer and the player page follow the table.
 * - The public table state ({@link PublicTable}) is a world setting every client can read,
 *   so players see the cards without the bridge. It holds the reading's id, whether the table
 *   is shown, and per slot only the stage and, once revealed, the card. Unrevealed card ids,
 *   position names and GM notes are never in it ({@link publicHasNoSecrets} checks this in
 *   the tests). Slots are in deal order and carry no position name.
 *
 * Cards are drawn in CSS from the suit and value in the card id. A GM may attach a picture
 * (any image in the world's files) to a card; the repo ships no card art and no book text.
 */
import { escapeHtml } from './ai-changes-model.js';
import type { PositionRow } from './tarokka-model.js';

/** Deal order: the order cards are placed on the table. */
export const TABLE_POSITIONS = [
  'tome',
  'holySymbol',
  'sunsword',
  'ally',
  'strahdLocation',
] as const;

export type SlotStage = 'empty' | 'placed' | 'revealed';

/** What a player's browser may hold for one slot. */
export interface PublicSlot {
  stage: SlotStage;
  /** Only when `stage` is `revealed`. */
  cardId?: string;
  name?: string;
  image?: string;
}

/** The world setting: the whole public table. */
export interface PublicTable {
  readingId: string;
  shown: boolean;
  slots: PublicSlot[];
}

const MAX_NAME = 120;
const MAX_IMAGE = 500;
const CARD_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function emptyTable(readingId = ''): PublicTable {
  return {
    readingId,
    shown: false,
    slots: TABLE_POSITIONS.map(() => ({ stage: 'empty' as const })),
  };
}

/** A picture path the table will draw: http(s) or a path inside the world's files, no script. */
export function safeImage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (v === '' || v.length > MAX_IMAGE) return null;
  if (/["'<>\\]/.test(v) || [...v].some(ch => ch.charCodeAt(0) < 0x20)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) && !/^https?:\/\//i.test(v)) return null;
  return v;
}

/** The public table from a stored value; anything malformed becomes an empty table. */
export function parsePublicTable(raw: unknown): PublicTable {
  const r = (raw ?? {}) as Partial<PublicTable> | null;
  const readingId = typeof r?.readingId === 'string' ? r.readingId.slice(0, 80) : '';
  const stored = Array.isArray(r?.slots) ? r.slots : [];
  const slots: PublicSlot[] = TABLE_POSITIONS.map((_, i) => {
    const s = (stored[i] ?? {}) as Partial<PublicSlot>;
    if (s.stage === 'revealed' && typeof s.cardId === 'string' && CARD_ID.test(s.cardId)) {
      const image = safeImage(s.image);
      return {
        stage: 'revealed',
        cardId: s.cardId.slice(0, 40),
        name: typeof s.name === 'string' ? s.name.slice(0, MAX_NAME) : s.cardId,
        ...(image ? { image } : {}),
      };
    }
    return { stage: s.stage === 'placed' ? 'placed' : 'empty' };
  });
  return { readingId, shown: r?.shown === true && readingId !== '', slots };
}

/**
 * The public table after looking at the reading in the vault: a different reading starts a
 * clean table; a position the vault has revealed shows its face; a slot that was shown but is
 * no longer revealed (an undone reveal) goes back to face down.
 */
export function reconcile(
  current: PublicTable,
  positions: readonly PositionRow[] | null,
  readingId: string,
  images: Readonly<Record<string, string>>
): PublicTable {
  if (!positions || readingId === '') return emptyTable();
  const base = current.readingId === readingId ? current : emptyTable(readingId);
  const slots = TABLE_POSITIONS.map((position, i): PublicSlot => {
    const row = positions.find(p => p.position === position);
    const was = base.slots[i] ?? { stage: 'empty' };
    if (row?.revealed && row.cardId !== '') {
      const image = safeImage(images[row.cardId]);
      return {
        stage: 'revealed',
        cardId: row.cardId,
        name: (row.cardName || row.cardId).slice(0, MAX_NAME),
        ...(image ? { image } : {}),
      };
    }
    return { stage: was.stage === 'empty' ? 'empty' : 'placed' };
  });
  return { readingId, shown: base.shown, slots };
}

export function sameTable(a: PublicTable, b: PublicTable): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The slot the next "Place" goes to (deal order), or -1 when all five are down. */
export function nextToPlace(table: PublicTable): number {
  return table.slots.findIndex(s => s.stage === 'empty');
}

/** Put the next card face down on the table. Returns the table unchanged when all five are down. */
export function placeNext(table: PublicTable): PublicTable {
  const index = nextToPlace(table);
  if (index < 0) return table;
  return {
    ...table,
    slots: table.slots.map((s, i) => (i === index ? { stage: 'placed' as const } : s)),
  };
}

/** Whether a slot may be flipped now: only a face-down card on the table. */
export function canFlip(table: PublicTable, index: number): boolean {
  return table.slots[index]?.stage === 'placed';
}

/** Every card of a reading is revealed. */
export function allRevealed(table: PublicTable): boolean {
  return table.slots.every(s => s.stage === 'revealed');
}

/**
 * Test helper for the secrecy rule: true when the stored value mentions none of the given
 * secrets (unrevealed card ids and names, position names, GM notes).
 */
export function publicHasNoSecrets(table: PublicTable, secrets: readonly string[]): boolean {
  const json = JSON.stringify(table).toLowerCase();
  return secrets.every(s => s === '' || !json.includes(s.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Cards in CSS
// ---------------------------------------------------------------------------

const SUIT_GLYPHS: Record<string, string> = {
  swords: '⚔',
  stars: '✦',
  coins: '◎',
  glyphs: '✵',
};

/** What a card id looks like: a suit and value, or a high card (crown). */
export function cardLook(cardId: string): { suit: string; glyph: string; value: string } {
  const m = /^(swords|stars|coins|glyphs)-(\d+|master)$/.exec(cardId);
  if (m) {
    return { suit: m[1], glyph: SUIT_GLYPHS[m[1]] ?? '', value: m[2] === 'master' ? 'M' : m[2] };
  }
  return { suit: 'crown', glyph: '♕', value: '' };
}

/** A face-down card. */
export function renderBack(extraClass = ''): string {
  return `<div class="fmb-tt-card fmb-tt-back${extraClass ? ` ${extraClass}` : ''}"><span class="fmb-tt-sigil">✵</span></div>`;
}

/** A card face: the GM's picture when there is one, else suit, value and name drawn in CSS. */
export function renderFace(cardId: string, name: string, image: string | null): string {
  const look = cardLook(cardId);
  const label = escapeHtml(name || cardId);
  const art = image
    ? `<img class="fmb-tt-img" src="${escapeHtml(image)}" alt="${label}">`
    : `<span class="fmb-tt-glyph">${look.glyph}</span>${
        look.value !== '' ? `<span class="fmb-tt-value">${escapeHtml(look.value)}</span>` : ''
      }`;
  return (
    `<div class="fmb-tt-card fmb-tt-face fmb-tt-suit-${look.suit}">${art}` +
    `<span class="fmb-tt-name">${label}</span></div>`
  );
}

function renderEmpty(): string {
  return '<div class="fmb-tt-card fmb-tt-empty"></div>';
}

/** The players' table: five slots, backs for placed cards, faces for revealed ones, no labels. */
export function renderPlayerHtml(table: PublicTable): string {
  const slots = table.slots
    .map(s => {
      if (s.stage === 'revealed' && s.cardId) {
        return `<li class="fmb-tt-slot">${renderFace(s.cardId, s.name ?? s.cardId, s.image ?? null)}</li>`;
      }
      return `<li class="fmb-tt-slot">${s.stage === 'placed' ? renderBack() : renderEmpty()}</li>`;
    })
    .join('');
  return `<ul class="fmb-tt-table">${slots}</ul>`;
}

// ---------------------------------------------------------------------------
// The GM's view
// ---------------------------------------------------------------------------

/** One slot as the GM sees it. */
export interface GmSlot {
  position: string;
  label: string;
  cardId: string;
  cardName: string;
  gmNote: string;
  image: string | null;
}

export interface GmView {
  status: 'loading' | 'ready' | 'error';
  error: string;
  actionError: string;
  readingSource: string;
  /** Null until a reading exists. */
  slots: GmSlot[] | null;
  table: PublicTable;
  showCards: boolean;
  busy: boolean;
}

export function emptyGmView(): GmView {
  return {
    status: 'loading',
    error: '',
    actionError: '',
    readingSource: '',
    slots: null,
    table: emptyTable(),
    showCards: false,
    busy: false,
  };
}

function button(action: string, label: string, icon: string, attrs = '', disabled = false): string {
  return (
    `<button type="button" class="fmb-ai-btn" data-action="${action}"${attrs}` +
    `${disabled ? ' disabled' : ''}><i class="${icon}"></i> ${escapeHtml(label)}</button>`
  );
}

function renderGmSlot(slot: GmSlot, index: number, view: GmView): string {
  const stage = view.table.slots[index]?.stage ?? 'empty';
  const attrs = ` data-index="${index}" data-position="${escapeHtml(slot.position)}"`;
  const dealt = stage !== 'empty';
  const visible = stage === 'revealed' || (view.showCards && slot.cardId !== '');
  const card = visible
    ? renderFace(slot.cardId, slot.cardName, slot.image)
    : dealt
      ? renderBack()
      : renderEmpty();
  const tag =
    stage === 'revealed'
      ? '<span class="fmb-ai-tag fmb-tk-revealed">flipped</span>'
      : stage === 'placed'
        ? '<span class="fmb-ai-tag">face down</span>'
        : '<span class="fmb-ai-tag">in the deck</span>';
  const note =
    view.showCards && slot.gmNote !== ''
      ? `<div class="fmb-tk-note">${escapeHtml(slot.gmNote)}</div>`
      : '';
  const isNext = nextToPlace(view.table) === index;
  const controls =
    (isNext ? button('place', 'Place', 'fa-solid fa-arrow-down', attrs, view.busy) : '') +
    (stage === 'placed' ? button('flip', 'Flip', 'fa-solid fa-eye', attrs, view.busy) : '') +
    (slot.cardId !== ''
      ? button(
          'picture',
          slot.image ? 'Change picture' : 'Picture',
          'fa-solid fa-image',
          attrs,
          view.busy
        )
      : '') +
    (slot.image
      ? button('pictureClear', 'Clear picture', 'fa-solid fa-xmark', attrs, view.busy)
      : '');
  return (
    `<li class="fmb-tt-slot fmb-tt-gmslot"${attrs}>${card}` +
    `<div class="fmb-tt-label">${escapeHtml(slot.label)} ${tag}</div>${note}` +
    `<div class="fmb-tk-row">${controls}</div></li>`
  );
}

/** The GM window's content. Card faces of unflipped cards need "Show cards" ticked. */
export function renderGmHtml(view: GmView): string {
  const t = view.table;
  const toolbar =
    `<div class="fmb-ai-toolbar fmb-ho-toolbar">` +
    `<label class="fmb-ho-show"><input type="checkbox" data-field="showCards"${view.showCards ? ' checked' : ''}> Show cards</label>${
      t.shown
        ? button('hide', 'Stop showing', 'fa-solid fa-eye-slash', '', view.busy)
        : button('show', 'Show to players', 'fa-solid fa-tv', '', view.busy || view.slots === null)
    }${button('refresh', 'Refresh', 'fa-solid fa-rotate')}</div>`;
  let notice = '';
  if (view.status === 'error') {
    notice = `<p class="fmb-ai-notice fmb-ai-error" role="alert">${escapeHtml(view.error)}</p>`;
  } else if (view.status === 'loading' && view.slots === null) {
    notice = '<p class="fmb-ai-notice">Loading the reading...</p>';
  }
  if (view.actionError !== '') {
    notice += `<p class="fmb-ai-notice fmb-ai-error" role="alert">${escapeHtml(view.actionError)}</p>`;
  }
  let body = '';
  if (view.slots) {
    const state = t.shown ? 'shown to the players' : 'not shown to the players';
    body =
      `<p class="fmb-tk-sub">GM only · ${escapeHtml(view.readingSource)} · ${state}</p>` +
      `<ul class="fmb-tt-table fmb-tt-gm">${view.slots.map((s, i) => renderGmSlot(s, i, view)).join('')}</ul>`;
  } else if (view.status === 'ready') {
    body =
      '<p class="fmb-ai-notice">No reading yet. Deal or choose the five cards in the dashboard\'s ' +
      'Tarokka drawer, or ask Claude, then press Refresh.</p>';
  }
  return `${toolbar}${notice}${body}`;
}

/** The id of the reading in a `get-tarokka-reading` result; empty when there is none. */
export function readingIdOf(result: unknown): string {
  const reading = ((result ?? {}) as { reading?: { readingId?: unknown } | null }).reading;
  const id = reading?.readingId;
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : '';
}

/** The confirm dialog for a card flip: what the players will see, and optional text for them. */
export function renderFlipDialogHtml(label: string, cardName: string): string {
  return (
    `<p>Flip <strong>${escapeHtml(cardName)}</strong> (${escapeHtml(label)}) for the players?</p>` +
    '<label class="fmb-tk-field">Text for the players (optional; the card name is used if empty)' +
    '<textarea name="text" rows="3" maxlength="5000"></textarea></label>' +
    '<p>This marks the card revealed in the AI Tool and adds a page for the players. ' +
    'Undo in Recent Changes puts it back.</p>'
  );
}
