/**
 * The Tarokka card table (D-130 step 2): a window on the GM's screen to place the five cards
 * face down and flip them one at a time, and a window on the players' screens that shows what
 * the GM has put on the table. It replaces the community module `tarokka-reading`.
 *
 * The GM's {@link TableController} reads the reading from the backend (`get-tarokka-reading`),
 * keeps the public table in the world setting {@link TABLE_SETTING} (see tarokka-table-model.ts
 * for what may be in it) and flips a card by planning and applying a normal Tarokka reveal, so
 * the dashboard drawer and the player page show the same cards. Pictures are optional files from
 * the world, kept per card id in {@link IMAGES_SETTING}. Players need no bridge: their window
 * only draws the world setting and opens when the GM shows the table.
 *
 * The controller knows nothing about Foundry's windows; the classes are built on first use
 * because `ApplicationV2` does not exist when this file is loaded.
 */
import { MODULE_ID } from './constants.js';
import { aiToolRequest } from './gm-helper-queries.js';
import { parseRevealPlan } from './handouts-model.js';
import { parseReading } from './tarokka-model.js';
import {
  canFlip,
  emptyGmView,
  emptyTable,
  parsePublicTable,
  placeNext,
  reconcile,
  readingIdOf,
  renderFlipDialogHtml,
  renderGmHtml,
  renderPlayerHtml,
  safeImage,
  sameTable,
  type GmSlot,
  type GmView,
  type PublicTable,
} from './tarokka-table-model.js';
import { bindFields, replaceKeepingFocus } from './window-fields.js';

/** World setting: the public table every client reads. Hidden from the settings menu. */
export const TABLE_SETTING = 'tarokkaTable';
/** World setting: the GM's pictures, `{cardId: path}`. */
export const IMAGES_SETTING = 'tarokkaCardImages';

