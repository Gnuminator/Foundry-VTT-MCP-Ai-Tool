/**
 * The "Handouts" window inside Foundry (I-108 part 2): the dashboard's handouts
 * drawer for a GM who runs Foundry in their own browser. It lists the reveal queue
 * (with Remove), has one "Reveal next" button with a "Show it now" tick, and shows
 * who has read which revealed page.
 *
 * Every call goes to the backend through {@link aiToolRequest} (a direct call when
 * this browser holds the bridge link, else relayed through the GM client that does).
 * The state and the flows live in {@link HandoutsController}, which knows nothing
 * about Foundry's windows; the window class only draws the controller's view and
 * forwards clicks, and is built on first use because Foundry's `ApplicationV2` does
 * not exist when this file is loaded.
 */
import { onAiChangesUpdated } from './ai-changes-signal.js';
import {
  buildHandoutsRows,
  parseRevealPlan,
  renderHandoutsHtml,
  renderRevealConfirmHtml,
  type HandoutsContext,
  type HandoutsView,
  type RevealPlan,
} from './handouts-model.js';
import { aiToolRequest } from './gm-helper-queries.js';
import { bindFields, replaceKeepingFocus } from './window-fields.js';

/** The pieces of Foundry the controller needs; tests pass fakes. */
export interface HandoutsDeps {
  request(tool: string, args: Record<string, unknown>): Promise<unknown>;
  /** What names the scenes and players, read fresh on every load. */
  context(): HandoutsContext;
  /** Ask the GM to confirm a reveal; true when they did. */
  confirmReveal(plan: RevealPlan): Promise<boolean>;
  notifyInfo(message: string): void;
  notifyError(message: string): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

/** The window's state: what is listed, what is loading, and the Remove and Reveal flows. */
export class HandoutsController {
  view: HandoutsView = {
    status: 'loading',
    error: '',
    actionError: '',
    queue: [],
    revealed: [],
    nextTitle: null,
    busy: false,
    showNow: false,
  };
  private loadSeq = 0;

  constructor(
    private readonly deps: HandoutsDeps,
    private readonly changed: () => void
  ) {}

  /** Fetch the lists again; a newer call wins over an older one still running. */
  async load(): Promise<void> {
    const seq = ++this.loadSeq;
    this.view = { ...this.view, status: 'loading' };
    this.changed();
    let next: Partial<HandoutsView>;
    try {
      const result = await this.deps.request('list-revealed-pages', {});
      next = { status: 'ready', error: '', ...buildHandoutsRows(result, this.deps.context()) };
    } catch (error) {
      next = { status: 'error', error: errorMessage(error) };
    }
    if (seq !== this.loadSeq) return;
    this.view = { ...this.view, ...next };
    this.changed();
  }

  /** The GM ticked or unticked "Show it now" (no redraw: the box already shows it). */
  setShowNow(value: boolean): void {
    this.view = { ...this.view, showNow: value };
  }

  /** The window closed: forget the tick, so the next time it opens it is unticked. */
  resetForm(): void {
    this.view = { ...this.view, showNow: false, actionError: '' };
  }

  /** Take a page off the queue (applies at once: the queue is prep, nothing in Foundry changes). */
  async remove(pageUuid: string): Promise<void> {
    if (this.view.busy) return;
    this.view = { ...this.view, busy: true, actionError: '' };
    this.changed();
    try {
      const result = (await this.deps.request('plan-page-reveal', {
        action: 'unqueue',
        pageUuid,
      })) as { note?: unknown } | null;
      this.deps.notifyInfo(
        typeof result?.note === 'string' && result.note ? result.note : 'Removed from the queue'
      );
    } catch (error) {
      this.failed(errorMessage(error));
    }
    this.view = { ...this.view, busy: false };
    await this.load();
  }

  /**
   * Plan the reveal of the next queued page, show the plan for the GM to confirm, then
   * apply it. A cancel does nothing (the plan expires by itself). "Show it now" is the
   * tick as it stands when this starts, and is cleared afterwards however it ended.
   */
  async revealNext(): Promise<void> {
    if (this.view.busy || this.view.nextTitle === null) return;
    const showNow = this.view.showNow;
    this.view = { ...this.view, busy: true, actionError: '' };
    this.changed();
    try {
      const sceneId = this.deps.context().activeSceneId;
      const plan = parseRevealPlan(
        await this.deps.request('plan-page-reveal', {
          action: 'reveal-next',
          ...(sceneId ? { sceneId } : {}),
          ...(showNow ? { showNow: true } : {}),
        })
      );
      if (!plan) throw new Error('The AI Tool made no plan for this reveal');
      if (await this.deps.confirmReveal(plan)) {
        const applied = (await this.deps.request('apply-planned-change', {
          planId: plan.planId,
          confirm: true,
          confirmDestructive: true,
        })) as { shown?: { ok?: boolean; error?: string } } | null;
        this.deps.notifyInfo(`Revealed: ${plan.summary}`);
        if (applied?.shown?.ok === false) {
          this.failed(
            `Revealed, but the page could not be shown on the players' screens: ${applied.shown.error ?? 'unknown error'}`
          );
        }
      }
    } catch (error) {
      this.failed(errorMessage(error));
    }
    this.view = { ...this.view, busy: false, showNow: false };
    await this.load();
  }

