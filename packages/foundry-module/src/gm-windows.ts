/**
 * "GM windows" (I-134): more of the co-GM dashboard as pop-out windows inside Foundry, so a GM
 * who runs from one screen has them next to the map. On by default (W52, 2026-10-29): the world
 * setting {@link GM_WINDOWS_SETTING} can be turned off, and with it off the toolbar buttons are not added
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
    name: 'AI Tool: GM windows',
    hint: 'Adds Combat, Party, Session, Scene and Loot buttons to the AI Tool group in the scene controls (GM only). Each opens a window next to the map: the combat order, the party, the session marker, the scene mood and the coins and loot the party carries. Combat has Previous and Next turn buttons (same as the combat tracker) and Session has Start and End; nothing else here changes the game. Turning this off closes the open windows.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
    // The buttons are added when the scene controls are built: build them again.
    onChange: () => {
      if (!gmWindowsEnabled()) closeGmWindows();
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

/** The windows that are open now, so the switch can close them. */
const openWindows = new Set<{ close?(): Promise<unknown> }>();

/** Close every open GM window (the switch was turned off); a window that is not open stays so. */
export function closeGmWindows(): void {
  for (const window of Array.from(openWindows)) {
    openWindows.delete(window);
    void Promise.resolve(window.close?.()).catch((e: unknown): void => {
      console.warn(`${MODULE_ID} | window close failed`, e);
    });
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
  /** Where the window first opens (pixels from the top left), so the windows do not stack on one spot. */
  left?: number;
  top?: number;
  /** Foundry hooks (`updateCombat`, ...) after which the panel redraws. */
  hooks: readonly string[];
  /** The panel's HTML; escapes everything that comes from a document. */
  render(): string;
  /** `data-action` handlers: `target` is the clicked element. */
  actions?: Record<string, (target: HTMLElement) => void | Promise<void>>;
  /** Called each time the window is opened (or brought to the front): a panel that loads data starts it here. */
  onOpen?: () => void;
  /** Called when the window closes: a panel that started a timer in `onOpen` stops it here. */
  onClose?: () => void;
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
        position: {
          width: spec.width,
          height: spec.height,
          ...(spec.left !== undefined ? { left: spec.left } : {}),
          ...(spec.top !== undefined ? { top: spec.top } : {}),
        },
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
        openWindows.add(this);
        if (this.hookIds.length > 0) return;
        for (const name of spec.hooks) {
          const id = Hooks.on(name, () => this.scheduleRedraw());
          this.hookIds.push([name, id]);
        }
      }

      _onClose(): void {
        openWindows.delete(this);
        for (const [name, id] of this.hookIds) Hooks.off(name, id);
        this.hookIds = [];
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
        spec.onClose?.();
      }

      private scheduleRedraw(): void {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.timer = null;
          // The switch went off (or this GM lost the role) while the window was open: close it, do not blank it.
          if (!canOpenGmWindow()) {
            closeGmWindows();
            return;
          }
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
      // Tracked before the first draw finishes, so a switch turned off during it still closes the window.
      openWindows.add(instance);
      await instance.render({ force: true });
      instance.bringToFront?.();
      spec.onOpen?.();
      return true;
    },
    redraw(): void {
      if (!instance || instance.rendered === false) return;
      if (!canOpenGmWindow()) {
        closeGmWindows();
        return;
      }
      instance.render().catch((e: unknown): void => {
        console.warn(`${MODULE_ID} | window redraw failed`, e);
      });
    },
    reset(): void {
      windowClass = null;
      instance = null;
      openWindows.clear();
    },
  };
}
