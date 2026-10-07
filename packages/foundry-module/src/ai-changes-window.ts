/**
 * The "Changes" window inside Foundry (I-108, I-109 part 4): everyone's changes (players, the
 * GM and the AI) as in the dashboard's Recent Changes, with Undo and Redo, for a GM who runs
 * Foundry in their own browser.
 *
 * The data comes from the backend through {@link aiToolRequest} (a direct call
 * when this browser holds the bridge link, else relayed through the GM client
 * that does). The state and the undo flow live in {@link AiChangesController},
 * which knows nothing about Foundry's windows; the window class only draws the
 * controller's view and forwards clicks, and is built on first use because
 * Foundry's `ApplicationV2` does not exist when this file is loaded.
 *
 * A bridge older than I-109 part 4 does not know `list-changes`: the window then falls back to
 * the AI-only list and the plain `undo-change` flow.
 */
import { BRIDGE_TOO_OLD_MESSAGE } from './constants.js';
import { onAiChangesUpdated } from './ai-changes-signal.js';
import {
  ACTION_YES,
  CHOICE_EVERYTHING_SINCE,
  CHOICE_JUST_THIS,
  CHOICE_REWIND,
  everythingSinceDialog,
  laterChoiceDialog,
  parsePlan,
  redoDialog,
  rewindFirstDialog,
  rewindSecondDialog,
  undoPlanDialog,
  type DialogSpec,
  type UndoPlan,
} from './ai-changes-dialogs.js';
import {
  FILTER_ALL,
  FIRST_PAGE_LIMIT,
  MORE_LIMIT,
  buildRows,
  filterArgs,
  parseNote,
  renderChangesHtml,
  validFilter,
  type ChangeRow,
  type ChangeUser,
  type ChangesView,
} from './ai-changes-model.js';
import { aiToolRequest } from './gm-helper-queries.js';

