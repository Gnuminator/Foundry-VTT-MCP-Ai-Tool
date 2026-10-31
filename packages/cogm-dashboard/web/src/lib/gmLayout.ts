// The GM page's layout (item gm-page-wrapper): which side the strip is on, how wide, the limits
// of the divider, and which messages count. Pure, so the page's rules are tested without a
// browser. The numbers come from the design note (vault Design/GM page design 2026-10-31.md).
import { LIVE_PICK_MESSAGE, LIVE_READY_MESSAGE } from './mapPick';

export type GmMode = 'right' | 'left' | 'window';

export interface GmLayout {
  mode: GmMode;
  /** The strip pane's width in px; Foundry takes the rest. */
  stripPx: number;
  /** The first-run hint was dismissed. */
  hintSeen: boolean;
}

/** Browser storage key (per browser, like the cogm_ keys next to it). */
export const GM_LAYOUT_KEY = 'cogm_gm_layout';
export const DEFAULT_STRIP_PX = 420;
export const MIN_STRIP_PX = 320;
const MAX_STRIP_PX = 720;
/** Foundry needs room for the canvas plus its 300 px sidebar. */
export const MIN_FOUNDRY_PX = 760;
/** Below this the page shows the strip alone (no side by side): both panes plus the divider. */
export const SIDE_BY_SIDE_MIN_PX = 1088;
/** How long after the frame loads before the page says Foundry may not show here. */
export const FRAME_WAIT_MS = 8000;

export const DEFAULT_LAYOUT: GmLayout = {
  mode: 'right',
  stripPx: DEFAULT_STRIP_PX,
  hintSeen: false,
};

/** The widest the strip may be for this viewport. */
export function maxStripPx(viewportWidth: number): number {
  return Math.max(MIN_STRIP_PX, Math.min(MAX_STRIP_PX, viewportWidth - MIN_FOUNDRY_PX));
}

export function clampStripPx(px: number, viewportWidth: number): number {
  if (!Number.isFinite(px)) return DEFAULT_STRIP_PX;
  return Math.round(Math.min(maxStripPx(viewportWidth), Math.max(MIN_STRIP_PX, px)));
}

/** Whether Foundry and the strip fit next to each other at this viewport width. */
export function fitsSideBySide(viewportWidth: number): boolean {
  return viewportWidth >= SIDE_BY_SIDE_MIN_PX;
}

/** A saved layout, or the defaults for anything missing or wrong. */
export function parseLayout(raw: string | null): GmLayout {
  try {
    const value = raw ? (JSON.parse(raw) as Partial<GmLayout> & { v?: unknown }) : null;
    if (!value || typeof value !== 'object') return { ...DEFAULT_LAYOUT };
    const mode: GmMode =
      value.mode === 'left' || value.mode === 'window' || value.mode === 'right'
        ? value.mode
        : 'right';
    const px = typeof value.stripPx === 'number' ? value.stripPx : DEFAULT_STRIP_PX;
    return {
      mode,
      stripPx: Number.isFinite(px) ? Math.max(MIN_STRIP_PX, Math.min(MAX_STRIP_PX, px)) : 420,
      hintSeen: value.hintSeen === true,
    };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export function loadLayout(): GmLayout {
  try {
    return parseLayout(window.localStorage.getItem(GM_LAYOUT_KEY));
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export function saveLayout(layout: GmLayout): void {
  try {
    window.localStorage.setItem(GM_LAYOUT_KEY, JSON.stringify({ v: 1, ...layout }));
  } catch {
    // Storage can be blocked; the layout then lasts for this page only.
  }
}

/** The pick or ready message and where it came from, for the page's one message handler. */
export type GmMessage =
  | { kind: 'pick'; from: 'foundry'; ids: readonly string[] }
  | { kind: 'ready'; from: 'strip-window' };

interface Sources {
  foundryFrame: unknown;
  foundryTab: unknown;
  stripWindow: unknown;
  foundryOrigin: string | null;
  ownOrigin: string;
}

/**
 * What a message means, or null. A pick counts only from the Foundry frame or tab and only from
 * Foundry's origin; a ready only from the strip window and this page's own origin. A closed or
 * missing window never matches, so a null source cannot match a null handle.
 */
export function classifyMessage(
  event: { data: unknown; source: unknown; origin: string },
  s: Sources
): GmMessage | null {
  const { data, source, origin } = event;
  if (source === null || source === undefined || typeof data !== 'object' || data === null) {
    return null;
  }
  const type = (data as { type?: unknown }).type;
  const fromFoundry =
    s.foundryOrigin !== null &&
    origin === s.foundryOrigin &&
    (source === s.foundryFrame || source === s.foundryTab);
  if (type === LIVE_PICK_MESSAGE && fromFoundry) {
    const list = (data as { tokenIds?: unknown }).tokenIds;
    if (!Array.isArray(list)) return null;
    const ids = list
      .filter((id): id is string => typeof id === 'string' && id !== '')
      .slice(0, 200);
    return { kind: 'pick', from: 'foundry', ids };
  }
  if (type === LIVE_READY_MESSAGE && origin === s.ownOrigin && source === s.stripWindow) {
    return { kind: 'ready', from: 'strip-window' };
  }
  return null;
}
