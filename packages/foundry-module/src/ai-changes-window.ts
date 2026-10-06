/**
 * The "AI changes" window inside Foundry (I-108): the same entries as the
 * dashboard's Recent Changes, with Undo, for a GM who runs Foundry in their own
 * browser.
 *
 * The data comes from the backend through {@link aiToolRequest} (a direct call
 * when this browser holds the bridge link, else relayed through the GM client
 * that does). The state and the undo flow live in {@link AiChangesController},
 * which knows nothing about Foundry's windows; the window class only draws the
 * controller's view and forwards clicks, and is built on first use because
 * Foundry's `ApplicationV2` does not exist when this file is loaded.
 */
import { onAiChangesUpdated } from './ai-changes-signal.js';
import {
  FIRST_PAGE_LIMIT,
  MORE_LIMIT,
  buildRows,
  renderChangesHtml,
  renderUndoConfirmHtml,
  type ChangeRow,
  type ChangesView,
} from './ai-changes-model.js';
import { aiToolRequest } from './gm-helper-queries.js';

/** The pieces of Foundry the controller needs; tests pass fakes. */
export interface AiChangesDeps {
  request(tool: string, args: Record<string, unknown>): Promise<unknown>;
  /** Ask the GM to confirm an undo; true when they did. */
  confirmUndo(row: ChangeRow): Promise<boolean>;
  notifyInfo(message: string): void;
  notifyError(message: string): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

/** The window's state: what is listed, what is loading, and the undo flow. */
export class AiChangesController {
  view: ChangesView = {
    status: 'loading',
    rows: [],
    error: '',
    limit: FIRST_PAGE_LIMIT,
    busyId: null,
    openIds: new Set<string>(),
  };
  private loadSeq = 0;

  constructor(
    private readonly deps: AiChangesDeps,
    private readonly changed: () => void
  ) {}

  /** Fetch the list again; a newer call wins over an older one still running. */
  async load(): Promise<void> {
    const seq = ++this.loadSeq;
    this.view = { ...this.view, status: 'loading' };
    this.changed();
    let next: Partial<ChangesView>;
    try {
      const result = await this.deps.request('list-recent-changes', { limit: this.view.limit });
      next = { status: 'ready', rows: buildRows(result), error: '' };
    } catch (error) {
      next = { status: 'error', error: errorMessage(error) };
    }
    if (seq !== this.loadSeq) return;
    this.view = { ...this.view, ...next };
    this.changed();
  }

  /** "Show more": the next 100 instead of the first 20. */
  async showMore(): Promise<void> {
    this.view = { ...this.view, limit: MORE_LIMIT };
    await this.load();
  }

  /** Remember whether an entry's diff is expanded, without redrawing. */
  setOpen(id: string, open: boolean): void {
    const openIds = new Set(this.view.openIds);
    if (open) openIds.add(id);
    else openIds.delete(id);
    this.view = { ...this.view, openIds };
  }

