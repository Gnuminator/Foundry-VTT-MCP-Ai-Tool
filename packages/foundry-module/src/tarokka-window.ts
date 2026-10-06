/**
 * The "Tarokka" window inside Foundry (I-108 part 3): the dashboard's Tarokka drawer
 * for a GM who runs Foundry in their own browser. It shows the five positions of the
 * current reading (the cards veiled until "Show cards" is ticked), opens the linked
 * documents, and reveals a position to the players with the text the GM types.
 * Linking cards and dealing or importing a reading stay in the dashboard or with Claude.
 *
 * Every call goes to the backend through {@link aiToolRequest} (a direct call when
 * this browser holds the bridge link, else relayed through the GM client that does).
 * The state and the flows live in {@link TarokkaController}, which knows nothing about
 * Foundry's windows; the window class only draws the controller's view and forwards
 * clicks, and is built on first use because Foundry's `ApplicationV2` does not exist
 * when this file is loaded. The ticks and the typed text live in the controller, so a
 * redraw (Refresh, the change-log signal) keeps an open reveal form as it is.
 */
import { onAiChangesUpdated } from './ai-changes-signal.js';
import { aiToolRequest, openDocumentLocally } from './gm-helper-queries.js';
import { parseRevealPlan, type RevealPlan } from './handouts-model.js';
import {
  checkRevealForm,
  emptyForm,
  parseReading,
  renderTarokkaConfirmHtml,
  renderTarokkaHtml,
  type TarokkaView,
} from './tarokka-model.js';
import { bindFields, replaceKeepingFocus } from './window-fields.js';

/** The pieces of Foundry the controller needs; tests pass fakes. */
export interface TarokkaDeps {
  request(tool: string, args: Record<string, unknown>): Promise<unknown>;
  /** Ask the GM to confirm a reveal; true when they did. */
  confirmReveal(plan: RevealPlan): Promise<boolean>;
  /** Open a linked document on this client. */
  openDocument(uuid: string): Promise<unknown>;
  notifyInfo(message: string): void;
  notifyError(message: string): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

/** The window's state: the reading, the ticks and forms, and the open and reveal flows. */
export class TarokkaController {
  view: TarokkaView = {
    status: 'loading',
    error: '',
    actionError: '',
    reading: null,
    showCards: false,
    forms: {},
    busy: false,
  };
  private loadSeq = 0;

  constructor(
    private readonly deps: TarokkaDeps,
    private readonly changed: () => void
  ) {}

  /** Fetch the reading again; a newer call wins over an older one still running. */
  async load(): Promise<void> {
    const seq = ++this.loadSeq;
    this.view = { ...this.view, status: 'loading' };
    this.changed();
    let next: Partial<TarokkaView>;
    try {
      const reading = parseReading(await this.deps.request('get-tarokka-reading', {}));
      next = { status: 'ready', error: '', reading };
    } catch (error) {
      next = { status: 'error', error: errorMessage(error) };
    }
    if (seq !== this.loadSeq) return;
    this.view = { ...this.view, ...next };
    this.pruneForms();
    this.changed();
  }

  /** Close the forms of positions that are gone or already revealed (the reading changed under them). */
  private pruneForms(): void {
    const reading = this.view.reading;
    const open = new Set(
      reading ? reading.positions.filter(p => !p.revealed).map(p => p.position) : []
    );
    const forms = Object.fromEntries(Object.entries(this.view.forms).filter(([k]) => open.has(k)));
    if (Object.keys(forms).length !== Object.keys(this.view.forms).length) {
      this.view = { ...this.view, forms };
    }
  }

  /** The GM ticked or unticked "Show cards": a redraw shows or veils the cards. */
  setShowCards(value: boolean): void {
    this.view = { ...this.view, showCards: value };
    this.changed();
  }

