/**
 * The GM-only "AI Tool" group in Foundry's scene controls (the left toolbar).
 *
 * The group is layer-less: it has no canvas layer, so clicking it changes only
 * which tools the toolbar lists. The canvas keeps the layer that was active, and
 * clicking any core group takes the toolbar back. Its tools are plain buttons
 * (`button: true`): a click runs `onChange` at once and nothing becomes the
 * active tool. "AI changes" and "Handouts" are the first two; Tarokka slots in later by
 * adding an entry to {@link AI_TOOL_BUTTONS}.
 */
import { openAiChangesWindow } from './ai-changes-window.js';
import { MODULE_ID } from './constants.js';
import { openHandoutsWindow } from './handouts-window.js';

/** One button of the group. */
export interface AiToolButton {
  name: string;
  title: string;
  icon: string;
  open: () => void | Promise<void>;
}

/** The group's buttons, in toolbar order. */
export const AI_TOOL_BUTTONS: readonly AiToolButton[] = [
  {
    name: 'aiChanges',
    title: 'AI changes',
    icon: 'fa-solid fa-clock-rotate-left',
    open: () => openAiChangesWindow(),
  },
  {
    name: 'handouts',
    title: 'Handouts',
    icon: 'fa-solid fa-scroll',
    open: () => openHandoutsWindow(),
  },
];

/** The group's key in the controls record; after the core groups, which use orders 1 to 10. */
export const AI_TOOL_CONTROL = 'aiTool';
const AI_TOOL_ORDER = 100;

/**
 * Add the "AI Tool" group to Foundry's `controls` record (the argument of the
 * `getSceneControlButtons` hook). Nothing is added for a player.
 */
export function addAiToolControls(
  controls: Record<string, unknown>,
  buttons: readonly AiToolButton[] = AI_TOOL_BUTTONS
): void {
  if (!game.user?.isGM) return;
  const tools: Record<string, unknown> = {};
  buttons.forEach((button, index) => {
    tools[button.name] = {
      name: button.name,
      title: button.title,
      icon: button.icon,
      order: index + 1,
      button: true,
      visible: true,
      onChange: (): void => {
        void Promise.resolve(button.open()).catch((error: unknown) => {
          console.error(`[${MODULE_ID}] Could not open "${button.title}":`, error);
          ui.notifications.error(
            `Could not open "${button.title}": ${error instanceof Error ? error.message : String(error)}`
          );
        });
      },
    };
  });
  controls[AI_TOOL_CONTROL] = {
    name: AI_TOOL_CONTROL,
    title: 'AI Tool',
    icon: 'fa-solid fa-wand-sparkles',
    order: AI_TOOL_ORDER,
    visible: true,
    tools,
  };
}

/** Hook the group into the scene controls (every client; only GMs get it). */
export function registerAiToolControls(): void {
  Hooks.on('getSceneControlButtons', (controls: Record<string, unknown>) => {
    try {
      addAiToolControls(controls);
    } catch (error) {
      console.error(`[${MODULE_ID}] Could not add the AI Tool controls:`, error);
    }
  });
}