  /** Confirm, then undo one change through the backend; conflicts show as the backend words them. */
  async undo(changeId: string): Promise<void> {
    const row = this.view.rows.find(r => r.id === changeId);
    if (!row || !row.canUndo || this.view.busyId !== null) return;
    if (!(await this.deps.confirmUndo(row))) return;
    this.view = { ...this.view, busyId: changeId };
    this.changed();
    try {
      await this.deps.request('undo-change', { changeId, confirm: true });
      this.deps.notifyInfo(`Undone: ${row.summary}`);
    } catch (error) {
      this.deps.notifyError(errorMessage(error));
    }
    this.view = { ...this.view, busyId: null };
    await this.load();
  }
}

// ---------------------------------------------------------------------------
// The Foundry window
// ---------------------------------------------------------------------------

/** What the window needs from `ApplicationV2` (the full class is in Foundry, not in our types). */
interface AppV2Instance {
  render(options?: { force?: boolean }): Promise<unknown>;
  bringToFront?(): void;
}
type AppV2Constructor = new (options?: Record<string, unknown>) => AppV2Instance;

export interface AiChangesWindowInstance extends AppV2Instance {
  readonly controller: AiChangesController;
}

interface DialogV2Like {
  confirm(options: Record<string, unknown>): Promise<boolean | null>;
}

/** The deps that talk to the real Foundry. */
export function foundryDeps(): AiChangesDeps {
  return {
    request: (tool, args) => aiToolRequest(tool, args),
    confirmUndo: async (row): Promise<boolean> => {
      const api = (foundry.applications as { api?: { DialogV2?: DialogV2Like } }).api;
      if (!api?.DialogV2) return false;
      const answer = await api.DialogV2.confirm({
        window: { title: 'Undo AI change' },
        content: renderUndoConfirmHtml(row),
        yes: { label: 'Undo' },
        no: { label: 'Cancel' },
        rejectClose: false,
      });
      return answer === true;
    },
    notifyInfo: message => void ui.notifications.info(message),
    notifyError: message => void ui.notifications.error(message),
  };
}

let windowClass: (new () => AiChangesWindowInstance) | null = null;
let instance: AiChangesWindowInstance | null = null;

/** Wait before re-fetching after a push, so a burst of changes is one fetch. */
const PUSH_REFRESH_DEBOUNCE_MS = 300;

function defineWindowClass(): new () => AiChangesWindowInstance {
  const api = (foundry.applications as { api?: { ApplicationV2?: AppV2Constructor } }).api;
  const Base = api?.ApplicationV2;
  if (!Base) throw new Error('This Foundry version has no ApplicationV2');

  type Self = AiChangesWindowInstance;
  const onRefresh = function (this: Self): void {
    void this.controller.load();
  };
  const onMore = function (this: Self): void {
    void this.controller.showMore();
  };
  const onUndo = function (this: Self, _event: Event, target: HTMLElement): void {
    const id = target.dataset.changeId;
    if (id) void this.controller.undo(id);
  };

  class AiChangesWindow extends Base implements AiChangesWindowInstance {
    static DEFAULT_OPTIONS = {
      id: 'fmb-ai-changes',
      classes: ['fmb-ai-window'],
      tag: 'div',
      window: { title: 'AI changes', icon: 'fa-solid fa-wand-sparkles', resizable: true },
      position: { width: 460, height: 560 },
      actions: { refresh: onRefresh, more: onMore, undo: onUndo },
    };

    readonly controller = new AiChangesController(foundryDeps(), () => void this.render());
    private stopListening: (() => void) | null = null;
    private pushTimer: ReturnType<typeof setTimeout> | null = null;

    _prepareContext(): Promise<{ view: ChangesView }> {
      return Promise.resolve({ view: this.controller.view });
    }

    _renderHTML(context: { view: ChangesView }): Promise<string> {
      return Promise.resolve(renderChangesHtml(context.view));
    }

    _replaceHTML(html: string, content: HTMLElement): void {
      const scrollTop = content.scrollTop;
      content.innerHTML = html;
      content.scrollTop = scrollTop;
      for (const details of Array.from(content.querySelectorAll('details[data-change-id]'))) {
        details.addEventListener('toggle', () => {
          this.controller.setOpen(
            (details as HTMLElement).dataset.changeId ?? '',
            (details as HTMLDetailsElement).open
          );
        });
      }
    }

    _onRender(): void {
      // Re-fetch when the bridge client says the change log changed.
      this.stopListening ??= onAiChangesUpdated(() => {
        if (this.pushTimer !== null) clearTimeout(this.pushTimer);
        this.pushTimer = setTimeout(() => {
          this.pushTimer = null;
          void this.controller.load();
        }, PUSH_REFRESH_DEBOUNCE_MS);
      });
    }

    _onClose(): void {
      this.stopListening?.();
      this.stopListening = null;
      if (this.pushTimer !== null) clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
  }
  return AiChangesWindow;
}

/** Open the "AI changes" window (one per browser) and fetch the list. */
export async function openAiChangesWindow(): Promise<void> {
  windowClass ??= defineWindowClass();
  instance ??= new windowClass();
  await instance.render({ force: true });
  instance.bringToFront?.();
  await instance.controller.load();
}

/** Forget the window (tests). */
export function resetAiChangesWindowForTests(): void {
  windowClass = null;
  instance = null;
}
