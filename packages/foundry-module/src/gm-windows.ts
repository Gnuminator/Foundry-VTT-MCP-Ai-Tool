/**
 * "GM windows" (I-134): more of the co-GM dashboard as pop-out windows inside Foundry, so a GM
 * who runs from one screen has them next to the map. Ships dark: the world setting
 * {@link GM_WINDOWS_SETTING} is off by default, and with it off the toolbar buttons are not added
 * and the windows refuse to open.
 *
 * {@link createPanelWindow} is the shared window shell: a read-only panel that draws one HTML
 * string from Foundry's own data and redraws (debounced) when one of its hooks fires. The panels
 * read documents on this GM client and call no bridge tool, so they work with the bridge off and
 * write nothing; GM only, because the panels show monster hit points and hidden combatants.
 */
import { MODULE_ID } from './constants.js';
import { replaceKeepingFocus } from './window-fields.js';

/** The world setting that turns the windows on (the GM sees it in the module settings). */
export const GM_WINDOWS_SETTING = 'gmWindows';

/** Wait before redrawing after a hook, so a burst of changes is one redraw. */
export const PANEL_REFRESH_DEBOUNCE_MS = 200;

/** Register the switch. Call from the module `init` hook. */
export function registerGmWindowsSetting(): void {
  game.settings.register(MODULE_ID, GM_WINDOWS_SETTING, {
    name: 'AI Tool: GM windows (Combat and Party)',
    hint: 'Adds a Combat and a Party button to the AI Tool group in the scene controls (GM only). Each opens a window with the combat order or the party at a glance, so you can run from one screen. Read-only; nothing here changes the game.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
    // The buttons are added when the scene controls are built: build them again.
    onChange: () => {
      try {
        const controls = (ui as unknown as { controls?: { render?(o: object): unknown } }).controls;
        void controls?.render?.({ reset: true });
      } catch (error) {
        console.warn(`[${MODULE_ID}] Could not redraw the scene controls:`, error);
      }
    },
  });
}

/** Whether the GM turned the windows on. A setting that is not registered counts as off. */
export function gmWindowsEnabled(): boolean {
  try {
    return game.settings.get(MODULE_ID, GM_WINDOWS_SETTING) === true;
  } catch {
    return false;
  }
}

/** Whether this client may open a GM window right now. */
export function canOpenGmWindow(): boolean {
  return game.user?.isGM === true && gmWindowsEnabled();
}

/** What a panel is: its window options, the HTML it draws and what makes it redraw. */
export interface PanelSpec {
  id: string;
  title: string;
  icon: string;
  width: number;
  height: number;
  /** Foundry hooks (`updateCombat`, ...) after which the panel redraws. */
  hooks: readonly string[];
  /** The panel's HTML; escapes everything that comes from a document. */
  render(): string;
  /** `data-action` handlers: `target` is the clicked element. */
  actions?: Record<string, (target: HTMLElement) => void | Promise<void>>;
  /** Called each time the window is opened (or brought to the front): a panel that loads data starts it here. */
  onOpen?: () => void;
}

/** What the window needs from `ApplicationV2` (the full class is in Foundry, not in our types). */
interface AppV2Instance {
  /** False while the window is closed (ApplicationV2 sets it). */
  rendered?: boolean;
  render(options?: { force?: boolean }): Promise<unknown>;
  bringToFront?(): void;
  close?(): Promise<unknown>;
}
type AppV2Constructor = new (options?: Record<string, unknown>) => AppV2Instance;

export interface PanelOpener {
  /** Open (or bring to the front) the window; false when the switch is off or this is not a GM. */
  open(): Promise<boolean>;
  /** Draw again now (a panel whose data arrived later); does nothing while the window is closed. */
  redraw(): void;
  /** Forget the window (tests). */
  reset(): void;
}

/**
 * Build the opener for a panel. The window class is made on first use, because Foundry's
 * `ApplicationV2` does not exist when this file is loaded; one window per browser.
 */
export function createPanelWindow(spec: PanelSpec): PanelOpener {
  let windowClass: (new () => AppV2Instance) | null = null;
  let instance: AppV2Instance | null = null;

  const define = (): new () => AppV2Instance => {
    const api = (foundry.applications as { api?: { ApplicationV2?: AppV2Constructor } }).api;
    const Base = api?.ApplicationV2;
    if (!Base) throw new Error('This Foundry version has no ApplicationV2');

    const actions: Record<string, (this: unknown, event: Event, target: HTMLElement) => void> = {};
    for (const [name, handler] of Object.entries(spec.actions ?? {})) {
      actions[name] = function (_event: Event, target: HTMLElement): void {
        void Promise.resolve(handler(target)).catch((error: unknown) => {
          console.error(`[${MODULE_ID}] ${spec.title}: ${name} failed:`, error);
          ui.notifications.error(
            `${spec.title}: ${error instanceof Error ? error.message : String(error)}`
          );
        });
      };
    }

    class PanelWindow extends Base {
      static DEFAULT_OPTIONS = {
        id: spec.id,
        classes: ['fmb-ai-window', 'fmb-gm-window'],
        tag: 'div',
        window: { title: spec.title, icon: spec.icon, resizable: true },
        position: { width: spec.width, height: spec.height },
        actions,
      };

      private hookIds: Array<[string, number]> = [];
      private timer: ReturnType<typeof setTimeout> | null = null;

      _prepareContext(): Promise<{ html: string }> {
        // A switch turned off, or a GM who lost the role, gets nothing drawn.
        return Promise.resolve({ html: canOpenGmWindow() ? spec.render() : '' });
      }

      _renderHTML(context: { html: string }): Promise<string> {
        return Promise.resolve(context.html);
      }

      _replaceHTML(html: string, content: HTMLElement): void {
        replaceKeepingFocus(content, html);
      }

      _onRender(): void {
        if (this.hookIds.length > 0) return;
        for (const name of spec.hooks) {
          const id = Hooks.on(name, () => this.scheduleRedraw());
          this.hookIds.push([name, id]);
        }
      }

      _onClose(): void {
        for (const [name, id] of this.hookIds) Hooks.off(name, id);
        this.hookIds = [];
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
      }

      private scheduleRedraw(): void {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.timer = null;
          this.render().catch((e: unknown): void => {
            console.warn(`${MODULE_ID} | window redraw failed`, e);
          });
        }, PANEL_REFRESH_DEBOUNCE_MS);
      }
    }
    return PanelWindow;
  };

  return {
    async open(): Promise<boolean> {
      if (!canOpenGmWindow()) {
        ui.notifications.warn(
          'The GM windows are off: turn on "AI Tool: GM windows" in the module settings.'
        );
        return false;
      }
      windowClass ??= define();
      instance ??= new windowClass();
      await instance.render({ force: true });
      instance.bringToFront?.();
      spec.onOpen?.();
      return true;
    },
    redraw(): void {
      if (!instance || instance.rendered === false || !canOpenGmWindow()) return;
      instance.render().catch((e: unknown): void => {
        console.warn(`${MODULE_ID} | window redraw failed`, e);
      });
    },
    reset(): void {
      windowClass = null;
      instance = null;
    },
  };
}
