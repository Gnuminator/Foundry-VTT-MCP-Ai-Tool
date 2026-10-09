/**
 * Join page look (I-086): The Veil (D-085) on Foundry's join page, the players' first screen.
 *
 * Foundry loads no module code or module styles on /join. It does show three world details
 * there: the background picture, the description (as HTML, unfiltered) and the next session
 * time. So the look lives in the world itself:
 *
 * - the world background points at `styles/join/veil-background.svg` in this module;
 * - one marked `<style>` line at the top of the description imports `styles/join/veil.css`
 *   from this module (relative URL, so a route prefix still works). The rest of the
 *   description is the GM's text and is never changed.
 *
 * The GM applies or removes it from the module settings ("Join page look"). Inside a running
 * world a GM may save world details through Foundry's own `/setup` "editWorld" request (the
 * same one Edit World uses), so no admin password is needed. Not an AI write: a GM click on
 * the world's own settings, outside plan, confirm and undo.
 *
 * Planning is pure (tested); {@link applyJoinLook} takes its Foundry pieces as deps.
 */
import { MODULE_ID } from './constants.js';
import { trackUsage } from './usage-recorder.js';

/** Where the join page files live, relative to Foundry's root (works with a route prefix). */
export const JOIN_ASSET_DIR = `modules/${MODULE_ID}/styles/join`;
export const VEIL_BACKGROUND = `${JOIN_ASSET_DIR}/veil-background.svg`;
export const VEIL_STYLESHEET = `${JOIN_ASSET_DIR}/veil.css`;

/** The line this module puts at the top of the description. */
export const VEIL_STYLE_LINE = `<style data-ai-tool-join="veil">@import url("${VEIL_STYLESHEET}");</style>`;

/** Any line this module put there (any look, any version), plus the space after it. */
const STYLE_LINE_PATTERN = /<style data-ai-tool-join(?:="[^"]*")?>[\s\S]*?<\/style>\s*/gi;

export type JoinLook = 'veil' | 'default';

/** The world details the join page reads. */
export interface WorldJoinFields {
  id: string;
  description?: string | null;
  background?: string | null;
  joinTheme?: string | null;
}

/** The body of Foundry's `/setup` "editWorld" request (a partial update of world.json). */
export interface JoinPageChange {
  action: 'editWorld';
  id: string;
  description: string;
  background?: string | null;
  joinTheme?: 'default';
}

/** The description without this module's style line. */
export function stripJoinStyle(description: string | null | undefined): string {
  return (description ?? '').replace(STYLE_LINE_PATTERN, '');
}

/** Whether The Veil is on the join page now (the style line is in the description). */
export function hasVeilLook(world: WorldJoinFields): boolean {
  return (world.description ?? '').includes('data-ai-tool-join="veil"');
}

/** Whether the world background is The Veil picture. */
export function hasVeilBackground(world: WorldJoinFields): boolean {
  return world.background === VEIL_BACKGROUND;
}

/**
 * The world change for a look. The Veil: the style line on top of the GM's description, The
 * Veil picture when asked for (else the background stays as it is), and Foundry's default join
 * theme when the world uses "Minimal" (it hides the description, and with it the style line).
 * Default: the style line removed, and the background cleared only when it is The Veil picture.
 */
export function planJoinPage(
  world: WorldJoinFields,
  look: JoinLook,
  options: { useBackground?: boolean } = {}
): JoinPageChange {
  const text = stripJoinStyle(world.description);
  const change: JoinPageChange = { action: 'editWorld', id: world.id, description: text };
  if (look === 'veil') {
    change.description = `${VEIL_STYLE_LINE}\n${text}`;
    if (options.useBackground ?? true) change.background = VEIL_BACKGROUND;
    if (world.joinTheme === 'minimal') change.joinTheme = 'default';
  } else if (hasVeilBackground(world)) {
    change.background = null;
  }
  return change;
}

/** The Foundry pieces {@link applyJoinLook} needs; tests pass fakes. */
export interface JoinPageDeps {
  world(): WorldJoinFields;
  /** POST the change to Foundry's `/setup`; resolves with its JSON reply. */
  submit(change: JoinPageChange): Promise<unknown>;
  /** Update the loaded world with the saved details (Foundry's reply). */
  updateWorld(saved: Record<string, unknown>): void;
  notifyInfo(message: string): void;
  notifyError(message: string): void;
}

function replyError(reply: unknown): string | null {
  if (!reply || typeof reply !== 'object') return 'Foundry sent no reply.';
  const error = (reply as { error?: unknown }).error;
  if (error === undefined || error === null || error === '') return null;
  return typeof error === 'string' ? error : JSON.stringify(error);
}