/** Register the two hidden world settings. Call from the module `init` hook, every client. */
export function registerTarokkaTableSettings(): void {
  game.settings.register(MODULE_ID, TABLE_SETTING, {
    name: 'Tarokka table',
    hint: 'What the Tarokka card table shows the players (face-down cards and the cards the GM flipped).',
    scope: 'world',
    config: false,
    type: Object,
    default: {},
    onChange: () => onTableSettingChanged(),
  });
  game.settings.register(MODULE_ID, IMAGES_SETTING, {
    name: 'Tarokka card pictures',
    hint: 'Pictures the GM attached to cards (a path in the world files).',
    scope: 'world',
    config: false,
    type: Object,
    default: {},
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

/** The pieces of Foundry the controller needs; tests pass fakes. */
export interface TableDeps {
  request(tool: string, args: Record<string, unknown>): Promise<unknown>;
  readTable(): PublicTable;
  writeTable(table: PublicTable): Promise<void>;
  readImages(): Record<string, string>;
  writeImages(images: Record<string, string>): Promise<void>;
  /** Ask the GM to confirm a flip; the text for the players ('' for none), or null on cancel. */
  confirmFlip(label: string, cardName: string): Promise<string | null>;
  /** Let the GM pick an image file; null when they cancel. */
  pickImage(): Promise<string | null>;
  notifyInfo(message: string): void;
  notifyError(message: string): void;
}

/** The GM window's state and flows. */
export class TableController {
  view: GmView = emptyGmView();
  private loadSeq = 0;

  constructor(
    private readonly deps: TableDeps,
    private readonly changed: () => void
  ) {}

  /** Fetch the reading again and bring the public table in step with it. */
  async load(): Promise<void> {
    const seq = ++this.loadSeq;
    this.view = { ...this.view, status: 'loading' };
    this.changed();
    try {
      const result = await this.deps.request('get-tarokka-reading', {});
      const reading = parseReading(result);
      const images = this.deps.readImages();
      const stored = this.deps.readTable();
      const table = reconcile(
        stored,
        reading?.positions ?? null,
        reading ? readingIdOf(result) : '',
        images
      );
      if (seq !== this.loadSeq) return;
      if (!sameTable(stored, table)) await this.deps.writeTable(table);
      const slots: GmSlot[] | null = reading
        ? reading.positions.map(p => ({
            position: p.position,
            label: p.label,
            cardId: p.cardId,
            cardName: p.cardName || p.cardId,
            gmNote: p.gmNote,
            image: safeImage(images[p.cardId]),
          }))
        : null;
      this.view = {
        ...this.view,
        status: 'ready',
        error: '',
        readingSource: reading?.source ?? '',
        slots,
        table,
      };
    } catch (error) {
      if (seq !== this.loadSeq) return;
      this.view = { ...this.view, status: 'error', error: errorMessage(error) };
    }
    this.changed();
  }

  setShowCards(value: boolean): void {
    this.view = { ...this.view, showCards: value };
    this.changed();
  }

  /** The window closed: forget the tick and the reading, so it reopens clean. */
  resetUi(): void {
    this.loadSeq++;
    this.view = emptyGmView();
  }

  private async saveTable(table: PublicTable): Promise<void> {
    await this.deps.writeTable(table);
    this.view = { ...this.view, table };
  }

  /** Run a table action: one at a time, errors shown in the window, then redraw. */
  private async act(run: () => Promise<void>): Promise<void> {
    if (this.view.busy) return;
    this.view = { ...this.view, busy: true, actionError: '' };
    this.changed();
    try {
      await run();
    } catch (error) {
      const message = errorMessage(error);
      this.view = { ...this.view, actionError: message };
      this.deps.notifyError(message);
    }
    this.view = { ...this.view, busy: false };
    this.changed();
  }

  /** Put the next card face down on the table. */
  place(): Promise<void> {
    return this.act(async () => {
      const next = placeNext(this.view.table);
      if (next !== this.view.table) await this.saveTable(next);
    });
  }

  /** Show the table to the players, or stop showing it. */
  setShown(shown: boolean): Promise<void> {
    return this.act(async () => {
      if (shown && this.view.slots === null) throw new Error('There is no reading to show');
      await this.saveTable({ ...this.view.table, shown });
    });
  }

  /** Flip a face-down card: a normal Tarokka reveal, so the dashboard and player page follow. */
  flip(index: number): Promise<void> {
    return this.act(async () => {
      const slot = this.view.slots?.[index];
      if (!slot || !canFlip(this.view.table, index)) return;
      const typed = await this.deps.confirmFlip(slot.label, slot.cardName);
      if (typed === null) return;
      const text = typed.trim() === '' ? slot.cardName : typed.trim();
      const plan = parseRevealPlan(
        await this.deps.request('plan-tarokka-reveal', {
          position: slot.position,
          text,
          title: slot.label,
        })
      );
      if (!plan) throw new Error('The AI Tool made no plan for this flip');
      await this.deps.request('apply-planned-change', {
        planId: plan.planId,
        confirm: true,
        confirmDestructive: true,
      });
      this.deps.notifyInfo(`Flipped: ${slot.label}`);
      await this.load();
    });
  }

  /** Attach a picture from the world's files to the card in this slot. */
  pickPicture(index: number): Promise<void> {
    return this.act(async () => {
      const slot = this.view.slots?.[index];
      if (!slot || slot.cardId === '') return;
      const path = safeImage(await this.deps.pickImage());
      if (!path) return;
      await this.deps.writeImages({ ...this.deps.readImages(), [slot.cardId]: path });
      await this.load();
    });
  }

  clearPicture(index: number): Promise<void> {
    return this.act(async () => {
      const slot = this.view.slots?.[index];
      if (!slot || slot.cardId === '') return;
      const images = { ...this.deps.readImages() };
      delete images[slot.cardId];
      await this.deps.writeImages(images);
      await this.load();
    });
  }
}

// ---------------------------------------------------------------------------
// Foundry glue
// ---------------------------------------------------------------------------

interface DialogV2Like {
  prompt(options: Record<string, unknown>): Promise<unknown>;
}
interface FilePickerLike {
  new (options: Record<string, unknown>): { render(force?: boolean): unknown };
}

function readTableSetting(): PublicTable {
  try {
    return parsePublicTable(game.settings.get(MODULE_ID, TABLE_SETTING));
  } catch {
    return emptyTable();
  }
}

function readImagesSetting(): Record<string, string> {
  try {
    const raw = game.settings.get(MODULE_ID, IMAGES_SETTING) as Record<string, unknown> | null;
    const out: Record<string, string> = {};
    for (const [id, value] of Object.entries(raw ?? {})) {
      const path = safeImage(value);
      if (path) out[id] = path;
    }
    return out;
  } catch {
    return {};
  }
}

/** The deps that talk to the real Foundry. */
export function foundryTableDeps(): TableDeps {
  return {
    request: (tool, args) => aiToolRequest(tool, args),
    readTable: readTableSetting,
    writeTable: async (table): Promise<void> => {
      await game.settings.set(MODULE_ID, TABLE_SETTING, table);
    },
    readImages: readImagesSetting,
    writeImages: async (images): Promise<void> => {
      await game.settings.set(MODULE_ID, IMAGES_SETTING, images);
    },
    confirmFlip: async (label, cardName): Promise<string | null> => {
      const api = (foundry.applications as { api?: { DialogV2?: DialogV2Like } }).api;
      if (!api?.DialogV2) return null;
      const answer = await api.DialogV2.prompt({
        window: { title: 'Flip Tarokka card' },
        content: renderFlipDialogHtml(label, cardName),
        ok: {
          label: 'Flip',
          callback: (_event: unknown, button: { form?: HTMLFormElement }): string => {
            const field = button.form?.elements.namedItem('text') as HTMLTextAreaElement | null;
            return field?.value ?? '';
          },
        },
        rejectClose: false,
      });
      return typeof answer === 'string' ? answer : null;
    },
    pickImage: () =>
      new Promise<string | null>(resolve => {
        const picker = (
          foundry.applications as unknown as {
            apps?: { FilePicker?: { implementation?: FilePickerLike } };
          }
        ).apps?.FilePicker?.implementation;
        if (!picker) {
          resolve(null);
          return;
        }
        void new picker({
          type: 'image',
          callback: (path: string): void => resolve(path),
        }).render(true);
      }),
    notifyInfo: message => void ui.notifications.info(message),
    notifyError: message => void ui.notifications.error(message),
  };
}

interface AppV2Instance {
  render(options?: { force?: boolean }): Promise<unknown>;
  close?(): Promise<unknown>;
  bringToFront?(): void;
  rendered?: boolean;
}
type AppV2Constructor = new (options?: Record<string, unknown>) => AppV2Instance;

interface GmWindowInstance extends AppV2Instance {
  readonly controller: TableController;
}
interface PlayerWindowInstance extends AppV2Instance {
  redraw(): void;
}

function appBase(): AppV2Constructor {
  const api = (foundry.applications as { api?: { ApplicationV2?: AppV2Constructor } }).api;
  if (!api?.ApplicationV2) throw new Error('This Foundry version has no ApplicationV2');
  return api.ApplicationV2;
}

function defineGmWindow(): new () => GmWindowInstance {
  const Base = appBase();
  type Self = GmWindowInstance;
  const indexOf = (target: HTMLElement): number => Number(target.dataset.index ?? -1);
  const onPlace = function (this: Self): void {
    void this.controller.place();
  };
  const onFlip = function (this: Self, _event: Event, target: HTMLElement): void {
    void this.controller.flip(indexOf(target));
  };
  const onShow = function (this: Self): void {
    void this.controller.setShown(true);
  };
  const onHide = function (this: Self): void {
    void this.controller.setShown(false);
  };
  const onRefresh = function (this: Self): void {
    void this.controller.load();
  };
  const onPicture = function (this: Self, _event: Event, target: HTMLElement): void {
    void this.controller.pickPicture(indexOf(target));
  };
  const onPictureClear = function (this: Self, _event: Event, target: HTMLElement): void {
    void this.controller.clearPicture(indexOf(target));
  };

  class TableWindow extends Base implements GmWindowInstance {
    static DEFAULT_OPTIONS = {
      id: 'fmb-tarokka-table-gm',
      classes: ['fmb-ai-window', 'fmb-tt-window'],
      tag: 'div',
      window: { title: 'Tarokka table', icon: 'fa-solid fa-cards', resizable: true },
      position: { width: 860, height: 560 },
      actions: {
        place: onPlace,
        flip: onFlip,
        show: onShow,
        hide: onHide,
        refresh: onRefresh,
        picture: onPicture,
        pictureClear: onPictureClear,
      },
    };

    readonly controller = new TableController(foundryTableDeps(), () => void this.render());

    _prepareContext(): Promise<Record<string, never>> {
      return Promise.resolve({});
    }

    _renderHTML(): Promise<string> {
      return Promise.resolve(renderGmHtml(this.controller.view));
    }

    _replaceHTML(html: string, content: HTMLElement): void {
      bindFields(content, (field, _position, value) => {
        if (field === 'showCards') this.controller.setShowCards(value === true);
      });
      replaceKeepingFocus(content, html);
    }

    _onClose(): void {
      this.controller.resetUi();
    }
  }
  return TableWindow;
}

function definePlayerWindow(): new () => PlayerWindowInstance {
  const Base = appBase();
  class PlayerTableWindow extends Base implements PlayerWindowInstance {
    static DEFAULT_OPTIONS = {
      id: 'fmb-tarokka-table-player',
      classes: ['fmb-tt-window', 'fmb-tt-player'],
      tag: 'div',
      window: { title: 'Tarokka reading', icon: 'fa-solid fa-cards', resizable: true },
      position: { width: 860, height: 380 },
    };

    redraw(): void {
      void this.render();
    }

    _prepareContext(): Promise<Record<string, never>> {
      return Promise.resolve({});
    }

    _renderHTML(): Promise<string> {
      return Promise.resolve(renderPlayerHtml(readTableSetting()));
    }

    _replaceHTML(html: string, content: HTMLElement): void {
      replaceKeepingFocus(content, html);
    }
  }
  return PlayerTableWindow;
}

let gmClass: (new () => GmWindowInstance) | null = null;
let gmInstance: GmWindowInstance | null = null;
let playerClass: (new () => PlayerWindowInstance) | null = null;
let playerInstance: PlayerWindowInstance | null = null;

/** Open the GM's card table (one per browser) and fetch the reading. */
export async function openTarokkaTableWindow(): Promise<void> {
  gmClass ??= defineGmWindow();
  gmInstance ??= new gmClass();
  await gmInstance.render({ force: true });
  gmInstance.bringToFront?.();
  await gmInstance.controller.load();
}

/** Open or close the player table to match the world setting. Players only. */
export function syncPlayerTable(): void {
  if (game.user?.isGM) return;
  const table = readTableSetting();
  if (table.shown) {
    playerClass ??= definePlayerWindow();
    playerInstance ??= new playerClass();
    void playerInstance.render({ force: true });
  } else if (playerInstance?.rendered) {
    void playerInstance.close?.();
  }
}

/** The setting changed on some client: players follow it; a GM's own window already has it. */
export function onTableSettingChanged(): void {
  try {
    syncPlayerTable();
  } catch (error) {
    console.warn(`[${MODULE_ID}] Could not update the Tarokka table:`, error);
  }
}

/** Forget the windows (tests). */
export function resetTarokkaTableWindowsForTests(): void {
  gmClass = null;
  gmInstance = null;
  playerClass = null;
  playerInstance = null;
}
