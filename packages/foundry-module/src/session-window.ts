/**
 * The "Session" GM window (I-134 part 2): the dashboard's session marker inside Foundry. It shows
 * whether a play session is open (and since when, or when the last one ended) and has Start and
 * End buttons, the same as the dashboard's header marker.
 *
 * Unlike Combat and Party this panel talks to the bridge: `get-play-session` reads the state and
 * `mark-play-session` writes a start or end line to the bridge's own session log (log only, no
 * game state, so no plan and confirm). Both go through {@link aiToolRequest}, which works from any
 * GM browser. {@link parseSession} and {@link renderSessionHtml} are pure; the state lives in
 * {@link SessionController}.
 */
import { escapeHtml } from './ai-changes-model.js';
import { aiToolRequest } from './gm-helper-queries.js';
import { createPanelWindow } from './gm-windows.js';

/** What `get-play-session` answers, as far as the window reads it. */
export interface PlaySessionState {
  open: boolean;
  startedAt: string | null;
  lastEventAt: string | null;
  endedAt: string | null;
}

export interface SessionView {
  status: 'loading' | 'ready' | 'error';
  error: string;
  session: PlaySessionState | null;
  /** A start or end is on its way: the buttons are off. */
  busy: boolean;
}

const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** Read a `get-play-session` answer; anything else is an error for the window to show. */
export function parseSession(raw: unknown): PlaySessionState {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || typeof r.open !== 'boolean') {
    throw new Error('The bridge gave an unexpected answer for the play session');
  }
  return {
    open: r.open,
    startedAt: stringOrNull(r.startedAt),
    lastEventAt: stringOrNull(r.lastEventAt),
    endedAt: stringOrNull(r.endedAt),
  };
}

function when(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function renderSessionHtml(view: SessionView): string {
  const refresh = '<button type="button" class="fmb-ai-btn" data-action="refresh">Refresh</button>';
  if (view.status === 'loading') return '<p class="fmb-ai-notice">Loading the session...</p>';
  if (view.status === 'error' || !view.session) {
    return `<p class="fmb-ai-notice fmb-ai-error">${escapeHtml(view.error)}</p><p>${refresh}</p>`;
  }
  const s = view.session;
  const disabled = view.busy ? ' disabled' : '';
  const line = s.open
    ? `<strong>Session open</strong>${s.startedAt ? ` since ${escapeHtml(when(s.startedAt))}` : ''}`
    : `<strong>No session open</strong>${s.endedAt ? `, the last one ended ${escapeHtml(when(s.endedAt))}` : ''}`;
  const last = s.lastEventAt
    ? `<p class="fmb-gm-muted">Last event ${escapeHtml(when(s.lastEventAt))}</p>`
    : '';
  const action = s.open
    ? `<button type="button" class="fmb-ai-btn" data-action="markEnd"${disabled}>End the session</button>`
    : `<button type="button" class="fmb-ai-btn" data-action="markStart"${disabled}>Start the session</button>`;
  return `<p>${line}</p>${last}<p>${action} ${refresh}</p>`;
}

/** The window's state and flows; `request` is injected so tests need no bridge. */
export class SessionController {
  view: SessionView = { status: 'loading', error: '', session: null, busy: false };
  private seq = 0;

  constructor(
    private readonly request: (tool: string, args: Record<string, unknown>) => Promise<unknown>,
    private readonly changed: () => void
  ) {}

  async load(): Promise<void> {
    const seq = ++this.seq;
    try {
      const session = parseSession(await this.request('get-play-session', {}));
      if (seq !== this.seq) return;
      this.view = { ...this.view, status: 'ready', error: '', session };
    } catch (error) {
      if (seq !== this.seq) return;
      this.view = {
        ...this.view,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
    this.changed();
  }

  async mark(action: 'start' | 'end'): Promise<void> {
    if (this.view.busy) return;
    this.view = { ...this.view, busy: true };
    this.changed();
    try {
      await this.request('mark-play-session', { action });
    } catch (error) {
      this.view = {
        ...this.view,
        busy: false,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
      this.changed();
      return;
    }
    this.view = { ...this.view, busy: false };
    await this.load();
  }
}

const controller = new SessionController(aiToolRequest, () => panel.redraw());

const panel = createPanelWindow({
  id: 'fmb-gm-session',
  title: 'Session',
  icon: 'fa-solid fa-flag',
  width: 340,
  height: 200,
  hooks: [],
  render: () => renderSessionHtml(controller.view),
  onOpen: () => {
    void controller.load();
  },
  actions: {
    refresh: () => controller.load(),
    markStart: () => controller.mark('start'),
    markEnd: () => controller.mark('end'),
  },
});

/** Open the "Session" window (one per browser). */
export const openSessionWindow = (): Promise<boolean> => panel.open();

/** Forget the window and its state (tests). */
export const resetSessionWindowForTests = (): void => {
  panel.reset();
  controller.view = { status: 'loading', error: '', session: null, busy: false };
};