/** The pieces of Foundry the controller needs; tests pass fakes. */
export interface AiChangesDeps {
  request(tool: string, args: Record<string, unknown>): Promise<unknown>;
  /** Everyone who can be picked in the "Show" filter. */
  users(): ChangeUser[];
  /** Show a dialog; answers the clicked button's action, or null when it was closed. */
  ask(spec: DialogSpec): Promise<string | null>;
  notifyInfo(message: string): void;
  notifyError(message: string): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

/** The bridge is too old to answer the request (it relays this message as it is). */
function bridgeTooOld(error: unknown): boolean {
  return errorMessage(error).includes(BRIDGE_TOO_OLD_MESSAGE);
}

function plural(n: number | null, word: string): string {
  return n === null ? `the ${word}s` : `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** The window's state: what is listed, what is loading, and the undo and redo flows. */
export class AiChangesController {
  view: ChangesView = {
    status: 'loading',
    rows: [],
    error: '',
    note: '',
    limit: FIRST_PAGE_LIMIT,
    busyId: null,
    openIds: new Set<string>(),
    filter: FILTER_ALL,
    users: [],
    legacy: false,
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
      const users = this.deps.users();
      const filter = validFilter(this.view.filter, users);
      const limit = this.view.limit;
      let result: unknown;
      let legacy = false;
      try {
        result = await this.deps.request('list-changes', filterArgs(filter, limit));
      } catch (error) {
        if (!bridgeTooOld(error)) throw error;
        legacy = true;
        result = await this.deps.request('list-recent-changes', { limit });
      }
      next = {
        status: 'ready',
        rows: buildRows(result, { legacy }),
        note: legacy ? '' : parseNote(result),
        error: '',
        legacy,
        users,
        filter: legacy ? FILTER_ALL : filter,
      };
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

  /** Pick who to show (`all`, `ai` or `user:<id>`), from the first page. */
  async setFilter(filter: string): Promise<void> {
    this.view = {
      ...this.view,
      filter: validFilter(filter, this.view.users),
      limit: FIRST_PAGE_LIMIT,
    };
    await this.load();
  }

  /** Back to the first page (the window is one object per browser, so a reopen starts fresh). */
  resetLimit(): void {
    this.view = { ...this.view, limit: FIRST_PAGE_LIMIT };
  }

  /** Remember whether an entry's diff is expanded, without redrawing. */
  setOpen(id: string, open: boolean): void {
    const openIds = new Set(this.view.openIds);
    if (open) openIds.add(id);
    else openIds.delete(id);
    this.view = { ...this.view, openIds };
  }

  /**
   * Undo one change. A bridge that knows `plan-undo-changes` plans it and shows the choices
   * ({@link undoPlanned}); an older one confirms and runs `undo-change`. Conflicts show as the
   * backend words them, and the list reloads after anything was attempted.
   */
  async undo(changeId: string): Promise<void> {
    const row = this.view.rows.find(r => r.id === changeId);
    if (!row || !row.canUndo) return;
    await this.run(changeId, async () => {
      if (this.view.legacy) {
        if (!(await this.confirm(undoPlanDialog(row, legacyPlan(row))))) return false;
        await this.deps.request('undo-change', { changeId, confirm: true });
        this.deps.notifyInfo(`Undone: ${row.summary}`);
        return true;
      }
      return this.undoPlanned(row);
    });
  }

  /** Redo: undo the undo that took the change back, after a confirm that says what comes back. */
  async redo(undoChangeId: string): Promise<void> {
    const row = this.view.rows.find(r => r.redoId === undoChangeId);
    if (!row) return;
    await this.run(undoChangeId, async () => {
      const undo = this.view.rows.find(r => r.id === undoChangeId);
      if (!(await this.confirm(redoDialog(row, undo)))) return false;
      await this.deps.request('undo-change', { changeId: undoChangeId, confirm: true });
      this.deps.notifyInfo(`Redone: ${row.summary}`);
      return true;
    });
  }

  /** One flow at a time: buttons are disabled while it runs; reload when something was attempted. */
  private async run(busyId: string, flow: () => Promise<boolean>): Promise<void> {
    if (this.view.busyId !== null) return;
    this.view = { ...this.view, busyId };
    this.changed();
    let attempted = true;
    try {
      attempted = await flow();
    } catch (error) {
      this.deps.notifyError(errorMessage(error));
    }
    this.view = { ...this.view, busyId: null };
    if (attempted) await this.load();
    else this.changed();
  }

  private async confirm(spec: DialogSpec): Promise<boolean> {
    return (await this.deps.ask(spec)) === ACTION_YES;
  }

  private async plan(
    row: ChangeRow,
    scope: string,
    extra: Record<string, unknown> = {}
  ): Promise<UndoPlan> {
    return parsePlan(await this.deps.request('plan-undo-changes', { id: row.id, scope, ...extra }));
  }

  private async apply(plan: UndoPlan, done: string): Promise<boolean> {
    await this.deps.request('apply-planned-change', {
      planId: plan.planId,
      confirm: true,
      confirmDestructive: plan.confirmDestructive,
    });
    this.deps.notifyInfo(done);
    return true;
  }

  /** The planned undo: just this, everything since, or (under Advanced) the whole table. */
  private async undoPlanned(row: ChangeRow): Promise<boolean> {
    let plan = await this.plan(row, 'just-this');
    if (plan.later.length > 0) {
      const choice = await this.deps.ask(laterChoiceDialog(row, plan.later));
      if (choice === CHOICE_REWIND) return this.rewind(row);
      if (choice === CHOICE_EVERYTHING_SINCE) {
        plan = await this.plan(row, 'everything-since');
        if (!(await this.confirm(everythingSinceDialog(row, plan)))) return false;
        return this.apply(plan, `Undone ${plural(plan.count, 'change')}`);
      }
      if (choice !== CHOICE_JUST_THIS) return false;
      if (!(await this.confirm(undoPlanDialog(row, plan)))) return false;
      return this.apply(plan, `Undone: ${row.summary}`);
    }
    // The latest change on its thing: a plain confirm, with the rewind under Advanced too.
    const choice = await this.deps.ask(undoPlanDialog(row, plan, true));
    if (choice === CHOICE_REWIND) return this.rewind(row);
    if (choice !== ACTION_YES) return false;
    return this.apply(plan, `Undone: ${row.summary}`);
  }

  /** Rewind the whole table to this change: two confirmations, the second names the count. */
  private async rewind(row: ChangeRow): Promise<boolean> {
    const plan = await this.plan(row, 'world-since', { rewindTable: true });
    if (!(await this.confirm(rewindFirstDialog(row, plan)))) return false;
    if (!(await this.confirm(rewindSecondDialog(plan)))) return false;
    return this.apply(plan, `Rewound the table: ${plural(plan.count, 'change')} undone`);
  }
}

/** The old bridge's confirm shows the row's own lines (there is no plan to read them from). */
function legacyPlan(row: ChangeRow): UndoPlan {
  return {
    planId: '',
    summary: row.summary,
    count: 1,
    lines: row.diff,
    notes: [],
    later: [],
    confirmDestructive: false,
  };
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

/** The open dialog, as far as the `render` hook uses it. */
interface DialogLike {
  element: HTMLElement;
  close(): Promise<unknown>;
}

interface DialogV2Like {
  wait(options: Record<string, unknown>): Promise<unknown>;
}

/** Everyone in the world, for the "Show" filter. */
function worldUsers(): ChangeUser[] {
  const users = game.users as unknown as { values(): Iterable<{ id: string; name?: string }> };
  return Array.from(users.values(), u => ({ id: u.id, name: u.name ?? u.id }));
}

/** The deps that talk to the real Foundry. */
export function foundryDeps(): AiChangesDeps {
  return {
    request: (tool, args) => aiToolRequest(tool, args),
    users: worldUsers,
    ask: async (spec): Promise<string | null> => {
      const api = (foundry.applications as { api?: { DialogV2?: DialogV2Like } }).api;
      if (!api?.DialogV2) return null;
      // A button inside the content (`data-choice`, the Advanced rewind) answers by closing the dialog.
      let picked: string | null = null;
      const answer = await api.DialogV2.wait({
        window: { title: spec.title },
        content: spec.content,
        buttons: spec.buttons.map(b => ({
          action: b.action,
          label: b.label,
          default: b.default === true,
        })),
        render: (_event: unknown, dialog: DialogLike): void => {
          for (const el of Array.from(
            dialog.element.querySelectorAll<HTMLElement>('[data-choice]')
          )) {
            el.addEventListener('click', () => {
              picked = el.dataset.choice ?? null;
              void dialog.close();
            });
          }
        },
        rejectClose: false,
      });
      return picked ?? (typeof answer === 'string' ? answer : null);
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
  const onRedo = function (this: Self, _event: Event, target: HTMLElement): void {
    const id = target.dataset.changeId;
    if (id) void this.controller.redo(id);
  };

  class AiChangesWindow extends Base implements AiChangesWindowInstance {
    static DEFAULT_OPTIONS = {
      id: 'fmb-ai-changes',
      classes: ['fmb-ai-window'],
      tag: 'div',
      window: { title: 'Changes', icon: 'fa-solid fa-clock-rotate-left', resizable: true },
      position: { width: 480, height: 560 },
      actions: { refresh: onRefresh, more: onMore, undo: onUndo, redo: onRedo },
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
      for (const select of Array.from(content.querySelectorAll('select[data-fmb-filter]'))) {
        select.addEventListener('change', () => {
          void this.controller.setFilter((select as HTMLSelectElement).value);
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
      this.controller.resetLimit();
      this.stopListening?.();
      this.stopListening = null;
      if (this.pushTimer !== null) clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
  }
  return AiChangesWindow;
}

/** Open the "Changes" window (one per browser) and fetch the list. */
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