  /** A field of an open reveal form changed (no redraw: the input already shows it). */
  setField(field: string, position: string | undefined, value: string | boolean): void {
    if (position === undefined) return;
    const form = this.view.forms[position];
    if (!form) return;
    let next = form;
    if (field === 'revealText') next = { ...form, text: String(value) };
    else if (field === 'revealTitle') next = { ...form, title: String(value) };
    else if (field === 'revealShowNow') next = { ...form, showNow: value === true };
    else return;
    this.view = { ...this.view, forms: { ...this.view.forms, [position]: next } };
  }

  /** Open a position's reveal form (an empty one with "Show it now" unticked; an open one stays as typed). */
  openForm(position: string): void {
    if (this.view.busy || this.view.forms[position]) return;
    this.view = { ...this.view, forms: { ...this.view.forms, [position]: emptyForm() } };
    this.changed();
  }

  /** Close a position's reveal form and drop what was typed. */
  closeForm(position: string): void {
    if (this.view.busy || !this.view.forms[position]) return;
    const forms = { ...this.view.forms };
    delete forms[position];
    this.view = { ...this.view, forms };
    this.changed();
  }

  /**
   * The window closed: forget the ticks, the forms and the reading itself, so the next time
   * it opens it is clean and shows nothing of the old reading before the new one arrives.
   */
  resetUi(): void {
    this.loadSeq++; // a load still running must not bring the reading back
    this.view = {
      ...this.view,
      status: 'loading',
      error: '',
      actionError: '',
      reading: null,
      showCards: false,
      forms: {},
    };
  }

  /** Open a linked document on this screen (nothing changes in the world). */
  async openDocument(uuid: string): Promise<void> {
    try {
      await this.deps.openDocument(uuid);
    } catch (error) {
      this.deps.notifyError(errorMessage(error));
    }
  }