/** Apply a look: plan, save through `/setup`, update the loaded world. True when saved. */
export async function applyJoinLook(
  look: JoinLook,
  options: { useBackground?: boolean },
  deps: JoinPageDeps
): Promise<boolean> {
  const change = planJoinPage(deps.world(), look, options);
  let reply: unknown;
  try {
    reply = await deps.submit(change);
  } catch (error) {
    deps.notifyError(
      `The join page look was not saved: ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
  const error = replyError(reply);
  if (error) {
    deps.notifyError(`The join page look was not saved: ${error}`);
    return false;
  }
  deps.updateWorld(reply as Record<string, unknown>);
  deps.notifyInfo(
    look === 'veil'
      ? 'The Veil is on the join page. Players see it the next time they open the join page.'
      : "The join page is back to Foundry's own look."
  );
  return true;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The dialog text for the world as it is now. */
export function joinPageDialogHtml(world: WorldJoinFields): string {
  const on = hasVeilLook(world);
  const other = world.background && !hasVeilBackground(world) ? world.background : null;
  const now = on
    ? 'The Veil is on the join page now.'
    : "The join page has Foundry's own look now.";
  const backgroundHint = other
    ? `Replaces the current picture (${escapeHtml(other)}). Untick to keep it.`
    : 'The castle in the mist, drawn for this campaign.';
  return [
    '<p>The join page is the first screen players see: the world title, its description, the next session time and the login.</p>',
    '<p>The Veil gives it the campaign look: grey-green mist, the castle picture and a lamplit Join button. Your description text stays as it is; the look is one line added at its top.</p>',
    `<p><strong>${now}</strong></p>`,
    '<div class="form-group">',
    `<label><input type="checkbox" name="useBackground"${other ? '' : ' checked'}> Use The Veil picture as the world background</label>`,
    `<p class="hint">${backgroundHint}</p>`,
    '</div>',
    '<p class="hint">Saving the description in Edit World can drop the look line. If the join page loses the look, open this again and apply it. The next session time is set in Edit World.</p>',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Foundry side: the settings menu dialog and the real deps
// ---------------------------------------------------------------------------

/** Foundry's pieces for {@link applyJoinLook}: `game.world` and a POST to `/setup`. */
export function foundryJoinDeps(): JoinPageDeps {
  return {
    world: () => game.world,
    submit: async (change): Promise<unknown> => {
      const response = await fetch(foundry.utils.getRoute('setup'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(change),
      });
      return response.json() as Promise<unknown>;
    },
    updateWorld: saved => void game.world.updateSource(saved),
    notifyInfo: message => void ui.notifications.info(message),
    notifyError: message => void ui.notifications.error(message),
  };
}

type DialogButtonCallback = (event: Event, button: HTMLButtonElement) => unknown;
type DialogV2Class = new (options: Record<string, unknown>) => object;

/**
 * The "Join page look" settings menu: a DialogV2 (Foundry requires an ApplicationV2 class for
 * a menu). Built at `init`, when Foundry's classes exist; GM only (`restricted`).
 */
export function createJoinPageMenu(): new () => object {
  const api = foundry.applications.api as { DialogV2: DialogV2Class };
  return class JoinPageMenu extends api.DialogV2 {
    constructor() {
      const world = game.world;
      const veil: DialogButtonCallback = async (_event, button) => {
        trackUsage('action', 'module.join-page.veil');
        const box = button.form?.elements.namedItem('useBackground') as {
          checked?: unknown;
        } | null;
        const useBackground = typeof box?.checked === 'boolean' ? box.checked : true;
        return applyJoinLook('veil', { useBackground }, foundryJoinDeps());
      };
      const plain: DialogButtonCallback = async () => {
        trackUsage('action', 'module.join-page.default');
        return applyJoinLook('default', {}, foundryJoinDeps());
      };
      const buttons: Record<string, unknown>[] = [
        {
          action: 'veil',
          label: 'Apply The Veil',
          icon: 'fa-solid fa-moon',
          default: true,
          callback: veil,
        },
      ];
      if (hasVeilLook(world) || hasVeilBackground(world)) {
        buttons.push({
          action: 'default',
          label: "Back to Foundry's look",
          icon: 'fa-solid fa-rotate-left',
          callback: plain,
        });
      }
      buttons.push({ action: 'cancel', label: 'Cancel', icon: 'fa-solid fa-xmark' });
      super({
        window: { title: 'Join page look', icon: 'fa-solid fa-door-open' },
        position: { width: 520 },
        content: joinPageDialogHtml(world),
        buttons,
      });
    }
  };
}