  private failed(message: string): void {
    this.view = { ...this.view, actionError: message };
    this.deps.notifyError(message);
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

export interface HandoutsWindowInstance extends AppV2Instance {
  readonly controller: HandoutsController;
}

interface DialogV2Like {
  confirm(options: Record<string, unknown>): Promise<boolean | null>;
}

/** Foundry's scenes, as far as the window reads them. */
interface SceneLike {
  id?: string;
  name?: string;
}

function worldContext(): HandoutsContext {
  const scenes = game.scenes as unknown as
    | { active?: SceneLike | null; get?(id: string): SceneLike | undefined }
    | undefined;
  const users = game.users as unknown as {
    get(id: string): { name?: string } | undefined;
    filter(fn: (u: { id: string; isGM: boolean }) => boolean): Array<{ id: string }>;
  };
  return {
    activeSceneId: scenes?.active?.id ?? null,
    sceneName: id => scenes?.get?.(id)?.name ?? null,
    playerName: id => users.get(id)?.name ?? null,
    playerIds: users.filter(u => !u.isGM).map(u => u.id),
  };
}

/** The deps that talk to the real Foundry. */
export function foundryHandoutsDeps(): HandoutsDeps {
  return {
    request: (tool, args) => aiToolRequest(tool, args),
    context: worldContext,
    confirmReveal: async (plan): Promise<boolean> => {
      const api = (foundry.applications as { api?: { DialogV2?: DialogV2Like } }).api;
      if (!api?.DialogV2) return false;
      const answer = await api.DialogV2.confirm({
        window: { title: 'Reveal handout' },
        content: renderRevealConfirmHtml(plan),
        yes: { label: 'Reveal' },
        no: { label: 'Cancel' },
        rejectClose: false,
      });
      return answer === true;
    },
    notifyInfo: message => void ui.notifications.info(message),
    notifyError: message => void ui.notifications.error(message),
  };
}

let windowClass: (new () => HandoutsWindowInstance) | null = null;
let instance: HandoutsWindowInstance | null = null;

/** Wait before re-fetching after a push, so a burst of changes is one fetch. */
const PUSH_REFRESH_DEBOUNCE_MS = 300;

function defineWindowClass(): new () => HandoutsWindowInstance {
  const api = (foundry.applications as { api?: { ApplicationV2?: AppV2Constructor } }).api;
  const Base = api?.ApplicationV2;
  if (!Base) throw new Error('This Foundry version has no ApplicationV2');

  type Self = HandoutsWindowInstance;
  const onRefresh = function (this: Self): void {
    void this.controller.load();
  };
  const onRemove = function (this: Self, _event: Event, target: HTMLElement): void {
    const uuid = target.dataset.pageUuid;
    if (uuid) void this.controller.remove(uuid);
  };
  const onReveal = function (this: Self): void {
    // The tick lives in the controller (kept across redraws, cleared after each reveal).
    void this.controller.revealNext();
  };

  class HandoutsWindow extends Base implements HandoutsWindowInstance {
    static DEFAULT_OPTIONS = {
      id: 'fmb-handouts',
      classes: ['fmb-ai-window'],
      tag: 'div',
      window: { title: 'Handouts', icon: 'fa-solid fa-scroll', resizable: true },
      position: { width: 480, height: 600 },
      actions: { refresh: onRefresh, remove: onRemove, reveal: onReveal },
    };

    readonly controller = new HandoutsController(foundryHandoutsDeps(), () => void this.render());
    private stopListening: (() => void) | null = null;
    private pushTimer: ReturnType<typeof setTimeout> | null = null;

    _prepareContext(): Promise<{ view: HandoutsView }> {
      return Promise.resolve({ view: this.controller.view });
    }

    _renderHTML(context: { view: HandoutsView }): Promise<string> {
      return Promise.resolve(renderHandoutsHtml(context.view));
    }

    _replaceHTML(html: string, content: HTMLElement): void {
      bindFields(content, (field, _position, value) => {
        if (field === 'showNow') this.controller.setShowNow(value === true);
      });
      replaceKeepingFocus(content, html);
    }

    _onRender(): void {
      // Re-fetch when the bridge client says the change log changed (a reveal, an undo, a hide).
      this.stopListening ??= onAiChangesUpdated(() => {
        if (this.pushTimer !== null) clearTimeout(this.pushTimer);
        this.pushTimer = setTimeout(() => {
          this.pushTimer = null;
          void this.controller.load();
        }, PUSH_REFRESH_DEBOUNCE_MS);
      });
    }

    _onClose(): void {
      this.controller.resetForm();
      this.stopListening?.();
      this.stopListening = null;
      if (this.pushTimer !== null) clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
  }
  return HandoutsWindow;
}

/** Open the "Handouts" window (one per browser) and fetch the lists. */
export async function openHandoutsWindow(): Promise<void> {
  windowClass ??= defineWindowClass();
  instance ??= new windowClass();
  await instance.render({ force: true });
  instance.bringToFront?.();
  await instance.controller.load();
}

/** Forget the window (tests). */
export function resetHandoutsWindowForTests(): void {
  windowClass = null;
  instance = null;
}