  /**
   * Plan the reveal of one position with the typed text, show the plan for the GM to
   * confirm, then apply it. A cancel does nothing (the plan expires by itself). The form's
   * "Show it now" tick is cleared afterwards however this ended; the form closes only
   * after a reveal, so a cancel or a failure keeps the typed text.
   */
  async revealPosition(position: string): Promise<void> {
    const form = this.view.forms[position];
    if (this.view.busy || !form) return;
    const checked = checkRevealForm(form);
    if (!checked.ok) {
      this.failed(checked.error);
      this.changed();
      return;
    }
    this.view = { ...this.view, busy: true, actionError: '' };
    this.changed();
    let revealed = false;
    try {
      const plan = parseRevealPlan(
        await this.deps.request('plan-tarokka-reveal', {
          position,
          text: checked.text,
          ...(checked.title !== '' ? { title: checked.title } : {}),
          ...(form.showNow ? { showNow: true } : {}),
        })
      );
      if (!plan) throw new Error('The AI Tool made no plan for this reveal');
      if (await this.deps.confirmReveal(plan)) {
        const applied = (await this.deps.request('apply-planned-change', {
          planId: plan.planId,
          confirm: true,
          confirmDestructive: true,
        })) as { shown?: { ok?: boolean; error?: string } } | null;
        revealed = true;
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
    // Whatever happened, "Show it now" goes back to unticked; a reveal also closes the form.
    const current = this.view.forms[position];
    const forms = { ...this.view.forms };
    if (revealed) delete forms[position];
    else if (current) forms[position] = { ...current, showNow: false };
    this.view = { ...this.view, busy: false, forms };
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

export interface TarokkaWindowInstance extends AppV2Instance {
  readonly controller: TarokkaController;
}

interface DialogV2Like {
  confirm(options: Record<string, unknown>): Promise<boolean | null>;
}

/** The deps that talk to the real Foundry. */
export function foundryTarokkaDeps(): TarokkaDeps {
  return {
    request: (tool, args) => aiToolRequest(tool, args),
    confirmReveal: async (plan): Promise<boolean> => {
      const api = (foundry.applications as { api?: { DialogV2?: DialogV2Like } }).api;
      if (!api?.DialogV2) return false;
      const answer = await api.DialogV2.confirm({
        window: { title: 'Reveal Tarokka card' },
        content: renderTarokkaConfirmHtml(plan),
        yes: { label: 'Reveal' },
        no: { label: 'Cancel' },
        rejectClose: false,
      });
      return answer === true;
    },
    openDocument: uuid => openDocumentLocally(uuid),
    notifyInfo: message => void ui.notifications.info(message),
    notifyError: message => void ui.notifications.error(message),
  };
}

let windowClass: (new () => TarokkaWindowInstance) | null = null;
let instance: TarokkaWindowInstance | null = null;

/** Wait before re-fetching after a push, so a burst of changes is one fetch. */
const PUSH_REFRESH_DEBOUNCE_MS = 300;

function defineWindowClass(): new () => TarokkaWindowInstance {
  const api = (foundry.applications as { api?: { ApplicationV2?: AppV2Constructor } }).api;
  const Base = api?.ApplicationV2;
  if (!Base) throw new Error('This Foundry version has no ApplicationV2');

  type Self = TarokkaWindowInstance;
  const positionOf = (target: HTMLElement): string => target.dataset.position ?? '';
  const onRefresh = function (this: Self): void {
    void this.controller.load();
  };
  const onOpenDoc = function (this: Self, _event: Event, target: HTMLElement): void {
    const uuid = target.dataset.uuid;
    if (uuid) void this.controller.openDocument(uuid);
  };
  const onRevealOpen = function (this: Self, _event: Event, target: HTMLElement): void {
    this.controller.openForm(positionOf(target));
  };
  const onRevealCancel = function (this: Self, _event: Event, target: HTMLElement): void {
    this.controller.closeForm(positionOf(target));
  };
  const onRevealGo = function (this: Self, _event: Event, target: HTMLElement): void {
    void this.controller.revealPosition(positionOf(target));
  };

  class TarokkaWindow extends Base implements TarokkaWindowInstance {
    static DEFAULT_OPTIONS = {
      id: 'fmb-tarokka',
      classes: ['fmb-ai-window'],
      tag: 'div',
      window: { title: 'Tarokka', icon: 'fa-solid fa-cards', resizable: true },
      position: { width: 520, height: 640 },
      actions: {
        refresh: onRefresh,
        openDoc: onOpenDoc,
        revealOpen: onRevealOpen,
        revealCancel: onRevealCancel,
        revealGo: onRevealGo,
      },
    };

    readonly controller = new TarokkaController(foundryTarokkaDeps(), () => void this.render());
    private stopListening: (() => void) | null = null;
    private pushTimer: ReturnType<typeof setTimeout> | null = null;

    _prepareContext(): Promise<Record<string, never>> {
      return Promise.resolve({});
    }

    _renderHTML(): Promise<string> {
      // Read the state now, not when the render started: a keystroke in between is in it.
      return Promise.resolve(renderTarokkaHtml(this.controller.view));
    }

    _replaceHTML(html: string, content: HTMLElement): void {
      bindFields(content, (field, position, value) => {
        if (field === 'showCards') this.controller.setShowCards(value === true);
        else this.controller.setField(field, position, value);
      });
      replaceKeepingFocus(content, html);
    }

    _onRender(): void {
      // Re-fetch when the bridge client says the change log changed (a reveal, an undo).
      this.stopListening ??= onAiChangesUpdated(() => {
        if (this.pushTimer !== null) clearTimeout(this.pushTimer);
        this.pushTimer = setTimeout(() => {
          this.pushTimer = null;
          void this.controller.load();
        }, PUSH_REFRESH_DEBOUNCE_MS);
      });
    }

    _onClose(): void {
      this.controller.resetUi();
      this.stopListening?.();
      this.stopListening = null;
      if (this.pushTimer !== null) clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
  }
  return TarokkaWindow;
}

/** Open the "Tarokka" window (one per browser) and fetch the reading. */
export async function openTarokkaWindow(): Promise<void> {
  windowClass ??= defineWindowClass();
  instance ??= new windowClass();
  await instance.render({ force: true });
  instance.bringToFront?.();
  await instance.controller.load();
}

/** Forget the window (tests). */
export function resetTarokkaWindowForTests(): void {
  windowClass = null;
  instance = null;
}
