/**
 * Run mode and Prep mode for Foundry's own screen (per client, CSS only).
 *
 * Run mode hides what a GM never touches mid-session (the extra sidebar tabs and the hotbar) by
 * adding {@link RUN_MODE_CLASS} to the page body; the stylesheet does the hiding. Prep mode
 * removes the class and everything is back. Nothing is deleted or changed on the server: the
 * choice is a client setting (this browser only), and a small "show all" pill is always on
 * screen while Run mode is on, so a hidden tab is never out of reach.
 */
import { MODULE_ID } from './constants.js';

/** The client setting that holds the mode. */
const RUN_MODE_SETTING = 'runMode';
/** Class on the page body while Run mode is on; the stylesheet keys on it. */
export const RUN_MODE_CLASS = 'mcp-run-mode';
/** Id of the "show all" pill. */
export const RUN_MODE_PILL_ID = 'mcp-run-mode-pill';

/** Register the client setting. Call from the module `init` hook. */
export function registerRunModeSetting(): void {
  game.settings.register(MODULE_ID, RUN_MODE_SETTING, {
    name: 'AI Tool: Run mode',
    hint: 'Hides the extra sidebar tabs and the hotbar on this computer only. The "show all" button always brings them back.',
    scope: 'client',
    config: false,
    type: Boolean,
    default: false,
    onChange: () => applyRunMode(),
  });
}

/** Whether Run mode is on for this client. A setting that is not registered counts as off. */
export function runModeEnabled(): boolean {
  try {
    return game.settings.get(MODULE_ID, RUN_MODE_SETTING) === true;
  } catch {
    return false;
  }
}

/** Put the page in line with the setting: the body class and the "show all" pill. */
export function applyRunMode(): void {
  const on = runModeEnabled() && game.user?.isGM === true;
  document.body.classList.toggle(RUN_MODE_CLASS, on);
  document.getElementById(RUN_MODE_PILL_ID)?.remove();
  if (!on) return;
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.id = RUN_MODE_PILL_ID;
  pill.className = 'mcp-run-mode-pill';
  pill.textContent = 'Run mode: show all';
  pill.title = 'Switch to Prep mode and show every tab and the hotbar again';
  pill.addEventListener('click', () => {
    void setRunMode(false);
  });
  document.body.appendChild(pill);
}

/** Switch mode (this client only). */
export async function setRunMode(on: boolean): Promise<void> {
  try {
    await game.settings.set(MODULE_ID, RUN_MODE_SETTING, on);
  } catch (error) {
    console.warn(`[${MODULE_ID}] Could not save the Run mode setting:`, error);
  }
  applyRunMode();
}

/** Scene-controls button: flips the mode. */
export async function toggleRunMode(): Promise<void> {
  await setRunMode(!runModeEnabled());
}

/** Apply the saved mode once the world is ready. */
export function registerRunModeHooks(): void {
  Hooks.once('ready', () => applyRunMode());
}
